import { describe, expect, it } from 'vitest';
import type { IElectricalTopologySnapshotCore } from '../../core/contracts/electrical-topology-card.contract';
import type { ElectricalTrackedDevice } from '../../core/interfaces/widgets-interface';
import {
  ElectricalTopologyStore,
  type ElectricalTopologyConfig,
  type ElectricalTopologyEntry
} from './electrical-topology-store';

type Snapshot = IElectricalTopologySnapshotCore;

const config: ElectricalTopologyConfig<Snapshot> = {
  createSnapshot: seed => ({ id: seed.id, source: seed.source, deviceKey: seed.deviceKey }),
  applyValue: (snapshot, key, value) => {
    const bag = snapshot as unknown as Record<string, unknown>;
    if (Object.is(bag[key], value)) {
      return false;
    }
    bag[key] = value;
    return true;
  },
  derive: snapshot => {
    if (snapshot.voltage != null && snapshot.current != null) {
      snapshot.power = snapshot.voltage * snapshot.current;
    }
  }
};

const entry = (id: string, key: string, value: unknown): ElectricalTopologyEntry => ({ id, key, value, state: null });
const device = (id: string, source: string): ElectricalTrackedDevice => ({ id, source, key: `${id}||${source}` });

describe('ElectricalTopologyStore', () => {
  it('stores discovered snapshots by id and exposes them as visible', () => {
    const store = new ElectricalTopologyStore(config);
    store.processBatch([entry('a1', 'voltage', 12)]);

    expect(store.store()['a1']?.voltage).toBe(12);
    expect(store.discoveredIds()).toEqual(['a1']);
    expect(store.visibleKeys()).toEqual(['a1']);
    expect(store.visibleSnapshots()).toHaveLength(1);
  });

  it('runs the derive hook over the fully-applied draft when V and I arrive in one batch', () => {
    const store = new ElectricalTopologyStore(config);
    store.processBatch([entry('a1', 'voltage', 14), entry('a1', 'current', 3)]);

    expect(store.store()['a1']?.power).toBe(42);
  });

  it('does not commit when applyValue reports no change', () => {
    const store = new ElectricalTopologyStore(config);
    store.processBatch([entry('a1', 'voltage', 12)]);
    const before = store.store();

    store.processBatch([entry('a1', 'voltage', 12)]); // same value
    expect(store.store()).toBe(before);
  });

  it('reprojects id-arrived-before-config snapshots onto device keys and drops the stale plain-id', () => {
    const store = new ElectricalTopologyStore(config);
    store.processBatch([entry('a1', 'voltage', 12)]); // arrives before config, keyed by plain id
    expect(store.store()['a1']).toBeDefined();

    store.applyConfig([device('a1', 'n2k')]);

    expect(store.store()['a1||n2k']).toBeDefined();
    expect(store.store()['a1||n2k']?.voltage).toBe(12);
    expect(store.store()['a1']).toBeUndefined();
    expect(store.visibleKeys()).toEqual(['a1||n2k']);
  });

  it('selects tracked keys when tracked, else discovered ids', () => {
    const store = new ElectricalTopologyStore(config);
    store.processBatch([entry('b2', 'voltage', 1), entry('a1', 'voltage', 2)]);
    expect(store.visibleKeys()).toEqual(['a1', 'b2']); // discovered, sorted

    store.applyConfig([device('a1', 'n2k')]);
    expect(store.visibleKeys()).toEqual(['a1||n2k']); // tracked order
  });

  it('fans one id out to all its tracked device keys, seeding source and deviceKey', () => {
    const store = new ElectricalTopologyStore(config);
    store.applyConfig([device('a1', 'n2k'), device('a1', 'victron')]);
    store.processBatch([entry('a1', 'voltage', 12)]);

    const map = store.store();
    expect(map['a1||n2k']?.voltage).toBe(12);
    expect(map['a1||victron']?.voltage).toBe(12);
    expect(map['a1||n2k']?.source).toBe('n2k');
    expect(map['a1||n2k']?.deviceKey).toBe('a1||n2k');
    expect(map['a1||victron']?.source).toBe('victron');
    expect(store.visibleKeys()).toEqual(['a1||n2k', 'a1||victron']);
  });
});
