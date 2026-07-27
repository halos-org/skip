import { describe, expect, it } from 'vitest';
import { DefaultDashboard } from './config.blank.dashboard';
import { WidgetPositionComponent } from '../app/widgets/widget-position/widget-position.component';

// The shipped seed is stamped at LATEST_APP_CONFIG_VERSION, so config migrations never run on a
// fresh install/profile. A widget whose path shape drifts from its DEFAULT_CONFIG therefore ships
// its old shape forever. Guard the position widget specifically — its two-path shape was the #414
// bug — so a future re-export of the seed can't silently reintroduce longPath/latPath.
describe('DefaultDashboard seed', () => {
  interface SeedWidget { input?: { widgetProperties?: { type?: string; config?: { paths?: Record<string, unknown>; enableTimeout?: boolean; dataTimeout?: number } } } }

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
      }
    });
  }
});
