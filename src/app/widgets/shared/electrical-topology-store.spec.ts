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

  it('re-keys an untracked device back to a discovered plain-id, keeping the card (#354)', () => {
    const store = new ElectricalTopologyStore(config);
    store.applyConfig([device('278', 'victron.0')]);
    store.processBatch([entry('278', 'voltage', 12)]);
    expect(store.store()['278||victron.0']?.voltage).toBe(12);

    store.applyConfig([]); // untrack the device

    const map = store.store();
    expect(map['278||victron.0']).toBeUndefined(); // stale device-key does not survive
    expect(map['278']?.voltage).toBe(12); // preserved as a discovered plain-id
    expect(map['278']?.deviceKey).toBeUndefined();
    expect(store.visibleKeys()).toEqual(['278']);
  });

  it('never renders a duplicate card for a device tracked then untracked then re-seen (#354)', () => {
    const store = new ElectricalTopologyStore(config);
    store.applyConfig([device('278', 'victron.0')]);
    store.processBatch([entry('278', 'voltage', 12)]);

    store.applyConfig([]); // untrack
    store.processBatch([entry('278', 'voltage', 13)]); // a later live delta for the same id

    const map = store.store();
    const keysForId278 = Object.keys(map).filter(key => map[key]?.id === '278');
    expect(keysForId278).toEqual(['278']); // exactly one entry for the id
    expect(map['278']?.voltage).toBe(13);
    expect(store.visibleKeys()).toEqual(['278']);
  });

  it('holds no deviceKey-bearing snapshot once every device is untracked (#354 invariant)', () => {
    const store = new ElectricalTopologyStore(config);
    store.applyConfig([device('a1', 'n2k'), device('b2', 'victron')]);
    store.processBatch([entry('a1', 'voltage', 1), entry('b2', 'voltage', 2)]);
    expect(Object.keys(store.store()).sort()).toEqual(['a1||n2k', 'b2||victron']);

    store.applyConfig([]); // untrack all

    const snapshots = Object.values(store.store());
    expect(snapshots.every(snapshot => snapshot.deviceKey === undefined)).toBe(true);
    expect(store.visibleKeys()).toEqual(['a1', 'b2']);
  });

  it('keeps the still-tracked key and re-keys the untracked one on a partial untrack (#354)', () => {
    const store = new ElectricalTopologyStore(config);
    store.applyConfig([device('a1', 'n2k'), device('b2', 'victron')]);
    store.processBatch([entry('a1', 'voltage', 1), entry('b2', 'voltage', 2)]);

    store.applyConfig([device('a1', 'n2k')]); // untrack b2 only

    const map = store.store();
    expect(map['a1||n2k']?.voltage).toBe(1);
    expect(map['b2||victron']).toBeUndefined();
    expect(map['b2']?.voltage).toBe(2);
    expect(map['b2']?.deviceKey).toBeUndefined();
    expect(store.visibleKeys()).toEqual(['a1||n2k']); // discovered b2 hidden while a1 tracked
  });

  it('drops one source of a still-tracked id without leaving a phantom discovered card (#354)', () => {
    const store = new ElectricalTopologyStore(config);
    store.applyConfig([device('a1', 'n2k'), device('a1', 'victron')]);
    store.processBatch([entry('a1', 'voltage', 12)]);

    store.applyConfig([device('a1', 'n2k')]); // drop the victron source; id a1 still tracked via n2k

    const map = store.store();
    expect(map['a1||n2k']?.voltage).toBe(12);
    expect(map['a1||victron']).toBeUndefined();
    expect(map['a1']).toBeUndefined(); // no phantom plain-id — id still tracked
    expect(Object.keys(map).filter(key => map[key]?.id === 'a1')).toEqual(['a1||n2k']);
    expect(store.visibleKeys()).toEqual(['a1||n2k']);
  });

  it('collapses multiple sources of one id to a single discovered card on full untrack (#354)', () => {
    const store = new ElectricalTopologyStore(config);
    store.applyConfig([device('a1', 'n2k'), device('a1', 'victron')]);
    store.processBatch([entry('a1', 'voltage', 12)]);
    expect(Object.keys(store.store()).sort()).toEqual(['a1||n2k', 'a1||victron']);

    store.applyConfig([]); // untrack all

    const map = store.store();
    expect(Object.keys(map).filter(key => map[key]?.id === 'a1')).toEqual(['a1']);
    expect(map['a1']?.deviceKey).toBeUndefined();
    expect(map['a1']?.voltage).toBe(12);
    expect(store.visibleKeys()).toEqual(['a1']);
  });

  it('does not commit the store when re-applying an identical device set', () => {
    const store = new ElectricalTopologyStore(config);
    store.applyConfig([device('a1', 'n2k')]);
    store.processBatch([entry('a1', 'voltage', 12)]);
    const before = store.store();

    store.applyConfig([device('a1', 'n2k')]); // identical config, no intervening data change
    expect(store.store()).toBe(before);
  });
});
