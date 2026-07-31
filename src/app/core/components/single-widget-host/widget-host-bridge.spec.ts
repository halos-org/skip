import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetHostBridge, installLongPress, parseStoredConfig } from './widget-host-bridge';

// Fake plotter-extension client so the bus loop can be exercised without a real host.
const bus = vi.hoisted(() => {
  let stored: unknown;
  let onStateChanged: (() => void) | null = null;
  const client = {
    call: () => Promise.resolve({}),
    close: () => undefined,
    state: {
      get: () => Promise.resolve({ config: stored }),
      set: () => Promise.resolve()
    },
    subscribe: (_patterns: string[], cb: () => void) => {
      onStateChanged = cb;
      return Promise.resolve(async () => undefined);
    }
  };
  return {
    client,
    setStored: (v: unknown) => { stored = v; },
    fireStateChanged: () => onStateChanged?.()
  };
});
vi.mock('signalk-plotterext-bus/extension', () => ({ connectExtension: () => Promise.resolve(bus.client) }));

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

describe('parseStoredConfig', () => {
  it('accepts a plain object as a config', () => {
    expect(parseStoredConfig({ updateInterval: 1000 })).toEqual({ updateInterval: 1000 });
  });

  it('rejects null, undefined, primitives, and arrays', () => {
    expect(parseStoredConfig(null)).toBeNull();
    expect(parseStoredConfig(undefined)).toBeNull();
    expect(parseStoredConfig('config')).toBeNull();
    expect(parseStoredConfig(42)).toBeNull();
    expect(parseStoredConfig([{ a: 1 }])).toBeNull();
  });
});

describe('WidgetHostBridge', () => {
  it('loads the saved per-instance config on connect and follows later state.changed events', async () => {
    bus.setStored({ updateInterval: 3000 });
    const bridge = new WidgetHostBridge();
    bridge.enable();
    await vi.waitFor(() => expect(bridge.config()).toEqual({ updateInterval: 3000 }));

    bus.setStored({ updateInterval: 5000 });
    bus.fireStateChanged();
    await vi.waitFor(() => expect(bridge.config()).toEqual({ updateInterval: 5000 }));

    bridge.disable();
  });
});
