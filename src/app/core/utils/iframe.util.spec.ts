import { describe, expect, it } from 'vitest';
import { isEmbeddedInIframe } from './iframe.util';

describe('isEmbeddedInIframe (#1062)', () => {
  it('returns false at the top level (self === top)', () => {
    const win = {} as { self: unknown; top: unknown };
    win.self = win;
    win.top = win;
    expect(isEmbeddedInIframe(win)).toBe(false);
  });

  it('returns true inside an iframe (self !== top)', () => {
    const top = { name: 'host' };
    const win = { self: null as unknown, top };
    win.self = win;
    expect(isEmbeddedInIframe(win)).toBe(true);
  });

  it('returns true when reading top throws (cross-origin host)', () => {
    const win = {
      get self() { return win; },
      get top(): unknown { throw new Error('SecurityError: cross-origin'); }
    };
    expect(isEmbeddedInIframe(win)).toBe(true);
  });
});
