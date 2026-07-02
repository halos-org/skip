import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Subject, firstValueFrom } from 'rxjs';
import { HistoryChartStreamService, IHistoryChartStreamParams, isHistoryUnavailable } from './history-chart-stream.service';
import { HistoryApiClientService } from './history-api-client.service';
import { HistoryToChartMapperService } from './history-to-chart-mapper.service';
import { DataService, IPathUpdate } from './data.service';
import { SettingsService } from './settings.service';
import { IDatasetServiceDatapoint } from './dataset-stream.service';

const PARAMS: IHistoryChartStreamParams = {
  path: 'navigation.speedOverGround',
  source: 'default',
  unit: 'number',
  domain: 'scalar',
  windowMs: 60_000,
  sampleTime: 500,
  maxDataPoints: 3,
  smoothingPeriod: 2
};

describe('HistoryChartStreamService', () => {
  let path$: Subject<IPathUpdate>;
  const history = { getValues: vi.fn() };
  const mapper = { mapValuesToChartDatapoints: vi.fn() };
  const data = { subscribePath: vi.fn() };
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

    // First live value routes through take(1) — no timer needed.
    path$.next({ data: { value: 5, timestamp: new Date(1000) }, state: 'normal' });

    expect(emissions.length).toBe(2);
    const point = emissions[1] as IDatasetServiceDatapoint;
    expect(point.timestamp).toBe(1000);
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
    path$.next({ data: { value: 30, timestamp: new Date(3000) }, state: 'normal' });

    const point = emissions[1] as IDatasetServiceDatapoint;
    expect(point.data.value).toBe(30);
    expect(point.data.lastMinimum).toBe(10); // 10 is only present if the backfill seeded the window
    expect(point.data.lastMaximum).toBe(30);
    expect(point.data.lastAverage).toBeCloseTo(20); // (10 + 20 + 30) / 3
    expect(point.data.sma).toBeCloseTo(25); // mean of the last 2: (20 + 30) / 2
  });

  it('emits HISTORY_UNAVAILABLE and starts no live tail when the backfill request rejects', async () => {
    history.getValues.mockRejectedValue(new Error('network down'));
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
});
