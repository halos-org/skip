import type { ElectricalTrackedDevice } from '../../core/interfaces/widgets-interface';

/**
 * Shared configuration/device normalizers for the electrical widget family
 * (charger, alternator, inverter, ac, and the parts of solar-charger/bms that
 * share the object-based device model). Each widget previously carried its own
 * verbatim copy of these; solar-charger and bms keep their own divergent
 * `normalizeTrackedDevices`, and ac keeps `normalizeAcTrackedDevices` (a
 * reserved-aggregate-id guard) — all behaviorally distinct, see #351.
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
    const source = normalizeOptionalString(candidate.source);
    if (!id || !source) {
      return;
    }

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
