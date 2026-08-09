/**
 * Guarded access to `localStorage`, and the single source of truth for whether it is usable.
 *
 * Skip runs where Web Storage is absent, throws on the property access itself, or exists and
 * accepts nothing: Safari private mode, embedded chartplotter browsers with storage disabled, a
 * sandboxed iframe, a zero-quota kiosk WebView, and Node without a localStorage file. Every one of
 * those must degrade rather than break boot, so all four operations here are total.
 *
 * The per-device connection config and the remote-control identity live in localStorage; the rest
 * of the configuration is server-side. Callers that would otherwise accept a change they cannot
 * persist should ask {@link isLocalStorageAvailable} first and refuse it instead — silently losing
 * a profile switch on the next reload is worse than declining it.
 */

const PROBE_KEY = 'skip.storageProbe';

function localStorageOrNull(): Storage | null {
  try {
    const store: Storage | undefined = globalThis.localStorage;
    return store ?? null;
  } catch {
    // Reading the property throws SecurityError in Firefox and Safari when the origin is denied
    // storage, so a `typeof` test is not enough — the getter still runs.
    return null;
  }
}

let usable: boolean | undefined;

/**
 * Whether a write would actually survive. Resolving the Storage object is not enough: a zero-quota
 * store answers every read and silently discards every write, so probe with a round trip. Cached,
 * since the answer cannot change within a page session.
 */
export function isLocalStorageAvailable(): boolean {
  if (usable !== undefined) { return usable; }
  const store = localStorageOrNull();
  if (!store) { return (usable = false); }
  try {
    store.setItem(PROBE_KEY, '1');
    usable = store.getItem(PROBE_KEY) === '1';
    store.removeItem(PROBE_KEY);
  } catch {
    usable = false;
  }
  return usable;
}

/** Test seam: the probe is cached for the page session, which outlives a spec. */
export function resetLocalStorageAvailability(): void {
  usable = undefined;
}

export function getLocalStorageItem(key: string): string | null {
  try {
    return localStorageOrNull()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function setLocalStorageItem(key: string, value: string): boolean {
  const store = localStorageOrNull();
  if (!store) { return false; }
  try {
    store.setItem(key, value);
    return true;
  } catch (error) {
    // A store that exists but refuses the write (quota exhausted, corrupted profile) is a fault the
    // operator needs to see, unlike a browser that offers no storage at all.
    console.error(`[LocalStorage] Could not persist '${key}'`, error);
    return false;
  }
}

export function removeLocalStorageItem(key: string): void {
  try {
    localStorageOrNull()?.removeItem(key);
  } catch {
    // Nothing to clean up if the store will not let us; the value is unreachable either way.
  }
}
