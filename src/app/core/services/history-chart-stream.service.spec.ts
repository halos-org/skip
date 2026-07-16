import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, Subject, firstValueFrom } from 'rxjs';
import { HistoryChartStreamService, IHistoryChartStreamParams, isHistoryUnavailable } from './history-chart-stream.service';
import { HistoryApiClientService, HistoryRequestError } from './history-api-client.service';
import { HistoryToChartMapperService } from './history-to-chart-mapper.service';
import { DataService, IPathUpdate } from './data.service';
import { ConnectionState, ConnectionStateMachine } from './connection-state-machine.service';
import { IDatasetServiceDatapoint } from '../interfaces/dataset.interfaces';

const PARAMS: IHistoryChartStreamParams = {
  path: 'navigation.speedOverGround',
  source: 'default',
  windowMs: 60_000,
  sampleTime: 500,
  maxDataPoints: 3,
  smoothingPeriod: 2
};

describe('HistoryChartStreamService', () => {
  let path$: Subject<IPathUpdate>;
  let state$: BehaviorSubject<ConnectionState>;
  const history = { getValues: vi.fn() };
  const mapper = { mapValuesToChartDatapoints: vi.fn() };
  const releasePath = vi.fn();
  const data = { acquirePath: vi.fn(), getPathUnitType: vi.fn() };

  function make(): HistoryChartStreamService {
    TestBed.configureTestingModule({
      providers: [
        HistoryChartStreamService,
        { provide: HistoryApiClientService, useValue: history },
        { provide: HistoryToChartMapperService, useValue: mapper },
        { provide: DataService, useValue: data },
        { provide: ConnectionStateMachine, useValue: { state$ } }
      ]
    });
    return TestBed.inject(HistoryChartStreamService);
  }

  beforeEach(() => {
    path$ = new Subject<IPathUpdate>();
    // Charts mount while already connected; the reconnect re-backfill fires only on LATER Connected
    // transitions, so a stuck-Connected stream leaves the existing live-tail behavior unchanged.
    state$ = new BehaviorSubject<ConnectionState>(ConnectionState.Connected);
    history.getValues.mockReset();
    mapper.mapValuesToChartDatapoints.mockReset().mockReturnValue([]);
    releasePath.mockReset();
    // The service consumes acquirePath now; data$ is the same subject the tests push into.
    data.acquirePath.mockReset().mockReturnValue({ data$: path$, release: releasePath });
    data.getPathUnitType.mockReset().mockReturnValue(null); // scalar unless a test overrides
  });

  it('emits HISTORY_UNAVAILABLE when the History API returns null (no provider)', async () => {
    history.getValues.mockResolvedValue(null);
    const first = await firstValueFrom(make().getBackfillThenLive(PARAMS));
    expect(isHistoryUnavailable(first)).toBe(true);
  });

  it('emits the mapped backfill as a single batch array, one request', async () => {
    history.getValues.mockResolvedValue({ context: 'vessels.self', range: {}, values: [], data: [] });
    mapper.mapValuesToChartDatapoints.mockReturnValue([
      { timestamp: 1000, data: { value: 1, sma: 1, lastAverage: 1, lastMinimum: 1, lastMaximum: 1 } },
      { timestamp: 2000, data: { value: 3, sma: 2, lastAverage: 2, lastMinimum: 1, lastMaximum: 3 } }
    ]);
    const first = await firstValueFrom(make().getBackfillThenLive(PARAMS));
    expect(Array.isArray(first)).toBe(true);
    expect((first as IDatasetServiceDatapoint[]).map(p => p.data.value)).toEqual([1, 3]);
    expect(history.getValues).toHaveBeenCalledTimes(1);
    // Only the raw per-bucket `:last` sample is requested; the SMA overlay is derived client-side, so
    // no `:sma`/`:avg`/`:min`/`:max` aggregate columns are asked of the server (#162).
    const query = history.getValues.mock.calls[0][0];
    expect(query.paths).toContain(':last');
    expect(query.paths).not.toContain(':sma');
    expect(query.paths).not.toContain(':avg');
    expect(query.paths).not.toContain(':min');
    expect(query.paths).not.toContain(':max');
    expect(query.from).toBeTruthy();
  });

  it('derives the backfill SMA circularly for direction paths (no server :sma)', async () => {
    history.getValues.mockResolvedValue({ context: 'vessels.self', range: {}, values: [], data: [] });
    // Direction samples straddling the 0/360° wrap: ~355°, ~5°, ~3°.
    mapper.mapValuesToChartDatapoints.mockReturnValue([
      { timestamp: 1000, data: { value: 6.19591884457987 } },
      { timestamp: 2000, data: { value: 0.08726646259971647 } },
      { timestamp: 3000, data: { value: 0.05235987755982989 } }
    ]);
    const params: IHistoryChartStreamParams = { ...PARAMS, angleDomainOverride: 'direction', smoothingPeriod: 3 };
    const first = await firstValueFrom(make().getBackfillThenLive(params));
    const points = first as IDatasetServiceDatapoint[];
    // The 3-sample SMA is the CIRCULAR mean (~1°/0.0175 rad). The server-side arithmetic :sma over
    // the same radians would be ~2.11 rad — so this proves the smoothing line is angle-correct.
    expect(points[2].data.sma).toBeCloseTo(0.0174959160, 4);
    expect(points[2].data.sma).not.toBeCloseTo(2.11, 1);
  });

  it('derives a scalar backfill SMA as the arithmetic mean of the trailing window (clamps early)', async () => {
    history.getValues.mockResolvedValue({ context: 'vessels.self', range: {}, values: [], data: [] });
    mapper.mapValuesToChartDatapoints.mockReturnValue([
      { timestamp: 1000, data: { value: 2 } },
      { timestamp: 2000, data: { value: 4 } },
      { timestamp: 3000, data: { value: 6 } }
    ]);
    // Scalar domain (getPathUnitType → null), smoothingPeriod 2.
    const params: IHistoryChartStreamParams = { ...PARAMS, smoothingPeriod: 2 };
    const first = await firstValueFrom(make().getBackfillThenLive(params));
    const points = first as IDatasetServiceDatapoint[];
    expect(points[0].data.sma).toBe(2); // window clamps to [2]
    expect(points[1].data.sma).toBe(3); // trailing window [2, 4]
    expect(points[2].data.sma).toBe(5); // trailing window [4, 6]
  });

  it('drops null-valued backfill points', async () => {
    history.getValues.mockResolvedValue({ context: 'vessels.self', range: {}, values: [], data: [] });
    mapper.mapValuesToChartDatapoints.mockReturnValue([
      { timestamp: 1000, data: { value: null } },
      { timestamp: 2000, data: { value: 4 } }
    ]);
    const first = await firstValueFrom(make().getBackfillThenLive(PARAMS));
    expect((first as IDatasetServiceDatapoint[]).map(p => p.data.value)).toEqual([4]);
  });

  it('after backfill, a live delta becomes a datapoint carrying window stats', async () => {
    history.getValues.mockResolvedValue({ context: 'vessels.self', range: {}, values: [], data: [] });
    mapper.mapValuesToChartDatapoints.mockReturnValue([]); // empty backfill

    const emissions: (IDatasetServiceDatapoint | IDatasetServiceDatapoint[] | { unavailable: true })[] = [];
    make().getBackfillThenLive(PARAMS).subscribe(e => emissions.push(e));

    // Let the backfill promise settle so the live tail subscribes.
    await Promise.resolve();
    await Promise.resolve();
    expect(emissions[0]).toEqual([]); // empty batch first

    // First live value routes through take(1) — no timer needed. Fresh source timestamp (now).
    const before = Date.now();
    path$.next({ data: { value: 5, timestamp: new Date() }, state: 'normal' });

    expect(emissions.length).toBe(2);
    const point = emissions[1] as IDatasetServiceDatapoint;
    // #131: stamped with the client clock at emit time, not the value's raw source timestamp.
    expect(point.timestamp).toBeGreaterThanOrEqual(before);
    expect(point.data.value).toBe(5);
    expect(point.data.lastAverage).toBe(5);
    expect(point.data.lastMinimum).toBe(5);
    expect(point.data.lastMaximum).toBe(5);
  });

  it('seeds the live window from the backfill buffer (history feeds live stats)', async () => {
    history.getValues.mockResolvedValue({ context: 'vessels.self', range: {}, values: [], data: [] });
    mapper.mapValuesToChartDatapoints.mockReturnValue([
      { timestamp: 1000, data: { value: 10 } },
      { timestamp: 2000, data: { value: 20 } }
    ]);

    const emissions: (IDatasetServiceDatapoint | IDatasetServiceDatapoint[] | { unavailable: true })[] = [];
    make().getBackfillThenLive(PARAMS).subscribe(e => emissions.push(e));
    await Promise.resolve();
    await Promise.resolve();

    // The live value aggregates over the seeded buffer [10, 20], not a fresh empty one.
    path$.next({ data: { value: 30, timestamp: new Date() }, state: 'normal' });

    const point = emissions[1] as IDatasetServiceDatapoint;
    expect(point.data.value).toBe(30);
    expect(point.data.lastMinimum).toBe(10); // 10 is only present if the backfill seeded the window
    expect(point.data.lastMaximum).toBe(30);
    expect(point.data.lastAverage).toBeCloseTo(20); // (10 + 20 + 30) / 3
    expect(point.data.sma).toBeCloseTo(25); // mean of the last 2: (20 + 30) / 2
  });

  it('shifts backfill timestamps from server time into the client clock (#131 skew)', async () => {
    const serverNow = Date.now() + 90_000; // server clock runs 90s ahead of this client (no NTP)
    history.getValues.mockResolvedValue({
      context: 'vessels.self',
      range: { to: new Date(serverNow).toISOString() },
      values: [],
      data: []
    });
    mapper.mapValuesToChartDatapoints.mockReturnValue([
      { timestamp: serverNow - 2000, data: { value: 1 } },
      { timestamp: serverNow, data: { value: 2 } } // newest ~= server "now"
    ]);

    const emissions: (IDatasetServiceDatapoint | IDatasetServiceDatapoint[] | { unavailable: true })[] = [];
    const before = Date.now();
    make().getBackfillThenLive(PARAMS).subscribe(e => emissions.push(e));
    await Promise.resolve();
    await Promise.resolve();

    const batch = emissions[0] as IDatasetServiceDatapoint[];
    // Newest backfill point lands at ~client-now (inside the realtime window), not 90s in the future.
    expect(batch[1].timestamp).toBeGreaterThanOrEqual(before);
    expect(batch[1].timestamp).toBeLessThanOrEqual(Date.now() + 5);
    // Inter-point spacing is preserved by the constant offset.
    expect(batch[1].timestamp - batch[0].timestamp).toBe(2000);
  });

  it('holds a fresh value then breaks the trace with a gap once the source stops updating (#131)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    try {
      history.getValues.mockResolvedValue({
        context: 'vessels.self',
        range: { to: new Date(1_000_000).toISOString() },
        values: [],
        data: []
      });
      mapper.mapValuesToChartDatapoints.mockReturnValue([]);

      const emissions: (IDatasetServiceDatapoint | IDatasetServiceDatapoint[] | { unavailable: true })[] = [];
      make().getBackfillThenLive(PARAMS).subscribe(e => emissions.push(e));
      await vi.advanceTimersByTimeAsync(0); // settle the (empty) backfill

      // A fresh value (source timestamp = now) is drawn.
      path$.next({ data: { value: 5, timestamp: new Date(Date.now()) }, state: 'normal' });
      const first = emissions[emissions.length - 1] as IDatasetServiceDatapoint;
      expect(first.data.value).toBe(5);

      // One resample tick, value still fresh: holds the value and advances x in client time.
      await vi.advanceTimersByTimeAsync(PARAMS.sampleTime);
      const held = emissions[emissions.length - 1] as IDatasetServiceDatapoint;
      expect(held.data.value).toBe(5);
      expect(held.timestamp).toBeGreaterThan(first.timestamp);

      // Source silent past the bootstrap staleness window: the trace breaks once with a NaN gap.
      await vi.advanceTimersByTimeAsync(31_000);
      const gap = emissions.find(
        e => !Array.isArray(e) && !('unavailable' in e) && Number.isNaN((e as IDatasetServiceDatapoint).data.value)
      );
      expect(gap).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not gap a slow-but-alive source whose interval exceeds the chart cadence (#131)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    try {
      history.getValues.mockResolvedValue({
        context: 'vessels.self',
        range: { to: new Date(1_000_000).toISOString() },
        values: [],
        data: []
      });
      mapper.mapValuesToChartDatapoints.mockReturnValue([]);

      const emissions: (IDatasetServiceDatapoint | IDatasetServiceDatapoint[] | { unavailable: true })[] = [];
      make().getBackfillThenLive(PARAMS).subscribe(e => emissions.push(e));
      await vi.advanceTimersByTimeAsync(0);

      // Source updates every 5s — far slower than sampleTime (500ms). It must never false-gap.
      for (let i = 1; i <= 4; i++) {
        vi.setSystemTime(1_000_000 + i * 5_000);
        path$.next({ data: { value: i, timestamp: new Date(Date.now()) }, state: 'normal' });
        await vi.advanceTimersByTimeAsync(5_000);
      }

      const gaps = emissions.filter(
        e => !Array.isArray(e) && !('unavailable' in e) && Number.isNaN((e as IDatasetServiceDatapoint).data.value)
      );
      expect(gaps.length).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gaps a stale cached value replayed on subscribe instead of drawing it as fresh (#131)', async () => {
    history.getValues.mockResolvedValue({ context: 'vessels.self', range: {}, values: [], data: [] });
    mapper.mapValuesToChartDatapoints.mockReturnValue([]);

    const emissions: (IDatasetServiceDatapoint | IDatasetServiceDatapoint[] | { unavailable: true })[] = [];
    make().getBackfillThenLive(PARAMS).subscribe(e => emissions.push(e));
    await Promise.resolve();
    await Promise.resolve();

    // The first live value is an hour-old cached reading (a dead sensor's last value replayed).
    path$.next({ data: { value: 5, timestamp: new Date(Date.now() - 3_600_000) }, state: 'normal' });

    // It must not be drawn as a fresh point; a NaN gap marker is emitted instead.
    const last = emissions[emissions.length - 1] as IDatasetServiceDatapoint;
    expect(Number.isNaN(last.data.value)).toBe(true);
  });

  it('on a transient HistoryRequestError, does not disable the chart — rides the live tail with no backfill seed (#130)', async () => {
    history.getValues.mockRejectedValue(new HistoryRequestError(503));

    const emissions: (IDatasetServiceDatapoint | IDatasetServiceDatapoint[] | { unavailable: true })[] = [];
    make().getBackfillThenLive(PARAMS).subscribe(e => emissions.push(e));
    await new Promise(resolve => setTimeout(resolve)); // let the rejected backfill settle → live fallback

    // The transient failure must NOT surface HISTORY_UNAVAILABLE; the live tail is subscribed instead.
    expect(emissions.some(e => !Array.isArray(e) && 'unavailable' in e)).toBe(false);
    expect(data.acquirePath).toHaveBeenCalled();

    // A live delta still renders, so the chart keeps working through the blip.
    const before = Date.now();
    path$.next({ data: { value: 7, timestamp: new Date() }, state: 'normal' });
    const last = emissions[emissions.length - 1] as IDatasetServiceDatapoint;
    expect(last.data.value).toBe(7);
    expect(last.timestamp).toBeGreaterThanOrEqual(before);
  });

  it('transient fallback derives the clock offset from live samples so a skewed source is not false-gapped (#130)', async () => {
    // The fallback has no backfill to anchor the server→client offset. With a naive offset of 0 the
    // staleness check would read the server-behind-client skew as age and gap every healthy delta —
    // exactly the just-restarted-marine-server case that triggers the fallback. The offset must be
    // derived from the first live sample instead.
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    try {
      history.getValues.mockRejectedValue(new HistoryRequestError(503));

      const emissions: (IDatasetServiceDatapoint | IDatasetServiceDatapoint[] | { unavailable: true })[] = [];
      make().getBackfillThenLive(PARAMS).subscribe(e => emissions.push(e));
      await vi.advanceTimersByTimeAsync(0); // settle the rejected backfill → live fallback subscribes

      const SKEW_MS = 60_000; // server clock trails this client by 60s (no NTP)
      const SRC_INTERVAL_MS = 1_000;
      // First live value (drawn immediately via take(1)); source timestamp is 60s behind the client.
      path$.next({ data: { value: 10, timestamp: new Date(Date.now() - SKEW_MS) }, state: 'normal' });
      // A second value one source-interval later, then a resample tick to emit it.
      vi.setSystemTime(1_000_000 + SRC_INTERVAL_MS);
      path$.next({ data: { value: 11, timestamp: new Date(Date.now() - SKEW_MS) }, state: 'normal' });
      await vi.advanceTimersByTimeAsync(PARAMS.sampleTime);

      const points = emissions.filter(
        (e): e is IDatasetServiceDatapoint => !Array.isArray(e) && !('unavailable' in e)
      );
      // No gap markers despite the 60s skew, and the real values render.
      expect(points.some(p => Number.isNaN(p.data.value))).toBe(false);
      expect(points.map(p => p.data.value)).toContain(10);
      expect(points.map(p => p.data.value)).toContain(11);
    } finally {
      vi.useRealTimers();
    }
  });

  it('on an unexpected (non-transient) backfill error, emits HISTORY_UNAVAILABLE and starts no live tail', async () => {
    history.getValues.mockRejectedValue(new Error('boom'));
    const first = await firstValueFrom(make().getBackfillThenLive(PARAMS));
    expect(isHistoryUnavailable(first)).toBe(true);
    expect(data.acquirePath).not.toHaveBeenCalled();
  });

  it('unsubscribing tears down the live delta subscription', async () => {
    history.getValues.mockResolvedValue({ context: 'vessels.self', range: {}, values: [], data: [] });
    mapper.mapValuesToChartDatapoints.mockReturnValue([]);

    const emissions: unknown[] = [];
    const sub = make().getBackfillThenLive(PARAMS).subscribe(e => emissions.push(e));
    await Promise.resolve();
    await Promise.resolve();
    expect(emissions.length).toBe(1); // empty batch only

    sub.unsubscribe();
    path$.next({ data: { value: 9, timestamp: new Date(1000) }, state: 'normal' });
    expect(emissions.length).toBe(1); // no datapoint arrives after teardown
  });

  it('disposing before the backfill resolves suppresses the batch and the live tail', async () => {
    history.getValues.mockResolvedValue({ context: 'vessels.self', range: {}, values: [], data: [] });
    mapper.mapValuesToChartDatapoints.mockReturnValue([{ timestamp: 1000, data: { value: 1 } }]);

    const emissions: unknown[] = [];
    const sub = make().getBackfillThenLive(PARAMS).subscribe(e => emissions.push(e));
    sub.unsubscribe(); // before the backfill promise settles
    await Promise.resolve();
    await Promise.resolve();
    expect(emissions.length).toBe(0); // the disposed guard prevents the batch
    expect(data.acquirePath).not.toHaveBeenCalled();
  });

  it('releases the live path handle when the stream is torn down after backfill', async () => {
    history.getValues.mockResolvedValue({ context: 'vessels.self', range: {}, values: [], data: [] });
    mapper.mapValuesToChartDatapoints.mockReturnValue([]);
    const sub = make().getBackfillThenLive(PARAMS).subscribe();
    await Promise.resolve();
    await Promise.resolve();
    expect(data.acquirePath).toHaveBeenCalledTimes(1);
    expect(releasePath).not.toHaveBeenCalled();

    sub.unsubscribe();
    expect(releasePath).toHaveBeenCalledTimes(1);
  });

  it('neither acquires nor releases the path when disposed before the backfill resolves', async () => {
    history.getValues.mockResolvedValue({ context: 'vessels.self', range: {}, values: [], data: [] });
    mapper.mapValuesToChartDatapoints.mockReturnValue([{ timestamp: 1000, data: { value: 1 } }]);
    const sub = make().getBackfillThenLive(PARAMS).subscribe();
    sub.unsubscribe(); // before the backfill promise settles
    await Promise.resolve();
    await Promise.resolve();
    // startLive never ran → nothing acquired, so releaseLive stays null and the teardown is a no-op.
    expect(data.acquirePath).not.toHaveBeenCalled();
    expect(releasePath).not.toHaveBeenCalled();
  });

  it('resolves a radian path with no override to a circular domain — live stats wrap correctly (#6)', async () => {
    // navigation.headingTrue is a rad path, not on the signed allowlist -> direction domain.
    data.getPathUnitType.mockReturnValue('rad');
    history.getValues.mockResolvedValue({ context: 'vessels.self', range: {}, values: [], data: [] });
    mapper.mapValuesToChartDatapoints.mockReturnValue([
      { timestamp: 1000, data: { value: (350 * Math.PI) / 180 } } // seeds the window with 350°
    ]);

    const emissions: (IDatasetServiceDatapoint | IDatasetServiceDatapoint[] | { unavailable: true })[] = [];
    make().getBackfillThenLive({ ...PARAMS, path: 'navigation.headingTrue' }).subscribe(e => emissions.push(e));
    await Promise.resolve();
    await Promise.resolve();

    // Live value at 10°, over a window already holding 350°.
    path$.next({ data: { value: (10 * Math.PI) / 180, timestamp: new Date(2000) }, state: 'normal' });

    const last = emissions[emissions.length - 1] as IDatasetServiceDatapoint;
    const avg = last.data.lastAverage as number;
    // Circular mean of 350° and 10° is ~0° in the direction domain, NOT the ~180° a linear mean gives.
    // Pre-#133 this path resolved to 'scalar' and lastAverage would be ~π.
    expect(Math.min(avg, 2 * Math.PI - avg)).toBeLessThan(0.02);
  });

  describe('reconnect re-backfill (#85)', () => {
    it('does not re-backfill on the initial connect — only the constructor backfill runs', async () => {
      history.getValues.mockResolvedValue({ context: 'vessels.self', range: {}, values: [], data: [] });
      mapper.mapValuesToChartDatapoints.mockReturnValue([]);
      make().getBackfillThenLive(PARAMS).subscribe();
      await Promise.resolve();
      await Promise.resolve();

      // state$ replays its seeded Connected once during wiring; that first Connected must not trigger a
      // second History request on top of the constructor's backfill.
      expect(history.getValues).toHaveBeenCalledTimes(1);
    });

    it('re-fetches only the missed interval on reconnect and appends it as a batch', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);
      try {
        history.getValues.mockResolvedValue({ context: 'vessels.self', range: { to: new Date(1_000_000).toISOString() }, values: [], data: [] });
        mapper.mapValuesToChartDatapoints.mockReturnValue([]); // empty initial backfill
        const emissions: (IDatasetServiceDatapoint | IDatasetServiceDatapoint[] | { unavailable: true })[] = [];
        make().getBackfillThenLive(PARAMS).subscribe(e => emissions.push(e));
        await vi.advanceTimersByTimeAsync(0); // settle initial backfill → live subscribes

        // A live sample fixes lastLiveTs at the client clock (1_000_000).
        path$.next({ data: { value: 5, timestamp: new Date(1_000_000) }, state: 'normal' });

        // The WS drops; 20s pass; the re-backfill will return one gap sample at 1_010_000.
        state$.next(ConnectionState.Disconnected);
        vi.setSystemTime(1_020_000);
        history.getValues.mockResolvedValue({ context: 'vessels.self', range: { to: new Date(1_020_000).toISOString() }, values: [], data: [] });
        mapper.mapValuesToChartDatapoints.mockReturnValue([
          { timestamp: 990_000, data: { value: 1 } },   // at/behind the seam → dropped
          { timestamp: 1_010_000, data: { value: 9 } }   // inside the gap → kept
        ]);
        const callsBefore = history.getValues.mock.calls.length;

        state$.next(ConnectionState.Connected);
        await vi.advanceTimersByTimeAsync(0); // settle the re-backfill

        // Exactly one extra request, scoped to the gap: biased earlier than the seam by the skew margin
        // but still within the window. The stale-side point it re-admits is dropped by the > seam de-dup.
        expect(history.getValues.mock.calls.length).toBe(callsBefore + 1);
        const reQuery = history.getValues.mock.calls[history.getValues.mock.calls.length - 1][0];
        expect(Date.parse(reQuery.from)).toBeLessThanOrEqual(1_000_000);
        expect(Date.parse(reQuery.from)).toBeGreaterThanOrEqual(1_020_000 - PARAMS.windowMs);

        // The batch carries only the point newer than the seam; the stale-side point is de-duped.
        const batch = emissions.filter(e => Array.isArray(e)).pop() as IDatasetServiceDatapoint[];
        expect(batch.map(p => p.data.value)).toEqual([9]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('holds the live tail while disconnected so no gap is drawn mid-drop', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);
      try {
        history.getValues.mockResolvedValue({ context: 'vessels.self', range: { to: new Date(1_000_000).toISOString() }, values: [], data: [] });
        mapper.mapValuesToChartDatapoints.mockReturnValue([]);
        const emissions: (IDatasetServiceDatapoint | IDatasetServiceDatapoint[] | { unavailable: true })[] = [];
        make().getBackfillThenLive(PARAMS).subscribe(e => emissions.push(e));
        await vi.advanceTimersByTimeAsync(0);

        path$.next({ data: { value: 5, timestamp: new Date(1_000_000) }, state: 'normal' });
        state$.next(ConnectionState.Disconnected);

        // Well past the staleness window: a CONNECTED silent source would gap here (see the #131 test),
        // but a disconnect must not — the reconnect re-backfill fills it instead.
        await vi.advanceTimersByTimeAsync(31_000);
        const gaps = emissions.filter(
          e => !Array.isArray(e) && !('unavailable' in e) && Number.isNaN((e as IDatasetServiceDatapoint).data.value)
        );
        expect(gaps.length).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not re-backfill after the stream is torn down', async () => {
      history.getValues.mockResolvedValue({ context: 'vessels.self', range: {}, values: [], data: [] });
      mapper.mapValuesToChartDatapoints.mockReturnValue([]);
      const sub = make().getBackfillThenLive(PARAMS).subscribe();
      await Promise.resolve();
      await Promise.resolve();
      const callsAfterInit = history.getValues.mock.calls.length;

      sub.unsubscribe();
      state$.next(ConnectionState.Disconnected);
      state$.next(ConnectionState.Connected);
      await Promise.resolve();
      await Promise.resolve();

      expect(history.getValues.mock.calls.length).toBe(callsAfterInit);
    });

    it('breaks the trace with a gap when the re-backfill fails over a long outage (no interpolation)', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);
      try {
        history.getValues.mockResolvedValue({ context: 'vessels.self', range: { to: new Date(1_000_000).toISOString() }, values: [], data: [] });
        mapper.mapValuesToChartDatapoints.mockReturnValue([]);
        const emissions: (IDatasetServiceDatapoint | IDatasetServiceDatapoint[] | { unavailable: true })[] = [];
        make().getBackfillThenLive(PARAMS).subscribe(e => emissions.push(e));
        await vi.advanceTimersByTimeAsync(0);
        path$.next({ data: { value: 5, timestamp: new Date(1_000_000) }, state: 'normal' });

        state$.next(ConnectionState.Disconnected);
        vi.setSystemTime(1_040_000); // 40s outage — past the 30s bootstrap staleness threshold
        history.getValues.mockRejectedValue(new HistoryRequestError(503)); // provider down at reconnect
        state$.next(ConnectionState.Connected);
        await vi.advanceTimersByTimeAsync(0);

        // No batch (fetch failed); a NaN gap breaks the trace so the live tail cannot interpolate a
        // straight line across the outage.
        const last = emissions[emissions.length - 1];
        expect(Array.isArray(last)).toBe(false);
        expect(Number.isNaN((last as IDatasetServiceDatapoint).data.value)).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('breaks the trace with a gap when the re-backfill returns no rows over a long outage', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);
      try {
        history.getValues.mockResolvedValue({ context: 'vessels.self', range: { to: new Date(1_000_000).toISOString() }, values: [], data: [] });
        mapper.mapValuesToChartDatapoints.mockReturnValue([]);
        const emissions: (IDatasetServiceDatapoint | IDatasetServiceDatapoint[] | { unavailable: true })[] = [];
        make().getBackfillThenLive(PARAMS).subscribe(e => emissions.push(e));
        await vi.advanceTimersByTimeAsync(0);
        path$.next({ data: { value: 5, timestamp: new Date(1_000_000) }, state: 'normal' });

        state$.next(ConnectionState.Disconnected);
        vi.setSystemTime(1_040_000); // 40s outage — past the 30s bootstrap staleness threshold
        // Provider up but no rows for the window (e.g. a non-recorded path).
        history.getValues.mockResolvedValue({ context: 'vessels.self', range: { to: new Date(1_040_000).toISOString() }, values: [], data: [] });
        mapper.mapValuesToChartDatapoints.mockReturnValue([]);
        state$.next(ConnectionState.Connected);
        await vi.advanceTimersByTimeAsync(0);

        const last = emissions[emissions.length - 1];
        expect(Number.isNaN((last as IDatasetServiceDatapoint).data.value)).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not gap a brief blip the re-backfill cannot fill', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);
      try {
        history.getValues.mockResolvedValue({ context: 'vessels.self', range: { to: new Date(1_000_000).toISOString() }, values: [], data: [] });
        mapper.mapValuesToChartDatapoints.mockReturnValue([]);
        const emissions: (IDatasetServiceDatapoint | IDatasetServiceDatapoint[] | { unavailable: true })[] = [];
        make().getBackfillThenLive(PARAMS).subscribe(e => emissions.push(e));
        await vi.advanceTimersByTimeAsync(0);
        path$.next({ data: { value: 5, timestamp: new Date(1_000_000) }, state: 'normal' });

        state$.next(ConnectionState.Disconnected);
        vi.setSystemTime(1_001_000); // 1s blip — well under the staleness threshold
        history.getValues.mockResolvedValue({ context: 'vessels.self', range: { to: new Date(1_001_000).toISOString() }, values: [], data: [] });
        mapper.mapValuesToChartDatapoints.mockReturnValue([]);
        state$.next(ConnectionState.Connected);
        await vi.advanceTimersByTimeAsync(0);

        // A sub-threshold blip is indistinguishable from normal live cadence — no marker.
        const gaps = emissions.filter(
          e => !Array.isArray(e) && !('unavailable' in e) && Number.isNaN((e as IDatasetServiceDatapoint).data.value)
        );
        expect(gaps.length).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('recovers a failed initial backfill on the first connect, without waiting for a WS drop', async () => {
      // The constructor backfill fails transiently, so ctx.seeded stays false; the replayed first
      // Connected must then drive a recovery re-backfill rather than being skipped.
      history.getValues.mockReset();
      history.getValues
        .mockRejectedValueOnce(new HistoryRequestError(503))
        .mockResolvedValue({ context: 'vessels.self', range: {}, values: [], data: [] });
      mapper.mapValuesToChartDatapoints.mockReturnValue([]);

      const emissions: (IDatasetServiceDatapoint | IDatasetServiceDatapoint[] | { unavailable: true })[] = [];
      make().getBackfillThenLive(PARAMS).subscribe(e => emissions.push(e));
      await new Promise(resolve => setTimeout(resolve));
      await new Promise(resolve => setTimeout(resolve));

      // The transient failure did not disable the chart, and the seeded=false first Connected drove a
      // second (recovery) fetch on top of the constructor's failed one.
      expect(emissions.some(e => !Array.isArray(e) && 'unavailable' in e)).toBe(false);
      expect(history.getValues.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('coalesces a reconnect that lands mid-fetch and re-runs from the advanced seam', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);
      try {
        history.getValues.mockResolvedValue({ context: 'vessels.self', range: { to: new Date(1_000_000).toISOString() }, values: [], data: [] });
        mapper.mapValuesToChartDatapoints.mockReturnValue([]);
        const emissions: (IDatasetServiceDatapoint | IDatasetServiceDatapoint[] | { unavailable: true })[] = [];
        make().getBackfillThenLive(PARAMS).subscribe(e => emissions.push(e));
        await vi.advanceTimersByTimeAsync(0);
        path$.next({ data: { value: 5, timestamp: new Date(1_000_000) }, state: 'normal' });

        // Hold the first reconnect's re-backfill fetch open with a manual promise.
        let releaseFirst: (v: unknown) => void = () => { /* set below */ };
        const firstFetch = new Promise(res => { releaseFirst = res; });
        history.getValues.mockReturnValueOnce(firstFetch);
        state$.next(ConnectionState.Disconnected);
        vi.setSystemTime(1_010_000);
        state$.next(ConnectionState.Connected); // reBackfill #1 issues its fetch, then awaits
        await vi.advanceTimersByTimeAsync(0);
        const callsAfterFirst = history.getValues.mock.calls.length;
        const runAFrom = Date.parse(history.getValues.mock.calls[callsAfterFirst - 1][0].from);

        // A second drop/reconnect lands WHILE #1 is in flight: coalesced, no second fetch yet.
        state$.next(ConnectionState.Disconnected);
        state$.next(ConnectionState.Connected);
        await vi.advanceTimersByTimeAsync(0);
        expect(history.getValues.mock.calls.length).toBe(callsAfterFirst);

        // Run A delivers a point at 1_005_000 → the seam advances; the coalesced re-run (run B) must then
        // re-fetch from the ADVANCED seam, not the original one. Run B's fetch returns the same point,
        // which its > seam de-dup now drops (proving the seam advanced).
        mapper.mapValuesToChartDatapoints.mockReturnValue([{ timestamp: 1_005_000, data: { value: 8 } }]);
        history.getValues.mockResolvedValue({ context: 'vessels.self', range: { to: new Date(1_010_000).toISOString() }, values: [], data: [] });
        releaseFirst({ context: 'vessels.self', range: { to: new Date(1_010_000).toISOString() }, values: [], data: [] });
        await vi.advanceTimersByTimeAsync(0);

        expect(history.getValues.mock.calls.length).toBe(callsAfterFirst + 1);
        const runBFrom = Date.parse(history.getValues.mock.calls[callsAfterFirst][0].from);
        expect(runBFrom).toBeGreaterThan(runAFrom); // re-run starts from the advanced seam

        // Run A's batch landed and no NaN gap was drawn out of order (the seam advanced, so run B's
        // > seam de-dup keeps the trace monotonic).
        const batch = emissions.filter(e => Array.isArray(e)).pop() as IDatasetServiceDatapoint[];
        expect(batch.map(p => p.data.value)).toEqual([8]);
        const anyGap = emissions.some(
          e => !Array.isArray(e) && !('unavailable' in e) && Number.isNaN((e as IDatasetServiceDatapoint).data.value)
        );
        expect(anyGap).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('holds a live sample tick that arrives while a re-backfill fetch is in flight', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);
      try {
        history.getValues.mockResolvedValue({ context: 'vessels.self', range: { to: new Date(1_000_000).toISOString() }, values: [], data: [] });
        mapper.mapValuesToChartDatapoints.mockReturnValue([]);
        const emissions: (IDatasetServiceDatapoint | IDatasetServiceDatapoint[] | { unavailable: true })[] = [];
        make().getBackfillThenLive(PARAMS).subscribe(e => emissions.push(e));
        await vi.advanceTimersByTimeAsync(0);
        path$.next({ data: { value: 5, timestamp: new Date(1_000_000) }, state: 'normal' });

        // Hold the reconnect re-backfill fetch open so backfillInFlight stays true.
        let releaseFetch: (v: unknown) => void = () => { /* set below */ };
        const heldFetch = new Promise(res => { releaseFetch = res; });
        history.getValues.mockReturnValueOnce(heldFetch);
        state$.next(ConnectionState.Disconnected);
        vi.setSystemTime(1_005_000);
        state$.next(ConnectionState.Connected); // backfillInFlight = true, awaiting heldFetch
        await vi.advanceTimersByTimeAsync(0);

        // A sampled tick fires WHILE the fetch is in flight: the gate must suppress the replayed value so
        // it cannot append ahead of the pending batch.
        const countMidFetch = emissions.length;
        await vi.advanceTimersByTimeAsync(PARAMS.sampleTime);
        expect(emissions.length).toBe(countMidFetch);

        // Once the batch lands the gate reopens and the batch is emitted.
        mapper.mapValuesToChartDatapoints.mockReturnValue([{ timestamp: 1_004_000, data: { value: 7 } }]);
        releaseFetch({ context: 'vessels.self', range: { to: new Date(1_005_000).toISOString() }, values: [], data: [] });
        await vi.advanceTimersByTimeAsync(0);
        const batch = emissions.filter(e => Array.isArray(e)).pop() as IDatasetServiceDatapoint[];
        expect(batch.map(p => p.data.value)).toEqual([7]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not gap a slow-cadence source on a reconnect shorter than its update interval', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);
      try {
        history.getValues.mockResolvedValue({ context: 'vessels.self', range: { to: new Date(1_000_000).toISOString() }, values: [], data: [] });
        mapper.mapValuesToChartDatapoints.mockReturnValue([]);
        const emissions: (IDatasetServiceDatapoint | IDatasetServiceDatapoint[] | { unavailable: true })[] = [];
        make().getBackfillThenLive(PARAMS).subscribe(e => emissions.push(e));
        await vi.advanceTimersByTimeAsync(0);

        // Establish a ~10s source cadence (two samples 10s apart).
        path$.next({ data: { value: 1, timestamp: new Date(1_000_000) }, state: 'normal' });
        vi.setSystemTime(1_010_000);
        path$.next({ data: { value: 2, timestamp: new Date(1_010_000) }, state: 'normal' });

        // A 12s drop — well past the flat 3s floor but under the 3× cadence threshold, so the source
        // could not have produced data during it and no gap should be drawn.
        state$.next(ConnectionState.Disconnected);
        vi.setSystemTime(1_022_000);
        history.getValues.mockResolvedValue({ context: 'vessels.self', range: { to: new Date(1_022_000).toISOString() }, values: [], data: [] });
        mapper.mapValuesToChartDatapoints.mockReturnValue([]);
        state$.next(ConnectionState.Connected);
        await vi.advanceTimersByTimeAsync(0);

        const gaps = emissions.filter(
          e => !Array.isArray(e) && !('unavailable' in e) && Number.isNaN((e as IDatasetServiceDatapoint).data.value)
        );
        expect(gaps.length).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('gaps a known-cadence source when the reconnect outage exceeds its interval', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);
      try {
        history.getValues.mockResolvedValue({ context: 'vessels.self', range: { to: new Date(1_000_000).toISOString() }, values: [], data: [] });
        mapper.mapValuesToChartDatapoints.mockReturnValue([]);
        const emissions: (IDatasetServiceDatapoint | IDatasetServiceDatapoint[] | { unavailable: true })[] = [];
        make().getBackfillThenLive(PARAMS).subscribe(e => emissions.push(e));
        await vi.advanceTimersByTimeAsync(0);

        // Learn a ~5s cadence → gap threshold = max(3s, 3×5s) = 15s.
        path$.next({ data: { value: 1, timestamp: new Date(1_000_000) }, state: 'normal' });
        vi.setSystemTime(1_005_000);
        path$.next({ data: { value: 2, timestamp: new Date(1_005_000) }, state: 'normal' });

        // A 25s outage — past the 15s threshold → a real gap must be drawn (locks the gap-drawing side of
        // the cadence branch; a regression inflating the known-cadence threshold would suppress it).
        state$.next(ConnectionState.Disconnected);
        vi.setSystemTime(1_025_000);
        history.getValues.mockResolvedValue({ context: 'vessels.self', range: { to: new Date(1_025_000).toISOString() }, values: [], data: [] });
        mapper.mapValuesToChartDatapoints.mockReturnValue([]);
        state$.next(ConnectionState.Connected);
        await vi.advanceTimersByTimeAsync(0);

        const gaps = emissions.filter(
          e => !Array.isArray(e) && !('unavailable' in e) && Number.isNaN((e as IDatasetServiceDatapoint).data.value)
        );
        expect(gaps.length).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not fold the outage into the cadence when a delta arrives during the re-backfill', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);
      try {
        history.getValues.mockResolvedValue({ context: 'vessels.self', range: { to: new Date(1_000_000).toISOString() }, values: [], data: [] });
        mapper.mapValuesToChartDatapoints.mockReturnValue([]);
        const emissions: (IDatasetServiceDatapoint | IDatasetServiceDatapoint[] | { unavailable: true })[] = [];
        make().getBackfillThenLive(PARAMS).subscribe(e => emissions.push(e));
        await vi.advanceTimersByTimeAsync(0);

        // Learn a ~5s cadence → threshold 15s.
        path$.next({ data: { value: 1, timestamp: new Date(1_000_000) }, state: 'normal' });
        vi.setSystemTime(1_005_000);
        path$.next({ data: { value: 2, timestamp: new Date(1_005_000) }, state: 'normal' });

        // Long outage; hold the re-backfill fetch open across it.
        let releaseFetch: (v: unknown) => void = () => { /* set below */ };
        const heldFetch = new Promise(res => { releaseFetch = res; });
        history.getValues.mockReturnValueOnce(heldFetch);
        state$.next(ConnectionState.Disconnected);
        vi.setSystemTime(1_040_000); // 40s outage
        state$.next(ConnectionState.Connected); // reBackfill awaits heldFetch
        await vi.advanceTimersByTimeAsync(0);

        // The resumed WS delivers a fresh delta DURING the fetch, ~40s after the pre-drop sample. Folding
        // that gap into the EWMA cadence would inflate the threshold past 40s and suppress the gap below.
        path$.next({ data: { value: 9, timestamp: new Date(1_040_000) }, state: 'normal' });

        history.getValues.mockResolvedValue({ context: 'vessels.self', range: { to: new Date(1_040_000).toISOString() }, values: [], data: [] });
        mapper.mapValuesToChartDatapoints.mockReturnValue([]);
        releaseFetch({ context: 'vessels.self', range: { to: new Date(1_040_000).toISOString() }, values: [], data: [] });
        await vi.advanceTimersByTimeAsync(0);

        // The cadence stayed ~5s (threshold ~15s), so the 40s outage still draws its honest gap.
        const gaps = emissions.filter(
          e => !Array.isArray(e) && !('unavailable' in e) && Number.isNaN((e as IDatasetServiceDatapoint).data.value)
        );
        expect(gaps.length).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('caps the live-tail hold on a slow provider — draws the gap and resumes live instead of freezing', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);
      try {
        history.getValues.mockResolvedValue({ context: 'vessels.self', range: { to: new Date(1_000_000).toISOString() }, values: [], data: [] });
        mapper.mapValuesToChartDatapoints.mockReturnValue([]);
        const emissions: (IDatasetServiceDatapoint | IDatasetServiceDatapoint[] | { unavailable: true })[] = [];
        make().getBackfillThenLive(PARAMS).subscribe(e => emissions.push(e));
        await vi.advanceTimersByTimeAsync(0);
        path$.next({ data: { value: 5, timestamp: new Date(1_000_000) }, state: 'normal' });

        // Reconnect while the history provider hangs (never resolves) — the freeze scenario.
        history.getValues.mockReturnValueOnce(new Promise<never>(() => { /* hangs */ }));
        state$.next(ConnectionState.Disconnected);
        vi.setSystemTime(1_030_000);
        state$.next(ConnectionState.Connected);
        await vi.advanceTimersByTimeAsync(0);

        // Just before the hold cap (RECONNECT_HOLD_MS = 3000ms) elapses: still held, no gap yet.
        await vi.advanceTimersByTimeAsync(2_900);
        expect(emissions.some(e => !Array.isArray(e) && !('unavailable' in e) && Number.isNaN((e as IDatasetServiceDatapoint).data.value))).toBe(false);

        // Past the cap: the hold releases and the honest gap is drawn even though the fetch is still hung.
        await vi.advanceTimersByTimeAsync(200);
        const gaps = emissions.filter(
          e => !Array.isArray(e) && !('unavailable' in e) && Number.isNaN((e as IDatasetServiceDatapoint).data.value)
        );
        expect(gaps.length).toBe(1);

        // And the gate is released: a fresh live delta renders again instead of being dropped.
        vi.setSystemTime(1_034_000);
        path$.next({ data: { value: 7, timestamp: new Date(1_034_000) }, state: 'normal' });
        await vi.advanceTimersByTimeAsync(PARAMS.sampleTime);
        const rendered = emissions.some(
          e => !Array.isArray(e) && !('unavailable' in e) && (e as IDatasetServiceDatapoint).data.value === 7
        );
        expect(rendered).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('bounds the coalesced-chain hold to one budget under sustained flapping (no N×cap stacking)', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);
      try {
        history.getValues.mockResolvedValue({ context: 'vessels.self', range: { to: new Date(1_000_000).toISOString() }, values: [], data: [] });
        mapper.mapValuesToChartDatapoints.mockReturnValue([]);
        const emissions: (IDatasetServiceDatapoint | IDatasetServiceDatapoint[] | { unavailable: true })[] = [];
        make().getBackfillThenLive(PARAMS).subscribe(e => emissions.push(e));
        await vi.advanceTimersByTimeAsync(0);
        path$.next({ data: { value: 5, timestamp: new Date(1_000_000) }, state: 'normal' }); // seam 1_000_000

        // Reconnect while the provider hangs (never resolves) — run 1 of the coalesced chain. Offset the
        // outage by 100ms so the shared cap (1_043_100) lands between resampler ticks (multiples of the
        // 500ms sampleTime), avoiding a fake-timer tie between the hold timer and a sampled$ tick.
        history.getValues.mockReturnValue(new Promise<never>(() => { /* hangs */ }));
        state$.next(ConnectionState.Disconnected);
        vi.setSystemTime(1_040_100);
        state$.next(ConnectionState.Connected);
        await vi.advanceTimersByTimeAsync(0);
        expect(history.getValues.mock.calls.length).toBe(2); // one initial backfill + one run-1 fetch

        // A second drop/reconnect lands WHILE run 1 hangs: coalesced (reconnectPending). Without a shared
        // budget this would earn the coalesced re-run a fresh RECONNECT_HOLD_MS and hold the tail 2× the cap.
        state$.next(ConnectionState.Disconnected);
        state$.next(ConnectionState.Connected);
        await vi.advanceTimersByTimeAsync(0);
        expect(history.getValues.mock.calls.length).toBe(2); // coalesced, no run-2 fetch yet

        // Just before the single shared cap (deadline 1_043_100): still held, no gap.
        await vi.advanceTimersByTimeAsync(2_800); // → 1_042_900
        expect(emissions.some(
          e => !Array.isArray(e) && !('unavailable' in e) && Number.isNaN((e as IDatasetServiceDatapoint).data.value)
        )).toBe(false);

        // Just past the shared cap, within one sample interval so no stale-tail tick intrudes: the chain
        // stops and draws exactly one honest gap rather than re-running for a second 3s window.
        await vi.advanceTimersByTimeAsync(300); // → 1_043_200
        const gaps = emissions.filter(
          e => !Array.isArray(e) && !('unavailable' in e) && Number.isNaN((e as IDatasetServiceDatapoint).data.value)
        );
        expect(gaps.length).toBe(1);
        // The coalesced re-run never issued a fetch — the spent budget pre-empted it.
        expect(history.getValues.mock.calls.length).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('aborts the abandoned re-backfill fetch when the hold cap fires', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);
      try {
        history.getValues.mockResolvedValue({ context: 'vessels.self', range: { to: new Date(1_000_000).toISOString() }, values: [], data: [] });
        mapper.mapValuesToChartDatapoints.mockReturnValue([]);
        const emissions: (IDatasetServiceDatapoint | IDatasetServiceDatapoint[] | { unavailable: true })[] = [];
        make().getBackfillThenLive(PARAMS).subscribe(e => emissions.push(e));
        await vi.advanceTimersByTimeAsync(0);
        path$.next({ data: { value: 5, timestamp: new Date(1_000_000) }, state: 'normal' });

        // Reconnect while the provider hangs; the fetch is threaded an AbortSignal (2nd getValues arg).
        history.getValues.mockReturnValueOnce(new Promise<never>(() => { /* hangs */ }));
        state$.next(ConnectionState.Disconnected);
        vi.setSystemTime(1_040_000);
        state$.next(ConnectionState.Connected);
        await vi.advanceTimersByTimeAsync(0);

        const lastCall = history.getValues.mock.calls[history.getValues.mock.calls.length - 1];
        const signal = lastCall[1] as AbortSignal | undefined;
        expect(signal).toBeInstanceOf(AbortSignal);
        expect(signal?.aborted).toBe(false); // still within the hold — not yet abandoned

        // Past the hold cap (RECONNECT_HOLD_MS = 3000ms): the abandoned fetch is aborted rather than left
        // to self-terminate at the 30s HTTP timeout and stack on the struggling provider.
        await vi.advanceTimersByTimeAsync(3_100);
        expect(signal?.aborted).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('re-arms a fresh hold budget for the next healthy reconnect after a budget-spent storm', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);
      try {
        history.getValues.mockResolvedValue({ context: 'vessels.self', range: { to: new Date(1_000_000).toISOString() }, values: [], data: [] });
        mapper.mapValuesToChartDatapoints.mockReturnValue([]);
        const emissions: (IDatasetServiceDatapoint | IDatasetServiceDatapoint[] | { unavailable: true })[] = [];
        make().getBackfillThenLive(PARAMS).subscribe(e => emissions.push(e));
        await vi.advanceTimersByTimeAsync(0);
        path$.next({ data: { value: 5, timestamp: new Date(1_000_000) }, state: 'normal' }); // seam 1_000_000

        // A hung-provider storm plus a coalesced flap spends the whole shared budget and resets holdDeadline.
        history.getValues.mockReturnValue(new Promise<never>(() => { /* hangs */ }));
        state$.next(ConnectionState.Disconnected);
        vi.setSystemTime(1_040_100);
        state$.next(ConnectionState.Connected);
        await vi.advanceTimersByTimeAsync(0);
        state$.next(ConnectionState.Disconnected);
        state$.next(ConnectionState.Connected);
        await vi.advanceTimersByTimeAsync(3_200); // past the single shared cap → gap, budget cleared to null
        const gapsAfterStorm = emissions.filter(
          e => !Array.isArray(e) && !('unavailable' in e) && Number.isNaN((e as IDatasetServiceDatapoint).data.value)
        ).length;
        expect(gapsAfterStorm).toBeGreaterThanOrEqual(1);

        // A subsequent HEALTHY reconnect: a slow-but-alive provider that resolves WITHIN a fresh full budget.
        let releaseHealthy: (v: unknown) => void = () => { /* set below */ };
        const healthyFetch = new Promise(res => { releaseHealthy = res; });
        history.getValues.mockReturnValueOnce(healthyFetch);
        state$.next(ConnectionState.Disconnected);
        vi.setSystemTime(1_060_000);
        state$.next(ConnectionState.Connected);
        await vi.advanceTimersByTimeAsync(0);

        // 2s into the hold — under a FRESHLY-ARMED RECONNECT_HOLD_MS. A latched (spent) deadline would have
        // capped at ~0ms and drawn a gap with no delivery; a re-armed full budget keeps holding.
        await vi.advanceTimersByTimeAsync(2_000);
        expect(emissions.filter(
          e => !Array.isArray(e) && !('unavailable' in e) && Number.isNaN((e as IDatasetServiceDatapoint).data.value)
        ).length).toBe(gapsAfterStorm);

        // The healthy fetch resolves inside the fresh budget and backfills the missed interval.
        mapper.mapValuesToChartDatapoints.mockReturnValue([{ timestamp: 1_050_000, data: { value: 9 } }]);
        releaseHealthy({ context: 'vessels.self', range: { to: new Date(1_062_000).toISOString() }, values: [], data: [] });
        await vi.advanceTimersByTimeAsync(0);
        const batch = emissions.filter(e => Array.isArray(e)).pop() as IDatasetServiceDatapoint[];
        expect(batch.map(p => p.data.value)).toEqual([9]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('aborts a hung re-backfill fetch on teardown and emits nothing after disposal', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);
      try {
        history.getValues.mockResolvedValue({ context: 'vessels.self', range: { to: new Date(1_000_000).toISOString() }, values: [], data: [] });
        mapper.mapValuesToChartDatapoints.mockReturnValue([]);
        const emissions: (IDatasetServiceDatapoint | IDatasetServiceDatapoint[] | { unavailable: true })[] = [];
        const sub = make().getBackfillThenLive(PARAMS).subscribe(e => emissions.push(e));
        await vi.advanceTimersByTimeAsync(0);
        path$.next({ data: { value: 5, timestamp: new Date(1_000_000) }, state: 'normal' });

        // Reconnect while the provider hangs; capture the fetch's abort signal.
        history.getValues.mockReturnValueOnce(new Promise<never>(() => { /* hangs */ }));
        state$.next(ConnectionState.Disconnected);
        vi.setSystemTime(1_040_000);
        state$.next(ConnectionState.Connected);
        await vi.advanceTimersByTimeAsync(0);
        const signal = history.getValues.mock.calls[history.getValues.mock.calls.length - 1][1] as AbortSignal | undefined;
        const countBeforeDispose = emissions.length;

        // Tear the stream down mid-fetch.
        sub.unsubscribe();

        // The hold timer still fires (bounded by the remaining budget); it aborts the abandoned fetch and
        // the disposed guard suppresses any post-dispose emission or gap.
        await vi.advanceTimersByTimeAsync(3_100);
        expect(signal?.aborted).toBe(true);
        expect(emissions.length).toBe(countBeforeDispose);
      } finally {
        vi.useRealTimers();
      }
    });

    it('runs a coalesced re-backfill under the remaining shared budget, not a fresh cap', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);
      try {
        history.getValues.mockResolvedValue({ context: 'vessels.self', range: { to: new Date(1_000_000).toISOString() }, values: [], data: [] });
        mapper.mapValuesToChartDatapoints.mockReturnValue([]);
        const emissions: (IDatasetServiceDatapoint | IDatasetServiceDatapoint[] | { unavailable: true })[] = [];
        make().getBackfillThenLive(PARAMS).subscribe(e => emissions.push(e));
        await vi.advanceTimersByTimeAsync(0);
        path$.next({ data: { value: 5, timestamp: new Date(1_000_000) }, state: 'normal' }); // seam 1_000_000

        // Run 1: a held fetch that delivers partway through the shared budget (chain start at 1_040_000,
        // shared deadline 1_043_000).
        let releaseRun1: (v: unknown) => void = () => { /* set below */ };
        const run1Fetch = new Promise(res => { releaseRun1 = res; });
        history.getValues.mockReturnValueOnce(run1Fetch);
        state$.next(ConnectionState.Disconnected);
        vi.setSystemTime(1_040_000);
        state$.next(ConnectionState.Connected);
        await vi.advanceTimersByTimeAsync(0);

        // A coalesced flap lands while run 1 is in flight → the re-run is pending.
        state$.next(ConnectionState.Disconnected);
        state$.next(ConnectionState.Connected);
        await vi.advanceTimersByTimeAsync(0);

        // 1s into the budget, run 1 delivers; the coalesced run 2 then fires and hangs.
        await vi.advanceTimersByTimeAsync(1_000); // → 1_041_000
        mapper.mapValuesToChartDatapoints.mockReturnValue([{ timestamp: 1_041_000, data: { value: 8 } }]);
        history.getValues.mockReturnValue(new Promise<never>(() => { /* run 2 hangs */ }));
        releaseRun1({ context: 'vessels.self', range: { to: new Date(1_041_000).toISOString() }, values: [], data: [] });
        await vi.advanceTimersByTimeAsync(0);

        const batch = emissions.filter(e => Array.isArray(e)).pop() as IDatasetServiceDatapoint[];
        expect(batch.map(p => p.data.value)).toEqual([8]); // run 1 delivered, seam advanced to 1_041_000
        const run2Signal = history.getValues.mock.calls[history.getValues.mock.calls.length - 1][1] as AbortSignal | undefined;
        expect(run2Signal?.aborted).toBe(false);

        // Run 2 started at 1_041_000 with only the REMAINING 2000ms of the shared budget. A fresh per-run
        // cap would abort at 1_044_000; the shared budget aborts at 1_043_000.
        await vi.advanceTimersByTimeAsync(1_900); // → 1_042_900, before the shared deadline
        expect(run2Signal?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(200); // → 1_043_100, past the shared deadline
        expect(run2Signal?.aborted).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('advances the seam past a drawn gap so a lagging provider cannot backfill behind it', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);
      try {
        history.getValues.mockResolvedValue({ context: 'vessels.self', range: { to: new Date(1_000_000).toISOString() }, values: [], data: [] });
        mapper.mapValuesToChartDatapoints.mockReturnValue([]);
        const emissions: (IDatasetServiceDatapoint | IDatasetServiceDatapoint[] | { unavailable: true })[] = [];
        make().getBackfillThenLive(PARAMS).subscribe(e => emissions.push(e));
        await vi.advanceTimersByTimeAsync(0);
        path$.next({ data: { value: 5, timestamp: new Date(1_000_000) }, state: 'normal' }); // seam 1_000_000

        // Reconnect #1: the provider is still ingesting and returns no rows → a gap is drawn at ~1_040_000.
        state$.next(ConnectionState.Disconnected);
        vi.setSystemTime(1_040_000);
        history.getValues.mockResolvedValue({ context: 'vessels.self', range: { to: new Date(1_040_000).toISOString() }, values: [], data: [] });
        mapper.mapValuesToChartDatapoints.mockReturnValue([]);
        state$.next(ConnectionState.Connected);
        await vi.advanceTimersByTimeAsync(0);
        expect(emissions.filter(e => !Array.isArray(e) && !('unavailable' in e) && Number.isNaN((e as IDatasetServiceDatapoint).data.value)).length).toBe(1);

        // Reconnect #2: the provider has now ingested the backdated outage samples (all older than the gap).
        state$.next(ConnectionState.Disconnected);
        state$.next(ConnectionState.Connected);
        mapper.mapValuesToChartDatapoints.mockReturnValue([
          { timestamp: 1_005_000, data: { value: 1 } },
          { timestamp: 1_038_000, data: { value: 2 } }
        ]);
        history.getValues.mockResolvedValue({ context: 'vessels.self', range: { to: new Date(1_040_000).toISOString() }, values: [], data: [] });
        await vi.advanceTimersByTimeAsync(0);

        // The seam advanced to the gap timestamp, so those backdated points are de-duped — never drawn
        // behind the break.
        const drewBackdated = emissions.some(
          e => Array.isArray(e) && (e as IDatasetServiceDatapoint[]).some(p => p.data.value === 1)
        );
        expect(drewBackdated).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('survives an unexpected (non-request) error during the reconnect re-backfill', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        history.getValues.mockResolvedValue({ context: 'vessels.self', range: { to: new Date(1_000_000).toISOString() }, values: [], data: [] });
        mapper.mapValuesToChartDatapoints.mockReturnValue([]);
        const emissions: (IDatasetServiceDatapoint | IDatasetServiceDatapoint[] | { unavailable: true })[] = [];
        make().getBackfillThenLive(PARAMS).subscribe(e => emissions.push(e));
        await vi.advanceTimersByTimeAsync(0);
        path$.next({ data: { value: 5, timestamp: new Date(1_000_000) }, state: 'normal' });

        state$.next(ConnectionState.Disconnected);
        vi.setSystemTime(1_040_000); // 40s outage
        history.getValues.mockRejectedValue(new Error('mapper boom')); // unexpected, not a HistoryRequestError
        state$.next(ConnectionState.Connected);
        await vi.advanceTimersByTimeAsync(0);

        // The unexpected error is logged, the stream is not disabled (no HISTORY_UNAVAILABLE), and the
        // trace still breaks honestly rather than throwing out of the async handler.
        expect(errorSpy).toHaveBeenCalled();
        expect(emissions.some(e => !Array.isArray(e) && 'unavailable' in e)).toBe(false);
        const last = emissions[emissions.length - 1];
        expect(Number.isNaN((last as IDatasetServiceDatapoint).data.value)).toBe(true);
      } finally {
        errorSpy.mockRestore();
        vi.useRealTimers();
      }
    });

    it('re-backfills the first connect when mounted during an outage — the seed is not contemporaneous (#85)', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);
      try {
        // Mount while the WS is already down (HTTP still up, so the constructor backfill succeeds). The
        // seeded window and the first Connected land minutes apart, so that Connected is a real reconnect
        // whose elapsed interval must be re-fetched — not the free skip a contemporaneous seed would earn.
        state$.next(ConnectionState.Disconnected);
        history.getValues.mockResolvedValue({ context: 'vessels.self', range: { to: new Date(1_000_000).toISOString() }, values: [], data: [] });
        mapper.mapValuesToChartDatapoints.mockReturnValue([{ timestamp: 1_000_000, data: { value: 5 } }]);
        const emissions: (IDatasetServiceDatapoint | IDatasetServiceDatapoint[] | { unavailable: true })[] = [];
        make().getBackfillThenLive(PARAMS).subscribe(e => emissions.push(e));
        await vi.advanceTimersByTimeAsync(0); // settle the mount backfill → beginLive replays Disconnected

        // 20s of outage elapse, then the WS reconnects.
        vi.setSystemTime(1_020_000);
        history.getValues.mockResolvedValue({ context: 'vessels.self', range: { to: new Date(1_020_000).toISOString() }, values: [], data: [] });
        mapper.mapValuesToChartDatapoints.mockReturnValue([
          { timestamp: 990_000, data: { value: 1 } },   // at/behind the seam → dropped
          { timestamp: 1_010_000, data: { value: 9 } }   // inside the gap → kept
        ]);
        const callsBefore = history.getValues.mock.calls.length; // the single mount backfill

        state$.next(ConnectionState.Connected);
        await vi.advanceTimersByTimeAsync(0); // settle the re-backfill

        // Exactly one re-backfill fires, scoped to the gap; without it the outage would draw a silent line.
        expect(history.getValues.mock.calls.length).toBe(callsBefore + 1);
        const batch = emissions.filter(e => Array.isArray(e)).pop() as IDatasetServiceDatapoint[];
        expect(batch.map(p => p.data.value)).toEqual([9]);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
