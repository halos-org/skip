import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installLongPress } from './widget-removal-bridge';

// jsdom lacks a PointerEvent constructor; a MouseEvent carries clientX/clientY, and isPrimary is
// added so the handler's primary-pointer guard passes.
function pointer(type: string, x = 0, y = 0): Event {
  const e = new MouseEvent(type, { clientX: x, clientY: y });
  Object.defineProperty(e, 'isPrimary', { value: true });
  return e;
}

describe('installLongPress', () => {
  let teardown: () => void = () => undefined;

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { teardown(); teardown = () => undefined; vi.useRealTimers(); });

  it('fires onLongPress after a stationary hold', () => {
    const cb = vi.fn();
    teardown = installLongPress(cb);
    window.dispatchEvent(pointer('pointerdown', 10, 10));
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1500);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('does not fire when the press is released early', () => {
    const cb = vi.fn();
    teardown = installLongPress(cb);
    window.dispatchEvent(pointer('pointerdown', 10, 10));
    vi.advanceTimersByTime(500);
    window.dispatchEvent(pointer('pointerup', 10, 10));
    vi.advanceTimersByTime(2000);
    expect(cb).not.toHaveBeenCalled();
  });

  it('cancels when the pointer moves beyond the slop', () => {
    const cb = vi.fn();
    teardown = installLongPress(cb);
    window.dispatchEvent(pointer('pointerdown', 10, 10));
    window.dispatchEvent(pointer('pointermove', 40, 40));
    vi.advanceTimersByTime(1500);
    expect(cb).not.toHaveBeenCalled();
  });

  it('stops listening after teardown', () => {
    const cb = vi.fn();
    installLongPress(cb)();
    window.dispatchEvent(pointer('pointerdown', 10, 10));
    vi.advanceTimersByTime(1500);
    expect(cb).not.toHaveBeenCalled();
  });
});
