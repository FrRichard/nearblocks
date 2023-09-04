// Only implemented token transfers
import { Knex } from 'knex';
import { types } from 'near-lake-framework';

import log from '#libs/log';
import { EventType } from '#services/events';
import { isExecutionSuccess } from '#libs/utils';
import { isFunctionCallAction } from '#libs/guards';
import {
  FtEventEntry,
  EventContract,
  AssetsFungibleTokenEvent,
} from '#ts/types';
import {
  getFTData,
  saveFTData,
  ftTransfer,
  ftTransferCall,
  ftResolveTransfer,
} from '#services/ft';

const EVENT_TYPE = EventType.META_POOL_NEAR;

const contract: EventContract = async (
  knex: Knex,
  block: types.BlockHeader,
  shardId: number,
  outcome: types.ExecutionOutcomeWithReceipt,
) => {
  try {
    if (
      outcome.receipt &&
      isExecutionSuccess(outcome.executionOutcome.outcome.status)
    ) {
      const events: AssetsFungibleTokenEvent[] = [];
      const predecessor = outcome.receipt.predecessorId;
      const logs = outcome.executionOutcome.outcome.logs;
      const receipt = {
        receiptId: outcome.receipt.receiptId,
        blockTimestamp: block.timestampNanosec,
        shardId: shardId,
        eventType: EVENT_TYPE,
        receiverId: outcome.receipt.receiverId,
      };

      if ('Action' in outcome.receipt.receipt) {
        outcome.receipt.receipt.Action?.actions.forEach((action) => {
          if (isFunctionCallAction(action)) {
            try {
              const eventItems = matchActions(action, predecessor, logs);

              if (eventItems.length) {
                eventItems.forEach((eventItem) =>
                  events.push(getFTData(receipt, events.length, eventItem)),
                );
              }
            } catch (error) {
              log.error(error);
            }
          }
        });
      }

      if (events.length) {
        await saveFTData(knex, events);
      }
    }
  } catch (error) {
    log.error(error);
  }
};

const matchActions = (
  action: types.FunctionCallAction,
  predecessor: string,
  logs: string[],
): FtEventEntry[] => {
  switch (action.FunctionCall.methodName) {
    case 'ft_transfer': {
      return ftTransfer(action.FunctionCall.args, predecessor);
    }
    case 'ft_transfer_call': {
      return ftTransferCall(action.FunctionCall.args, predecessor);
    }
    case 'ft_resolve_transfer': {
      return ftResolveTransfer(logs);
    }
    default:
      return [];
  }
};

export default contract;
