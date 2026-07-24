import { dashboardsRequireRemoteContexts, REMOTE_CONTEXT_WIDGET_TYPES } from './remote-context-demand.util';
import type { Dashboard } from '../services/dashboard.service';

// Mirrors the saved dashboard shape: the host selector is always 'widget-host2'; the real widget
// type and its config live under input.widgetProperties.
function widget(type: string, config: Record<string, unknown> = {}): unknown {
  return { selector: 'widget-host2', input: { widgetProperties: { type, uuid: 'x', config } } };
}

function dashboard(configuration: unknown[]): Dashboard {
  return { id: 'd1', name: 'D', configuration } as unknown as Dashboard;
}

describe('dashboardsRequireRemoteContexts', () => {
  it('returns false for empty / nullish input', () => {
    expect(dashboardsRequireRemoteContexts([])).toBe(false);
    expect(dashboardsRequireRemoteContexts(null)).toBe(false);
    expect(dashboardsRequireRemoteContexts(undefined)).toBe(false);
    expect(dashboardsRequireRemoteContexts([dashboard([])])).toBe(false);
  });

  it('returns false for a self-only dashboard (bare and self.-prefixed paths)', () => {
    const d = dashboard([
      widget('widget-numeric', {
        paths: { numericPath: { path: 'self.navigation.speedOverGround', pathType: 'number' } }
      }),
      widget('widget-data-chart', { datachartPath: 'self.environment.wind.speedApparent' }),
      widget('widget-text', { paths: { stringPath: { path: 'navigation.state' } } })
    ]);
    expect(dashboardsRequireRemoteContexts([d])).toBe(false);
  });

  it('detects the AIS radar widget type even with no configured paths', () => {
    const d = dashboard([widget('widget-ais-radar', {})]);
    expect(dashboardsRequireRemoteContexts([d])).toBe(true);
  });

  it('detects a generic widget bound to a remote vessels. path (paths object shape)', () => {
    const d = dashboard([
      widget('widget-numeric', {
        paths: {
          numericPath: { path: 'vessels.urn:mrn:imo:mmsi:123456789.navigation.speedOverGround', pathType: 'number' }
        }
      })
    ]);
    expect(dashboardsRequireRemoteContexts([d])).toBe(true);
  });

  it('detects a remote atons. path stored in the data-chart top-level field', () => {
    const d = dashboard([
      widget('widget-data-chart', { datachartPath: 'atons.urn:mrn:imo:mmsi:987654321.navigation.position' })
    ]);
    expect(dashboardsRequireRemoteContexts([d])).toBe(true);
  });

  it('detects a remote path in an array-shaped paths config (multi-control widgets)', () => {
    const d = dashboard([
      widget('widget-multi-state-switch', {
        paths: [{ path: 'vessels.urn:mrn:imo:mmsi:111.electrical.switches.nav', pathType: 'boolean' }]
      })
    ]);
    expect(dashboardsRequireRemoteContexts([d])).toBe(true);
  });

  it('returns true if any dashboard in the set has demand', () => {
    const selfOnly = dashboard([widget('widget-numeric', { paths: { p: { path: 'self.a.b' } } })]);
    const withRadar = dashboard([widget('widget-ais-radar', {})]);
    expect(dashboardsRequireRemoteContexts([selfOnly, withRadar])).toBe(true);
  });

  it('is not fooled by the decoy top-level host selector', () => {
    // selector is always 'widget-host2'; matching on it would false-positive. The real type is nested.
    const d = dashboard([widget('widget-numeric', { paths: { p: { path: 'self.a' } } })]);
    expect((d.configuration?.[0] as { selector?: string }).selector).toBe('widget-host2');
    expect(dashboardsRequireRemoteContexts([d])).toBe(false);
  });

  it('tolerates malformed / missing widget config without throwing', () => {
    const d = dashboard([{}, { input: {} }, { input: { widgetProperties: {} } }, null]);
    expect(dashboardsRequireRemoteContexts([d])).toBe(false);
  });

  it('exposes widget-ais-radar in the remote-context type set', () => {
    expect(REMOTE_CONTEXT_WIDGET_TYPES.has('widget-ais-radar')).toBe(true);
  });
});
