import { computed, signal } from '@angular/core';
import type { TState } from '../../core/interfaces/signalk-interfaces';
import type { ElectricalTrackedDevice } from '../../core/interfaces/widgets-interface';
import type { IElectricalTopologySnapshotCore } from '../../core/contracts/electrical-topology-card.contract';
import { buildIdToDeviceKeysMap } from './electrical-config.util';

/** One de-duped, parsed path update handed to the store from the ingest scheduler. */
export interface ElectricalTopologyEntry {
  id: string;
  key: string;
  value: unknown;
  state: TState | null;
}

export interface ElectricalTopologyConfig<TSnapshot extends IElectricalTopologySnapshotCore> {
  /** Create a fresh snapshot for a newly seen device key. */
  createSnapshot: (seed: { id: string; source: string | null; deviceKey: string | undefined }) => TSnapshot;
  /** Apply one parsed value to the draft snapshot; return whether a field actually changed. */
  applyValue: (snapshot: TSnapshot, key: string, value: unknown, state: TState | null) => boolean;
  /** Optional per-changed-key derivation (e.g. power = V*I) run after a value applies. */
  derive?: (snapshot: TSnapshot) => void;
}

/**
 * Source-blind keyed-snapshot store shared by the electrical widget family
 * (alternator, inverter, ac, solar). Owns the by-key snapshot store, the
 * discovered-id and tracked-device signals, the batch-apply flush body,
 * reproject (re-key id-arrived-before-config snapshots onto configured device
 * keys), and the tracked-else-discovered visible selection. Per-widget metric
 * mapping and derivation are injected seams. Charger's source-qualified variant
 * and bms's id-only store compose their own paths (Stage 2b/2d).
 */
export class ElectricalTopologyStore<TSnapshot extends IElectricalTopologySnapshotCore> {
  private readonly _store = signal<Record<string, TSnapshot>>({});
  private readonly _discoveredIds = signal<string[]>([]);
  private readonly _trackedDevices = signal<ElectricalTrackedDevice[]>([]);

  readonly store = this._store.asReadonly();
  readonly discoveredIds = this._discoveredIds.asReadonly();
  readonly trackedDevices = this._trackedDevices.asReadonly();

  readonly visibleKeys = computed<string[]>(() => {
    const tracked = this._trackedDevices();
    if (tracked.length) {
      return tracked.map(device => device.key);
    }

    const map = this._store();
    const ids = new Set(this._discoveredIds());
    return Object.keys(map)
      .filter(key => {
        const snapshot = map[key];
        return !!snapshot && ids.has(snapshot.id);
      })
      .sort((left, right) => left.localeCompare(right));
  });

  readonly visibleSnapshots = computed<TSnapshot[]>(() => {
    const keys = this.visibleKeys();
    const map = this._store();
    return keys.map(key => map[key]).filter((snapshot): snapshot is TSnapshot => !!snapshot);
  });

  constructor(private readonly cfg: ElectricalTopologyConfig<TSnapshot>) {}

  /** Apply resolved config: set the tracked devices and reproject existing snapshots. */
  applyConfig(devices: ElectricalTrackedDevice[]): void {
    this._trackedDevices.set(devices);
    this.reproject(devices);
  }

  /** Process a drained batch of entries into the store. */
  processBatch(entries: ElectricalTopologyEntry[]): void {
    const uniqueIds = new Set(entries.map(entry => entry.id));
    uniqueIds.forEach(id => this.trackDiscovered(id));

    const idToKeys = buildIdToDeviceKeysMap(this._trackedDevices());

    this._store.update(current => {
      let next = current;
      let changed = false;

      for (const entry of entries) {
        const keysForId = idToKeys.get(entry.id);
        const targetKeys: string[] = keysForId?.length ? keysForId : [entry.id];

        for (const deviceKey of targetKeys) {
          const isTracked = !!keysForId?.length;
          const trackedDevice = isTracked ? this._trackedDevices().find(device => device.key === deviceKey) : null;
          const existing = next[deviceKey]
            ?? this.cfg.createSnapshot({ id: entry.id, source: trackedDevice?.source ?? null, deviceKey: isTracked ? deviceKey : undefined });
          const snapshot = { ...existing };

          const fieldChanged = this.cfg.applyValue(snapshot, entry.key, entry.value, entry.state);
          if (!fieldChanged) {
            continue;
          }

          this.cfg.derive?.(snapshot);

          if (!changed) {
            next = { ...next };
            changed = true;
          }
          next[deviceKey] = snapshot;
        }
      }

      return changed ? next : current;
    });
  }

  private reproject(devices: ElectricalTrackedDevice[]): void {
    if (!devices.length) {
      return;
    }

    const idToKeys = new Map<string, string[]>();
    devices.forEach(device => {
      const existing = idToKeys.get(device.id) ?? [];
      existing.push(device.key);
      idToKeys.set(device.id, existing);
    });

    this._store.update(current => {
      let next = current;
      let changed = false;

      idToKeys.forEach((keys, id) => {
        const sourceSnapshot = current[id];
        if (!sourceSnapshot) {
          return;
        }

        for (const deviceKey of keys) {
          if (current[deviceKey]) {
            continue;
          }
          const trackedDevice = devices.find(device => device.key === deviceKey);
          if (!changed) {
            next = { ...current };
            changed = true;
          }
          next[deviceKey] = { ...sourceSnapshot, source: trackedDevice?.source ?? null, deviceKey };
        }

        if (changed && next[id]?.deviceKey === undefined) {
          delete next[id];
        }
      });

      return changed ? next : current;
    });
  }

  private trackDiscovered(id: string): void {
    const ids = this._discoveredIds();
    if (ids.includes(id)) {
      return;
    }
    this._discoveredIds.set([...ids, id].sort((left, right) => left.localeCompare(right)));
  }
}
