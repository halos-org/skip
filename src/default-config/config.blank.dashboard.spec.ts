import { describe, expect, it } from 'vitest';
import { DefaultDashboard } from './config.blank.dashboard';
import { WidgetPositionComponent } from '../app/widgets/widget-position/widget-position.component';
import { WidgetWindComponent } from '../app/widgets/widget-windsteer/widget-windsteer.component';
import { WidgetRacesteerComponent } from '../app/widgets/widget-racesteer/widget-racesteer.component';
import { WidgetWindTrendsChartComponent } from '../app/widgets/widget-windtrends-chart/widget-windtrends-chart.component';
import { WidgetAutopilotComponent } from '../app/widgets/widget-autopilot/widget-autopilot.component';

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

  // Attitude widgets read a sub-field off navigation.attitude; their path must stay hidden
  // (isPathConfigurable:false) — else the settings show a dead 'number' picker on an object leaf and
  // no Paths tab is suppressed (#416) — and their data timeout defaults on. Each type is asserted
  // separately so dropping one on a future re-export can't hide behind the other's presence.
  for (const type of ['widget-heel-gauge', 'widget-horizon']) {
    it(`seeds ${type} with a hidden fixed attitude path and the timeout enabled`, () => {
      const widgets = seededWidgetsOfType(type);
      expect(widgets.length).toBeGreaterThan(0);

      for (const widget of widgets) {
        const cfg = widget.input?.widgetProperties?.config;
        const paths = Object.values(cfg?.paths ?? {}) as { path?: string; isPathConfigurable?: boolean }[];
        expect(paths.length).toBeGreaterThan(0);
        for (const pathCfg of paths) {
          expect(pathCfg.path).toBe('self.navigation.attitude');
          expect(pathCfg.isPathConfigurable).toBe(false);
        }
        expect(cfg?.enableTimeout).toBe(true);
        expect(cfg?.dataTimeout).toBe(5);
        expect(typeof cfg?.updateInterval).toBe('number');
        expect(cfg?.updateInterval).toBeGreaterThan(0);
      }
    });
  }

  // The seed is stamped at LATEST, so migrations never touch it; the wind-steer seed must agree with
  // its DEFAULT_CONFIG or a fresh install ships a value migrated users don't get. The seed had already
  // drifted (angleTrueGround / speedOverGround) undetected before Effort B corrected it — guard every
  // seeded slot against the default so it can't drift again. pathOptions is base-sourced (supplied by
  // the runtime merge), so it is deliberately excluded here.
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
    { type: 'widget-windtrends-chart', config: WidgetWindTrendsChartComponent.DEFAULT_CONFIG,
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
