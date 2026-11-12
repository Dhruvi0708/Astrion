import { describe, expect, it } from 'vitest';
import { safeNext } from './AuthPages';

describe('safeNext (open-redirect protection)', () => {
  it.each([
    [null, '/app/overview'],
    ['/app/sources?new=1', '/app/sources?new=1'],
    [encodeURIComponent('/app/universe?node=x'), '/app/universe?node=x'],
    ['https://evil.example', '/app/overview'],
    ['//evil.example/app', '/app/overview'],
    ['/login', '/app/overview'],
    ['%E0%A4%A', '/app/overview'],
  ])('%s → %s', (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });
});
