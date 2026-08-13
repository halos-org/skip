import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { BehaviorSubject, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMeta, IPathValueData, IPathMetaData } from '../interfaces/app-interfaces';
import { ISignalKDataValueUpdate, ISkMetadata, States } from '../interfaces/signalk-interfaces';
import { DataService, IPathUpdate, IPathUpdateWithPath } from './data.service';
import { SignalKDeltaService } from './signalk-delta.service';
import { SignalKConnectionService } from './signalk-connection.service';

describe('DataService', () => {
  let service: DataService;

  let dataPathUpdates$: Subject<IPathValueData>;
  let metadataUpdates$: Subject<IMeta>;
  let notificationUpdates$: Subject<ISignalKDataValueUpdate>;
  let selfUpdates$: Subject<string>;

  beforeEach(() => {
    dataPathUpdates$ = new Subject<IPathValueData>();
    metadataUpdates$ = new Subject<IMeta>();
    notificationUpdates$ = new Subject<ISignalKDataValueUpdate>();
    selfUpdates$ = new Subject<string>();

    TestBed.configureTestingModule({
      providers: [
        DataService,
        {
          provide: SignalKDeltaService,
          useValue: {
            subscribeDataPathsUpdates: () => dataPathUpdates$.asObservable(),
            subscribeMetadataUpdates: () => metadataUpdates$.asObservable(),
            subscribeNotificationsUpdates: () => notificationUpdates$.asObservable(),
            subscribeSelfUpdates: () => selfUpdates$.asObservable(),
          },
        },
      ],
    });

    service = TestBed.inject(DataService);
  });

  afterEach(() => {
    // Recency-dependent timeout tests fake the clock; always restore so real-time tests are unaffected.
    vi.useRealTimers();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('shares one live subject per (path, source) so co-subscribers cannot tear each other down', () => {
    const first$ = service.subscribePath('self.electrical.batteries.10.voltage', 'default');
    const second$ = service.subscribePath('self.electrical.batteries.10.voltage', 'default');
    const otherSource$ = service.subscribePath('self.electrical.batteries.10.voltage', 'test-source');

    // Deduplication is keyed by (path, source): identical pairs share one subject, distinct sources do not.
    expect(second$).toBe(first$);
    expect(otherSource$).not.toBe(first$);

    const firstValues: unknown[] = [];
    const secondValues: unknown[] = [];
    first$.subscribe(update => firstValues.push(update.data.value));
    second$.subscribe(update => secondValues.push(update.data.value));

    dataPathUpdates$.next({
      context: 'self',
      path: 'electrical.batteries.10.voltage',
      source: 'test-source',
      timestamp: '2026-01-01T00:00:01.000Z',
      value: 12.5,
    });

    // Both co-subscribers keep receiving from the shared stream; there is no teardown that could complete it.
    expect(firstValues.at(-1)).toBe(12.5);
    expect(secondValues.at(-1)).toBe(12.5);
  });

  describe('unsubscribePath (refcounted release)', () => {
    const PATH = 'self.navigation.speedOverGround';

    it('tears down a shared registration only once every subscriber has released it', () => {
      let firstCompleted = false;
      let secondCompleted = false;
      service.subscribePath(PATH, 'default').subscribe({ complete: () => (firstCompleted = true) });
      service.subscribePath(PATH, 'default').subscribe({ complete: () => (secondCompleted = true) });

      service.unsubscribePath(PATH, 'default');
      expect(firstCompleted).toBe(false);
      expect(secondCompleted).toBe(false);

      service.unsubscribePath(PATH, 'default');
      expect(firstCompleted).toBe(true);
      expect(secondCompleted).toBe(true);
    });

    it('matches by path and source, leaving other sources on the same path alive', () => {
      let defaultCompleted = false;
      let otherCompleted = false;
      service.subscribePath(PATH, 'default').subscribe({ complete: () => (defaultCompleted = true) });
      const other$ = service.subscribePath(PATH, 'gps-2');
      other$.subscribe({ complete: () => (otherCompleted = true) });

      service.unsubscribePath(PATH, 'default');
      expect(defaultCompleted).toBe(true);
      expect(otherCompleted).toBe(false);

      // The surviving source still delivers values after its sibling was released.
      let latestOther: IPathUpdate | undefined;
      other$.subscribe(update => (latestOther = update));
      dataPathUpdates$.next({
        context: 'self',
        path: 'navigation.speedOverGround',
        source: 'gps-2',
        timestamp: '2026-01-01T00:00:01.000Z',
        value: 3.2,
      });
      expect(latestOther!.data.value).toBe(3.2);
    });

    it('is a safe no-op for an unknown path or source', () => {
      service.subscribePath(PATH, 'default');
      expect(() => service.unsubscribePath('self.does.not.exist', 'default')).not.toThrow();
      expect(() => service.unsubscribePath(PATH, 'no-such-source')).not.toThrow();

      // The live registration is untouched by the no-op releases.
      let latest: IPathUpdate | undefined;
      service.subscribePath(PATH, 'default').subscribe(update => (latest = update));
      dataPathUpdates$.next({
        context: 'self',
        path: 'navigation.speedOverGround',
        source: 'gps',
        timestamp: '2026-01-01T00:00:01.000Z',
        value: 6.0,
      });
      expect(latest!.data.value).toBe(6.0);
    });

    it('mints a fresh live registration after a full teardown, not the completed one', () => {
      service.subscribePath(PATH, 'default');
      service.unsubscribePath(PATH, 'default');

      // A subscribe after teardown must get a working subject, not the completed one
      // (which would replay its last value then complete, ignoring later deltas).
      let latest: IPathUpdate | undefined;
      let completed = false;
      service.subscribePath(PATH, 'default').subscribe({
        next: update => (latest = update),
        complete: () => (completed = true),
      });
      dataPathUpdates$.next({
        context: 'self',
        path: 'navigation.speedOverGround',
        source: 'gps',
        timestamp: '2026-01-01T00:00:01.000Z',
        value: 7.7,
      });
      expect(completed).toBe(false);
      expect(latest!.data.value).toBe(7.7);
    });
  });

  describe('acquirePath (disposable handle)', () => {
    const PATH = 'self.navigation.speedOverGround';

    it('shares the same stream subscribePath returns and refcounts co-acquirers', () => {
      // data$ IS the shared subject subscribePath hands out (acquirePath composes subscribePath).
      const shared$ = service.subscribePath(PATH, 'default'); // refCount 1
      const a = service.acquirePath(PATH, 'default');         // refCount 2
      expect(a.data$).toBe(shared$);
      service.unsubscribePath(PATH, 'default');               // balance the bare subscribePath → refCount 1

      let completed = false;
      a.data$.subscribe({ complete: () => (completed = true) });
      const b = service.acquirePath(PATH, 'default');         // refCount 2
      expect(b.data$).toBe(a.data$);

      a.release();                                            // refCount 1
      expect(completed).toBe(false); // b still holds it
      b.release();                                            // refCount 0 → teardown
      expect(completed).toBe(true);
    });

    it('release is idempotent: extra calls do not tear down a co-acquirer still holding the path', () => {
      let firstCompleted = false;
      let secondCompleted = false;
      const first = service.acquirePath(PATH, 'default');
      const second = service.acquirePath(PATH, 'default');
      first.data$.subscribe({ complete: () => (firstCompleted = true) });
      second.data$.subscribe({ complete: () => (secondCompleted = true) });

      first.release();
      first.release();
      first.release(); // 2nd/3rd calls are no-ops
      expect(firstCompleted).toBe(false);
      expect(secondCompleted).toBe(false);

      // The surviving co-acquirer's stream stays live and still delivers values.
      let latest: IPathUpdate | undefined;
      second.data$.subscribe(update => (latest = update));
      dataPathUpdates$.next({
        context: 'self',
        path: 'navigation.speedOverGround',
        source: 'gps',
        timestamp: '2026-01-01T00:00:01.000Z',
        value: 4.4,
      });
      expect(latest!.data.value).toBe(4.4);

      // A balanced release finally tears it down.
      second.release();
      expect(secondCompleted).toBe(true);
    });

    it('a handle cannot decrement a registration below its own single acquire', () => {
      // Two independent acquisitions of the SAME (path, source): refCount == 2.
      const doomed = service.acquirePath(PATH, 'default');
      const survivor = service.acquirePath(PATH, 'default');
      let survivorCompleted = false;
      survivor.data$.subscribe({ complete: () => (survivorCompleted = true) });

      // Over-calling release cannot decrement more than the one acquire this handle made.
      doomed.release();
      doomed.release();
      doomed.release();

      expect(survivorCompleted).toBe(false); // the survivor's acquire is intact
    });
  });

  describe('removePathsForContext', () => {
    const vesselA = 'vessels.urn:mrn:imo:mmsi:100000001';
    const vesselB = 'vessels.urn:mrn:imo:mmsi:100000002';
    const TS = '2026-01-01T00:00:01.000Z';

    function seedSog(context: string, value: number): void {
      dataPathUpdates$.next({ context, path: 'navigation.speedOverGround', source: 'gps', timestamp: TS, value });
    }

    it('removes cached path data for a context, leaving other contexts untouched', () => {
      seedSog('self', 1.1);
      seedSog(vesselA, 2.2);
      seedSog(vesselB, 3.3);
      expect(service.getPathObject(`${vesselA}.navigation.speedOverGround`)).not.toBeNull();

      service.removePathsForContext(vesselA);

      expect(service.getPathObject(`${vesselA}.navigation.speedOverGround`)).toBeNull();
      expect(service.getPathObject('self.navigation.speedOverGround')).not.toBeNull();
      expect(service.getPathObject(`${vesselB}.navigation.speedOverGround`)).not.toBeNull();
      expect(service.getCachedPaths()).not.toContain(`${vesselA}.navigation.speedOverGround`);
    });

    it('prunes the full-tree data and meta caches when they are active', () => {
      service.startSkDataFullTree();
      let latestMeta: IPathMetaData[] = [];
      service.startSkMetaFullTree().subscribe(meta => (latestMeta = meta));

      seedSog(vesselA, 2.2);
      metadataUpdates$.next({
        context: vesselA,
        path: 'navigation.speedOverGround',
        meta: { description: 'SOG', units: 'm/s', properties: {} },
      });

      expect(service.getCachedPaths()).toContain(`${vesselA}.navigation.speedOverGround`);
      expect(latestMeta.some(m => m.path === `${vesselA}.navigation.speedOverGround`)).toBe(true);

      service.removePathsForContext(vesselA);

      expect(service.getCachedPaths()).not.toContain(`${vesselA}.navigation.speedOverGround`);
      expect(latestMeta.some(m => m.path === `${vesselA}.navigation.speedOverGround`)).toBe(false);
    });

    it('prunes _skData even while the full tree is inactive, reflected after a later rebuild', () => {
      seedSog(vesselA, 2.2);
      service.removePathsForContext(vesselA);

      // Open the tree only now; the rebuild reads the already-pruned _skData.
      service.startSkDataFullTree();
      expect(service.getCachedPaths()).not.toContain(`${vesselA}.navigation.speedOverGround`);
    });

    it('is a no-op for the self context', () => {
      seedSog('self', 1.1);
      service.removePathsForContext('self');
      expect(service.getPathObject('self.navigation.speedOverGround')).not.toBeNull();
      expect(service.getCachedPaths()).toContain('self.navigation.speedOverGround');
    });

    it('does not re-emit the meta full tree when no path matches the removed context', () => {
      let metaEmits = 0;
      service.startSkMetaFullTree().subscribe(() => metaEmits++);
      seedSog(vesselA, 2.2);
      metadataUpdates$.next({
        context: vesselA,
        path: 'navigation.speedOverGround',
        meta: { description: 'SOG', units: 'm/s', properties: {} },
      });
      const before = metaEmits;

      service.removePathsForContext('vessels.urn:mrn:imo:mmsi:999999999');

      expect(metaEmits).toBe(before);
    });

    it('does not clobber a sibling context that is a string prefix of the removed one', () => {
      const shortCtx = 'vessels.urn:mrn:imo:mmsi:100';
      const longCtx = 'vessels.urn:mrn:imo:mmsi:1002';
      seedSog(shortCtx, 1.0);
      seedSog(longCtx, 2.0);

      service.removePathsForContext(shortCtx);

      expect(service.getPathObject(`${shortCtx}.navigation.speedOverGround`)).toBeNull();
      expect(service.getPathObject(`${longCtx}.navigation.speedOverGround`)).not.toBeNull();
    });

    it('prunes the per-path last-observed receipt for a removed foreign context, leaving self intact', () => {
      seedSog('self', 1.1);
      seedSog(vesselA, 2.2);

      const lastObserved = (service as unknown as { _lastObservedByPath: Map<string, number> })._lastObservedByPath;
      expect(lastObserved.has(`${vesselA}.navigation.speedOverGround`)).toBe(true);
      expect(lastObserved.has('self.navigation.speedOverGround')).toBe(true);

      service.removePathsForContext(vesselA);

      expect(lastObserved.has(`${vesselA}.navigation.speedOverGround`)).toBe(false);
      expect(lastObserved.has('self.navigation.speedOverGround')).toBe(true);
    });
  });

  describe('getPathMetaObservable (meta decoupled from registrations)', () => {
    const PATH = 'self.electrical.batteries.10.voltage';

    function pushMeta(context: string, path: string, meta: ISkMetadata): void {
      metadataUpdates$.next({ context, path, meta });
    }

    it('keeps the shared meta stream live when a sibling source registration is released', () => {
      // Two sources registered for the same path: releasing one must not complete the path's meta.
      service.subscribePath(PATH, 'default');
      service.subscribePath(PATH, 'gps-2');

      let latestMeta: ISkMetadata | null | undefined;
      let completed = false;
      service.getPathMetaObservable(PATH).subscribe({
        next: m => (latestMeta = m),
        complete: () => (completed = true),
      });

      service.unsubscribePath(PATH, 'default');

      pushMeta('self', 'electrical.batteries.10.voltage', { description: 'Voltage', units: 'V', properties: {} });

      expect(completed).toBe(false);
      expect(latestMeta?.units).toBe('V');
    });

    it('emits to a subscriber that observed meta before any path registration (no dead of(null))', () => {
      const PATH2 = 'self.environment.outside.temperature';
      const metas: (ISkMetadata | null)[] = [];
      // Subscribe BEFORE any subscribePath — the pre-decoupling code returned a dead of(null) here.
      service.getPathMetaObservable(PATH2).subscribe(m => metas.push(m));
      expect(metas).toEqual([null]); // seeded null from the BehaviorSubject

      pushMeta('self', 'environment.outside.temperature', { description: 'Temp', units: 'K', properties: {} });

      // The later delta reaches the same live subscriber, proving it is not a completed of(null).
      expect(metas.length).toBe(2);
      expect(metas[1]?.units).toBe('K');
    });

    it('prunes the decoupled meta subject for a removed foreign context, leaving self untouched', () => {
      const vessel = 'vessels.urn:mrn:imo:mmsi:100000001';
      const foreignPath = `${vessel}.navigation.speedOverGround`;
      const selfPath = 'self.navigation.speedOverGround';

      service.getPathMetaObservable(foreignPath).subscribe();
      service.getPathMetaObservable(selfPath).subscribe();

      const metaMap = (service as unknown as { _pathMetaByPath: Map<string, unknown> })._pathMetaByPath;
      expect(metaMap.has(foreignPath)).toBe(true);
      expect(metaMap.has(selfPath)).toBe(true);

      service.removePathsForContext(vessel);
      expect(metaMap.has(foreignPath)).toBe(false);
      expect(metaMap.has(selfPath)).toBe(true);

      // The self context is a no-op, its meta subject survives.
      service.removePathsForContext('self');
      expect(metaMap.has(selfPath)).toBe(true);
    });
  });

  it('applies notification state to path value updates', () => {
    let latest: IPathUpdate | undefined;

    service
      .subscribePath('self.electrical.batteries.10.capacity.stateOfCharge', 'default')
      .subscribe(update => (latest = update));

    dataPathUpdates$.next({
      context: 'self',
      path: 'electrical.batteries.10.capacity.stateOfCharge',
      source: 'test-source',
      timestamp: '2026-01-01T00:00:01.000Z',
      value: 0.47,
    });

    notificationUpdates$.next({
      path: 'notifications.electrical.batteries.10.capacity.stateOfCharge',
      value: {
        method: ['visual'],
        state: States.Warn,
        message: 'SOC warning',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    });

    expect(latest).toBeTruthy();
    expect(latest!.data.value).toBe(0.47);
    expect(latest!.state).toBe(States.Warn);
  });

  it('applies state when metadata is received before value and value arrives later', () => {
    notificationUpdates$.next({
      path: 'notifications.electrical.batteries.10.current',
      value: {
        method: ['visual'],
        state: States.Alert,
        message: 'Current alert',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    });

    metadataUpdates$.next({
      context: 'self',
      path: 'electrical.batteries.10.current',
      meta: {
        description: 'Battery current',
        units: 'A',
        properties: {},
      },
    });

    let latest: IPathUpdate | undefined;

    service
      .subscribePath('self.electrical.batteries.10.current', 'default')
      .subscribe(update => (latest = update));

    dataPathUpdates$.next({
      context: 'self',
      path: 'electrical.batteries.10.current',
      source: 'test-source',
      timestamp: '2026-01-01T00:00:01.000Z',
      value: 12.3,
    });

    expect(latest).toBeTruthy();
    expect(latest!.data.value).toBe(12.3);
    expect(latest!.state).toBe(States.Alert);
  });

  it('exposes the value timestamp lazily as a memoized Date', () => {
    let latest: IPathUpdate | undefined;

    service
      .subscribePath('self.navigation.speedThroughWater', 'default')
      .subscribe(update => (latest = update));

    dataPathUpdates$.next({
      context: 'self',
      path: 'navigation.speedThroughWater',
      source: 'test-source',
      timestamp: '2026-01-01T00:00:05.000Z',
      value: 3.2,
    });

    expect(latest).toBeTruthy();
    // The lazy getter returns the correct Date when a consumer reads it...
    const ts = latest!.data.timestamp;
    expect(ts).toBeInstanceOf(Date);
    expect(ts!.toISOString()).toBe('2026-01-01T00:00:05.000Z');
    // ...and is memoized: repeated reads return the same instance (no re-allocation).
    expect(latest!.data.timestamp).toBe(ts);
  });

  it('emits equivalent sequences for subscribePathTree and subscribePathTreeWithInitial', () => {
    dataPathUpdates$.next({
      context: 'self',
      path: 'electrical.batteries.10.voltage',
      source: 'test-source',
      timestamp: '2026-01-01T00:00:01.000Z',
      value: 12.5,
    });
    dataPathUpdates$.next({
      context: 'self',
      path: 'electrical.batteries.11.voltage',
      source: 'test-source',
      timestamp: '2026-01-01T00:00:02.000Z',
      value: 12.7,
    });
    dataPathUpdates$.next({
      context: 'self',
      path: 'electrical.solar.1.voltage',
      source: 'test-source',
      timestamp: '2026-01-01T00:00:03.000Z',
      value: 24.1,
    });

    const treeWithInitial = service.subscribePathTreeWithInitial('self.electrical.batteries.*');
    const treeInitial = treeWithInitial.initial;

    const fromTreeInitial: IPathUpdateWithPath[] = [];
    const fromTreeLive: IPathUpdateWithPath[] = [];
    let seen = 0;
    const subA = service.subscribePathTree('self.electrical.batteries.*').subscribe(update => {
      if (seen < treeInitial.length) {
        fromTreeInitial.push(update);
        seen++;
      } else {
        fromTreeLive.push(update);
      }
    });

    const fromInitialApiLive: IPathUpdateWithPath[] = [];
    const subB = treeWithInitial.live$.subscribe(update => {
      fromInitialApiLive.push(update);
    });

    expect(fromTreeInitial.length).toBe(treeInitial.length);
    expect(fromTreeInitial.map(item => item.path)).toEqual(treeInitial.map(item => item.path));
    expect(fromTreeInitial.map(item => item.update.data.value)).toEqual(treeInitial.map(item => item.update.data.value));

    dataPathUpdates$.next({
      context: 'self',
      path: 'electrical.batteries.12.voltage',
      source: 'test-source',
      timestamp: '2026-01-01T00:00:04.000Z',
      value: 12.9,
    });

    expect(fromTreeLive.length).toBe(1);
    expect(fromInitialApiLive.length).toBe(1);
    expect(fromTreeLive[0].path).toBe('self.electrical.batteries.12.voltage');
    expect(fromInitialApiLive[0].path).toBe('self.electrical.batteries.12.voltage');
    expect(fromTreeLive[0].update.data.value).toBe(12.9);
    expect(fromInitialApiLive[0].update.data.value).toBe(12.9);

    subA.unsubscribe();
    subB.unsubscribe();
  });

  it('emits equivalent sequences for source-specific reads', () => {
    dataPathUpdates$.next({
      context: 'self',
      path: 'electrical.batteries.10.voltage',
      source: 'test-source',
      timestamp: '2026-01-01T00:00:01.000Z',
      value: 12.5,
    });
    dataPathUpdates$.next({
      context: 'self',
      path: 'electrical.batteries.11.voltage',
      source: 'other-source',
      timestamp: '2026-01-01T00:00:02.000Z',
      value: 99.1,
    });

    const treeWithInitial = service.subscribePathTreeWithInitial('self.electrical.batteries.*', 'test-source');
    const treeInitial = treeWithInitial.initial;

    const fromTreeInitial: IPathUpdateWithPath[] = [];
    const fromTreeLive: IPathUpdateWithPath[] = [];
    let seen = 0;
    const subA = service.subscribePathTree('self.electrical.batteries.*', 'test-source').subscribe(update => {
      if (seen < treeInitial.length) {
        fromTreeInitial.push(update);
        seen++;
      } else {
        fromTreeLive.push(update);
      }
    });

    const fromInitialApiLive: IPathUpdateWithPath[] = [];
    const subB = treeWithInitial.live$.subscribe(update => {
      fromInitialApiLive.push(update);
    });

    expect(fromTreeInitial.length).toBe(treeInitial.length);
    expect(fromTreeInitial.map(item => item.path)).toEqual(treeInitial.map(item => item.path));
    expect(fromTreeInitial.map(item => item.update.data.value)).toEqual(treeInitial.map(item => item.update.data.value));

    dataPathUpdates$.next({
      context: 'self',
      path: 'electrical.batteries.10.voltage',
      source: 'other-source',
      timestamp: '2026-01-01T00:00:03.000Z',
      value: 77.7,
    });
    dataPathUpdates$.next({
      context: 'self',
      path: 'electrical.batteries.12.voltage',
      source: 'test-source',
      timestamp: '2026-01-01T00:00:04.000Z',
      value: 12.9,
    });

    expect(fromTreeLive.length).toBe(2);
    expect(fromInitialApiLive.length).toBe(2);
    expect(fromTreeLive.map(item => item.path)).toEqual(fromInitialApiLive.map(item => item.path));
    expect(fromTreeLive.map(item => item.update.data.value)).toEqual(fromInitialApiLive.map(item => item.update.data.value));

    subA.unsubscribe();
    subB.unsubscribe();
  });

  it('resets value, timestamp and state on timeout for a recognised pathType', () => {
    let latest: IPathUpdate | undefined;
    service
      .subscribePath('self.environment.wind.speedApparent', 'default')
      .subscribe(update => (latest = update));

    dataPathUpdates$.next({
      context: 'self',
      path: 'environment.wind.speedApparent',
      source: 'test-source',
      timestamp: '2026-01-01T00:00:01.000Z',
      value: 5.5,
    });
    expect(latest!.data.value).toBe(5.5);

    service.timeoutPathObservable('self.environment.wind.speedApparent', 'default', 'number', 5000);

    expect(latest!.data.value).toBeNull();
    expect(latest!.data.timestamp).toBeNull();
    expect(latest!.state).toBe(States.Normal);
  });

  it('keeps a timed-out value cleared when a later notification changes its state (no resurface)', () => {
    let latest: IPathUpdate | undefined;
    service
      .subscribePath('self.environment.wind.speedApparent', 'default')
      .subscribe(update => (latest = update));

    dataPathUpdates$.next({
      context: 'self',
      path: 'environment.wind.speedApparent',
      source: 'test-source',
      timestamp: '2026-01-01T00:00:01.000Z',
      value: 5.5,
    });
    expect(latest!.data.value).toBe(5.5);

    service.timeoutPathObservable('self.environment.wind.speedApparent', 'default', 'number', 5000);
    expect(latest!.data.value).toBeNull();

    // A later notification re-pushes state onto every registration of the path. A shallow reset
    // leaves the upstream value subject caching 5.5, so combineLatest re-pairs it with the new state
    // and resurfaces the stale reading. The deep reset nulled that upstream value, so the reading
    // stays cleared and only the state advances.
    notificationUpdates$.next({
      path: 'notifications.environment.wind.speedApparent',
      value: {
        method: ['visual'],
        state: States.Warn,
        message: 'Apparent wind warning',
        timestamp: '2026-01-01T00:00:02.000Z',
      },
    });

    expect(latest!.data.value).toBeNull();
    expect(latest!.state).toBe(States.Warn);
  });

  it('leaves a persistent alarm state intact across a timeout then resume (does not clobber to Normal)', () => {
    const PATH = 'self.electrical.batteries.10.voltage';
    let latest: IPathUpdate | undefined;
    service.subscribePath(PATH, 'default').subscribe(update => (latest = update));

    dataPathUpdates$.next({
      context: 'self',
      path: 'electrical.batteries.10.voltage',
      source: 'test-source',
      timestamp: '2026-01-01T00:00:01.000Z',
      value: 12.0,
    });
    // The server raises an alarm on the low voltage.
    notificationUpdates$.next({
      path: 'notifications.electrical.batteries.10.voltage',
      value: {
        method: ['visual'],
        state: States.Alarm,
        message: 'Low voltage',
        timestamp: '2026-01-01T00:00:02.000Z',
      },
    });
    expect(latest!.data.value).toBe(12.0);
    expect(latest!.state).toBe(States.Alarm);

    // The data stream times out. The value blanks, but the alarm is still active on the server, so
    // the reset must not force the state back to Normal.
    service.timeoutPathObservable(PATH, 'default', 'number', 5000);
    expect(latest!.data.value).toBeNull();
    expect(latest!.state).toBe(States.Alarm);

    // Data resumes still-low: a value delta arrives, but the alarm never cleared so no new state
    // transition notification fires. The alarm coloring must survive rather than reverting to Normal.
    dataPathUpdates$.next({
      context: 'self',
      path: 'electrical.batteries.10.voltage',
      source: 'test-source',
      timestamp: '2026-01-01T00:00:03.000Z',
      value: 11.5,
    });
    expect(latest!.data.value).toBe(11.5);
    expect(latest!.state).toBe(States.Alarm);
  });

  it('resets only the timed-out source registration, leaving sibling sources live', () => {
    let latestDefault: IPathUpdate | undefined;
    let latestSourceA: IPathUpdate | undefined;
    let latestSourceB: IPathUpdate | undefined;
    service
      .subscribePath('self.electrical.batteries.10.voltage', 'default')
      .subscribe(update => (latestDefault = update));
    service
      .subscribePath('self.electrical.batteries.10.voltage', 'test-source-a')
      .subscribe(update => (latestSourceA = update));
    service
      .subscribePath('self.electrical.batteries.10.voltage', 'test-source-b')
      .subscribe(update => (latestSourceB = update));

    dataPathUpdates$.next({
      context: 'self',
      path: 'electrical.batteries.10.voltage',
      source: 'test-source-a',
      timestamp: '2026-01-01T00:00:01.000Z',
      value: 12.5,
    });
    dataPathUpdates$.next({
      context: 'self',
      path: 'electrical.batteries.10.voltage',
      source: 'test-source-b',
      timestamp: '2026-01-01T00:00:02.000Z',
      value: 13.0,
    });
    expect(latestSourceA!.data.value).toBe(12.5);
    expect(latestSourceB!.data.value).toBe(13.0);
    expect(latestDefault!.data.value).toBe(13.0);

    // Only test-source-a's stream timed out; its live siblings (test-source-b and
    // the default bucket, still fed by test-source-b) must be left untouched. The path was fed
    // moments ago (real clock), so the liveness gate treats it as live and skips the cross-clear.
    service.timeoutPathObservable('self.electrical.batteries.10.voltage', 'test-source-a', 'number', 5000);

    expect(latestSourceA!.data.value).toBeNull();
    expect(latestSourceA!.state).toBe(States.Normal);
    expect(latestSourceB!.data.value).toBe(13.0);
    expect(latestDefault!.data.value).toBe(13.0);
  });

  it('does not emit on timeout for an unrecognised pathType', () => {
    const updates: IPathUpdate[] = [];
    service
      .subscribePath('self.navigation.position', 'default')
      .subscribe(update => updates.push(update));

    const countBefore = updates.length;
    service.timeoutPathObservable('self.navigation.position', 'default', 'boolean', 5000);

    expect(updates.length).toBe(countBefore);
    expect(updates.every(update => update !== undefined)).toBe(true);
  });

  it('resets an object-typed path (navigation.position) to null on timeout', () => {
    let latest: IPathUpdate | undefined;
    service
      .subscribePath('self.navigation.position', 'default')
      .subscribe(update => (latest = update));

    dataPathUpdates$.next({
      context: 'self',
      path: 'navigation.position',
      source: 'test-source',
      timestamp: '2026-01-01T00:00:01.000Z',
      value: { latitude: 59.5, longitude: 22.5 },
    });
    expect(latest!.data.value).toEqual({ latitude: 59.5, longitude: 22.5 });

    // The position widget's path is object-typed; a user-enabled data timeout must still blank it.
    service.timeoutPathObservable('self.navigation.position', 'default', 'object', 5000);

    expect(latest!.data.value).toBeNull();
  });

  describe('timeout liveness-gated cross-clear (#254)', () => {
    const VOLTAGE = 'self.electrical.batteries.10.voltage';
    const TTL_MS = 5000;

    function feed(source: string, value: number | boolean): void {
      dataPathUpdates$.next({
        context: 'self',
        path: 'electrical.batteries.10.voltage',
        source,
        timestamp: '2026-01-01T00:00:01.000Z',
        value,
      });
    }

    it('skips the sibling cross-clear while a source fed the path within the TTL window (preserves #252)', () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);

      let latestDefault: IPathUpdate | undefined;
      let latestA: IPathUpdate | undefined;
      let latestB: IPathUpdate | undefined;
      service.subscribePath(VOLTAGE, 'default').subscribe(u => (latestDefault = u));
      service.subscribePath(VOLTAGE, 'source-a').subscribe(u => (latestA = u));
      service.subscribePath(VOLTAGE, 'source-b').subscribe(u => (latestB = u));

      feed('source-a', 12.5);
      feed('source-b', 13.0);
      expect(latestA!.data.value).toBe(12.5);
      expect(latestB!.data.value).toBe(13.0);
      expect(latestDefault!.data.value).toBe(13.0);

      // source-b fed the path 4.999 s ago — still inside the 5 s window, so the path is "live".
      vi.setSystemTime(TTL_MS - 1);
      service.timeoutPathObservable(VOLTAGE, 'source-a', 'number', TTL_MS);

      // Only the timed-out source is reset; the live sibling and the default bucket are untouched.
      expect(latestA!.data.value).toBeNull();
      expect(latestB!.data.value).toBe(13.0);
      expect(latestDefault!.data.value).toBe(13.0);
    });

    it('cross-clears sibling sources and the default bucket once the path has gone all-silent', () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);

      let latestDefault: IPathUpdate | undefined;
      let latestA: IPathUpdate | undefined;
      let latestB: IPathUpdate | undefined;
      service.subscribePath(VOLTAGE, 'default').subscribe(u => (latestDefault = u));
      service.subscribePath(VOLTAGE, 'source-a').subscribe(u => (latestA = u));
      service.subscribePath(VOLTAGE, 'source-b').subscribe(u => (latestB = u));

      feed('source-a', 12.5);
      feed('source-b', 13.0);

      // Nothing has fed the path for the full TTL window: every source is silent.
      vi.setSystemTime(TTL_MS);
      service.timeoutPathObservable(VOLTAGE, 'source-a', 'number', TTL_MS);

      expect(latestA!.data.value).toBeNull();
      expect(latestB!.data.value).toBeNull();
      expect(latestDefault!.data.value).toBeNull();
    });

    it('cross-clears an enableTimeout:false sibling (which never times out itself) when the path is all-silent', () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);

      // A widget-boolean-switch / autopilot ships enableTimeout:false and reads the shared default
      // bucket, so it never calls timeoutPathObservable. A sensor widget on a specific source of the
      // same path does have a TTL. When that source times out all-silent, the frozen switch reading
      // (a plausible-but-stale hazard) must still be cleared.
      let latestSwitch: IPathUpdate | undefined;
      let latestSensor: IPathUpdate | undefined;
      service.subscribePath(VOLTAGE, 'default').subscribe(u => (latestSwitch = u));
      service.subscribePath(VOLTAGE, 'sensor-a').subscribe(u => (latestSensor = u));

      feed('sensor-a', true);
      expect(latestSwitch!.data.value).toBe(true);
      expect(latestSensor!.data.value).toBe(true);

      vi.setSystemTime(TTL_MS);
      // The sensor's whitelisted pathType ('number') admits the call; the target switch registration
      // is reached and reset regardless of its own (boolean) value type.
      service.timeoutPathObservable(VOLTAGE, 'sensor-a', 'number', TTL_MS);

      expect(latestSensor!.data.value).toBeNull();
      expect(latestSwitch!.data.value).toBeNull();
    });

    it('keeps a cross-cleared sibling cleared when a later notification changes the path state', () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);

      let latestDefault: IPathUpdate | undefined;
      service.subscribePath(VOLTAGE, 'default').subscribe(u => (latestDefault = u));
      service.subscribePath(VOLTAGE, 'source-a').subscribe();

      feed('source-a', 13.0);
      expect(latestDefault!.data.value).toBe(13.0);

      vi.setSystemTime(TTL_MS);
      service.timeoutPathObservable(VOLTAGE, 'source-a', 'number', TTL_MS);
      expect(latestDefault!.data.value).toBeNull();

      // The deep upstream reset must survive a later notification state change on the path: the
      // state advances but the cross-cleared value must not resurface.
      notificationUpdates$.next({
        path: 'notifications.electrical.batteries.10.voltage',
        value: {
          method: ['visual'],
          state: States.Alarm,
          message: 'Low voltage',
          timestamp: '2026-01-01T00:00:03.000Z',
        },
      });

      expect(latestDefault!.data.value).toBeNull();
      expect(latestDefault!.state).toBe(States.Alarm);
    });

    it('treats a path with no recency receipt as all-silent (undefined disjunct of the liveness gate)', () => {
      let latestDefault: IPathUpdate | undefined;
      let latestA: IPathUpdate | undefined;
      service.subscribePath(VOLTAGE, 'default').subscribe(u => (latestDefault = u));
      service.subscribePath(VOLTAGE, 'source-a').subscribe(u => (latestA = u));

      feed('source-a', 13.0);
      expect(latestDefault!.data.value).toBe(13.0);

      // Simulate a path that holds a value but has no recency receipt (never fed this session, or the
      // receipt was pruned): the gate must fall to its `lastObserved === undefined` disjunct and treat
      // the path as silent so the cross-clear still fires.
      const lastObserved = (service as unknown as { _lastObservedByPath: Map<string, number> })._lastObservedByPath;
      lastObserved.delete(VOLTAGE);

      service.timeoutPathObservable(VOLTAGE, 'source-a', 'number', 5000);

      expect(latestA!.data.value).toBeNull();
      expect(latestDefault!.data.value).toBeNull();
    });
  });

  it('derives path type from meta units when meta precedes the value', () => {
    metadataUpdates$.next({
      context: 'self',
      path: 'electrical.batteries.10.current',
      meta: { description: 'Battery current', units: 'A', properties: {} },
    });
    metadataUpdates$.next({
      context: 'self',
      path: 'navigation.datetime',
      meta: { description: 'Time', units: 'RFC 3339 (UTC)', properties: {} },
    });
    metadataUpdates$.next({
      context: 'self',
      path: 'design.aisShipType',
      meta: { description: 'Ship type', units: undefined, properties: {} },
    });

    expect(service.getPathObject('self.electrical.batteries.10.current')!.type).toBe('number');
    expect(service.getPathObject('self.navigation.datetime')!.type).toBe('Date');
    expect(service.getPathObject('self.design.aisShipType')!.type).toBeUndefined();
  });

  it('leaves path type undefined when the first received value is null', () => {
    dataPathUpdates$.next({
      context: 'self',
      path: 'navigation.anchor.position',
      source: 'test-source',
      timestamp: '2026-01-01T00:00:01.000Z',
      value: null,
    });

    expect(service.getPathObject('self.navigation.anchor.position')!.type).toBeUndefined();
  });

  it('files a context-less delta value under self (empty context assumes self)', () => {
    const values: unknown[] = [];
    service
      .subscribePath('self.navigation.speedOverGround', 'default')
      .subscribe(update => values.push(update.data.value));

    // A delta with no context must land on the self root, not an "undefined.<path>" key (#209).
    dataPathUpdates$.next({
      context: undefined,
      path: 'navigation.speedOverGround',
      source: 'default',
      timestamp: '2026-01-01T00:00:01.000Z',
      value: 3.2,
    });

    expect(values.at(-1)).toBe(3.2);
  });

  it('keeps a foreign-context value under its own root, not self', () => {
    const selfValues: unknown[] = [];
    const foreignValues: unknown[] = [];
    service.subscribePath('self.navigation.speedOverGround', 'default').subscribe(u => selfValues.push(u.data.value));
    service.subscribePath('vessels.abc.navigation.speedOverGround', 'default').subscribe(u => foreignValues.push(u.data.value));

    dataPathUpdates$.next({
      context: 'vessels.abc',
      path: 'navigation.speedOverGround',
      source: 'default',
      timestamp: '2026-01-01T00:00:01.000Z',
      value: 7,
    });

    expect(foreignValues.at(-1)).toBe(7);
    // Self stays at its initial null emission; the foreign value never leaks onto it.
    expect(selfValues).not.toContain(7);
  });
});

/** Backfill of path metadata the stream did not deliver. See `DataService.backfillMetaOverRest`. */
describe('DataService REST meta backfill', () => {
  let service: DataService;
  let http: HttpTestingController;
  let dataPathUpdates$: Subject<IPathValueData>;
  let metadataUpdates$: Subject<IMeta>;
  let selfUpdates$: Subject<string>;
  let endpoint$: BehaviorSubject<{ httpServiceUrl: string | null }>;
  const API = 'http://boat.example/signalk/v1/api/';

  const value = (path: string, v: number): IPathValueData =>
    ({ context: undefined, path, source: 'default', timestamp: '2026-01-01T00:00:01.000Z', value: v });

  const boot = (httpServiceUrl: string | null = API): void => {
    dataPathUpdates$ = new Subject<IPathValueData>();
    metadataUpdates$ = new Subject<IMeta>();
    selfUpdates$ = new Subject<string>();
    endpoint$ = new BehaviorSubject<{ httpServiceUrl: string | null }>({ httpServiceUrl });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        DataService,
        {
          provide: SignalKDeltaService,
          useValue: {
            subscribeDataPathsUpdates: () => dataPathUpdates$.asObservable(),
            subscribeMetadataUpdates: () => metadataUpdates$.asObservable(),
            subscribeNotificationsUpdates: () => new Subject<ISignalKDataValueUpdate>().asObservable(),
            subscribeSelfUpdates: () => selfUpdates$.asObservable(),
          },
        },
        {
          provide: SignalKConnectionService,
          useValue: { serverServiceEndpoint$: endpoint$, serverVersion$: new BehaviorSubject('2.27.0') },
        },
      ],
    });

    service = TestBed.inject(DataService);
    http = TestBed.inject(HttpTestingController);
  };

  beforeEach(() => boot());
  afterEach(() => http.verify());

  const BEARING = 'self.navigation.course.calcValues.bearingTrue';
  const BEARING_URL = `${API}vessels/self/navigation/course/calcValues/bearingTrue/meta`;

  // On a real connection every delta names its context as the vessel's self URN; `context: undefined`
  // is a test convenience. Without a case that pushes one, the guard could reject every delta that
  // states a context and the suite would still pass while the fetch never fired in production.
  it('fetches for a delta whose context is the vessel\'s own self URN', () => {
    const urn = 'vessels.urn:mrn:signalk:uuid:abc';
    selfUpdates$.next(urn);
    service.subscribePath(BEARING, 'default').subscribe();

    dataPathUpdates$.next({ ...value('navigation.course.calcValues.bearingTrue', 1.396), context: urn });

    http.expectOne(BEARING_URL).flush({ units: 'rad' });
    expect(service.getPathMeta(BEARING)?.units).toBe('rad');
  });

  // The budget has to measure answers, not deltas. A path updating faster than the server replies
  // would otherwise spend all three attempts concurrently, on the same unanswered question.
  it('keeps one request per path outstanding however fast the deltas arrive', () => {
    service.subscribePath(BEARING, 'default').subscribe();

    dataPathUpdates$.next(value('navigation.course.calcValues.bearingTrue', 1.1));
    dataPathUpdates$.next(value('navigation.course.calcValues.bearingTrue', 1.2));
    dataPathUpdates$.next(value('navigation.course.calcValues.bearingTrue', 1.3));

    const pending = http.match(BEARING_URL);
    expect(pending).toHaveLength(1);
    pending[0].flush({ units: 'rad' });
  });

  // A 200 is not proof of metadata. Anything accepted here is cached, and a non-empty cache stops
  // the path ever asking again — so a gateway's JSON error envelope would be permanent.
  it('rejects a 200 whose body carries no metadata key', () => {
    service.subscribePath(BEARING, 'default').subscribe();
    dataPathUpdates$.next(value('navigation.course.calcValues.bearingTrue', 1.396));

    http.expectOne(BEARING_URL).flush({ status: 'KO', message: 'Authentication required' });

    expect(service.getPathMeta(BEARING)).toBeFalsy();
  });

  // The cache key for a foreign context named `self.<something>` is indistinguishable from a self
  // path's, so self-ness is recorded from the delta. Registration must consult that record, not the
  // key's shape, or the guard the delta side enforces is bypassed one call site over.
  it('does not fetch at registration for a foreign context whose cache key looks like self', () => {
    const forged = 'self.evil.navigation.speedOverGround';
    dataPathUpdates$.next({ ...value('navigation.speedOverGround', 7), context: 'self.evil' });

    service.subscribePath(forged, 'default').subscribe();

    http.expectNone(`${API}vessels/self/evil/navigation/speedOverGround/meta`);
  });

  it('fetches a subscribed path\'s meta when a value arrives without it, and applies what comes back', () => {
    const metas: (ISkMetadata | null)[] = [];
    service.subscribePath(BEARING, 'default').subscribe();
    service.getPathMetaObservable(BEARING).subscribe(m => metas.push(m));

    dataPathUpdates$.next(value('navigation.course.calcValues.bearingTrue', 1.396));

    const req = http.expectOne(BEARING_URL);
    expect(req.request.method).toBe('GET');
    req.flush({ units: 'rad', displayUnits: { targetUnit: 'degree' } });

    // displayUnits is the half that turns radians into degrees; units alone only picks the group.
    expect(metas.at(-1)?.units).toBe('rad');
    expect(metas.at(-1)?.displayUnits?.targetUnit).toBe('degree');
    expect(service.getPathDisplayUnits(BEARING)?.targetUnit).toBe('degree');
  });

  it('does not fetch when the stream already delivered the path\'s meta', () => {
    service.subscribePath('self.navigation.speedOverGround', 'default').subscribe();
    metadataUpdates$.next({ context: undefined, path: 'navigation.speedOverGround', meta: { units: 'm/s' } as ISkMetadata });

    dataPathUpdates$.next(value('navigation.speedOverGround', 3.2));

    http.expectNone(`${API}vessels/self/navigation/speedOverGround/meta`);
  });

  it('does not fetch for a path nothing is displaying', () => {
    // A self-subscribed stream carries every path on the vessel; only what a widget is bound to is
    // worth a request.
    dataPathUpdates$.next(value('navigation.speedOverGround', 3.2));

    http.expectNone(`${API}vessels/self/navigation/speedOverGround/meta`);
  });

  // A 404 means "not yet" as often as "never": the path's metadata is registered on the server when
  // the path materialises, and the first value can beat it. Spending the attempt on that answer
  // would reproduce the very defect this fixes.
  it('retries on a later value when the server answers 404, up to a ceiling', () => {
    service.subscribePath('self.some.undocumented.path', 'default').subscribe();
    const url = `${API}vessels/self/some/undocumented/path/meta`;

    for (let i = 1; i <= 3; i++) {
      dataPathUpdates$.next(value('some.undocumented.path', i));
      http.expectOne(url).flush('not found', { status: 404, statusText: 'Not Found' });
    }

    // The ceiling holds: further values cost nothing.
    dataPathUpdates$.next(value('some.undocumented.path', 4));
    dataPathUpdates$.next(value('some.undocumented.path', 5));
    http.expectNone(url);
  });

  it('stops asking once a retry succeeds', () => {
    service.subscribePath(BEARING, 'default').subscribe();

    dataPathUpdates$.next(value('navigation.course.calcValues.bearingTrue', 1.1));
    http.expectOne(BEARING_URL).flush('not found', { status: 404, statusText: 'Not Found' });

    dataPathUpdates$.next(value('navigation.course.calcValues.bearingTrue', 1.2));
    http.expectOne(BEARING_URL).flush({ units: 'rad' });

    dataPathUpdates$.next(value('navigation.course.calcValues.bearingTrue', 1.3));
    http.expectNone(BEARING_URL);
  });

  it('leaves a foreign-context path alone; the endpoint it would query is self', () => {
    service.subscribePath('vessels.abc.navigation.speedOverGround', 'default').subscribe();

    dataPathUpdates$.next({ context: 'vessels.abc', path: 'navigation.speedOverGround', source: 'default', timestamp: '2026-01-01T00:00:01.000Z', value: 7 });
    // afterEach's verify() fails on any request at all.
  });

  // A context is a delta field, not a property of the cache key. Deriving self-ness from the key's
  // `self.` prefix would let a delta claiming `context: 'self.evil'` steer a vessels/self query.
  it('leaves a foreign context alone even when it makes the cache key look like self', () => {
    service.subscribePath('self.evil.navigation.speedOverGround', 'default').subscribe();

    dataPathUpdates$.next({ context: 'self.evil', path: 'navigation.speedOverGround', source: 'default', timestamp: '2026-01-01T00:00:01.000Z', value: 7 });
  });

  it('percent-encodes each path segment so a request cannot leave vessels/self', () => {
    const hostile = 'displays.%2e%2e/%2e%2e/skServer/loginStatus#';
    service.subscribePath(`self.${hostile}`, 'default').subscribe();

    dataPathUpdates$.next(value(hostile, 1));

    const req = http.expectOne(r => r.url.startsWith(`${API}vessels/self/`));
    expect(req.request.url).toBe(`${API}vessels/self/displays/%252e%252e%2F%252e%252e%2FskServer%2FloginStatus%23/meta`);
    req.flush('not found', { status: 404, statusText: 'Not Found' });
  });

  it('does not fetch before the endpoint is known, and does not spend the attempt waiting', () => {
    boot(null);
    service.subscribePath(BEARING, 'default').subscribe();

    dataPathUpdates$.next(value('navigation.course.calcValues.bearingTrue', 1.396));
    http.expectNone(BEARING_URL);

    // Discovery completes; the next value fetches, proving no attempt was consumed while it waited.
    endpoint$.next({ httpServiceUrl: API });
    dataPathUpdates$.next(value('navigation.course.calcValues.bearingTrue', 1.4));
    http.expectOne(BEARING_URL).flush({ units: 'rad' });
  });

  it('tolerates an API root published without a trailing slash', () => {
    boot('http://boat.example/signalk/v1/api');
    service.subscribePath(BEARING, 'default').subscribe();

    dataPathUpdates$.next(value('navigation.course.calcValues.bearingTrue', 1.396));

    http.expectOne(BEARING_URL).flush({ units: 'rad' });
  });

  it('ignores a response body that carries no metadata, and keeps the path eligible', () => {
    service.subscribePath(BEARING, 'default').subscribe();

    for (const body of [null, {}, ['rad']]) {
      dataPathUpdates$.next(value('navigation.course.calcValues.bearingTrue', 1.396));
      http.expectOne(BEARING_URL).flush(body);
      expect(service.getPathMeta(BEARING)).toBeNull();
    }
  });

  // The delta-time trigger waits for a delta the path may never send again — a change-driven sensor,
  // or course calculations after the course goes idle. Placing the widget is the event that matters.
  it('fetches when a widget is placed on a path that already has a cached value', () => {
    dataPathUpdates$.next(value('navigation.course.calcValues.bearingTrue', 1.396));
    http.expectNone(BEARING_URL); // nothing displays it yet

    service.subscribePath(BEARING, 'default').subscribe();

    http.expectOne(BEARING_URL).flush({ units: 'rad' });
    expect(service.getPathMeta(BEARING)?.units).toBe('rad');
  });

  // The tree API and the electrical widgets take a path's meta without a value registration.
  it('fetches for a consumer that observes meta without subscribing to values', () => {
    service.getPathMetaObservable(BEARING).subscribe();

    dataPathUpdates$.next(value('navigation.course.calcValues.bearingTrue', 1.396));

    http.expectOne(BEARING_URL).flush({ units: 'rad' });
  });

  it('lets a meta delta that lands mid-flight stand, rather than merging the response over it', () => {
    const metas: (ISkMetadata | null)[] = [];
    service.subscribePath(BEARING, 'default').subscribe();
    service.getPathMetaObservable(BEARING).subscribe(m => metas.push(m));

    dataPathUpdates$.next(value('navigation.course.calcValues.bearingTrue', 1.396));
    const req = http.expectOne(BEARING_URL);

    metadataUpdates$.next({ context: undefined, path: 'navigation.course.calcValues.bearingTrue', meta: { units: 'rad', description: 'from the stream' } as ISkMetadata });
    req.flush({ units: 'rad', description: 'from REST' });

    expect(metas.at(-1)?.description).toBe('from the stream');
  });
});
