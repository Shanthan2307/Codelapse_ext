/** Formatting shared by the pages. Dates use one fixed locale so pages read the same everywhere. */
const DATE_TIME = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
});

const SHORT_DATE_TIME = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** "Nov 2, 7:50 AM", for tables. */
export function formatShortDateTime(value: number | string): string {
  return SHORT_DATE_TIME.format(new Date(value));
}

export function formatDateTime(value: number | string): string {
  return DATE_TIME.format(new Date(value));
}

/** "1 h 5 min", "12 min", "40 s". */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) {
    return `${hours} h ${minutes} min`;
  }
  if (minutes > 0) {
    return `${minutes} min`;
  }
  return `${totalSeconds} s`;
}

/** Time into a session as mm:ss (or h:mm:ss). */
export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(hours > 0 ? 2 : 1, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

export function plural(count: number, one: string, many: string = `${one}s`): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}
