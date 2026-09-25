import { TestBed } from '@angular/core/testing';
import { WidgetRuntimeDirective } from '../app/core/directives/widget-runtime.directive';
import type { IWidgetSvcConfig } from '../app/core/interfaces/widgets-interface';
import { describe, expect, it } from 'vitest';
import { DefaultDashboard } from './config.blank.dashboard';
import { WidgetPositionComponent } from '../app/widgets/widget-position/widget-position.component';
import { WidgetWindComponent } from '../app/widgets/widget-windsteer/widget-windsteer.component';
import { WidgetRacesteerComponent } from '../app/widgets/widget-racesteer/widget-racesteer.component';
import { WidgetWindTrendsGraphComponent } from '../app/widgets/widget-windtrends-graph/widget-windtrends-graph.component';
import { WidgetAutopilotComponent } from '../app/widgets/widget-autopilot/widget-autopilot.component';
import { WidgetHorizonComponent } from '../app/widgets/widget-horizon/widget-horizon.component';
import { WidgetHeelGaugeComponent } from '../app/widgets/widget-heel-gauge/widget-heel-gauge.component';
import { WidgetSimpleLinearComponent } from '../app/widgets/widget-simple-linear/widget-simple-linear.component';
import { applySiSteps, SI_VERSION_KEY } from '../app/core/utils/config-migration.util';
import { IConfig } from '../app/core/interfaces/app-settings.interfaces';
import { LATEST_APP_CONFIG_VERSION } from '../app/core/constants/config-versions.const';

// The shipped seed is stamped at LATEST_APP_CONFIG_VERSION, so config migrations never run on a
// fresh install/profile. A widget whose path shape drifts from its DEFAULT_CONFIG therefore ships
// its old shape forever. Guard the position widget specifically — its two-path shape was the #414
// bug — so a future re-export of the seed can't silently reintroduce longPath/latPath.
describe('DefaultDashboard seed', () => {
  interface SeedWidget { input?: { widgetProperties?: { type?: string; config?: { paths?: Record<string, unknown>; enableTimeout?: boolean; dataTimeout?: number; updateInterval?: number } } } }

  const seededWidgetsOfType = (type: string): SeedWidget[] =>
    DefaultDashboard.flatMap(dash => (dash.configuration ?? []) as SeedWidget[])
      .filter(w => w.input?.widgetProperties?.type === type);

  it('seeds every position widget with the single object-typed path from its DEFAULT_CONFIG', () => {
    const expectedKeys = Object.keys(WidgetPositionComponent.DEFAULT_CONFIG.paths ?? {});
    const positionWidgets = seededWidgetsOfType('widget-position');
    expect(positionWidgets.length).toBeGreaterThan(0);

    for (const widget of positionWidgets) {
      const paths = widget.input?.widgetProperties?.config?.paths ?? {};
      expect(Object.keys(paths)).toEqual(expectedKeys);
      const positionPath = paths['positionPath'] as { pathType?: string } | undefined;
      expect(positionPath?.pathType).toBe('object');
    }
  });

  // The heel gauge reads any angle; the seed must agree with its DEFAULT_CONFIG (the seed is stamped
  // at LATEST, so the v24 migration never reaches it) and keep its data timeout on.
  it('seeds widget-heel-gauge with a configurable roll pointer path and the timeout enabled', () => {
    const widgets = seededWidgetsOfType('widget-heel-gauge');
    expect(widgets.length).toBeGreaterThan(0);
    for (const widget of widgets) {
      const cfg = widget.input?.widgetProperties?.config;
      expect(cfg?.paths).toEqual(WidgetHeelGaugeComponent.DEFAULT_CONFIG.paths);
      expect(cfg?.enableTimeout).toBe(true);
      expect(cfg?.dataTimeout).toBe(5);
      expect(typeof cfg?.updateInterval).toBe('number');
      expect(cfg?.updateInterval).toBeGreaterThan(0);
    }
  });

  // The seed is stamped at LATEST, so migrations never touch it; the wind-steer seed must agree with
  // its DEFAULT_CONFIG or a fresh install ships a value migrated users don't get. The seed had already
  // drifted (angleTrueGround / speedOverGround) undetected before Effort B corrected it — guard every
  // seeded slot against the default so it can't drift again. pathOptions is base-sourced (supplied by
  // the runtime merge), so it is deliberately excluded here.
  it('seeds widget-wind-steer with the SI close-hauled options and marker of its DEFAULT_CONFIG', () => {
    const seedWidgets = seededWidgetsOfType('widget-wind-steer');
    expect(seedWidgets.length).toBeGreaterThan(0);
    const defaults = WidgetWindComponent.DEFAULT_CONFIG;
    for (const widget of seedWidgets) {
      const cfg = (widget.input?.widgetProperties?.config ?? {}) as Record<string, unknown>;
      expect(cfg['closeHauledLineEnable']).toBe(defaults.closeHauledLineEnable);
      expect(cfg['closeHauledLineAngle']).toBe(defaults.closeHauledLineAngle);
      expect(cfg['siVersion']).toBe(defaults.siVersion);
      expect('laylineAngle' in cfg).toBe(false);
    }
  });

  it('seeds widget-wind-steer with the polar overlay on once merged over its DEFAULT_CONFIG', () => {
    const seedWidgets = seededWidgetsOfType('widget-wind-steer');
    expect(seedWidgets.length).toBeGreaterThan(0);
    for (const widget of seedWidgets) {
      const runtime = TestBed.runInInjectionContext(() => new WidgetRuntimeDirective());
      runtime.initialize(WidgetWindComponent.DEFAULT_CONFIG, widget.input?.widgetProperties?.config as IWidgetSvcConfig);
      expect(runtime.options()?.polarOverlayEnable).toBe(true);
    }
  });

  it('seeds widget-wind-steer with path + editability matching its DEFAULT_CONFIG', () => {
    const seedWidgets = seededWidgetsOfType('widget-wind-steer');
    expect(seedWidgets.length).toBeGreaterThan(0);
    const defaults = WidgetWindComponent.DEFAULT_CONFIG.paths as Record<string, { path?: string; isPathConfigurable?: boolean }>;
    for (const widget of seedWidgets) {
      const paths = (widget.input?.widgetProperties?.config?.paths ?? {}) as Record<string, { path?: string; isPathConfigurable?: boolean }>;
      for (const [slot, seedPath] of Object.entries(paths)) {
        expect(seedPath.path, `seed wind-steer ${slot}.path`).toBe(defaults[slot]?.path);
        expect(seedPath.isPathConfigurable, `seed wind-steer ${slot}.isPathConfigurable`).toBe(defaults[slot]?.isPathConfigurable);
      }
    }
  });

  // Effort C: autopilot's seed must match its slimmed DEFAULT_CONFIG — every path fixed and the dead
  // windAngleTrueWater slot gone from both. The seed's copy carried its own drift (angleTrueGround
  // under a "True Water" description) before this; a re-export must not resurrect it.
  it('seeds widget-autopilot with every path fixed, matching DEFAULT_CONFIG, and no windAngleTrueWater', () => {
    const seedWidgets = seededWidgetsOfType('widget-autopilot');
    expect(seedWidgets.length).toBeGreaterThan(0);
    const defaults = WidgetAutopilotComponent.DEFAULT_CONFIG.paths as Record<string, { path?: string; isPathConfigurable?: boolean }>;
    expect(defaults['windAngleTrueWater']).toBeUndefined(); // dropped from the default
    for (const widget of seedWidgets) {
      const paths = (widget.input?.widgetProperties?.config?.paths ?? {}) as Record<string, { path?: string; isPathConfigurable?: boolean }>;
      expect(paths['windAngleTrueWater']).toBeUndefined(); // and from the seed
      for (const [slot, seedPath] of Object.entries(paths)) {
        expect(seedPath.isPathConfigurable, `seed autopilot ${slot}.isPathConfigurable`).toBe(false);
        expect(seedPath.path, `seed autopilot ${slot}.path`).toBe(defaults[slot]?.path);
      }
    }
  });
});

// The Pitch & Roll horizon reads its fields off the whole navigation.attitude leaf, so its path must
// stay hidden (isPathConfigurable:false) — else the settings show a dead 'number' picker on an object
// leaf (#416). The seed carries no horizon widget, so the invariant is asserted on the widget itself.
describe('attitude widget path config shape', () => {
  it('widget-horizon: reads a hidden fixed navigation.attitude path with the timeout enabled', () => {
    const config = WidgetHorizonComponent.DEFAULT_CONFIG;
    const paths = Object.values(config.paths ?? {}) as { path?: string; isPathConfigurable?: boolean }[];
    expect(paths.length).toBeGreaterThan(0);
    for (const pathConfig of paths) {
      expect(pathConfig.path).toBe('self.navigation.attitude');
      expect(pathConfig.isPathConfigurable).toBe(false);
    }
    expect(config.enableTimeout).toBe(true);
    expect(config.dataTimeout).toBe(5);
  });
});

// A re-export captures one boat's per-widget choices, and two widgets reading one path can come
// back disagreeing — a bearing left at 'unitless' renders raw radians beside the same bearing in
// degrees, and neither page tells the user which is lying.
describe('seed self-consistency', () => {
  interface SeedWidget { input?: { widgetProperties?: { type?: string; config?: { displayName?: string; paths?: Record<string, { path?: string; convertUnitTo?: string; pathSkUnitsFilter?: string | null }> } } } }
  const seedWidgets = (): SeedWidget[] => DefaultDashboard.flatMap(dash => (dash.configuration ?? []) as SeedWidget[]);

  it('uses one unit per Signal K path across every page', () => {
    const unitsByPath = new Map<string, Set<string>>();
    for (const widget of seedWidgets()) {
      for (const pathConfig of Object.values(widget.input?.widgetProperties?.config?.paths ?? {})) {
        if (!pathConfig?.path || !pathConfig.convertUnitTo) continue;
        const units = unitsByPath.get(pathConfig.path) ?? new Set<string>();
        units.add(pathConfig.convertUnitTo);
        unitsByPath.set(pathConfig.path, units);
      }
    }
    const disagreements = [...unitsByPath.entries()]
      .filter(([, units]) => units.size > 1)
      .map(([path, units]) => `${path}: ${[...units].join(' vs ')}`);
    expect(disagreements).toEqual([]);
  });

  // A seeded unit filter narrows the path picker to paths publishing that unit, so a general-purpose
  // gauge that ships one hides every path it is not already filtered to — including the one it is
  // bound to. The seed carried four Compact Linear gauges filtered to Volt on tank-level and
  // temperature paths (#541); correcting DEFAULT_CONFIG could not reach them, because the seed is
  // stored config stamped at LATEST and no migration touches it.
  it('seeds widget-simple-linear with the unfiltered path picker from its DEFAULT_CONFIG', () => {
    const defaults = WidgetSimpleLinearComponent.DEFAULT_CONFIG.paths as Record<string, { pathSkUnitsFilter?: string | null; convertUnitTo?: string }>;
    const seeded = seedWidgets().filter(w => w.input?.widgetProperties?.type === 'widget-simple-linear');
    expect(seeded.length).toBeGreaterThan(0);

    for (const widget of seeded) {
      const paths = (widget.input?.widgetProperties?.config?.paths ?? {}) as Record<string, { pathSkUnitsFilter?: string | null }>;
      for (const [slot, seedPath] of Object.entries(paths)) {
        expect(seedPath.pathSkUnitsFilter, `seed simple-linear ${slot}.pathSkUnitsFilter`).toBe(defaults[slot]?.pathSkUnitsFilter ?? null);
      }
    }
  });

  it('carries no stray whitespace in page or widget names', () => {
    const untrimmed = [
      ...DefaultDashboard.map(dash => dash.name),
      ...seedWidgets().map(widget => widget.input?.widgetProperties?.config?.displayName),
    ].filter((name): name is string => typeof name === 'string' && name !== name.trim());
    expect(untrimmed).toEqual([]);
  });
});

// The choice/fixed slot shape is hand-declared per widget DEFAULT_CONFIG and mirrored by the
// v17->v18 migration map. Guard it directly so a dropped pathOptions array (choice degrades to a free
// picker) or a flipped isPathConfigurable (a fixed internal path becomes user-editable) fails the
// build — widget-racesteer has no spec of its own, so this is its only DEFAULT_CONFIG guard.
describe('wind-family path config shape', () => {
  const WIND_SHAPE = [
    { type: 'widget-wind-steer', config: WidgetWindComponent.DEFAULT_CONFIG,
      choice: ['headingPath', 'trueWindAngle', 'courseOverGround'],
      fixed: ['appWindAngle', 'appWindSpeed', 'trueWindSpeed', 'set', 'drift'] },
    { type: 'widget-racesteer', config: WidgetRacesteerComponent.DEFAULT_CONFIG,
      choice: ['headingPath', 'trueWindAngle', 'courseOverGround'],
      fixed: ['appWindAngle', 'appWindSpeed', 'trueWindSpeed', 'nextWaypointBearing', 'set', 'drift'] },
    { type: 'widget-windtrends-chart', config: WidgetWindTrendsGraphComponent.DEFAULT_CONFIG,
      choice: ['trueWindDirection'],
      fixed: ['trueWindSpeed'] },
  ];

  for (const { type, config, choice, fixed } of WIND_SHAPE) {
    it(`${type}: choice slots carry pathOptions and stay configurable`, () => {
      const paths = config.paths as Record<string, { pathOptions?: unknown[]; isPathConfigurable?: boolean }>;
      for (const slot of choice) {
        expect(paths[slot], `${type}.${slot}`).toBeDefined();
        expect(Array.isArray(paths[slot].pathOptions), `${type}.${slot}.pathOptions`).toBe(true);
        expect(paths[slot].pathOptions!.length).toBeGreaterThanOrEqual(2);
        expect(paths[slot].isPathConfigurable).toBe(true);
      }
    });

    it(`${type}: fixed slots are non-editable with no choice`, () => {
      const paths = config.paths as Record<string, { pathOptions?: unknown[]; isPathConfigurable?: boolean }>;
      for (const slot of fixed) {
        expect(paths[slot], `${type}.${slot}`).toBeDefined();
        expect(paths[slot].isPathConfigurable).toBe(false);
        expect(paths[slot].pathOptions).toBeUndefined();
      }
    });
  }
});

// The seed is stored config stamped at LATEST: no chain step ever converts it, and the SI steps that
// run on every load would convert an unmarked widget and rewrite the slot. So it must already be in
// the shape the latest SI steps produce.
describe('seed scale bounds in SI', () => {
  interface SeedConfig { displayName?: string; displayScale?: { lower?: unknown; upper?: unknown }; yScaleMin?: unknown; yScaleMax?: unknown; [key: string]: unknown }
  const seeded = (type: string, displayName: string): SeedConfig[] =>
    DefaultDashboard.flatMap(dash => dash.configuration ?? [])
      .map(w => (w as { input?: { widgetProperties?: { type?: string; config?: SeedConfig } } }).input?.widgetProperties)
      .filter(wp => wp?.type === type && wp.config?.displayName === displayName)
      .map(wp => wp!.config!);

  it('is a fixed point of the SI steps, with no reset', () => {
    const config = {
      app: { configVersion: LATEST_APP_CONFIG_VERSION },
      theme: { themeName: '' },
      dashboards: structuredClone(DefaultDashboard)
    } as unknown as IConfig;
    const infos: string[] = [];

    expect(applySiSteps(config, { info: m => infos.push(m), error: m => infos.push(m) })).toBe(false);
    expect(infos).toEqual([]);
  });

  it('stores gauge bounds in SI and marks the gauges', () => {
    const rpm = [...seeded('widget-gauge-ng-radial', 'Engine'), ...seeded('widget-gauge-steel', 'RPM')];
    expect(rpm.length).toBe(2);
    for (const config of rpm) {
      expect(config.displayScale).toMatchObject({ lower: 0, upper: 60 });
      expect(config[SI_VERSION_KEY]).toBe(22);
    }
    const [coolant] = seeded('widget-gauge-ng-linear', 'Coolant Temperature');
    expect(coolant.displayScale?.lower).toBeCloseTo(273.15);
    expect(coolant.displayScale?.upper).toBeCloseTo(393.15);
    for (const fuel of seeded('widget-simple-linear', 'Fuel')) {
      expect(fuel.displayScale).toMatchObject({ lower: 0, upper: 1 });
    }
  });

  it('stores numeric y bounds in SI', () => {
    const [sog] = seeded('widget-numeric', 'Speed Over Ground');
    expect(sog.yScaleMin).toBe(0);
    expect(sog.yScaleMax).toBeCloseTo(5.144, 3);
    const [cabin] = seeded('widget-numeric', 'Cabin temperature');
    expect(cabin.yScaleMin).toBeCloseTo(273.15);
    expect(cabin.yScaleMax).toBeCloseTo(283.15);
    const [depth] = seeded('widget-numeric', 'Depth');
    expect([depth.yScaleMin, depth.yScaleMax]).toEqual([0, 10]);
  });

  it('keeps data-chart y bounds unset', () => {
    for (const config of seeded('widget-data-chart', 'Barometer')) {
      expect([config['yScaleMin'], config['yScaleMax'], config['yScaleSuggestedMin'], config['yScaleSuggestedMax']]).toEqual([null, null, null, null]);
    }
  });
});
