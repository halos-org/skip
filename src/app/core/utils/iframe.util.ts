/**
 * Detects whether the app is running inside an iframe (e.g. Signal K app-dock, Freeboard). Accessing
 * `top` across origins throws a SecurityError, which itself means we are embedded — so this fails
 * safe to embedded. Single source of truth for the app's framed detection (#1062, #217).
 */
export function isEmbeddedInIframe(win: { self: unknown; top: unknown } = window): boolean {
  try {
    return win.self !== win.top;
  } catch {
    return true;
  }
}
