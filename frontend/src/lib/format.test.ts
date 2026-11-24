import { expect, it } from 'vitest';
import { parseTime, relativeTime } from './format';

it('reads timestamps without an offset as UTC, never local time', () => {
  expect(parseTime('2026-11-24T10:00:00').getTime()).toBe(Date.UTC(2026, 10, 24, 10));
  expect(parseTime('2026-11-24T15:30:00+05:30').getTime()).toBe(Date.UTC(2026, 10, 24, 10));
  expect(relativeTime('2026-11-24T10:00:00', Date.UTC(2026, 10, 24, 10, 5))).toBe('5 minutes ago');
});
