import type { ElectricalTrackedDevice } from '../../core/interfaces/widgets-interface';

/**
 * Shared configuration/device normalizers for the electrical widget family
 * (charger, alternator, inverter, ac, solar-charger, bms). `normalizeTrackedDevices`
 * is the family's canonical device normalizer: it accepts object items only,
 * defaults a missing or blank `source` to `'default'` (matching what the widget
 * config modal writes at save time), drops only items without a usable `id`, and
 * dedupes by `key`. ac keeps `normalizeAcTrackedDevices` (a reserved-aggregate-id
 * guard) — a distinct AC-phase variant, see #351.
 */

export function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const ids = new Set<string>();
  value.forEach(item => {
    if (typeof item !== 'string') {
      return;
    }

    const normalized = item.trim();
    if (normalized.length > 0) {
      ids.add(normalized);
    }
  });

  return [...ids].sort((left, right) => left.localeCompare(right));
}

export function normalizeTrackedDevices(value: unknown): ElectricalTrackedDevice[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const devices = new Map<string, ElectricalTrackedDevice>();
  value.forEach(item => {
    if (!item || typeof item !== 'object') {
      return;
    }

    const candidate = item as { id?: unknown; source?: unknown; key?: unknown };
    const id = normalizeOptionalString(candidate.id);
    if (!id) {
      return;
    }

    const source = normalizeOptionalString(candidate.source) ?? 'default';
    const key = normalizeOptionalString(candidate.key) ?? `${id}||${source}`;
    devices.set(key, { id, source, key });
  });

  return [...devices.values()].sort((left, right) => left.key.localeCompare(right.key));
}

export function buildIdToDeviceKeysMap(devices: readonly ElectricalTrackedDevice[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  devices.forEach(device => {
    const existing = map.get(device.id) ?? [];
    existing.push(device.key);
    map.set(device.id, existing);
  });
  return map;
}
