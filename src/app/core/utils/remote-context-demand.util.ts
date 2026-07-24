import type { Dashboard } from '../services/dashboard.service';

/**
 * Widget types that consume remote (non-self) Signal K contexts irrespective of their configured
 * paths. The AIS radar is fed directly from the AIS delta stream (not the path picker), so its
 * demand cannot be inferred from a stored path string. New remote-context widgets opt in here.
 */
export const REMOTE_CONTEXT_WIDGET_TYPES: ReadonlySet<string> = new Set(['widget-ais-radar']);

// Non-self SK contexts are addressed by a `vessels.`/`atons.` prefix; self paths are bare or
// `self.`-prefixed (see path-discovery.service getContextType). Matching the prefix therefore
// identifies a remote binding and never a self one.
const REMOTE_CONTEXT_PREFIXES = ['vessels.', 'atons.'];

/**
 * True when any saved dashboard hosts a widget that needs remote (non-self) SK contexts — either a
 * known remote-context widget type, or any widget whose configuration references a remote context
 * path (a string beginning `vessels.`/`atons.`, across every path-storage shape: `paths` objects,
 * `paths` arrays, `datachartPath`, etc.).
 *
 * Fail-safe by construction: it scans every string in a widget's config, so an over-match only ever
 * widens the subscription to `all`. Under-subscribing would hide collision-relevant AIS targets, so
 * callers must treat an absent/uncomputed demand as `true` (subscribe=all), never `false`.
 */
export function dashboardsRequireRemoteContexts(dashboards: Dashboard[] | null | undefined): boolean {
  if (!Array.isArray(dashboards)) return false;
  return dashboards.some(dashboard =>
    Array.isArray(dashboard?.configuration) &&
    dashboard.configuration.some(widgetHostNeedsRemoteContext)
  );
}

function widgetHostNeedsRemoteContext(entry: unknown): boolean {
  const props = (entry as { input?: { widgetProperties?: { type?: string; config?: unknown } } })
    ?.input?.widgetProperties;
  if (!props) return false;
  if (props.type && REMOTE_CONTEXT_WIDGET_TYPES.has(props.type)) return true;
  return valueReferencesRemoteContext(props.config);
}

function valueReferencesRemoteContext(value: unknown): boolean {
  if (typeof value === 'string') {
    return REMOTE_CONTEXT_PREFIXES.some(prefix => value.startsWith(prefix));
  }
  if (Array.isArray(value)) {
    return value.some(valueReferencesRemoteContext);
  }
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(valueReferencesRemoteContext);
  }
  return false;
}
