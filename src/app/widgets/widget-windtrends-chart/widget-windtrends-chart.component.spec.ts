import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Chart.js cannot instantiate under jsdom. Mock it self-contained (no importOriginal / outer refs)
// so vi.mock hoisting does not trip a TDZ. The mock Chart carries a truthy `ctx`.
vi.mock('chart.js', () => {
  class MockChart {
    public static register(): void { /* noop */ }
    public ctx = {};
    public data: { datasets: { data: unknown[] }[] };
    public options: { plugins?: Record<string, unknown>; scales?: Record<string, unknown> } = {};
    constructor(_ctx: unknown, config: { data: { datasets: { data: unknown[] }[] }; options: unknown }) {
      this.data = config.data;
      this.options = (config.options ?? {}) as typeof this.options;
    }
    public update(): void { /* noop */ }
    public destroy(): void { /* noop */ }
  }
  return {
    Chart: MockChart,
    registerables: [],
    TimeScale: {}, LinearScale: {}, LineController: {}, PointElement: {},
    LineElement: {}, Filler: {}, Legend: {}, Tooltip: {}, Title: {}, SubTitle: {}
  };
});
vi.mock('chartjs-adapter-date-fns', () => ({}));
vi.mock('chartjs-plugin-annotation', () => ({ default: {} }));
vi.mock('@aziham/chartjs-plugin-streaming', () => ({ default: {} }));

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { BreakpointObserver } from '@angular/cdk/layout';
import { WidgetWindTrendsChartComponent } from './widget-windtrends-chart.component';
import { HistoryChartStreamService, HISTORY_UNAVAILABLE } from '../../core/services/history-chart-stream.service';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { UnitsService } from '../../core/services/units.service';
import { DataService } from '../../core/services/data.service';
import { CanvasService } from '../../core/services/canvas.service';
import type { ITheme } from '../../core/services/app-service';
import type { IDatasetServiceDatapoint } from '../../core/interfaces/dataset.interfaces';
import type { IPathArray } from '../../core/interfaces/widgets-interface';

const themeMock = new Proxy({}, { get: () => '#000000' }) as unknown as ITheme;

// The merged config the widget runtime hands the component always carries the record-form `paths`
// (from DEFAULT_CONFIG or a user override). The runtime directive is mocked here, so the spec has to
// supply that record explicitly — a bare `{ timeScale, color }` would gate out both series.
const cloneDefaultPaths = (): IPathArray =>
  structuredClone(WidgetWindTrendsChartComponent.DEFAULT_CONFIG.paths) as IPathArray;

describe('WidgetWindTrendsChartComponent', () => {
  let fixture: ComponentFixture<WidgetWindTrendsChartComponent>;

  const runtimeMock = { options: vi.fn() };
  const historyMock = { getBackfillThenLive: vi.fn() };
  const unitsMock = {
    convertToUnit: (_unit: string, value: number) => value,
    resolvePathMeasure: () => 'knots',
    getUnitDisplaySymbol: (measure: string) => measure
  };
  // Speed measure resolution folds the path's meta subject; a single emission is enough to resolve it.
  const dataMock = { getPathMetaObservable: () => of(null) };
  const canvasMock = { registerCanvas: vi.fn(), releaseCanvas: vi.fn(), unregisterCanvas: vi.fn() };
  const breakpointMock = { observe: vi.fn().mockReturnValue(of({ matches: false, breakpoints: {} })) };

  const setup = async (timeScale = 'Last 30 Minutes', paths: IPathArray = cloneDefaultPaths()): Promise<void> => {
    runtimeMock.options.mockReturnValue({ timeScale, color: 'contrast', paths });

    await TestBed.configureTestingModule({
      imports: [WidgetWindTrendsChartComponent],
      providers: [
        { provide: WidgetRuntimeDirective, useValue: runtimeMock },
        { provide: HistoryChartStreamService, useValue: historyMock },
        { provide: UnitsService, useValue: unitsMock },
        { provide: DataService, useValue: dataMock },
        { provide: CanvasService, useValue: canvasMock },
        { provide: BreakpointObserver, useValue: breakpointMock }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(WidgetWindTrendsChartComponent);
    fixture.componentRef.setInput('id', 'w1');
    fixture.componentRef.setInput('type', 'widget-windtrends-chart');
    fixture.componentRef.setInput('theme', themeMock);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  // The "Data acquisition…" overlay's readiness gate is internal to the chart plugin; isChartReady is
  // its testable seam. Reads the component's live chart (both share the same datasets reference).
  const readiness = (): boolean => {
    const probe = fixture.componentInstance as unknown as { chart: unknown; isChartReady(chart: unknown): boolean };
    return probe.isChartReady(probe.chart);
  };

  // The big-number unit label is drawn inside the chart plugin (which the MockChart never invokes), so
  // its source — speedUnitSymbol() — is probed directly, the same private-seam pattern as readiness().
  const speedLabel = (): string =>
    (fixture.componentInstance as unknown as { speedUnitSymbol(): string }).speedUnitSymbol();

  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as unknown as CanvasRenderingContext2D);
    runtimeMock.options.mockReset();
    historyMock.getBackfillThenLive.mockReset().mockReturnValue(new Subject());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('opens two History streams — direction and speed — with the derived window params', async () => {
    await setup('Last 30 Minutes');

    expect(historyMock.getBackfillThenLive).toHaveBeenCalledTimes(2);
    const paths = historyMock.getBackfillThenLive.mock.calls.map(c => c[0].path);
    expect(paths).toContain('self.environment.wind.directionTrue');
    expect(paths).toContain('self.environment.wind.speedTrue');

    const params = historyMock.getBackfillThenLive.mock.calls[0][0];
    expect(params.source).toBe('default');
    // resolveWindowMs('Last 30 Minutes', 30) → 1_800_000ms → deriveDataSourceInfo: 3600 / 500 / 125.
    expect(params.windowMs).toBe(1_800_000);
    expect(params.sampleTime).toBe(3_600);
    expect(params.maxDataPoints).toBe(500);
    expect(params.smoothingPeriod).toBe(125);
  });

  it('handles a HISTORY_UNAVAILABLE emission on either stream without crashing', async () => {
    const dir = new Subject();
    const spd = new Subject();
    historyMock.getBackfillThenLive
      .mockReturnValueOnce(dir)
      .mockReturnValueOnce(spd);
    await setup('Last 30 Minutes');

    expect(() => dir.next(HISTORY_UNAVAILABLE)).not.toThrow();
    expect(() => spd.next(HISTORY_UNAVAILABLE)).not.toThrow();
  });

  it('plots direction and speed backfill batches without crashing', async () => {
    const dir = new Subject();
    const spd = new Subject();
    historyMock.getBackfillThenLive
      .mockReturnValueOnce(dir)
      .mockReturnValueOnce(spd);
    await setup('Last 30 Minutes');

    const batch: IDatasetServiceDatapoint[] = [
      { timestamp: 1000, data: { value: 10, sma: 10, lastAverage: 10, lastMinimum: 10, lastMaximum: 10 } },
      { timestamp: 2000, data: { value: 350, sma: 340, lastAverage: 345, lastMinimum: 10, lastMaximum: 350 } }
    ];
    expect(() => { dir.next(batch); spd.next(batch); }).not.toThrow();
  });

  it('converts the speed series with the server-resolved measure, not hardcoded knots', async () => {
    const dir = new Subject();
    const spd = new Subject();
    historyMock.getBackfillThenLive
      .mockReturnValueOnce(dir)
      .mockReturnValueOnce(spd);
    // Server prefers m/s for this speed path (as on the live boat); the widget must follow it.
    const resolveSpy = vi.spyOn(unitsMock, 'resolvePathMeasure').mockReturnValue('m/s');
    const convertSpy = vi.spyOn(unitsMock, 'convertToUnit');
    await setup('Last 30 Minutes');

    spd.next([
      { timestamp: 1000, data: { value: 5, sma: 5, lastAverage: 5, lastMinimum: 5, lastMaximum: 5 } }
    ]);

    expect(resolveSpy).toHaveBeenCalledWith('self.environment.wind.speedTrue');
    // Speed datasets are converted to the server-resolved measure ('m/s'), never the old hardcoded 'knots'.
    const speedConversionUnits = convertSpy.mock.calls.map(c => c[0]).filter(u => u !== 'deg');
    expect(speedConversionUnits).toContain('m/s');
    expect(speedConversionUnits).not.toContain('knots');
  });

  it('labels the speed readout with the server-resolved symbol, not a hardcoded kts', async () => {
    vi.spyOn(unitsMock, 'resolvePathMeasure').mockReturnValue('m/s');
    const symbolSpy = vi.spyOn(unitsMock, 'getUnitDisplaySymbol');
    await setup('Last 30 Minutes');

    expect(speedLabel()).toBe('m/s');
    expect(symbolSpy).toHaveBeenCalledWith('m/s');
  });

  it('shows base-SI values with no unit label when the server has no speed preference', async () => {
    const spd = new Subject();
    historyMock.getBackfillThenLive.mockReturnValueOnce(new Subject()).mockReturnValueOnce(spd);
    vi.spyOn(unitsMock, 'resolvePathMeasure').mockReturnValue('unitless');
    const convertSpy = vi.spyOn(unitsMock, 'convertToUnit');
    await setup('Last 30 Minutes');

    spd.next([{ timestamp: 1000, data: { value: 5, sma: 5, lastAverage: 5, lastMinimum: 5, lastMaximum: 5 } }]);

    // No client-side fallback: values pass through in base SI (convertToUnit('unitless') is identity),
    // never re-substituted to knots.
    const speedUnits = convertSpy.mock.calls.map(c => c[0]).filter(u => u !== 'deg');
    expect(speedUnits).toContain('unitless');
    expect(speedUnits).not.toContain('knots');
    // The readout is unlabeled rather than showing the raw 'unitless' key.
    expect(speedLabel()).toBe('');
  });

  it('re-resolves and rebuilds the speed series when the server displayUnits change', async () => {
    const metaSubject = new Subject<null>();
    vi.spyOn(dataMock, 'getPathMetaObservable').mockReturnValue(metaSubject);
    const resolveSpy = vi.spyOn(unitsMock, 'resolvePathMeasure').mockReturnValue('knots');
    const convertSpy = vi.spyOn(unitsMock, 'convertToUnit');
    const spd2 = new Subject();
    historyMock.getBackfillThenLive
      .mockReturnValueOnce(new Subject())   // initial direction stream
      .mockReturnValueOnce(new Subject())   // initial speed stream
      .mockReturnValueOnce(new Subject())   // rebuilt direction stream
      .mockReturnValueOnce(spd2);           // rebuilt speed stream

    await setup('Last 30 Minutes');
    const callsBefore = historyMock.getBackfillThenLive.mock.calls.length;

    // A late/changed displayUnits fires the path's meta subject; the resolved measure flips to m/s.
    resolveSpy.mockReturnValue('m/s');
    metaSubject.next(null);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // The measure change fed the rebuild signature and re-opened the streams…
    expect(historyMock.getBackfillThenLive.mock.calls.length).toBeGreaterThan(callsBefore);
    // …so new data now converts in the new unit rather than the stale knots.
    convertSpy.mockClear();
    spd2.next([{ timestamp: 3000, data: { value: 5, sma: 5, lastAverage: 5, lastMinimum: 5, lastMaximum: 5 } }]);
    const speedUnits = convertSpy.mock.calls.map(c => c[0]).filter(u => u !== 'deg');
    expect(speedUnits).toContain('m/s');
    expect(speedUnits).not.toContain('knots');
  });

  it('keeps TWD structural but TWS a display path, so the history dialog follows the server unit', () => {
    // The history dialog classifies a slot as structural (stored unit) vs display (server measure) by
    // showConvertUnitTo===false. TWS must stay a display path or the dialog pins to knots while the tile
    // shows the server unit — the lock-step break this fix closes.
    const paths = WidgetWindTrendsChartComponent.DEFAULT_CONFIG.paths as IPathArray;
    expect(paths.trueWindDirection.showConvertUnitTo).toBe(false);
    expect(paths.trueWindSpeed.showConvertUnitTo).toBeUndefined();
  });

  it('opens the History streams on the user-configured direction and speed paths', async () => {
    const paths = cloneDefaultPaths();
    paths.trueWindDirection.path = 'self.environment.wind.directionMagnetic';
    paths.trueWindDirection.source = 'vane1';
    paths.trueWindSpeed.path = 'self.navigation.speedOverGround';
    paths.trueWindSpeed.source = 'gps2';

    await setup('Last 30 Minutes', paths);

    expect(historyMock.getBackfillThenLive).toHaveBeenCalledTimes(2);
    const calls = historyMock.getBackfillThenLive.mock.calls.map(c => ({ path: c[0].path, source: c[0].source }));
    expect(calls).toContainEqual({ path: 'self.environment.wind.directionMagnetic', source: 'vane1' });
    expect(calls).toContainEqual({ path: 'self.navigation.speedOverGround', source: 'gps2' });
  });

  it('opens the direction stream only when the speed slot path is cleared', async () => {
    const paths = cloneDefaultPaths();
    paths.trueWindSpeed.path = null;

    await setup('Last 30 Minutes', paths);

    expect(historyMock.getBackfillThenLive).toHaveBeenCalledTimes(1);
    expect(historyMock.getBackfillThenLive.mock.calls[0][0].path).toBe('self.environment.wind.directionTrue');
  });

  it('opens the speed stream only when the direction slot path is cleared, and renders it', async () => {
    const spd = new Subject();
    historyMock.getBackfillThenLive.mockReturnValueOnce(spd);
    const paths = cloneDefaultPaths();
    paths.trueWindDirection.path = null;

    await setup('Last 30 Minutes', paths);

    expect(historyMock.getBackfillThenLive).toHaveBeenCalledTimes(1);
    expect(historyMock.getBackfillThenLive.mock.calls[0][0].path).toBe('self.environment.wind.speedTrue');

    const batch: IDatasetServiceDatapoint[] = [
      { timestamp: 1000, data: { value: 5, sma: 5, lastAverage: 5, lastMinimum: 5, lastMaximum: 5 } },
      { timestamp: 2000, data: { value: 7, sma: 6, lastAverage: 6, lastMinimum: 5, lastMaximum: 7 } }
    ];
    expect(() => spd.next(batch)).not.toThrow();
  });

  it('rebuilds the streams when a slot path changes after the initial render', async () => {
    await setup('Last 30 Minutes');
    expect(historyMock.getBackfillThenLive).toHaveBeenCalledTimes(2);

    const nextPaths = cloneDefaultPaths();
    nextPaths.trueWindSpeed.path = 'self.navigation.speedOverGround';
    runtimeMock.options.mockReturnValue({ timeScale: 'Last 30 Minutes', color: 'contrast', paths: nextPaths });

    // The runtime directive is a plain mock (options() is not a signal), so drive the rebuild effect
    // by changing a tracked input (theme); in the real app the merged-config signal re-fires directly.
    const nextTheme = new Proxy({}, { get: () => '#111111' }) as unknown as ITheme;
    fixture.componentRef.setInput('theme', nextTheme);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const streamedPaths = historyMock.getBackfillThenLive.mock.calls.map(c => c[0].path);
    expect(streamedPaths).toContain('self.navigation.speedOverGround');
    expect(historyMock.getBackfillThenLive.mock.calls.length).toBeGreaterThan(2);
  });

  it('clears the loading overlay once the only active series (direction) has data', async () => {
    const dir = new Subject();
    historyMock.getBackfillThenLive.mockReturnValueOnce(dir);
    const paths = cloneDefaultPaths();
    paths.trueWindSpeed.path = '';
    await setup('Last 30 Minutes', paths);

    expect(readiness()).toBe(false);
    dir.next([
      { timestamp: 1000, data: { value: 10, sma: 10, lastAverage: 10, lastMinimum: 10, lastMaximum: 10 } },
      { timestamp: 2000, data: { value: 20, sma: 15, lastAverage: 15, lastMinimum: 10, lastMaximum: 20 } }
    ]);
    expect(readiness()).toBe(true);
  });

  it('clears the loading overlay once the only active series (speed) has data', async () => {
    const spd = new Subject();
    historyMock.getBackfillThenLive.mockReturnValueOnce(spd);
    const paths = cloneDefaultPaths();
    paths.trueWindDirection.path = '';
    await setup('Last 30 Minutes', paths);

    expect(readiness()).toBe(false);
    spd.next([
      { timestamp: 1000, data: { value: 5, sma: 5, lastAverage: 5, lastMinimum: 5, lastMaximum: 5 } },
      { timestamp: 2000, data: { value: 7, sma: 6, lastAverage: 6, lastMinimum: 5, lastMaximum: 7 } }
    ]);
    expect(readiness()).toBe(true);
  });

  it('keeps the loading overlay when both slots are cleared (nothing configured)', async () => {
    const paths = cloneDefaultPaths();
    paths.trueWindDirection.path = '';
    paths.trueWindSpeed.path = '';
    await setup('Last 30 Minutes', paths);

    expect(historyMock.getBackfillThenLive).not.toHaveBeenCalled();
    expect(readiness()).toBe(false);
  });

  it('keeps the loading overlay until both configured series have data', async () => {
    const dir = new Subject();
    const spd = new Subject();
    historyMock.getBackfillThenLive
      .mockReturnValueOnce(dir)
      .mockReturnValueOnce(spd);
    await setup('Last 30 Minutes');

    dir.next([
      { timestamp: 1000, data: { value: 10, sma: 10, lastAverage: 10, lastMinimum: 10, lastMaximum: 10 } },
      { timestamp: 2000, data: { value: 20, sma: 15, lastAverage: 15, lastMinimum: 10, lastMaximum: 20 } }
    ]);
    expect(readiness()).toBe(false);

    spd.next([
      { timestamp: 1000, data: { value: 5, sma: 5, lastAverage: 5, lastMinimum: 5, lastMaximum: 5 } },
      { timestamp: 2000, data: { value: 7, sma: 6, lastAverage: 6, lastMinimum: 5, lastMaximum: 7 } }
    ]);
    expect(readiness()).toBe(true);
  });
});
