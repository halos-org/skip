import { describe, expect, it, vi } from 'vitest';
import {
  ConfigTooOldError,
  SI_VERSION_KEY,
  V22_MEASURE_TO_SI,
  applySiSteps,
  MIN_MIGRATABLE_APP_CONFIG_VERSION,
  MigrationMessageSink,
  migrateConfig,
  migrateOneAppVersion,
  migrateWidgetConfig,
  removeSplitShellConfigKeys
} from './config-migration.util';
import { IAppConfig, IConfig } from '../interfaces/app-settings.interfaces';
import { IWidgetSvcConfig } from '../interfaces/widgets-interface';
import { LATEST_APP_CONFIG_VERSION } from '../constants/config-versions.const';

const configAt = (version: unknown): IConfig =>
  ({
    app: version === undefined ? {} : { configVersion: version },
    theme: { themeName: '' },
    dashboards: []
  } as unknown as IConfig);

function recordingSink(): MigrationMessageSink & { infos: string[]; errors: string[] } {
  const infos: string[] = [];
  const errors: string[] = [];
  return { infos, errors, info: m => infos.push(m), error: m => errors.push(m) };
}

// A v18 dashboard holding one autopilot whose windAngleTrueWater slot the v18 -> v19 step deletes.
const v18AutopilotConfig = (): IConfig =>
  ({
    app: { configVersion: 18 },
    theme: { themeName: '' },
    dashboards: [{
      id: 'd1',
      configuration: [{
        id: 'w1',
        selector: 'widget-host2',
        input: { widgetProperties: { type: 'widget-autopilot', uuid: 'w1', config: {
          paths: { headingTrue: { path: 'self.navigation.headingTrue', isPathConfigurable: true }, windAngleTrueWater: { path: 'x' } }
        } } }
      }]
    }]
  } as unknown as IConfig);

describe('migrateConfig (in-memory migration chain)', () => {
  it('returns a current-version config unchanged, running no step', () => {
    const config = configAt(LATEST_APP_CONFIG_VERSION);
    const result = migrateConfig(config, recordingSink());

    expect(result.migrated).toBe(false);
    expect(result.config).toEqual(config);
  });

  it('migrates a floor (v11) config up to the current version without touching the caller object', () => {
    const original = configAt(MIN_MIGRATABLE_APP_CONFIG_VERSION);

    const result = migrateConfig(original, recordingSink());

    expect(result.migrated).toBe(true);
    expect(result.config.app?.configVersion).toBe(LATEST_APP_CONFIG_VERSION);
    expect(original.app?.configVersion).toBe(MIN_MIGRATABLE_APP_CONFIG_VERSION);
  });

  it('migrates an intermediate (v12) config up to the current version', () => {
    const result = migrateConfig(configAt(12), recordingSink());

    expect(result.migrated).toBe(true);
    expect(result.config.app?.configVersion).toBe(LATEST_APP_CONFIG_VERSION);
  });

  it('applies each step on the way, reporting through the sink', () => {
    const sink = recordingSink();

    const result = migrateConfig(v18AutopilotConfig(), sink);

    const paths = (result.config.dashboards[0].configuration?.[0] as unknown as {
      input: { widgetProperties: { config: { paths: Record<string, { isPathConfigurable?: boolean }> } } };
    }).input.widgetProperties.config.paths;
    expect(paths['windAngleTrueWater']).toBeUndefined();
    expect(paths['headingTrue'].isPathConfigurable).toBe(false);
    expect(sink.infos.some(m => /autopilot/i.test(m))).toBe(true);
    expect(sink.errors).toEqual([]);
  });

  it('rejects a below-floor config with a distinct "too old" error', () => {
    expect(() => migrateConfig(configAt(10), recordingSink())).toThrow(ConfigTooOldError);
    expect(() => migrateConfig(configAt(10), recordingSink())).toThrow(/too old/i);
  });

  // The chain serves the published config and Freeboard tiles as well as imports, so its errors
  // must read correctly on every path; the import path adds its own advice.
  it('words every rejection without assuming an import', () => {
    for (const version of [10, undefined, LATEST_APP_CONFIG_VERSION + 1]) {
      let message = '';
      try {
        migrateConfig(configAt(version), recordingSink());
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toBe('');
      expect(message).not.toMatch(/import/i);
    }
  });

  it('rejects a config with no recognizable version with a distinct error', () => {
    expect(() => migrateConfig(configAt(undefined), recordingSink())).toThrow(/recognizable version/i);
  });

  it('rejects a too-new config with a distinct "newer" error', () => {
    expect(() => migrateConfig(configAt(LATEST_APP_CONFIG_VERSION + 1), recordingSink())).toThrow(/newer/i);
  });

  it('has a step for every version from the floor up to latest (guards future LATEST bumps)', () => {
    for (let from = MIN_MIGRATABLE_APP_CONFIG_VERSION; from < LATEST_APP_CONFIG_VERSION; from++) {
      const upgraded = migrateOneAppVersion(configAt(from), from, recordingSink());
      // A bump of LATEST_APP_CONFIG_VERSION that forgets to register the new step lands here: the
      // dispatch returns null for the now-in-range version, and every config below it stops loading.
      expect(upgraded, `no upgrade step registered for config version ${from}`).not.toBeNull();
      expect(upgraded?.app?.configVersion).toBeGreaterThan(from);
    }
  });

  it('reports a step that refuses its input through the sink error channel', () => {
    const sink = recordingSink();

    expect(migrateOneAppVersion(configAt(13), 12, sink)).toBeNull();
    expect(sink.errors).toHaveLength(1);
  });
});

describe('migrateWidgetConfig (a single widget config through the chain)', () => {
  it('runs a lone widget config through the steps above its version', () => {
    const cfg = {
      paths: { headingTrue: { path: 'self.navigation.headingTrue', isPathConfigurable: true }, windAngleTrueWater: { path: 'x' } }
    } as unknown as IWidgetSvcConfig;

    const migrated = migrateWidgetConfig('widget-autopilot', cfg, 18, recordingSink());

    const paths = migrated.paths as unknown as Record<string, { isPathConfigurable?: boolean }>;
    expect(paths['windAngleTrueWater']).toBeUndefined();
    expect(paths['headingTrue'].isPathConfigurable).toBe(false);
    // The caller's object is left untouched.
    expect((cfg.paths as unknown as Record<string, unknown>)['windAngleTrueWater']).toBeDefined();
  });

  it('only runs steps that match the widget type', () => {
    const cfg = { paths: { windAngleTrueWater: { path: 'x' } } } as unknown as IWidgetSvcConfig;

    const migrated = migrateWidgetConfig('widget-text', cfg, 18, recordingSink());

    expect(migrated).toEqual(cfg);
  });

  it('returns a current-version widget config unchanged', () => {
    const cfg = { updateInterval: 1000, siVersion: 20 } as IWidgetSvcConfig;

    expect(migrateWidgetConfig('widget-wind-steer', cfg, LATEST_APP_CONFIG_VERSION, recordingSink())).toEqual(cfg);
  });

  it('throws for a version the chain cannot migrate from', () => {
    const cfg = { updateInterval: 1000 } as IWidgetSvcConfig;

    expect(() => migrateWidgetConfig('widget-wind-steer', cfg, LATEST_APP_CONFIG_VERSION + 1, recordingSink())).toThrow(/newer/i);
    expect(() => migrateWidgetConfig('widget-wind-steer', cfg, 'nineteen', recordingSink())).toThrow(/recognizable version/i);
  });

  it('keeps the chain free of widget-level side effects on the lone config', () => {
    // The v11 step rewrites grid metrics on the dashboard entry; those belong to the wrapper, never
    // to the widget config handed back.
    const cfg = { updateInterval: 1000 } as IWidgetSvcConfig;
    const info = vi.fn();

    const migrated = migrateWidgetConfig('widget-numeric', cfg, MIN_MIGRATABLE_APP_CONFIG_VERSION, { info, error: vi.fn() });

    expect(migrated['w' as keyof IWidgetSvcConfig]).toBeUndefined();
    expect(migrated.updateInterval).toBe(1000);
  });
});

describe('removeSplitShellConfigKeys', () => {
  it('strips the retired split-shell keys from an app config', () => {
    const app = { splitShellEnabled: true, splitShellSide: 'left', splitShellWidth: 0.3, splitShellSwipeDisabled: true, autoNightMode: true };

    removeSplitShellConfigKeys(app as unknown as IAppConfig);

    expect(app).toEqual({ autoNightMode: true });
  });
});

// A dashboard holding the given widgets, at the given app-config version.
const configWith = (version: number, widgets: { type: string; config: Record<string, unknown> }[]): IConfig =>
  ({
    app: { configVersion: version },
    theme: { themeName: '' },
    dashboards: [{
      id: 'd1',
      configuration: widgets.map((w, i) => ({
        id: `w${i}`, selector: 'widget-host2',
        input: { widgetProperties: { type: w.type, uuid: `w${i}`, config: w.config } }
      }))
    }]
  } as unknown as IConfig);
const widgetConfigs = (config: IConfig): Record<string, unknown>[] =>
  (config.dashboards[0].configuration ?? []).map(w =>
    (w as unknown as { input: { widgetProperties: { config: Record<string, unknown> } } }).input.widgetProperties.config);

describe('v19 -> v20: Wind Steer close-hauled options in SI', () => {
  it('renames the close-hauled options and converts the angle to rad at full precision', () => {
    const migrated = migrateOneAppVersion(
      configWith(19, [{ type: 'widget-wind-steer', config: { laylineEnable: false, laylineAngle: 40 } }]), 19, recordingSink());

    expect(migrated?.app?.configVersion).toBe(20);
    const [windsteer] = widgetConfigs(migrated as IConfig);
    expect(windsteer).toEqual({ closeHauledLineEnable: false, closeHauledLineAngle: 40 * Math.PI / 180, [SI_VERSION_KEY]: 20 });
    // Frozen factor pinned by literal value.
    expect(windsteer['closeHauledLineAngle']).toBe(0.6981317007977318);
  });

  it('leaves a Wind Steer without the close-hauled options to its defaults, but marks it', () => {
    const migrated = migrateOneAppVersion(configWith(19, [{ type: 'widget-wind-steer', config: { updateInterval: 500 } }]), 19, recordingSink());
    expect(widgetConfigs(migrated as IConfig)[0]).toEqual({ updateInterval: 500, [SI_VERSION_KEY]: 20 });
  });

  it("deletes racesteer's unread layline options and leaves other widgets alone", () => {
    const migrated = migrateOneAppVersion(configWith(19, [
      { type: 'widget-racesteer', config: { laylineEnable: true, laylineAngle: 40, windSectorEnable: true } },
      { type: 'widget-numeric', config: { laylineAngle: 12 } }
    ]), 19, recordingSink());
    expect(widgetConfigs(migrated as IConfig)).toEqual([{ windSectorEnable: true }, { laylineAngle: 12 }]);
  });

  it('refuses a config that is not at v19', () => {
    const sink = recordingSink();
    expect(migrateOneAppVersion(configWith(18, []), 19, sink)).toBeNull();
    expect(sink.errors).toHaveLength(1);
  });
});

describe('applySiSteps (per-widget SI markers)', () => {
  const unmarked = (): Record<string, unknown> => ({ laylineEnable: true, laylineAngle: 30 });

  it('reruns of v19 -> v20 on marked Wind Steer configs change nothing', () => {
    const first = migrateOneAppVersion(configWith(19, [{ type: 'widget-wind-steer', config: unmarked() }]), 19, recordingSink()) as IConfig;
    const expected = structuredClone(widgetConfigs(first));
    // A tab on an older build lowered the stamp but kept the migrated widgets.
    first.app!.configVersion = 19;

    const again = migrateOneAppVersion(first, 19, recordingSink()) as IConfig;
    expect(widgetConfigs(again)).toEqual(expected);
  });

  it('converts unmarked Wind Steer configs written back under the current stamp', () => {
    // An older build's dashboards-only save leaves the stamp at latest.
    const config = configWith(LATEST_APP_CONFIG_VERSION, [{ type: 'widget-wind-steer', config: unmarked() }]);

    expect(applySiSteps(config, recordingSink())).toBe(true);
    expect(widgetConfigs(config)[0]).toEqual({ closeHauledLineEnable: true, closeHauledLineAngle: 30 * Math.PI / 180, [SI_VERSION_KEY]: 20 });
  });

  it('migrateConfig runs the SI steps on a current-version copy too, without touching the caller object', () => {
    const original = configWith(LATEST_APP_CONFIG_VERSION, [{ type: 'widget-wind-steer', config: unmarked() }]);
    const result = migrateConfig(original, recordingSink());

    expect(result.migrated).toBe(true);
    expect(widgetConfigs(result.config)[0][SI_VERSION_KEY]).toBe(20);
    expect(widgetConfigs(original)[0]).toEqual(unmarked());
  });

  it('deletes a stale pre-SI key an older build merged back into a marked config, without reading it', () => {
    const angle = 0.6;
    const config = configWith(LATEST_APP_CONFIG_VERSION, [{
      type: 'widget-wind-steer',
      config: { closeHauledLineAngle: angle, laylineAngle: 45, laylineEnable: true, [SI_VERSION_KEY]: 20 }
    }]);

    expect(applySiSteps(config, recordingSink())).toBe(true);
    expect(widgetConfigs(config)[0]).toEqual({ closeHauledLineAngle: angle, [SI_VERSION_KEY]: 20 });
  });

  it('reports no change for marked configs without stale keys', () => {
    const config = configWith(LATEST_APP_CONFIG_VERSION, [{ type: 'widget-wind-steer', config: { closeHauledLineAngle: 0.6, [SI_VERSION_KEY]: 20 } }]);
    expect(applySiSteps(config, recordingSink())).toBe(false);
  });
});

describe('v20 -> v21: Sea Horizon heel angles and AIS radar options in SI', () => {
  const seaHorizon = (gauge: Record<string, unknown>) => ({ type: 'widget-sea-horizon', config: { gauge } });
  const aisRadar = (ais: Record<string, unknown>) => ({ type: 'widget-ais-radar', config: { ais } });

  it('converts the heel caution and alarm angles to rad at full precision', () => {
    const migrated = migrateOneAppVersion(
      configWith(20, [seaHorizon({ heelCautionAngle: 20, heelAlarmAngle: 30, damping: 3 })]), 20, recordingSink());

    expect(migrated?.app?.configVersion).toBe(21);
    const [config] = widgetConfigs(migrated as IConfig);
    // Frozen factor pinned by literal values.
    expect(config).toEqual({ gauge: { heelCautionAngle: 0.3490658503988659, heelAlarmAngle: 0.5235987755982988, damping: 3 }, [SI_VERSION_KEY]: 21 });
  });

  it('converts the AIS range rings to metres and the COG vector time to seconds, renaming its key', () => {
    const migrated = migrateOneAppVersion(
      configWith(20, [aisRadar({ rangeRings: [1, 3, 6, 12, 24, 48], rangeIndex: '3', cogVectorsMinutes: 10, showCogVectors: true })]), 20, recordingSink());

    const [config] = widgetConfigs(migrated as IConfig);
    // Frozen factors pinned by literal values.
    expect(config).toEqual({
      ais: { rangeRings: [1852, 5556, 11112, 22224, 44448, 88896], rangeIndex: '3', cogVectorsSeconds: 600, showCogVectors: true },
      [SI_VERSION_KEY]: 21
    });
  });

  it('marks a Sea Horizon or AIS radar without the options, and leaves other widgets alone', () => {
    const migrated = migrateOneAppVersion(configWith(20, [
      { type: 'widget-sea-horizon', config: { updateInterval: 500 } },
      { type: 'widget-ais-radar', config: { ais: { viewMode: 'north-up' } } },
      { type: 'widget-heel-gauge', config: { gauge: { heelCautionAngle: 20 } } }
    ]), 20, recordingSink());
    expect(widgetConfigs(migrated as IConfig)).toEqual([
      { updateInterval: 500, [SI_VERSION_KEY]: 21 },
      { ais: { viewMode: 'north-up' }, [SI_VERSION_KEY]: 21 },
      { gauge: { heelCautionAngle: 20 } }
    ]);
  });

  it('leaves Wind Steer to the v20 step: a v20 config keeps its close-hauled angle', () => {
    const migrated = migrateOneAppVersion(
      configWith(20, [{ type: 'widget-wind-steer', config: { closeHauledLineAngle: 0.6, [SI_VERSION_KEY]: 20 } }]), 20, recordingSink());
    expect(widgetConfigs(migrated as IConfig)[0]).toEqual({ closeHauledLineAngle: 0.6, [SI_VERSION_KEY]: 20 });
  });

  it('refuses a config that is not at v20', () => {
    const sink = recordingSink();
    expect(migrateOneAppVersion(configWith(19, []), 20, sink)).toBeNull();
    expect(sink.errors).toHaveLength(1);
  });

  it('v19 -> v20 does not run the v21 steps', () => {
    const migrated = migrateOneAppVersion(configWith(19, [seaHorizon({ heelCautionAngle: 20 })]), 19, recordingSink());
    expect(widgetConfigs(migrated as IConfig)[0]).toEqual({ gauge: { heelCautionAngle: 20 } });
  });

  it('reruns of v20 -> v21 on marked Sea Horizon and AIS radar configs change nothing', () => {
    const first = migrateOneAppVersion(configWith(20, [
      seaHorizon({ heelCautionAngle: 20, heelAlarmAngle: 30 }),
      aisRadar({ rangeRings: [1, 3, 6], cogVectorsMinutes: 10 })
    ]), 20, recordingSink()) as IConfig;
    const expected = structuredClone(widgetConfigs(first));
    // A tab on an older build lowered the stamp but kept the migrated widgets.
    first.app!.configVersion = 20;

    const again = migrateOneAppVersion(first, 20, recordingSink()) as IConfig;
    expect(widgetConfigs(again)).toEqual(expected);
  });

  it('converts unmarked Sea Horizon and AIS radar configs written back under the current stamp', () => {
    // An older build's dashboards-only save leaves the stamp at latest.
    const config = configWith(LATEST_APP_CONFIG_VERSION, [
      seaHorizon({ heelCautionAngle: 20, heelAlarmAngle: 30 }),
      aisRadar({ rangeRings: [1, 3], cogVectorsMinutes: 5 })
    ]);

    expect(applySiSteps(config, recordingSink())).toBe(true);
    expect(widgetConfigs(config)).toEqual([
      { gauge: { heelCautionAngle: 0.3490658503988659, heelAlarmAngle: 0.5235987755982988 }, [SI_VERSION_KEY]: 21 },
      { ais: { rangeRings: [1852, 5556], cogVectorsSeconds: 300 }, [SI_VERSION_KEY]: 21 }
    ]);
  });

  it('migrateConfig carries a v19 Sea Horizon through both steps to rad', () => {
    const result = migrateConfig(configWith(19, [seaHorizon({ heelCautionAngle: 20 })]), recordingSink());
    expect(result.config.app?.configVersion).toBe(LATEST_APP_CONFIG_VERSION);
    expect(widgetConfigs(result.config)[0]).toEqual({ gauge: { heelCautionAngle: 0.3490658503988659 }, [SI_VERSION_KEY]: 21 });
  });

  it('deletes a stale COG vector time an older build merged back into a marked AIS radar, without reading it', () => {
    const config = configWith(LATEST_APP_CONFIG_VERSION, [
      aisRadar({ rangeRings: [1852], cogVectorsSeconds: 900, cogVectorsMinutes: 10 })
    ]);
    (widgetConfigs(config)[0])[SI_VERSION_KEY] = 21;

    expect(applySiSteps(config, recordingSink())).toBe(true);
    expect(widgetConfigs(config)[0]).toEqual({ ais: { rangeRings: [1852], cogVectorsSeconds: 900 }, [SI_VERSION_KEY]: 21 });
  });

  it('reports no change for marked Sea Horizon and AIS radar configs without stale keys', () => {
    const config = configWith(LATEST_APP_CONFIG_VERSION, [
      { type: 'widget-sea-horizon', config: { gauge: { heelCautionAngle: 0.3 }, [SI_VERSION_KEY]: 21 } },
      { type: 'widget-ais-radar', config: { ais: { cogVectorsSeconds: 600 }, [SI_VERSION_KEY]: 21 } }
    ]);
    expect(applySiSteps(config, recordingSink())).toBe(false);
  });
});

describe('v21 -> v22: scale bounds in SI', () => {
  const GAUGE_TYPES = ['widget-gauge-ng-radial', 'widget-gauge-ng-linear', 'widget-gauge-steel', 'widget-simple-linear'];
  const gauge = (type: string, unit: string | undefined, lower: unknown, upper: unknown) => ({
    type,
    config: {
      displayName: 'RPM',
      paths: { gaugePath: unit === undefined ? { path: 'self.x' } : { path: 'self.x', convertUnitTo: unit } },
      displayScale: { lower, upper, type: 'linear' }
    }
  });
  const numeric = (unit: string, yScaleMin: unknown, yScaleMax: unknown) => ({
    type: 'widget-numeric',
    config: { displayName: 'SOG', paths: { numericPath: { path: 'self.x', convertUnitTo: unit } }, yScaleMin, yScaleMax }
  });
  const scale = (config: Record<string, unknown>) => config['displayScale'] as { lower: unknown; upper: unknown };
  const resets = (config: IConfig) => (config.app as IAppConfig).siScaleResets;

  it('pins a sample of the frozen measure table, which holds no string-format measure', () => {
    expect(V22_MEASURE_TO_SI['rpm']).toEqual([0, 60]);
    expect(V22_MEASURE_TO_SI['celsius']).toEqual([-273.15, 1]);
    expect(V22_MEASURE_TO_SI['fahrenheit']).toEqual([-459.67, 1.8000000000000114]);
    expect(V22_MEASURE_TO_SI['knots']).toEqual([0, 1.943844494119952]);
    expect(V22_MEASURE_TO_SI['kPa']).toEqual([0, 0.001]);
    expect(V22_MEASURE_TO_SI['bar']).toEqual([0, 0.00001]);
    expect(V22_MEASURE_TO_SI['percent']).toEqual([0, 100]);
    expect(V22_MEASURE_TO_SI['K']).toEqual([0, 1]);
    for (const measure of ['D HH:MM:SS', 'latitudeMin', 'latitudeSec', 'longitudeMin', 'longitudeSec', 'unitless', '']) {
      expect(Object.hasOwn(V22_MEASURE_TO_SI, measure), measure).toBe(false);
    }
    for (const [measure, [zero, perSi]] of Object.entries(V22_MEASURE_TO_SI)) {
      expect(Number.isFinite(zero) && Number.isFinite(perSi) && perSi !== 0, measure).toBe(true);
    }
  });

  for (const type of GAUGE_TYPES) {
    it(`converts ${type} bounds from the stored unit: 0-3600 rpm to 0-60 Hz`, () => {
      const migrated = migrateOneAppVersion(configWith(21, [gauge(type, 'rpm', 0, 3600)]), 21, recordingSink()) as IConfig;

      expect(migrated.app?.configVersion).toBe(22);
      const [config] = widgetConfigs(migrated);
      expect(config['displayScale']).toEqual({ lower: 0, upper: 60, type: 'linear' });
      expect(config[SI_VERSION_KEY]).toBe(22);
      expect(resets(migrated)).toBeUndefined();
    });
  }

  it('converts celsius bounds to kelvin and leaves kelvin bounds as they are', () => {
    const migrated = migrateOneAppVersion(configWith(21, [
      gauge('widget-gauge-ng-linear', 'celsius', 0, 120),
      gauge('widget-gauge-ng-radial', 'K', 250, 400)
    ]), 21, recordingSink()) as IConfig;

    const [celsius, kelvin] = widgetConfigs(migrated).map(scale);
    expect(celsius.lower).toBeCloseTo(273.15);
    expect(celsius.upper).toBeCloseTo(393.15);
    expect(kelvin).toEqual({ lower: 250, upper: 400, type: 'linear' });
  });

  it('converts numeric y bounds from the stored unit: 0-10 knots to 0-5.144 m/s', () => {
    const migrated = migrateOneAppVersion(configWith(21, [numeric('knots', 0, 10)]), 21, recordingSink()) as IConfig;

    const [config] = widgetConfigs(migrated);
    expect(config['yScaleMin']).toBe(0);
    expect(config['yScaleMax']).toBeCloseTo(5.144, 3);
    expect(config[SI_VERSION_KEY]).toBe(22);
  });

  it('resets and lists bounds whose stored unit is empty, unitless, missing, unknown or a string format', () => {
    const sink = recordingSink();
    const migrated = migrateOneAppVersion(configWith(21, [
      gauge('widget-gauge-steel', '', 0, 100),
      gauge('widget-simple-linear', 'unitless', 0, 100),
      gauge('widget-gauge-ng-radial', undefined, 0, 100),
      gauge('widget-gauge-ng-linear', 'furlongs', 0, 100),
      numeric('D HH:MM:SS', 0, 3600)
    ]), 21, sink) as IConfig;

    const configs = widgetConfigs(migrated);
    for (const config of configs.slice(0, 4)) {
      expect(config['displayScale']).toEqual({ lower: null, upper: null, type: 'linear' });
      expect(config[SI_VERSION_KEY]).toBe(22);
    }
    expect(configs[4]).toMatchObject({ yScaleMin: null, yScaleMax: null, [SI_VERSION_KEY]: 22 });
    expect(resets(migrated)).toEqual([
      { dashboardId: 'd1', dashboard: '1', widget: 'RPM', type: 'widget-gauge-steel', options: ['displayScale.lower', 'displayScale.upper'] },
      { dashboardId: 'd1', dashboard: '1', widget: 'RPM', type: 'widget-simple-linear', options: ['displayScale.lower', 'displayScale.upper'] },
      { dashboardId: 'd1', dashboard: '1', widget: 'RPM', type: 'widget-gauge-ng-radial', options: ['displayScale.lower', 'displayScale.upper'] },
      { dashboardId: 'd1', dashboard: '1', widget: 'RPM', type: 'widget-gauge-ng-linear', options: ['displayScale.lower', 'displayScale.upper'] },
      { dashboardId: 'd1', dashboard: '1', widget: 'SOG', type: 'widget-numeric', options: ['yScaleMin', 'yScaleMax'] }
    ]);
    expect(sink.infos.filter(m => /scale range/i.test(m))).toHaveLength(5);
  });

  it('resets and lists only the bounds that were numbers', () => {
    const migrated = migrateOneAppVersion(configWith(21, [gauge('widget-gauge-steel', '', null, 100)]), 21, recordingSink()) as IConfig;

    expect(scale(widgetConfigs(migrated)[0])).toEqual({ lower: null, upper: null, type: 'linear' });
    expect(resets(migrated)?.[0].options).toEqual(['displayScale.upper']);
  });

  it('resets and lists any numeric data-chart y bound, which has no stored unit', () => {
    const migrated = migrateOneAppVersion(configWith(21, [{
      type: 'widget-data-chart',
      config: { displayName: 'Pressure', convertUnitTo: 'mbar', yScaleMin: 990, yScaleMax: 1030, yScaleSuggestedMin: null, enableMinMaxScaleLimit: true }
    }]), 21, recordingSink()) as IConfig;

    expect(widgetConfigs(migrated)[0]).toEqual({
      displayName: 'Pressure', convertUnitTo: 'mbar', yScaleMin: null, yScaleMax: null, yScaleSuggestedMin: null,
      enableMinMaxScaleLimit: true, [SI_VERSION_KEY]: 22
    });
    expect(resets(migrated)).toEqual([{ dashboardId: 'd1', dashboard: '1', widget: 'Pressure', type: 'widget-data-chart', options: ['yScaleMin', 'yScaleMax'] }]);
  });

  it('only marks widgets without numeric bounds, adding no reset list', () => {
    const migrated = migrateOneAppVersion(configWith(21, [
      gauge('widget-gauge-steel', '', null, null),
      { type: 'widget-numeric', config: { paths: { numericPath: { path: 'self.x', convertUnitTo: 'unitless' } } } },
      { type: 'widget-data-chart', config: { yScaleMin: null } }
    ]), 21, recordingSink()) as IConfig;

    expect(widgetConfigs(migrated).map(c => c[SI_VERSION_KEY])).toEqual([22, 22, 22]);
    expect(migrated.app && 'siScaleResets' in migrated.app).toBe(false);
  });

  it('names the dashboard by its name, else its position, and the widget by its displayName, else its type', () => {
    const config = {
      app: { configVersion: 21, siScaleResets: [{ dashboardId: 'old', dashboard: 'Old', widget: 'Old', type: 'widget-numeric', options: ['yScaleMin'] }] },
      theme: { themeName: '' },
      dashboards: [
        { id: 'd1', name: 'Engine', configuration: [
          { id: 'w1', selector: 'widget-host2', input: { widgetProperties: { type: 'widget-numeric', uuid: 'w1', config: { displayName: 'Oil', yScaleMin: 0, yScaleMax: 5 } } } }
        ] },
        { id: 'd2', configuration: [
          { id: 'w2', selector: 'widget-host2', input: { widgetProperties: { type: 'widget-data-chart', uuid: 'w2', config: { yScaleMax: 5 } } } }
        ] }
      ]
    } as unknown as IConfig;

    const migrated = migrateOneAppVersion(config, 21, recordingSink()) as IConfig;

    expect(resets(migrated)).toEqual([
      { dashboardId: 'old', dashboard: 'Old', widget: 'Old', type: 'widget-numeric', options: ['yScaleMin'] },
      { dashboardId: 'd1', dashboard: 'Engine', widget: 'Oil', type: 'widget-numeric', options: ['yScaleMin', 'yScaleMax'] },
      { dashboardId: 'd2', dashboard: '2', widget: 'widget-data-chart', type: 'widget-data-chart', options: ['yScaleMax'] }
    ]);
  });

  it('leaves other widgets, and widget-slider, alone', () => {
    const migrated = migrateOneAppVersion(configWith(21, [
      { type: 'widget-slider', config: { displayScale: { lower: 0, upper: 100 } } },
      { type: 'widget-gauge-ng-compass', config: { displayScale: { lower: 0, upper: 360 } } }
    ]), 21, recordingSink()) as IConfig;
    expect(widgetConfigs(migrated)).toEqual([{ displayScale: { lower: 0, upper: 100 } }, { displayScale: { lower: 0, upper: 360 } }]);
  });

  it('refuses a config that is not at v21', () => {
    const sink = recordingSink();
    expect(migrateOneAppVersion(configWith(20, []), 21, sink)).toBeNull();
    expect(sink.errors).toHaveLength(1);
  });

  it('v20 -> v21 does not run the v22 steps', () => {
    const migrated = migrateOneAppVersion(configWith(20, [gauge('widget-gauge-steel', 'rpm', 0, 3600)]), 20, recordingSink()) as IConfig;
    expect(scale(widgetConfigs(migrated)[0])).toEqual({ lower: 0, upper: 3600, type: 'linear' });
  });

  it('gives identical results when migrated twice, and a rerun on marked widgets changes nothing', () => {
    const input = () => configWith(21, [gauge('widget-gauge-steel', 'rpm', 0, 3600), gauge('widget-gauge-steel', '', 0, 100), numeric('knots', 0, 10)]);
    const first = migrateOneAppVersion(input(), 21, recordingSink()) as IConfig;
    const second = migrateOneAppVersion(input(), 21, recordingSink()) as IConfig;
    expect(second).toEqual(first);

    const expected = structuredClone(first);
    // A tab on an older build lowered the stamp but kept the migrated widgets.
    first.app!.configVersion = 21;
    const again = migrateOneAppVersion(first, 21, recordingSink()) as IConfig;
    expect(widgetConfigs(again)).toEqual(widgetConfigs(expected));
    expect(resets(again)).toEqual(resets(expected));
    expect(applySiSteps(again, recordingSink())).toBe(false);
  });

  it('converts unmarked configs an older build wrote back under the current stamp', () => {
    const config = configWith(LATEST_APP_CONFIG_VERSION, [gauge('widget-gauge-ng-radial', 'rpm', 0, 3600), gauge('widget-gauge-steel', 'unitless', 0, 100)]);

    expect(applySiSteps(config, recordingSink())).toBe(true);
    expect(widgetConfigs(config).map(scale)).toEqual([
      { lower: 0, upper: 60, type: 'linear' },
      { lower: null, upper: null, type: 'linear' }
    ]);
    expect(resets(config)).toHaveLength(1);
  });

  it('migrateConfig carries a v21 config through the SI step to the latest version', () => {
    const result = migrateConfig(configWith(21, [gauge('widget-gauge-ng-radial', 'rpm', 0, 3600)]), recordingSink());
    expect(result.config.app?.configVersion).toBe(LATEST_APP_CONFIG_VERSION);
    expect(widgetConfigs(result.config)[0]).toMatchObject({ displayScale: { lower: 0, upper: 60 }, [SI_VERSION_KEY]: 22 });
  });
});

describe('v22 -> v23: dotted compound sub-field paths to pointer form', () => {
  // A path slot as a generic widget stores it.
  const slot = (path: string, convertUnitTo?: string): Record<string, unknown> =>
    ({ description: 'x', path, source: 'default', pathType: 'number', isPathConfigurable: true, ...(convertUnitTo ? { convertUnitTo } : {}) });
  const numeric = (path: string, convertUnitTo?: string) =>
    ({ type: 'widget-numeric', config: { paths: { numericPath: slot(path, convertUnitTo) } } });
  const slotOf = (config: Record<string, unknown>) =>
    (config['paths'] as Record<string, Record<string, unknown>>)['numericPath'];
  const migrate = (widgets: { type: string; config: Record<string, unknown> }[], sink = recordingSink()) =>
    widgetConfigs(migrateOneAppVersion(configWith(22, widgets), 22, sink) as IConfig);

  it('rewrites a numeric widget on a position or attitude child path to a pointer path, and stamps v23', () => {
    const migrated = migrateOneAppVersion(configWith(22, [
      numeric('self.navigation.position.latitude'),
      numeric('self.navigation.attitude.roll')
    ]), 22, recordingSink());

    expect(migrated?.app?.configVersion).toBe(23);
    expect(widgetConfigs(migrated as IConfig).map(c => slotOf(c)['path']))
      .toEqual(['self.navigation.position#/latitude', 'self.navigation.attitude#/roll']);
  });

  it('rewrites a nested compound at its own leaf', () => {
    const [cfg] = migrate([numeric('self.navigation.courseGreatCircle.nextPoint.position.longitude')]);
    expect(slotOf(cfg)['path']).toBe('self.navigation.courseGreatCircle.nextPoint.position#/longitude');
  });

  it('rewrites every slot of the array form of paths', () => {
    const [cfg] = migrate([{ type: 'widget-gauge-ng-linear', config: { paths: [slot('self.navigation.attitude.pitch')] } }]);
    expect((cfg['paths'] as Record<string, unknown>[])[0]['path']).toBe('self.navigation.attitude#/pitch');
  });

  it("rewrites a data graph's datachartPath", () => {
    const [cfg] = migrate([{ type: 'widget-data-chart', config: { datachartPath: 'self.navigation.attitude.roll', datachartSource: 'default' } }]);
    expect(cfg).toEqual({ datachartPath: 'self.navigation.attitude#/roll', datachartSource: 'default' });
  });

  it('leaves unknown dotted paths alone', () => {
    const [numericCfg, graphCfg] = migrate([
      numeric('self.electrical.solar.0.chargingMode.message'),
      { type: 'widget-data-chart', config: { datachartPath: 'self.navigation.speedOverGround' } }
    ]);
    expect(slotOf(numericCfg)['path']).toBe('self.electrical.solar.0.chargingMode.message');
    expect(graphCfg['datachartPath']).toBe('self.navigation.speedOverGround');
  });

  it.each(['widget-position', 'widget-heel-gauge', 'widget-horizon'])('leaves %s alone (v13 -> v14 collapsed it)', type => {
    const config = { paths: { p: slot('self.navigation.position.latitude', 'deg') } };
    const [cfg] = migrate([{ type, config: structuredClone(config) }]);
    expect(cfg).toEqual(config);
  });

  it('is idempotent: a pointer path is unchanged and a second run is a no-op', () => {
    const sink = recordingSink();
    const first = migrateOneAppVersion(configWith(22, [numeric('self.navigation.position.latitude', 'deg')]), 22, sink) as IConfig;
    const expected = structuredClone(widgetConfigs(first));
    first.app!.configVersion = 22;

    const again = migrateOneAppVersion(first, 22, sink) as IConfig;

    expect(widgetConfigs(again)).toEqual(expected);
    expect(slotOf(expected[0])).toMatchObject({ path: 'self.navigation.position#/latitude', convertUnitTo: 'pdeg' });
    expect(sink.infos.filter(m => /pointer form/.test(m))).toHaveLength(1);
  });

  it('keeps a Position-group unit on a migrated coordinate', () => {
    const [cfg] = migrate([numeric('self.navigation.position.latitude', 'latitudeMin')]);
    expect(slotOf(cfg)['convertUnitTo']).toBe('latitudeMin');
  });

  it.each(['deg', 'rad', 'grad'])('moves a coordinate stored in the Angle group\'s %s to position degrees', unit => {
    const [lat] = migrate([numeric('self.navigation.position.latitude', unit)]);
    const [lon] = migrate([numeric('self.navigation.position.longitude', unit)]);
    expect(slotOf(lat)['convertUnitTo']).toBe('pdeg');
    expect(slotOf(lon)['convertUnitTo']).toBe('pdeg');
  });

  it('keeps an Angle-group unit on a migrated attitude field', () => {
    const [cfg] = migrate([numeric('self.navigation.attitude.roll', 'deg')]);
    expect(slotOf(cfg)).toMatchObject({ path: 'self.navigation.attitude#/roll', convertUnitTo: 'deg' });
  });

  it('reports the rewrites and unit changes through the sink', () => {
    const sink = recordingSink();
    migrate([numeric('self.navigation.position.latitude', 'deg'), numeric('self.navigation.attitude.yaw')], sink);
    expect(sink.infos).toEqual([
      '[Upgrade] Rewrote 2 compound sub-field path(s) to pointer form.',
      '[Upgrade] Switched 1 latitude/longitude unit(s) from the Angle group to position degrees.'
    ]);
    expect(sink.errors).toEqual([]);
  });

  it('migrates a Freeboard tile config at v22 through migrateWidgetConfig', () => {
    const cfg = { paths: { numericPath: slot('self.navigation.position.longitude', 'deg') } } as unknown as IWidgetSvcConfig;

    const migrated = migrateWidgetConfig('widget-numeric', cfg, 22, recordingSink()) as unknown as Record<string, unknown>;

    expect(slotOf(migrated)).toMatchObject({ path: 'self.navigation.position#/longitude', convertUnitTo: 'pdeg' });
    expect(slotOf(cfg as unknown as Record<string, unknown>)['path']).toBe('self.navigation.position.longitude');
  });

  it('refuses a config that is not at v22', () => {
    const sink = recordingSink();
    expect(migrateOneAppVersion(configWith(21, []), 22, sink)).toBeNull();
    expect(sink.errors).toHaveLength(1);
  });
});

describe('v23 -> v24: the heel gauge reads any angle path', () => {
  // The heel gauge slot as the v16 step left it: the whole attitude leaf, fixed and hidden.
  const fixedSlot = (): Record<string, unknown> => ({
    description: 'Heel / Roll Angle', path: 'self.navigation.attitude', source: 'default', pathType: 'number',
    isPathConfigurable: false, convertUnitTo: 'deg', showConvertUnitTo: false, pathRequired: true
  });
  const angleSlot = (config: Record<string, unknown>) => (config['paths'] as Record<string, Record<string, unknown>>)['angle'];
  const migrate = (widgets: { type: string; config: Record<string, unknown> }[]) =>
    migrateOneAppVersion(configWith(23, widgets), 23, recordingSink()) as IConfig;

  it('makes a heel gauge\'s fixed attitude slot a configurable roll pointer path, and stamps v24', () => {
    const migrated = migrate([{ type: 'widget-heel-gauge', config: { paths: { angle: fixedSlot() } } }]);
    expect(migrated.app?.configVersion).toBe(24);
    expect(angleSlot(widgetConfigs(migrated)[0])).toEqual({
      ...fixedSlot(),
      description: 'Angle',
      path: 'self.navigation.attitude#/roll',
      isPathConfigurable: true,
      showPathSkUnitsFilter: false,
      pathSkUnitsFilter: 'rad'
    });
  });

  it('keeps the data source a user chose', () => {
    const migrated = migrate([{ type: 'widget-heel-gauge', config: { paths: { angle: { ...fixedSlot(), source: 'n2k.1' } } } }]);
    expect(angleSlot(widgetConfigs(migrated)[0])['source']).toBe('n2k.1');
  });

  it('leaves the Pitch & Roll horizon on its fixed attitude path', () => {
    const migrated = migrate([{ type: 'widget-horizon', config: { paths: { gaugePath: fixedSlot() } } }]);
    expect(widgetConfigs(migrated)[0]).toEqual({ paths: { gaugePath: fixedSlot() } });
  });

  it('is idempotent', () => {
    const once = migrate([{ type: 'widget-heel-gauge', config: { paths: { angle: fixedSlot() } } }]);
    const expected = { ...angleSlot(widgetConfigs(once)[0]) };
    const twice = migrateOneAppVersion({ ...once, app: { ...once.app, configVersion: 23 } } as IConfig, 23, recordingSink()) as IConfig;
    expect(angleSlot(widgetConfigs(twice)[0])).toEqual(expected);
  });
});
