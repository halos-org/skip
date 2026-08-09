/**
 * Guarded access to `localStorage`.
 *
 * Skip runs in contexts where Web Storage is absent or throws on the property access itself: Safari
 * private mode, embedded chartplotter browsers with storage disabled, a sandboxed iframe, and Node
 * without a localStorage file. Only the per-device connection config lives in localStorage — the
 * rest of the configuration is server-side — so an unusable store must degrade to session-only
 * defaults rather than break boot.
 */

function localStorageOrNull(): Storage | null {
  try {
    const store: Storage | undefined = globalThis.localStorage;
    return store ?? null;
  } catch {
    return null;
  }
}

export function isLocalStorageAvailable(): boolean {
  return localStorageOrNull() !== null;
}

export function getLocalStorageItem(key: string): string | null {
  return localStorageOrNull()?.getItem(key) ?? null;
}

export function setLocalStorageItem(key: string, value: string): void {
  const store = localStorageOrNull();
  if (!store) return;
  try {
    store.setItem(key, value);
  } catch (error) {
    // A store that exists but refuses the write (quota exhausted, corrupted profile) is a fault the
    // operator needs to see, unlike a browser that offers no storage at all.
    console.error(`[LocalStorage] Could not persist '${key}'`, error);
  }
}

export function removeLocalStorageItem(key: string): void {
  localStorageOrNull()?.removeItem(key);
}
