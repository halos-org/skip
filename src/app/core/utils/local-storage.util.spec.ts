import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLocalStorageItem, isLocalStorageAvailable, removeLocalStorageItem, setLocalStorageItem } from './local-storage.util';

const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

function stubLocalStorage(descriptor: PropertyDescriptor | null): void {
  if (descriptor) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, ...descriptor });
  } else {
    delete (globalThis as Record<string, unknown>)['localStorage'];
  }
}

function workingStore(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() { return entries.size; },
    clear: () => entries.clear(),
    getItem: (key: string) => entries.get(key) ?? null,
    key: (index: number) => Array.from(entries.keys())[index] ?? null,
    removeItem: (key: string) => { entries.delete(key); },
    setItem: (key: string, value: string) => { entries.set(key, value); }
  };
}

describe('local-storage.util (#502)', () => {
  afterEach(() => {
    stubLocalStorage(originalDescriptor ?? null);
    vi.restoreAllMocks();
  });

  it('reads null and swallows writes when the browser exposes no storage', () => {
    stubLocalStorage(null);
    expect(isLocalStorageAvailable()).toBe(false);
    expect(getLocalStorageItem('skip.connectionConfig')).toBeNull();
    expect(() => setLocalStorageItem('skip.connectionConfig', '{}')).not.toThrow();
    expect(() => removeLocalStorageItem('skip.connectionConfig')).not.toThrow();
  });

  it('reads null when the storage property access itself throws (origin denied storage)', () => {
    stubLocalStorage({ get: () => { throw new DOMException('denied', 'SecurityError'); } });
    expect(isLocalStorageAvailable()).toBe(false);
    expect(getLocalStorageItem('skip.connectionConfig')).toBeNull();
    expect(() => setLocalStorageItem('skip.connectionConfig', '{}')).not.toThrow();
  });

  it('round-trips through a working store', () => {
    stubLocalStorage({ value: workingStore() });
    setLocalStorageItem('skip.themeConfig', '{"themeName":"light"}');
    expect(getLocalStorageItem('skip.themeConfig')).toBe('{"themeName":"light"}');
    removeLocalStorageItem('skip.themeConfig');
    expect(getLocalStorageItem('skip.themeConfig')).toBeNull();
  });

  it('reports a rejected write instead of hiding it', () => {
    const store = workingStore();
    vi.spyOn(store, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    stubLocalStorage({ value: store });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => setLocalStorageItem('skip.themeConfig', '{}')).not.toThrow();
    expect(consoleError).toHaveBeenCalled();
  });
});
