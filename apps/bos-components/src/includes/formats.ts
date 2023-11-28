export function localFormat(number: number) {
  const formattedNumber = Number(number).toLocaleString('en', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 5,
  });
  return formattedNumber;
}

export function dollarFormat(number: number) {
  const formattedNumber = Number(number).toLocaleString('en', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return formattedNumber;
}

export function weight(number: number) {
  const suffixes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  let suffixIndex = 0;

  while (number >= 1000 && suffixIndex < suffixes.length - 1) {
    number /= 1000;
    suffixIndex++;
  }

  return number.toFixed(2) + ' ' + suffixes[suffixIndex];
}

export function convertToUTC(timestamp: number, hour: boolean) {
  const date = new Date(timestamp);

  // Get UTC date components
  const utcYear = date.getUTCFullYear();
  const utcMonth = ('0' + (date.getUTCMonth() + 1)).slice(-2); // Adding 1 because months are zero-based
  const utcDay = ('0' + date.getUTCDate()).slice(-2);
  const utcHours = ('0' + date.getUTCHours()).slice(-2);
  const utcMinutes = ('0' + date.getUTCMinutes()).slice(-2);
  const utcSeconds = ('0' + date.getUTCSeconds()).slice(-2);

  // Array of month abbreviations
  const monthAbbreviations = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const monthIndex = Number(utcMonth) - 1;
  // Format the date as required (Jul-25-2022 16:25:37)
  const formattedDate =
    monthAbbreviations[monthIndex] +
    '-' +
    utcDay +
    '-' +
    utcYear +
    ' ' +
    utcHours +
    ':' +
    utcMinutes +
    ':' +
    utcSeconds;

  if (hour) {
    const currentDate = new Date();
    const differenceInSeconds = Math.floor(
      (currentDate.getTime() - date.getTime()) / 1000,
    );

    if (differenceInSeconds < 60) {
      return 'a few seconds ago';
    } else if (differenceInSeconds < 3600) {
      const minutes = Math.floor(differenceInSeconds / 60);
      return minutes + ' minute' + (minutes !== 1 ? 's' : '') + ' ago';
    } else if (differenceInSeconds < 86400) {
      const hours = Math.floor(differenceInSeconds / 3600);
      return hours + ' hour' + (hours !== 1 ? 's' : '') + ' ago';
    }

    return formattedDate;
  }

  return formattedDate;
}

export function getTimeAgoString(timestamp: number) {
  const currentUTC = Date.now();
  const date = new Date(timestamp);
  const seconds = Math.floor((currentUTC - date.getTime()) / 1000);

  const intervals = {
    year: seconds / (60 * 60 * 24 * 365),
    month: seconds / (60 * 60 * 24 * 30),
    week: seconds / (60 * 60 * 24 * 7),
    day: seconds / (60 * 60 * 24),
    hour: seconds / (60 * 60),
    minute: seconds / 60,
  };

  if (intervals.year > 1) {
    return Math.floor(intervals.year) + ' years ago';
  } else if (intervals.month > 1) {
    return Math.floor(intervals.month) + ' months ago';
  } else if (intervals.week > 1) {
    return Math.floor(intervals.week) + ' weeks ago';
  } else if (intervals.day > 1) {
    return Math.floor(intervals.day) + ' days ago';
  } else if (intervals.hour > 1) {
    return Math.floor(intervals.hour) + ' hours ago';
  } else if (intervals.minute > 1) {
    return Math.floor(intervals.minute) + ' minutes ago';
  } else {
    return 'a few seconds ago';
  }
}

export function formatTimestampToString(timestamp: number) {
  const date = new Date(timestamp);

  // Format the date to 'YYYY-MM-DD HH:mm:ss' format
  const formattedDate = date.toISOString().replace('T', ' ').split('.')[0];

  return formattedDate;
}
