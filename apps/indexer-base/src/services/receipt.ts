import { difference, uniq } from 'lodash-es';
import { types } from 'near-lake-framework';

import { Knex } from 'nb-knex';
import { logger } from 'nb-logger';
import {
  ActionReceiptAction,
  ActionReceiptOutputData,
  Receipt,
} from 'nb-types';
import { retry } from 'nb-utils';

import redis, { redisClient } from '#libs/redis';
import { mapActionKind, mapReceiptKind } from '#libs/utils';

export const storeReceipts = async (
  knex: Knex,
  message: types.StreamerMessage,
) => {
  const chunks = message.shards.flatMap((shard) => shard.chunk || []);

  await Promise.all(
    chunks.map(async (chunk) => {
      if (chunk.receipts.length) {
        await storeChunkReceipts(
          knex,
          chunk.header.chunkHash,
          message.block.header.hash,
          message.block.header.timestampNanosec,
          chunk.receipts,
        );
      }
    }),
  );
};

const storeChunkReceipts = async (
  knex: Knex,
  chunkHash: string,
  blockHash: string,
  blockTimestamp: string,
  receipts: types.Receipt[],
) => {
  const receiptOrDataIds = receipts.map((receipt) =>
    'Data' in receipt.receipt ? receipt.receipt.Data.dataId : receipt.receiptId,
  );
  const txnHashes = await getTxnHashes(knex, blockHash, receiptOrDataIds);

  const receiptData: Receipt[] = [];
  const receiptActionsData: ActionReceiptAction[] = [];
  const receiptOutputData: ActionReceiptOutputData[] = [];

  receipts.forEach((receipt, receiptIndex) => {
    const receiptOrDataId: string =
      'Data' in receipt.receipt
        ? receipt.receipt.Data.dataId
        : receipt.receiptId;
    const txnHash = txnHashes.get(receiptOrDataId);

    if (!txnHash) {
      throw new Error(`no parent transaction for receipt: ${receiptOrDataId}`);
    }

    if ('Action' in receipt.receipt) {
      receipt.receipt.Action.outputDataReceivers.forEach((receiver) => {
        receiptOutputData.push(
          getActionReceiptOutputData(blockTimestamp, receiptOrDataId, receiver),
        );
      });

      receipt.receipt.Action.actions.forEach((action, actionIndex) => {
        receiptActionsData.push(
          getActionReceiptActionData(
            blockTimestamp,
            receiptOrDataId,
            actionIndex,
            action,
            receipt.predecessorId,
            receipt.receiverId,
          ),
        );
      });
    }

    receiptData.push(
      getReceiptData(
        receipt,
        chunkHash,
        blockHash,
        blockTimestamp,
        txnHash,
        receiptIndex,
      ),
    );
  });

  if (receiptData.length) {
    await retry(async () => {
      await knex('receipts')
        .insert(receiptData)
        .onConflict(['receipt_id', 'included_in_block_timestamp'])
        .ignore();
    });
  }

  if (receiptActionsData.length) {
    await retry(async () => {
      await knex('action_receipt_actions')
        .insert(receiptActionsData)
        .onConflict([
          'receipt_id',
          'index_in_action_receipt',
          'receipt_included_in_block_timestamp',
        ])
        .ignore();
    });
  }

  if (receiptOutputData.length) {
    await retry(async () => {
      await knex('action_receipt_output_data')
        .insert(receiptOutputData)
        .onConflict([
          'output_data_id',
          'output_from_receipt_id',
          'receipt_included_in_block_timestamp',
        ])
        .ignore();
    });
  }
};

const getTxnHashes = async (knex: Knex, blockHash: string, ids: string[]) => {
  const receiptOrDataIds = uniq(ids);
  let txnHashes = await retry(async () => {
    return await fetchTxnHashesFromCache(receiptOrDataIds);
  });

  if (txnHashes.size === receiptOrDataIds.length) {
    return txnHashes;
  }

  logger.warn(
    {
      block: blockHash,
      receiptOrDataIds: receiptOrDataIds,
      txnHashes: [...txnHashes.keys()],
    },
    'missing parent txn hash(es) in cache... checking in db...',
  );

  txnHashes = await retry(async () => {
    return await fetchTxnHashesFromDB(knex, receiptOrDataIds);
  });

  return txnHashes;
};

const fetchTxnHashesFromCache = async (receiptOrDataIds: string[]) => {
  const txnHashes: Map<string, string> = new Map();
  const hashes = await redisClient.mget(redis.prefixedKeys(receiptOrDataIds));

  hashes.forEach((hash, i) => {
    if (hash) txnHashes.set(receiptOrDataIds[i], hash);
  });

  return txnHashes;
};

const fetchTxnHashesFromDB = async (knex: Knex, receiptOrDataIds: string[]) => {
  const txnHashes: Map<string, string> = new Map();
  const receiptOutputs = await knex('action_receipt_output_data')
    .innerJoin(
      'receipts',
      'action_receipt_output_data.output_from_receipt_id',
      'receipts.receipt_id',
    )
    .whereIn('output_data_id', receiptOrDataIds)
    .select('output_data_id', 'originated_from_transaction_hash');

  receiptOutputs.forEach((outputReceipt) => {
    txnHashes.set(
      outputReceipt.output_data_id,
      outputReceipt.originated_from_transaction_hash,
    );
  });

  if (txnHashes.size === receiptOrDataIds.length) {
    return txnHashes;
  }

  const outcomeReceipts = await knex('execution_outcome_receipts')
    .innerJoin(
      'receipts',
      'execution_outcome_receipts.executed_receipt_id',
      'receipts.receipt_id',
    )
    .whereIn('produced_receipt_id', receiptOrDataIds)
    .select('produced_receipt_id', 'originated_from_transaction_hash');

  outcomeReceipts.forEach((outcomeReceipt) => {
    txnHashes.set(
      outcomeReceipt.produced_receipt_id,
      outcomeReceipt.originated_from_transaction_hash,
    );
  });

  if (txnHashes.size === receiptOrDataIds.length) {
    return txnHashes;
  }

  const transactions = await knex('transactions')
    .whereIn('converted_into_receipt_id', receiptOrDataIds)
    .select('converted_into_receipt_id', 'transaction_hash');

  transactions.forEach((transaction) => {
    txnHashes.set(
      transaction.converted_into_receipt_id,
      transaction.transaction_hash,
    );
  });

  if (txnHashes.size === receiptOrDataIds.length) {
    return txnHashes;
  }

  throw new Error(
    `missing parent txn hash(es) in db...${JSON.stringify({
      receiptOrDataIds: difference(receiptOrDataIds, [...txnHashes.keys()]),
    })}`,
  );
};

const getReceiptData = (
  receipt: types.Receipt,
  chunkHash: string,
  blockHash: string,
  blockTimestamp: string,
  transactionHash: string,
  indexInChunk: number,
): Receipt => ({
  included_in_block_hash: blockHash,
  included_in_block_timestamp: blockTimestamp,
  included_in_chunk_hash: chunkHash,
  index_in_chunk: indexInChunk,
  originated_from_transaction_hash: transactionHash,
  predecessor_account_id: receipt.predecessorId,
  receipt_id: receipt.receiptId,
  receipt_kind: mapReceiptKind(receipt.receipt),
  receiver_account_id: receipt.receiverId,
});

const getActionReceiptActionData = (
  blockTimestamp: string,
  receiptId: string,
  actionIndex: number,
  action: types.Action,
  predecessorId: string,
  receiverId: string,
): ActionReceiptAction => {
  const { args, kind } = mapActionKind(action);

  return {
    action_kind: kind,
    args,
    index_in_action_receipt: actionIndex,
    receipt_id: receiptId,
    receipt_included_in_block_timestamp: blockTimestamp,
    receipt_predecessor_account_id: predecessorId,
    receipt_receiver_account_id: receiverId,
  };
};

const getActionReceiptOutputData = (
  blockTimestamp: string,
  receiptId: string,
  dataReceiver: types.DataReceiver,
): ActionReceiptOutputData => ({
  output_data_id: dataReceiver.dataId,
  output_from_receipt_id: receiptId,
  receipt_included_in_block_timestamp: blockTimestamp,
  receiver_account_id: dataReceiver.receiverId,
});
