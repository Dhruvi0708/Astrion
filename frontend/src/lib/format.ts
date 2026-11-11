const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function pluralize(n: number, word: string, plural = `${word}s`) {
  return `${n.toLocaleString()} ${n === 1 ? word : plural}`;
}
