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

  it('matches remote contexts by prefix, not substring (self-only stays false)', () => {
    // 'widget-host2' is the decoy host selector, and free-text config must not false-match on a
    // 'vessels'/'atons' substring that is not a context prefix.
    const d = dashboard([
      widget('widget-numeric', { displayName: 'My vessels overview', paths: { p: { path: 'self.a' } } }),
      widget('widget-text', { paths: { s: { path: 'navigation.atonsNearby' } } })
    ]);
    expect(dashboardsRequireRemoteContexts([d])).toBe(false);
  });

  it('descends into group-widget nested children (subGridOpts.children)', () => {
    // A group widget hosts a nested gridstack; children live under subGridOpts.children, not the
    // flat configuration. A remote consumer nested inside must still be detected.
    const groupWith = (child: unknown): unknown => ({
      id: 'g', selector: 'widget-host2',
      input: { widgetProperties: { type: 'group-widget', uuid: 'g', config: { displayName: 'Group' } } },
      subGridOpts: { children: [child] }
    });
    const nestedRadar = groupWith(widget('widget-ais-radar', {}));
    const nestedRemotePath = groupWith(widget('widget-numeric', {
      paths: { p: { path: 'vessels.urn:mrn:imo:mmsi:222.navigation.speedOverGround' } }
    }));
    const nestedSelfOnly = groupWith(widget('widget-numeric', { paths: { p: { path: 'self.a.b' } } }));

    expect(dashboardsRequireRemoteContexts([dashboard([nestedRadar])])).toBe(true);
    expect(dashboardsRequireRemoteContexts([dashboard([nestedRemotePath])])).toBe(true);
    expect(dashboardsRequireRemoteContexts([dashboard([nestedSelfOnly])])).toBe(false);
  });

  it('tolerates malformed / missing widget config without throwing', () => {
    const d = dashboard([{}, { input: {} }, { input: { widgetProperties: {} } }, null]);
    expect(dashboardsRequireRemoteContexts([d])).toBe(false);
  });

  it('exposes widget-ais-radar in the remote-context type set', () => {
    expect(REMOTE_CONTEXT_WIDGET_TYPES.has('widget-ais-radar')).toBe(true);
  });
});
