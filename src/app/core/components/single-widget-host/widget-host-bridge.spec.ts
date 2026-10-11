import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetHostBridge, installLongPress, parseStoredConfig, readTileConfig, tileConfigState } from './widget-host-bridge';
import type { IWidgetSvcConfig } from '../../interfaces/widgets-interface';
import { LATEST_APP_CONFIG_VERSION } from '../../constants/config-versions.const';

// Fake plotter-extension client so the bus loop can be exercised without a real host.
const bus = vi.hoisted(() => {
  let stored: Record<string, unknown> = {};
  let onStateChanged: (() => void) | null = null;
  const client = {
    call: () => Promise.resolve({}),
    close: () => undefined,
    state: {
      get: () => Promise.resolve(stored),
      set: () => Promise.resolve()
    },
    subscribe: (_patterns: string[], cb: () => void) => {
      onStateChanged = cb;
      return Promise.resolve(async () => undefined);
    }
  };
  return {
    client,
    setState: (values: Record<string, unknown>) => { stored = values; },
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

// An autopilot tile config the v18 -> v19 step changes: its dead windAngleTrueWater slot is deleted.
const v18AutopilotTile = (): IWidgetSvcConfig => ({
  paths: { windAngleTrueWater: { path: 'self.environment.wind.angleTrueWater' } }
} as unknown as IWidgetSvcConfig);

describe('readTileConfig', () => {
  it('reads an unstamped tile config as the version before the stamp existed', () => {
    // Version 19: the v19 -> v20 step converts the Wind Steer close-hauled angle to rad.
    expect(readTileConfig('widget-wind-steer', { config: { updateInterval: 1000, laylineAngle: 30 } }))
      .toEqual({ updateInterval: 1000, closeHauledLineAngle: 30 * Math.PI / 180 });
  });

  it('migrates a tile config from its stamped version', () => {
    const migrated = readTileConfig('widget-autopilot', { config: v18AutopilotTile(), configVersion: 18 });

    expect((migrated?.paths as unknown as Record<string, unknown>)['windAngleTrueWater']).toBeUndefined();
  });

  it('applies a config stamped with the current version as saved', () => {
    const cfg = { updateInterval: 2000 } as IWidgetSvcConfig;

    expect(readTileConfig('widget-wind-steer', tileConfigState(cfg))).toEqual(cfg);
  });

  it('ignores a tile config that cannot be migrated, with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(readTileConfig('widget-wind-steer', { config: { updateInterval: 1000 }, configVersion: LATEST_APP_CONFIG_VERSION + 1 })).toBeNull();
    expect(readTileConfig('widget-wind-steer', { config: { updateInterval: 1000 }, configVersion: 'v19' })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('reads no config when none is saved', () => {
    expect(readTileConfig('widget-wind-steer', {})).toBeNull();
    expect(readTileConfig('widget-wind-steer', { configVersion: LATEST_APP_CONFIG_VERSION })).toBeNull();
  });
});

describe('tileConfigState', () => {
  it('stamps the saved config with the current version beside it, not inside it', () => {
    const cfg = { updateInterval: 2000 } as IWidgetSvcConfig;

    expect(tileConfigState(cfg)).toEqual({ config: cfg, configVersion: LATEST_APP_CONFIG_VERSION });
    expect(cfg).toEqual({ updateInterval: 2000 });
  });
});

describe('WidgetHostBridge', () => {
  it('loads the saved per-instance config on connect and follows later state.changed events', async () => {
    bus.setState({ config: { updateInterval: 3000 } });
    const bridge = new WidgetHostBridge();
    bridge.enable('widget-wind-steer');
    await vi.waitFor(() => expect(bridge.config()).toEqual({ updateInterval: 3000 }));

    bus.setState({ config: { updateInterval: 5000 } });
    bus.fireStateChanged();
    await vi.waitFor(() => expect(bridge.config()).toEqual({ updateInterval: 5000 }));

    bridge.disable();
  });

  it('migrates the saved config for the hosted widget type before exposing it', async () => {
    bus.setState({ config: v18AutopilotTile(), configVersion: 18 });
    const bridge = new WidgetHostBridge();
    bridge.enable('widget-autopilot');

    await vi.waitFor(() => expect(bridge.config()).not.toBeNull());
    expect((bridge.config()?.paths as unknown as Record<string, unknown>)['windAngleTrueWater']).toBeUndefined();

    bridge.disable();
  });

  it('exposes no config when the saved one cannot be migrated, so the widget keeps its defaults', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    bus.setState({ config: { updateInterval: 3000 }, configVersion: LATEST_APP_CONFIG_VERSION + 1 });
    const bridge = new WidgetHostBridge();
    bridge.enable('widget-wind-steer');

    // The warning is raised after the saved config was read, so the bridge has settled by then.
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(bridge.config()).toBeNull();

    bridge.disable();
    warn.mockRestore();
  });
});
