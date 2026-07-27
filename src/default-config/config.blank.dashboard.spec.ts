import { describe, expect, it } from 'vitest';
import { DefaultDashboard } from './config.blank.dashboard';
import { WidgetPositionComponent } from '../app/widgets/widget-position/widget-position.component';

// The shipped seed is stamped at LATEST_APP_CONFIG_VERSION, so config migrations never run on a
// fresh install/profile. A widget whose path shape drifts from its DEFAULT_CONFIG therefore ships
// its old shape forever. Guard the position widget specifically — its two-path shape was the #414
// bug — so a future re-export of the seed can't silently reintroduce longPath/latPath.
describe('DefaultDashboard seed', () => {
  interface SeedWidget { input?: { widgetProperties?: { type?: string; config?: { paths?: Record<string, unknown> } } } }

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
});
