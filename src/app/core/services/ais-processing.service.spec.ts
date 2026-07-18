import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AisProcessingService,
  AisVessel,
  AisSar,
  AisAton,
  AisTrack
} from './ais-processing.service';
import { DataService, IPathUpdateWithPath } from './data.service';

/**
 * These tests lock in the `applyAisUpdate` path-dispatch behavior after it was
 * converted from a per-call `handlers` object literal to a `switch` statement.
 *
 * Events are driven through the real public entry point: the constructor
 * subscribes to `subscribePathTree(...)` streams, so pushing an
 * `IPathUpdateWithPath` through the mocked stream flows through
 * `handleAisTreeUpdate` -> `matchAisContext` -> `applyAisUpdate`. We then assert
 * the resulting track state the dispatch produced (see `trackByContext`).
 */
describe('AisProcessingService applyAisUpdate dispatch', () => {
  // Shared stream the constructor's merged AIS-tree subscriptions read from.
  let stream$: Subject<IPathUpdateWithPath>;
  let service: AisProcessingService;

  const VESSEL_CONTEXT = 'vessels.urn:mrn:imo:mmsi:123456789';
  const ATON_CONTEXT = 'atons.urn:mrn:imo:mmsi:987654321';
  const SAR_CONTEXT = 'sar.urn:mrn:imo:mmsi:111222333';

  function makeEvent(fullPath: string, value: unknown): IPathUpdateWithPath {
    return {
      path: fullPath,
      update: {
        data: { value, timestamp: new Date('2026-06-24T00:00:00Z') },
        state: 'normal'
      }
    } as IPathUpdateWithPath;
  }

  /**
   * Push a delta and flush the 250ms `targets` throttle so `targets()` updates.
   * The service is zoneless, so we drive RxJS's async scheduler with vitest's
   * fake timers (installed in beforeEach) instead of fakeAsync/tick.
   */
  function push(fullPath: string, value: unknown): void {
    stream$.next(makeEvent(fullPath, value));
    vi.advanceTimersByTime(300);
  }

  /**
   * Resolve the track the dispatch wrote to, straight from the service's
   * internal maps. We read internal state (not the public `targets()` signal)
   * because `flushTargetsSignal` filters out tracks that have neither an mmsi
   * nor a position - that filter is orthogonal to the dispatch under test, and
   * reading the raw track lets us assert string-only / status-only updates too.
   */
  function trackByContext(context: string): AisTrack | undefined {
    const internals = service as unknown as {
      contextIndex: Map<string, string>;
      tracks: Map<string, AisTrack>;
    };
    const id = internals.contextIndex.get(context);
    return id ? internals.tracks.get(id) : undefined;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    stream$ = new Subject<IPathUpdateWithPath>();

    const dataServiceMock: Partial<DataService> = {
      // Every prefix subscription shares the same stream; the merged pipeline
      // forwards anything we push. The self-nav stream also reads this but our
      // test paths only match AIS contexts, so they're routed correctly.
      subscribePathTree: () => stream$.asObservable(),
      // removeTrack prunes the DataService cache for the evicted context.
      removePathsForContext: vi.fn()
    };

    TestBed.configureTestingModule({
      providers: [
        AisProcessingService,
        { provide: DataService, useValue: dataServiceMock }
      ]
    });

    service = TestBed.inject(AisProcessingService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sets a vessel string field (name)', () => {
    push(`${VESSEL_CONTEXT}.name`, 'Test Vessel');

    const track = trackByContext(VESSEL_CONTEXT);
    expect(track).toBeDefined();
    expect(track!.type).toBe('vessel');
    expect(track!.name).toBe('Test Vessel');
  });

  it('sets a vessel numeric field gated by isVesselLike (speedOverGround)', () => {
    push(`${VESSEL_CONTEXT}.navigation.speedOverGround`, 5.5);

    const track = trackByContext(VESSEL_CONTEXT) as AisVessel;
    expect(track).toBeDefined();
    expect(track.speedOverGround).toBe(5.5);
  });

  it('sets a nested design field (design.length.overall)', () => {
    push(`${VESSEL_CONTEXT}.design.length.overall`, 42);

    const track = trackByContext(VESSEL_CONTEXT) as AisVessel;
    expect(track).toBeDefined();
    expect(track.design?.length?.overall).toBe(42);
  });

  it('merges nested design fields without clobbering siblings', () => {
    push(`${VESSEL_CONTEXT}.design.length.overall`, 42);
    push(`${VESSEL_CONTEXT}.design.beam`, 8);

    const track = trackByContext(VESSEL_CONTEXT) as AisVessel;
    expect(track.design?.length?.overall).toBe(42);
    expect(track.design?.beam).toBe(8);
  });

  it('applies a position update (latitude + longitude)', () => {
    push(`${VESSEL_CONTEXT}.navigation.position.latitude`, 48.5);
    push(`${VESSEL_CONTEXT}.navigation.position.longitude`, -123.25);

    const track = trackByContext(VESSEL_CONTEXT) as AisVessel;
    expect(track.position?.latitude).toBe(48.5);
    expect(track.position?.longitude).toBe(-123.25);
    expect(track.lastPositionAt).toBe(new Date('2026-06-24T00:00:00Z').getTime());
  });

  it('ignores a non-numeric latitude (early-out path -> break)', () => {
    push(`${VESSEL_CONTEXT}.navigation.position.latitude`, 'not-a-number');

    const track = trackByContext(VESSEL_CONTEXT) as AisVessel;
    // Track exists (created on resolve) but position was never set.
    expect(track).toBeDefined();
    expect(track.position).toBeUndefined();
  });

  it('applies a whole-object position value at the canonical navigation.position path', () => {
    push(`${VESSEL_CONTEXT}.navigation.position`, { latitude: 48.5, longitude: -123.25 });

    const track = trackByContext(VESSEL_CONTEXT) as AisVessel;
    expect(track.position?.latitude).toBe(48.5);
    expect(track.position?.longitude).toBe(-123.25);
    expect(track.lastPositionAt).toBe(new Date('2026-06-24T00:00:00Z').getTime());
  });

  it('applies a whole-object design.length value', () => {
    push(`${VESSEL_CONTEXT}.design.length`, { overall: 42, hull: 40, waterline: 38 });

    const track = trackByContext(VESSEL_CONTEXT) as AisVessel;
    expect(track.design?.length?.overall).toBe(42);
    expect(track.design?.length?.hull).toBe(40);
    expect(track.design?.length?.waterline).toBe(38);
  });

  it('applies a whole-object design.draft value', () => {
    push(`${VESSEL_CONTEXT}.design.draft`, { maximum: 2.5, minimum: 1.8, current: 2.1 });

    const track = trackByContext(VESSEL_CONTEXT) as AisVessel;
    expect(track.design?.draft?.maximum).toBe(2.5);
    expect(track.design?.draft?.minimum).toBe(1.8);
    expect(track.design?.draft?.current).toBe(2.1);
  });

  it('applies a whole-object design.aisShipType value', () => {
    push(`${VESSEL_CONTEXT}.design.aisShipType`, { id: 36, name: 'Sailing' });

    const track = trackByContext(VESSEL_CONTEXT) as AisVessel;
    expect(track.design?.aisShipType?.id).toBe(36);
    expect(track.design?.aisShipType?.name).toBe('Sailing');
  });

  it('applies a whole-object navigation.closestApproach value', () => {
    push(`${VESSEL_CONTEXT}.navigation.closestApproach`, { distance: 719.5, timeTo: -768.3 });

    const track = trackByContext(VESSEL_CONTEXT) as AisVessel;
    expect(track.closestApproach?.distance).toBe(719.5);
    expect(track.closestApproach?.timeTo).toBe(-768.3);
  });

  it('flags collision-risk data when a whole closestApproach carries collisionRiskRating', () => {
    push(`${VESSEL_CONTEXT}.mmsi`, '123456789');
    push(`${VESSEL_CONTEXT}.navigation.closestApproach`, { distance: 500, timeTo: 300, collisionRiskRating: 0.2 });

    const track = trackByContext(VESSEL_CONTEXT) as AisVessel;
    expect(track.closestApproach?.collisionRiskRating).toBe(0.2);
    expect(service.hasCollisionRiskData()).toBe(true);
  });

  it('merges a whole-object design compound without clobbering sibling design fields', () => {
    push(`${VESSEL_CONTEXT}.design.beam`, 8);
    push(`${VESSEL_CONTEXT}.design.length`, { overall: 42 });

    const track = trackByContext(VESSEL_CONTEXT) as AisVessel;
    expect(track.design?.beam).toBe(8);
    expect(track.design?.length?.overall).toBe(42);
  });

  it('does not set whole-object design compounds on a non-vessel (ATON guard holds)', () => {
    push(`${ATON_CONTEXT}.atonType.name`, 'Buoy 7');
    push(`${ATON_CONTEXT}.design.length`, { overall: 42 });

    const track = trackByContext(ATON_CONTEXT);
    expect((track as AisAton).typeName).toBe('Buoy 7');
    expect((track as unknown as AisVessel).design).toBeUndefined();
  });

  it('carries altitude on a whole-object position value', () => {
    push(`${VESSEL_CONTEXT}.navigation.position`, { latitude: 48.5, longitude: -123.25, altitude: 12 });

    const track = trackByContext(VESSEL_CONTEXT) as AisVessel;
    expect(track.position?.altitude).toBe(12);
  });

  it('applies whole-object design compounds to a SAR target (isVesselLike admits sar)', () => {
    push(`${SAR_CONTEXT}.design.length`, { overall: 30 });
    push(`${SAR_CONTEXT}.navigation.closestApproach`, { distance: 400, timeTo: 120 });

    const track = trackByContext(SAR_CONTEXT) as AisSar;
    expect(track.type).toBe('sar');
    expect(track.design?.length?.overall).toBe(30);
    expect(track.closestApproach?.distance).toBe(400);
  });

  it('replaces a design compound sub-object wholesale (a later partial clears omitted fields)', () => {
    push(`${VESSEL_CONTEXT}.design.length`, { overall: 42, hull: 40 });
    push(`${VESSEL_CONTEXT}.design.length`, { overall: 43 });

    const track = trackByContext(VESSEL_CONTEXT) as AisVessel;
    expect(track.design?.length?.overall).toBe(43);
    expect(track.design?.length?.hull).toBeUndefined();
  });

  it('applies a partial aisShipType (id only) and closestApproach range/bearing whole objects', () => {
    push(`${VESSEL_CONTEXT}.design.aisShipType`, { id: 37 });
    push(`${VESSEL_CONTEXT}.navigation.closestApproach`, { range: 800, bearing: 90 });

    const track = trackByContext(VESSEL_CONTEXT) as AisVessel;
    expect(track.design?.aisShipType?.id).toBe(37);
    expect(track.design?.aisShipType?.name).toBeUndefined();
    expect(track.closestApproach?.range).toBe(800);
    expect(track.closestApproach?.bearing).toBe(90);
  });

  it('applies design.draft.canoe from a whole-object value', () => {
    push(`${VESSEL_CONTEXT}.design.draft`, { canoe: 1.2 });

    const track = trackByContext(VESSEL_CONTEXT) as AisVessel;
    expect(track.design?.draft?.canoe).toBe(1.2);
  });

  it('does not flag collision-risk data for a whole closestApproach without collisionRiskRating', () => {
    push(`${VESSEL_CONTEXT}.mmsi`, '123456789');
    push(`${VESSEL_CONTEXT}.navigation.closestApproach`, { distance: 500, timeTo: 300 });

    const track = trackByContext(VESSEL_CONTEXT) as AisVessel;
    expect(Object.prototype.hasOwnProperty.call(track.closestApproach ?? {}, 'collisionRiskRating')).toBe(false);
    expect(service.hasCollisionRiskData()).toBe(false);
  });

  it('clears a stale collisionRiskRating when a later whole closestApproach omits it', () => {
    push(`${VESSEL_CONTEXT}.mmsi`, '123456789');
    push(`${VESSEL_CONTEXT}.navigation.closestApproach`, { distance: 500, timeTo: 300, collisionRiskRating: 0.2 });
    expect(service.hasCollisionRiskData()).toBe(true);

    push(`${VESSEL_CONTEXT}.navigation.closestApproach`, { distance: 3000, timeTo: 9000 });

    const track = trackByContext(VESSEL_CONTEXT) as AisVessel;
    expect(track.closestApproach?.collisionRiskRating).toBeUndefined();
    expect(service.hasCollisionRiskData()).toBe(false);
  });

  it('treats a null collisionRiskRating as absent, not zero-risk', () => {
    push(`${VESSEL_CONTEXT}.mmsi`, '123456789');
    push(`${VESSEL_CONTEXT}.navigation.closestApproach`, { distance: 500, timeTo: 300, collisionRiskRating: null });

    const track = trackByContext(VESSEL_CONTEXT) as AisVessel;
    expect(track.closestApproach?.collisionRiskRating).toBeUndefined();
    expect(service.hasCollisionRiskData()).toBe(false);
  });

  it('ignores a non-object whole-compound value (guard holds, no corruption)', () => {
    push(`${VESSEL_CONTEXT}.navigation.closestApproach`, { distance: 500 });
    push(`${VESSEL_CONTEXT}.design.length`, 42);
    push(`${VESSEL_CONTEXT}.navigation.closestApproach`, 'garbage');

    const track = trackByContext(VESSEL_CONTEXT) as AisVessel;
    expect(track.design?.length).toBeUndefined();
    // A non-object value must not replace the prior closestApproach.
    expect(track.closestApproach?.distance).toBe(500);
  });

  it('sets an ATON field gated by isAton (atonType.name)', () => {
    push(`${ATON_CONTEXT}.atonType.name`, 'Buoy 7');

    const track = trackByContext(ATON_CONTEXT) as AisAton;
    expect(track).toBeDefined();
    expect(track.type).toBe('aton');
    expect(track.typeName).toBe('Buoy 7');
  });

  it('does NOT set a vessel-only field on an ATON (guard holds)', () => {
    // speedOverGround is gated by isVesselLike; an ATON must not receive it.
    push(`${ATON_CONTEXT}.atonType.name`, 'Buoy 7');
    push(`${ATON_CONTEXT}.navigation.speedOverGround`, 9);

    const track = trackByContext(ATON_CONTEXT);
    expect((track as AisAton).typeName).toBe('Buoy 7');
    // Vessel-only field must remain absent on the ATON.
    expect((track as unknown as AisVessel).speedOverGround).toBeUndefined();
  });

  it('removes the track when sensors.ais.status = "remove"', () => {
    // First give the vessel a name + position so it shows up as a target.
    push(`${VESSEL_CONTEXT}.name`, 'Doomed Vessel');
    push(`${VESSEL_CONTEXT}.navigation.position.latitude`, 10);
    push(`${VESSEL_CONTEXT}.navigation.position.longitude`, 20);
    expect(trackByContext(VESSEL_CONTEXT)).toBeDefined();

    push(`${VESSEL_CONTEXT}.sensors.ais.status`, 'remove');

    expect(trackByContext(VESSEL_CONTEXT)).toBeUndefined();
  });

  it('sets a normal ais status without removing the track', () => {
    push(`${VESSEL_CONTEXT}.name`, 'Live Vessel');
    push(`${VESSEL_CONTEXT}.sensors.ais.status`, 'confirmed');

    const track = trackByContext(VESSEL_CONTEXT);
    expect(track).toBeDefined();
    expect(track!.ais.status).toBe('confirmed');
  });
});

/**
 * Eviction bounds unbounded target growth (the "unresponsive after a while"
 * freeze): many Signal K setups never send an explicit `status: 'remove'`, so
 * every distinct MMSI ever heard used to accumulate for the app lifetime,
 * making every flush + radar render O(targets) and heavier over uptime.
 */
describe('AisProcessingService target eviction (bounds unbounded growth)', () => {
  let stream$: Subject<IPathUpdateWithPath>;
  let service: AisProcessingService;
  const EVENT_TS = new Date('2026-06-24T00:00:00Z').getTime();

  function makeEvent(fullPath: string, value: unknown): IPathUpdateWithPath {
    return { path: fullPath, update: { data: { value, timestamp: new Date(EVENT_TS) }, state: 'normal' } } as IPathUpdateWithPath;
  }
  function push(fullPath: string, value: unknown): void {
    stream$.next(makeEvent(fullPath, value));
    vi.advanceTimersByTime(300);
  }
  function pushAt(fullPath: string, value: unknown, tsMs: number): void {
    stream$.next({ path: fullPath, update: { data: { value, timestamp: new Date(tsMs) }, state: 'normal' } } as IPathUpdateWithPath);
    vi.advanceTimersByTime(300);
  }
  let removePathsForContext: ReturnType<typeof vi.fn>;
  const internals = () => service as unknown as {
    tracks: Map<string, unknown>;
    contextIndex: Map<string, string>;
    mmsiIndex: Map<string, Set<string>>;
    maxTargets: number;
    evictStaleTracks: (nowMs: number) => void;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    stream$ = new Subject<IPathUpdateWithPath>();
    removePathsForContext = vi.fn();
    TestBed.configureTestingModule({
      providers: [AisProcessingService, { provide: DataService, useValue: { subscribePathTree: () => stream$.asObservable(), removePathsForContext } as Partial<DataService> }]
    });
    service = TestBed.inject(AisProcessingService);
  });
  afterEach(() => vi.useRealTimers());

  it('caps the retained track set at maxTargets, evicting the oldest, and prunes the indexes', () => {
    internals().maxTargets = 5;
    for (let i = 0; i < 12; i++) {
      push(`vessels.urn:mrn:imo:mmsi:${100000000 + i}.navigation.position.latitude`, 10 + i * 0.001);
    }
    expect(internals().tracks.size).toBe(5);
    // indexes must not leak entries for evicted tracks
    expect(internals().contextIndex.size).toBe(5);
  });

  it('evicts tracks not updated within the TTL when the sweep runs', () => {
    push(`vessels.urn:mrn:imo:mmsi:123456789.navigation.position.latitude`, 10);
    expect(internals().tracks.size).toBe(1);
    // 11 minutes after the last update (default TTL is 10 min) -> evicted
    internals().evictStaleTracks(EVENT_TS + 11 * 60 * 1000);
    expect(internals().tracks.size).toBe(0);
  });

  it('keeps tracks that were updated within the TTL', () => {
    push(`vessels.urn:mrn:imo:mmsi:123456789.navigation.position.latitude`, 10);
    internals().evictStaleTracks(EVENT_TS + 60 * 1000); // 1 min later, within TTL
    expect(internals().tracks.size).toBe(1);
  });

  it('runs TTL eviction through the periodic interval sweep', () => {
    // Anchor the fake clock to the event timestamp so the sweep's Date.now()
    // is deterministic relative to lastUpdateAt.
    vi.setSystemTime(EVENT_TS);
    push(`vessels.urn:mrn:imo:mmsi:123456789.mmsi`, '123456789');
    expect(internals().tracks.size).toBe(1);
    expect(internals().mmsiIndex.size).toBe(1);

    // Sweeps within the TTL must keep the track (also proves the clock anchor
    // took: an unanchored real-time clock would evict on the first sweep).
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(internals().tracks.size).toBe(1);

    // Past the 10 min TTL the interval-driven sweep evicts and prunes indexes.
    vi.advanceTimersByTime(6 * 60 * 1000);
    expect(internals().tracks.size).toBe(0);
    expect(internals().contextIndex.size).toBe(0);
    expect(internals().mmsiIndex.size).toBe(0);
  });

  it('evicts the least-recently-updated tracks first when over the cap', () => {
    internals().maxTargets = 3;
    const contexts = [0, 1, 2, 3, 4].map(i => `vessels.urn:mrn:imo:mmsi:${200000000 + i}`);
    contexts.forEach((context, i) => {
      pushAt(`${context}.navigation.position.latitude`, 10 + i, EVENT_TS + i * 1000);
    });

    expect(internals().tracks.size).toBe(3);
    expect(internals().contextIndex.has(contexts[0])).toBe(false);
    expect(internals().contextIndex.has(contexts[1])).toBe(false);
    expect(internals().contextIndex.has(contexts[2])).toBe(true);
    expect(internals().contextIndex.has(contexts[3])).toBe(true);
    expect(internals().contextIndex.has(contexts[4])).toBe(true);
  });

  /**
   * A track evicted at birth: the map is at the cap and the newcomer's first
   * timestamp is older than every retained track's lastUpdateAt (e.g. a
   * buffered/replayed delta), so enforceTargetCap removes the just-created
   * track inside createTrack. No index may keep referencing it afterwards.
   */
  function fillToCap(cap: number): void {
    internals().maxTargets = cap;
    for (let i = 0; i < cap; i++) {
      pushAt(`vessels.urn:mrn:imo:mmsi:${300000001 + i}.navigation.position.latitude`, 10 + i, EVENT_TS + (i + 1) * 1000);
    }
    expect(internals().tracks.size).toBe(cap);
  }

  it('leaves no dangling contextIndex entry for a track evicted at birth', () => {
    fillToCap(3);

    const stillborn = 'vessels.urn:mrn:imo:mmsi:300000099';
    pushAt(`${stillborn}.navigation.position.latitude`, 20, EVENT_TS);

    expect(internals().tracks.size).toBe(3);
    expect(internals().contextIndex.has(stillborn)).toBe(false);
    for (const [context, id] of internals().contextIndex.entries()) {
      expect(internals().tracks.has(id), `contextIndex entry for ${context} points at a missing track`).toBe(true);
    }
  });

  it('leaves no dangling mmsiIndex entry when the first update of a track evicted at birth is an mmsi', () => {
    fillToCap(3);

    const stillborn = 'vessels.urn:mrn:imo:mmsi:300000099';
    pushAt(`${stillborn}.mmsi`, '300000099', EVENT_TS);

    expect(internals().tracks.size).toBe(3);
    expect(internals().mmsiIndex.has('300000099')).toBe(false);
    for (const [mmsi, ids] of internals().mmsiIndex.entries()) {
      for (const id of ids) {
        expect(internals().tracks.has(id), `mmsiIndex entry for ${mmsi} points at a missing track`).toBe(true);
      }
    }
  });

  it('prunes the DataService cache for the context on an explicit status:"remove"', () => {
    const ctx = 'vessels.urn:mrn:imo:mmsi:400000001';
    push(`${ctx}.navigation.position.latitude`, 10);
    push(`${ctx}.sensors.ais.status`, 'remove');
    expect(removePathsForContext).toHaveBeenCalledWith(ctx);
  });

  it('prunes the DataService cache for the context evicted by the cap', () => {
    internals().maxTargets = 1;
    const oldCtx = 'vessels.urn:mrn:imo:mmsi:400000002';
    const newCtx = 'vessels.urn:mrn:imo:mmsi:400000003';
    pushAt(`${oldCtx}.navigation.position.latitude`, 10, EVENT_TS + 1000);
    pushAt(`${newCtx}.navigation.position.latitude`, 11, EVENT_TS + 2000);
    expect(removePathsForContext).toHaveBeenCalledWith(oldCtx);
  });

  it('prunes the DataService cache for the context evicted by the TTL sweep', () => {
    const ctx = 'vessels.urn:mrn:imo:mmsi:400000004';
    pushAt(`${ctx}.navigation.position.latitude`, 12, EVENT_TS);
    internals().evictStaleTracks(EVENT_TS + 11 * 60 * 1000);
    expect(removePathsForContext).toHaveBeenCalledWith(ctx);
  });
});

/**
 * Own-ship updates used to set the `ownShip` signal (a brand-new object) on every
 * self.navigation.* delta with no throttle/equality guard. The radar render effect
 * depends on ownShip(), so a moving/anchored vessel with a streaming compass drove
 * a full O(targets) re-render per fix. These tests pin the throttle + value guard.
 */
describe('AisProcessingService own-ship throttling', () => {
  let stream$: Subject<IPathUpdateWithPath>;
  let service: AisProcessingService;

  function push(fullPath: string, value: unknown): void {
    stream$.next({ path: fullPath, update: { data: { value, timestamp: new Date('2026-06-24T00:00:00Z') }, state: 'normal' } } as IPathUpdateWithPath);
    vi.advanceTimersByTime(300); // > 250ms throttle, so the throttled flush fires
  }

  beforeEach(() => {
    vi.useFakeTimers();
    stream$ = new Subject<IPathUpdateWithPath>();
    TestBed.configureTestingModule({
      providers: [AisProcessingService, { provide: DataService, useValue: { subscribePathTree: () => stream$.asObservable(), removePathsForContext: vi.fn() } as Partial<DataService> }]
    });
    service = TestBed.inject(AisProcessingService);
  });
  afterEach(() => vi.useRealTimers());

  it('does not emit a new ownShip object when the value is unchanged', () => {
    push('self.navigation.headingTrue', 1.5);
    const ref = service.ownShip();
    expect(ref.headingTrue).toBe(1.5);
    push('self.navigation.headingTrue', 1.5); // identical fix
    expect(service.ownShip()).toBe(ref);      // no redundant emission => stable reference
  });

  it('emits an updated ownShip when the value changes', () => {
    push('self.navigation.headingTrue', 1.5);
    push('self.navigation.headingTrue', 2.0);
    expect(service.ownShip().headingTrue).toBe(2.0);
  });
});
