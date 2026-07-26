import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Chart.js (and its plugins) cannot instantiate under jsdom. Mock them self-contained — no
// importOriginal, and mock the plugin modules too — so the factory has no outer references that
// would trip the vi.mock hoisting TDZ and break the rest of the suite. Kept above every other
// import so the source order matches the hoisted execution order.
vi.mock('chart.js', () => {
  class MockChart {
    public static register(): void { /* noop */ }
    public data: unknown;
    public options: unknown;
    constructor(_ctx: unknown, config: { data: unknown; options: unknown }) {
      this.data = config.data;
      this.options = config.options;
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
vi.mock('chartjs-plugin-annotation', () => ({ default: {} }));
vi.mock('chartjs-adapter-date-fns', () => ({}));
vi.mock('@aziham/chartjs-plugin-streaming', () => ({ default: {} }));

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EMPTY, Subject } from 'rxjs';
import { WidgetDataChartComponent } from './widget-data-chart.component';
import { IWidgetSvcConfig } from '../../core/interfaces/widgets-interface';
import { HistoryChartStreamService, HISTORY_UNAVAILABLE } from '../../core/services/history-chart-stream.service';
import type { IDatasetServiceDatapoint } from '../../core/interfaces/dataset.interfaces';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { UnitsService } from '../../core/services/units.service';
import { CanvasService } from '../../core/services/canvas.service';
import type { ITheme } from '../../core/services/app-service';

// Any color property the chart-options builder reads resolves to a valid string.
const themeMock = new Proxy({}, { get: () => '#000000' }) as unknown as ITheme;

const makeConfig = (overrides: Partial<IWidgetSvcConfig> = {}): IWidgetSvcConfig => ({
  ...WidgetDataChartComponent.DEFAULT_CONFIG,
  datachartPath: 'self.navigation.speedOverGround',
  color: 'contrast',
  ...overrides
});

describe('WidgetDataChartComponent', () => {
  let fixture: ComponentFixture<WidgetDataChartComponent>;

  const runtimeMock = { options: vi.fn() };
  const historyMock = { getBackfillThenLive: vi.fn() };
  const unitsMock = { convertToUnit: (_unit: string, value: number) => value, getUnitDisplaySymbol: (measure: string) => measure, resolvePathMeasure: () => 'knots' };
  const canvasMock = { releaseCanvas: vi.fn() };

  const setup = async (config: IWidgetSvcConfig): Promise<void> => {
    runtimeMock.options.mockReturnValue(config);

    await TestBed.configureTestingModule({
      imports: [WidgetDataChartComponent],
      providers: [
        { provide: WidgetRuntimeDirective, useValue: runtimeMock },
        { provide: HistoryChartStreamService, useValue: historyMock },
        { provide: UnitsService, useValue: unitsMock },
        { provide: CanvasService, useValue: canvasMock }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(WidgetDataChartComponent);
    fixture.componentRef.setInput('id', 'w1');
    fixture.componentRef.setInput('type', 'widget-data-chart');
    fixture.componentRef.setInput('theme', themeMock);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({} as unknown as CanvasRenderingContext2D);
    runtimeMock.options.mockReset();
    historyMock.getBackfillThenLive.mockReset().mockReturnValue(EMPTY);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it('streams from the History engine — the only engine', async () => {
    await setup(makeConfig());
    expect(historyMock.getBackfillThenLive).toHaveBeenCalled();
  });

  it('renders the "History data unavailable" empty state on a HISTORY_UNAVAILABLE emission', async () => {
    const emissions$ = new Subject<typeof HISTORY_UNAVAILABLE>();
    historyMock.getBackfillThenLive.mockReturnValue(emissions$);

    await setup(makeConfig());
    expect(historyMock.getBackfillThenLive).toHaveBeenCalled();

    emissions$.next(HISTORY_UNAVAILABLE);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('History data unavailable');
  });

  interface AnnLineState { display?: boolean; value?: number; label?: { display?: boolean; content?: string } }
  const readAnnotation = (name: string): AnnLineState | undefined =>
    (fixture.componentInstance.lineChartOptions.plugins as unknown as {
      annotation?: { annotations?: Record<string, AnnLineState> };
    }).annotation?.annotations?.[name];

  it('keeps an enabled annotation line hidden while its value is non-finite, then reveals it once finite', async () => {
    const emissions$ = new Subject<IDatasetServiceDatapoint>();
    historyMock.getBackfillThenLive.mockReturnValue(emissions$);

    // Average line enabled, but the rolling average is not yet available: the finite gate — not the
    // enabled flag — must keep the line and its label hidden (drops if Number.isFinite is removed).
    await setup(makeConfig({ showDatasetAverageValueLine: true, numDecimal: 1 }));

    emissions$.next({ timestamp: 1000, data: { value: 5 } });

    let averageLine = readAnnotation('averageLine');
    expect(averageLine?.display).toBe(false);
    expect(averageLine?.label?.display).toBe(false);

    // A finite average now streams: the same line becomes visible with the formatted content.
    emissions$.next({ timestamp: 2000, data: { value: 7, lastAverage: 7 } });

    averageLine = readAnnotation('averageLine');
    expect(averageLine?.display).toBe(true);
    expect(averageLine?.label?.display).toBe(true);
    expect(averageLine?.label?.content).toBe('7.0');
  });

  it('keeps an already-enabled annotation line visible after a theme change with data present', async () => {
    const emissions$ = new Subject<IDatasetServiceDatapoint>();
    historyMock.getBackfillThenLive.mockReturnValue(emissions$);

    await setup(makeConfig({ showDatasetAverageValueLine: true, numDecimal: 1 }));

    emissions$.next({ timestamp: 1000, data: { value: 5, lastAverage: 5 } });
    expect(readAnnotation('averageLine')?.display).toBe(true);

    // A theme change re-runs the display/theme effect, which rebuilds the annotation plugin via
    // setChartOptions; the enabled line must survive that rebuild rather than blanking until the
    // next emission.
    fixture.componentRef.setInput('theme', new Proxy({}, { get: () => '#111111' }) as unknown as ITheme);
    fixture.detectChanges();
    await fixture.whenStable();

    const averageLine = readAnnotation('averageLine');
    expect(averageLine?.display).toBe(true);
    expect(averageLine?.label?.display).toBe(true);
    expect(averageLine?.label?.content).toBe('5.0');
  });

  const readTitle = (): string | undefined =>
    (fixture.componentInstance.lineChartOptions.plugins as unknown as {
      title?: { text?: string };
    }).title?.text;

  it('labels the value from the path-resolved measure, not the stored convertUnitTo', async () => {
    const emissions$ = new Subject<IDatasetServiceDatapoint>();
    historyMock.getBackfillThenLive.mockReturnValue(emissions$);

    // Stored convertUnitTo is stale; the server-resolved measure for the path is the single source of
    // both the conversion and its display symbol, so the label must follow resolvePathMeasure.
    const resolveSpy = vi.spyOn(unitsMock, 'resolvePathMeasure').mockReturnValue('knots');

    await setup(makeConfig({ convertUnitTo: 'celsius', numDecimal: 1 }));

    emissions$.next({ timestamp: 1000, data: { value: 5 } });

    expect(resolveSpy).toHaveBeenCalledWith('self.navigation.speedOverGround');
    const title = readTitle();
    expect(title).toContain('knots');
    expect(title).not.toContain('celsius');
  });

  // A 91-sample batch spanning 90s of the default 600s window. Reused by the thinning tests below.
  const denseBatch = (): IDatasetServiceDatapoint[] => {
    const batch: IDatasetServiceDatapoint[] = [];
    for (let t = 0; t <= 90_000; t += 1_000) batch.push({ timestamp: t, data: { value: t / 1_000 } });
    return batch;
  };
  const drawnCount = (): number => fixture.componentInstance.lineChartData.datasets[0].data.length;

  it('thins a dense batch to about one point per pixel on a narrow plot', async () => {
    const emissions$ = new Subject<IDatasetServiceDatapoint[]>();
    historyMock.getBackfillThenLive.mockReturnValue(emissions$);
    await setup(makeConfig({ showAverageData: false }));

    // A measured 20px plot over the 600s window buckets to 30s, so the 91-sample / 90s batch
    // collapses to one evenly spaced point per bucket instead of shimmering at ~2.6 samples/px.
    (fixture.componentInstance as unknown as { chart: { chartArea: unknown } }).chart.chartArea =
      { width: 20, height: 20, left: 0, right: 20, top: 0, bottom: 20 };

    const batch = denseBatch();
    emissions$.next(batch);

    expect(drawnCount()).toBeLessThan(batch.length);
    expect(drawnCount()).toBeGreaterThanOrEqual(3);
    expect(drawnCount()).toBeLessThanOrEqual(5);
  });

  it('draws every sample when the plot has not been measured (thinning is inert)', async () => {
    const emissions$ = new Subject<IDatasetServiceDatapoint[]>();
    historyMock.getBackfillThenLive.mockReturnValue(emissions$);
    await setup(makeConfig({ showAverageData: false }));

    // No chartArea on the mock chart -> displayBucketMs stays 0 -> every sample is drawn.
    const batch = denseBatch();
    emissions$.next(batch);

    expect(drawnCount()).toBe(batch.length);
  });
});
