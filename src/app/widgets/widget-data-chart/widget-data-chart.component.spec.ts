import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Chart.js (and its plugins) cannot instantiate under jsdom. Mock them self-contained — no
// importOriginal, and mock the plugin modules too — so the factory has no outer references that
// would trip the vi.mock hoisting TDZ and break the rest of the suite. Kept above every other
// import so the source order matches the hoisted execution order.
vi.mock('chart.js', () => {
  class MockChart {
    public static register(): void { /* noop */ }
    // registerChartComponents() sets a line-element default join style on this.
    public static defaults = { elements: { line: {} } };
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

import { signal } from '@angular/core';
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

  // A real signal, not a vi.fn: the component tracks runtime.options() inside computed/effect, so a
  // config edit only reaches the rebuild path when the source is reactive — which is what the live
  // WidgetRuntimeDirective provides.
  const options = signal<IWidgetSvcConfig | undefined>(undefined);
  const runtimeMock = { options };
  const historyMock = { getBackfillThenLive: vi.fn() };
  const unitsMock = { convertToUnit: (_unit: string, value: number) => value, getUnitDisplaySymbol: (measure: string) => measure, resolvePathMeasure: () => 'knots' };
  const canvasMock = { releaseCanvas: vi.fn() };

  const setup = async (config: IWidgetSvcConfig): Promise<void> => {
    options.set(config);

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
    options.set(undefined);
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

  interface SubtitleState { display?: boolean; text?: string }
  const readSubtitle = (): SubtitleState | undefined =>
    (fixture.componentInstance.lineChartOptions.plugins as unknown as {
      subtitle?: SubtitleState;
    }).subtitle;

  interface AxisState {
    type?: string;
    ticks?: { mirror?: boolean; padding?: number; textStrokeColor?: string; textStrokeWidth?: number; color?: string };
    grid?: { display?: boolean; drawTicks?: boolean };
    title?: { display?: boolean };
  }
  const readAxis = (id: 'x' | 'y'): AxisState | undefined =>
    (fixture.componentInstance.lineChartOptions.scales as unknown as Record<string, AxisState>)[id];

  it('states the plot window on the widget label, not on a time-axis title', async () => {
    await setup(makeConfig({ displayName: 'SOG', timeScale: 'second', period: 30, showTimeScale: true }));

    // The axis title cost the plot a whole row to say this; the label says it in four characters.
    // Nothing else carries the window, so the suffix is the only indicator the user has left.
    expect(readSubtitle()?.text).toContain('SOG (30 s)');
    expect(readAxis('x')?.title?.display ?? false).toBe(false);
  });

  it('keeps the plot window on screen when the widget label is hidden', async () => {
    // The removed axis title rendered independently of Show Label, so hiding the name must not
    // take the window with it.
    await setup(makeConfig({ displayName: 'SOG', timeScale: 'minute', period: 10, showLabel: false }));

    const subtitle = readSubtitle();
    expect(subtitle?.display).toBe(true);
    expect(subtitle?.text?.trim()).toBe('(10 min)');
    expect(subtitle?.text).not.toContain('SOG');
  });

  it('falls back to the bare label for a legacy time scale with no abbreviation', async () => {
    // Stored configs can still carry the pre-migration TimeScaleFormat members. A full Record or a
    // `?? format` default would render "SOG (30 Last 30 Minutes)" on those.
    await setup(makeConfig({ displayName: 'SOG', timeScale: 'Last 30 Minutes', period: 30 }));

    expect(readSubtitle()?.text?.trim()).toBe('SOG');
  });

  it.each([
    { orientation: 'horizontal', verticalChart: false },
    { orientation: 'vertical', verticalChart: true }
  ])('draws both axes\' ticks inside the plot in the $orientation layout', async ({ verticalChart }) => {
    // The same options are spread into four separate axis blocks, two per orientation. One block
    // losing them reintroduces the label gutter for that orientation alone, which no dashboard
    // review would catch until someone opens a chart in that layout.
    await setup(makeConfig({ verticalChart, showTimeScale: true, showYScale: true }));

    for (const axis of [readAxis('x'), readAxis('y')]) {
      expect(axis?.ticks?.mirror).toBe(true);
      expect(axis?.ticks?.textStrokeColor).toBeTruthy();
      expect(axis?.ticks?.textStrokeWidth).toBeGreaterThan(0);
      expect(axis?.grid?.display).toBe(true);
      expect(axis?.grid?.drawTicks).toBe(false);
    }
  });

  it('rebuilds the chart when the orientation is toggled', async () => {
    const emissions$ = new Subject<IDatasetServiceDatapoint>();
    historyMock.getBackfillThenLive.mockReturnValue(emissions$);

    await setup(makeConfig({ verticalChart: false, showTimeScale: true, showYScale: true }));
    emissions$.next({ timestamp: 1000, data: { value: 5 } });

    expect(readAxis('x')?.type).toBe('realtime');
    expect(fixture.componentInstance.lineChartData.datasets[0].data.length).toBeGreaterThan(0);
    const streamsBefore = historyMock.getBackfillThenLive.mock.calls.length;

    options.set(makeConfig({ verticalChart: true, showTimeScale: true, showYScale: true }));
    fixture.detectChanges();
    await fixture.whenStable();

    // Swapping the orientation swaps which axis carries time. transformDatasetRows only transposes
    // rows as they arrive, so anything already buffered plots as garbage — up to a 365-day window —
    // unless the toggle goes through the full rebuild rather than an in-place options update.
    expect(readAxis('y')?.type).toBe('realtime');
    expect(fixture.componentInstance.lineChartData.datasets[0].data.length).toBe(0);
    expect(historyMock.getBackfillThenLive.mock.calls.length).toBeGreaterThan(streamsBefore);
  });

  it('keeps the per-axis tick colour when the shared inside-tick options are applied', async () => {
    // The shared options carry text-styling keys and are spread first, so a later `color` or `font`
    // added to them cannot silently win over the per-axis value in four places. A theme that names
    // each key separates the two: the ink is the axis colour, the halo is the card colour.
    await setup(makeConfig({ showTimeScale: true, showYScale: true }));
    fixture.componentRef.setInput('theme', new Proxy({}, { get: (_t, key) => String(key) }) as unknown as ITheme);
    fixture.detectChanges();
    await fixture.whenStable();

    for (const axis of [readAxis('x'), readAxis('y')]) {
      expect(axis?.ticks?.color).toBe('contrastDim');
      expect(axis?.ticks?.textStrokeColor).toBe('cardColor');
    }
  });

  it('draws the value line with a hair of tension so it avoids the fast pixel-bucketing path', async () => {
    await setup(makeConfig());

    // tension 0 routes the line onto Chart.js fastPathSegment, whose per-pixel-column collapse
    // shimmers under the streaming plugin's per-frame re-path. A tiny non-zero tension keeps it on
    // the exact-position path; it must stay non-zero (and visually straight) to avoid a regression.
    const valueDataset = fixture.componentInstance.lineChartData.datasets[0];
    expect(valueDataset.label).toBe('Value');
    expect(valueDataset.tension ?? 0).toBeGreaterThan(0);
    expect(valueDataset.tension ?? 1).toBeLessThan(0.01);
  });
});
