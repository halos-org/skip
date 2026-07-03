import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Subject, firstValueFrom } from 'rxjs';
import { HistoryChartStreamService, IHistoryChartStreamParams, isHistoryUnavailable } from './history-chart-stream.service';
import { HistoryApiClientService, HistoryRequestError } from './history-api-client.service';
import { HistoryToChartMapperService } from './history-to-chart-mapper.service';
import { DataService, IPathUpdate } from './data.service';
import { SettingsService } from './settings.service';
import { IDatasetServiceDatapoint } from './dataset-stream.service';

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
  const history = { getValues: vi.fn() };
  const mapper = { mapValuesToChartDatapoints: vi.fn() };
  const data = { subscribePath: vi.fn(), getPathUnitType: vi.fn() };
  const settings = { getWidgetHistoryDisabled: vi.fn() };

  function make(): HistoryChartStreamService {
    TestBed.configureTestingModule({
      providers: [
        HistoryChartStreamService,
        { provide: HistoryApiClientService, useValue: history },
        { provide: HistoryToChartMapperService, useValue: mapper },
        { provide: DataService, useValue: data },
        { provide: SettingsService, useValue: settings }
      ]
    });
    return TestBed.inject(HistoryChartStreamService);
  }

  beforeEach(() => {
    path$ = new Subject<IPathUpdate>();
    history.getValues.mockReset();
    mapper.mapValuesToChartDatapoints.mockReset().mockReturnValue([]);
    data.subscribePath.mockReset().mockReturnValue(path$);
    data.getPathUnitType.mockReset().mockReturnValue(null); // scalar unless a test overrides
    settings.getWidgetHistoryDisabled.mockReset().mockReturnValue(false);
  });

  it('emits HISTORY_UNAVAILABLE (no live tail) when history is disabled', async () => {
    settings.getWidgetHistoryDisabled.mockReturnValue(true);
    const first = await firstValueFrom(make().getBackfillThenLive(PARAMS));
    expect(isHistoryUnavailable(first)).toBe(true);
    expect(history.getValues).not.toHaveBeenCalled();
    expect(data.subscribePath).not.toHaveBeenCalled();
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
    // Aggregation suffixes + a from-window are requested.
    const query = history.getValues.mock.calls[0][0];
    expect(query.paths).toContain(':avg');
    expect(query.paths).toContain(':sma:');
    expect(query.from).toBeTruthy();
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
    expect(data.subscribePath).toHaveBeenCalled();

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
    expect(data.subscribePath).not.toHaveBeenCalled();
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
    expect(data.subscribePath).not.toHaveBeenCalled();
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
});
