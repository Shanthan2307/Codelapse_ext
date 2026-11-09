export type CsvValue = string | number | boolean | null | undefined;

/** One CSV field, quoted when it contains a comma, quote or line break (RFC 4180). */
export function csvField(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A CSV document with a header row; columns are given in order. */
export function toCsv<T extends Record<string, CsvValue>>(columns: (keyof T & string)[], rows: T[]): string {
  const lines = [columns.map(csvField).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => csvField(row[c])).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
