/**
 * Skip's own configuration namespace on both storage tiers. Skip is a fork of Kip and shares the
 * same server (applicationData appid) and the same browser origin, so without a distinct namespace
 * it would read Kip's config. See issue #84. Cold-turkey switch — no migration: any config left
 * under the old `kip`/bare keys is orphaned and Skip starts from defaults.
 */

/** applicationData appid path segment for server-side config (was `kip`). */
export const SERVER_CONFIG_APPID = 'skip';

/** Logical config type → Skip-namespaced localStorage key. Single source for the per-device keys. */
export const LOCAL_CONFIG_KEYS = {
  connectionConfig: 'skip.connectionConfig',
  appConfig: 'skip.appConfig',
  dashboardsConfig: 'skip.dashboardsConfig',
  layoutConfig: 'skip.layoutConfig',
  themeConfig: 'skip.themeConfig',
  widgetConfig: 'skip.widgetConfig',
} as const;

/** Resolve a logical config type to its Skip-namespaced localStorage key. */
export function localConfigKey(type: string): string {
  return (LOCAL_CONFIG_KEYS as Record<string, string>)[type] ?? `skip.${type}`;
}

/** Per-tab SSO redirect-budget key (sessionStorage). */
export const SSO_REDIRECT_BUDGET_KEY = 'skip.ssoRedirectAttempts';

/** Gesture-diagnostics debug flag key. */
export const GESTURES_DEBUG_KEY = 'skip.gesturesDebug';

/** Chart-engine A/B override flag key (#64 History-API prototype). */
export const CHART_ENGINE_OVERRIDE_KEY = 'skip.chartEngine';
