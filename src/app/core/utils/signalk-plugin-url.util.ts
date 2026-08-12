/**
 * Resolves the Signal K server root (no trailing slash) that every API and plugin URL hangs off.
 *
 * A user-configured Signal K URL takes precedence over the discovered HTTP service endpoint.
 * Either input may already carry a `/signalk[/vN[/api]]` suffix, so both go through the same
 * suffix strip — a path prefix ahead of it (reverse proxy) is preserved.
 *
 * @param httpServiceUrl the server's discovered v1/v2 API URL (e.g. `http://host:3000/signalk/v1/api/`)
 * @param configuredUrl  the user-configured Signal K URL, if any (takes precedence)
 * @returns the server root without a trailing slash, or `null` if it cannot be resolved
 */
function resolveSignalKServerRoot(
  httpServiceUrl: string | null | undefined,
  configuredUrl?: string | null
): string | null {
  const source = configuredUrl?.trim() || httpServiceUrl;
  if (!source) {
    return null;
  }

  const normalized = source.endsWith('/') ? source.slice(0, -1) : source;
  const root = normalized
    .replace(/\/signalk\/v2\/api$/, '')
    .replace(/\/signalk\/v1\/api$/, '')
    .replace(/\/signalk\/v2$/, '')
    .replace(/\/signalk\/v1$/, '')
    .replace(/\/signalk$/, '');

  return root || null;
}

/**
 * Resolves the base URL of a Signal K server plugin (`<server>/plugins/<pluginId>/`) from the
 * active connection endpoint.
 *
 * Generalises the per-plugin logic used by the `sk-video` and other plugin clients so every
 * plugin client agrees on how the base URL is derived. Pass the plugin
 * id (e.g. `'kip'`, `'sk-video'`).
 *
 * @param pluginId       the Signal K plugin id (lower-case kebab; e.g. `'sk-video'`)
 * @param httpServiceUrl the server's discovered v1/v2 API URL (e.g. `http://host:3000/signalk/v1/api/`)
 * @param configuredUrl  the user-configured Signal K URL, if any (takes precedence)
 * @returns the plugin base URL ending in `/`, or `null` if it cannot be resolved
 */
export function resolveSignalKPluginBaseUrl(
  pluginId: string,
  httpServiceUrl: string | null | undefined,
  configuredUrl?: string | null
): string | null {
  // Defensive: the id becomes part of a URL path, so reject anything that isn't a plain
  // lower-case kebab id (no empty, spaces, path traversal or upper-case).
  if (!/^[a-z0-9][a-z0-9-]*$/.test(pluginId)) {
    return null;
  }

  const root = resolveSignalKServerRoot(httpServiceUrl, configuredUrl);
  return root ? `${root}/plugins/${pluginId}/` : null;
}

/**
 * Resolves the base URL of the Signal K v2 REST API (`<server>/signalk/v2/api`).
 *
 * The endpoint the server advertises wins when present. A server can serve the v2 API and still
 * omit `endpoints.v2` from its `/signalk` document, which leaves the advertised value unset; the
 * URL is then derived from the same server root the plugin clients use, so both address the same
 * host.
 *
 * @param httpServiceUrlV2 the server's advertised v2 API URL, if any
 * @param httpServiceUrl   the server's discovered v1/v2 API URL
 * @param configuredUrl    the user-configured Signal K URL, if any
 * @returns the v2 API base URL without a trailing slash, or `null` if it cannot be resolved
 */
export function resolveSignalKV2ApiBaseUrl(
  httpServiceUrlV2: string | null | undefined,
  httpServiceUrl: string | null | undefined,
  configuredUrl?: string | null
): string | null {
  const advertised = httpServiceUrlV2?.trim();
  if (advertised) {
    return advertised.endsWith('/') ? advertised.slice(0, -1) : advertised;
  }

  const root = resolveSignalKServerRoot(httpServiceUrl, configuredUrl);
  return root ? `${root}/signalk/v2/api` : null;
}
