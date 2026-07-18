// Skip routes that must never be a returnTo target — redirecting back to them would loop the
// SSO bounce instead of returning the user to real content.
const SELF_ROUTE_PATHS = ['/login'];

// The app uses hash-based routing (main.ts withHashLocation), so Skip's own routes live in the URL
// fragment: /#/login resolves to pathname '/' with hash '#/login'. Checking only the pathname would
// let /#/login pass as a safe returnTo and loop the SSO bounce, so the fragment's route is checked too.
function isSelfRoute(resolved: URL): boolean {
  if (SELF_ROUTE_PATHS.includes(resolved.pathname)) {
    return true;
  }
  const fragment = resolved.hash.startsWith('#') ? resolved.hash.slice(1) : '';
  const queryIndex = fragment.indexOf('?');
  const fragmentPath = queryIndex >= 0 ? fragment.slice(0, queryIndex) : fragment;
  return SELF_ROUTE_PATHS.includes(fragmentPath);
}

/**
 * Validates a returnTo target for the SSO redirect. Accepts only site-relative paths on the app's
 * own origin; rejects protocol-relative (`//host`), backslash (normalized to `/` by browsers),
 * control characters, absolute/scheme URLs, cross-origin targets, and Skip's own login route (loop).
 * Mirrors the Signal K server's loginRedirect validation so Skip cannot construct an open redirect.
 */
export function isSafeReturnTo(target: string | null | undefined): boolean {
  if (!target || typeof target !== 'string') {
    return false;
  }
  if (!target.startsWith('/') || target.startsWith('//')) {
    return false;
  }
  if (target.includes('\\')) {
    return false;
  }
  for (let i = 0; i < target.length; i++) {
    const code = target.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return false;
    }
  }
  let resolved: URL;
  try {
    resolved = new URL(target, window.location.origin);
  } catch {
    return false;
  }
  if (resolved.origin !== window.location.origin) {
    return false;
  }
  // Reject a normalized protocol-relative path (e.g. raw '/a/..//evil' resolves to '//evil'), so the
  // check holds on the resolved path, not just the raw string.
  if (resolved.pathname.startsWith('//')) {
    return false;
  }
  return !isSelfRoute(resolved);
}

/**
 * Builds the login redirect URL, appending a validated `returnTo` and an optional `noAutoLogin`
 * flag. Handles both query-style login URLs (OIDC, e.g. `/signalk/v1/auth/oidc/login`) and hash
 * routes (admin login, e.g. `/admin/#/login`) by placing the params in the correct component.
 * An unsafe `returnTo` is dropped (the redirect still proceeds without it).
 */
export function buildLoginRedirectUrl(opts: {
  loginUrl: string;
  returnTo?: string | null;
  noAutoLogin?: boolean;
}): string {
  const params: [string, string][] = [];
  if (opts.returnTo && isSafeReturnTo(opts.returnTo)) {
    params.push(['returnTo', opts.returnTo]);
  }
  if (opts.noAutoLogin) {
    params.push(['noAutoLogin', 'true']);
  }
  if (params.length === 0) {
    return opts.loginUrl;
  }

  const query = params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const hashIndex = opts.loginUrl.indexOf('#');
  if (hashIndex >= 0) {
    // Hash route: the params belong to the hash fragment's own query string.
    const base = opts.loginUrl.slice(0, hashIndex);
    const hash = opts.loginUrl.slice(hashIndex);
    const sep = hash.includes('?') ? '&' : '?';
    return `${base}${hash}${sep}${query}`;
  }
  const sep = opts.loginUrl.includes('?') ? '&' : '?';
  return `${opts.loginUrl}${sep}${query}`;
}
