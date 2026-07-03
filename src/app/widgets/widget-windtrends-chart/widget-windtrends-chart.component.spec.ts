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
    TimeScale: {}, LinearScale: {}, LineController: {}, PointElement: {},
    LineElement: {}, Filler: {}, Title: {}, SubTitle: {}
  };
});
vi.mock('chartjs-adapter-date-fns', () => ({}));
vi.mock('@aziham/chartjs-plugin-streaming', () => ({ default: {} }));

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { BreakpointObserver } from '@angular/cdk/layout';
import { WidgetWindTrendsChartComponent } from './widget-windtrends-chart.component';
import { HistoryChartStreamService, HISTORY_UNAVAILABLE } from '../../core/services/history-chart-stream.service';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { UnitsService } from '../../core/services/units.service';
import { CanvasService } from '../../core/services/canvas.service';
import type { ITheme } from '../../core/services/app-service';
import type { IDatasetServiceDatapoint } from '../../core/interfaces/dataset.interfaces';

const themeMock = new Proxy({}, { get: () => '#000000' }) as unknown as ITheme;

describe('WidgetWindTrendsChartComponent', () => {
  let fixture: ComponentFixture<WidgetWindTrendsChartComponent>;

  const runtimeMock = { options: vi.fn() };
  const historyMock = { getBackfillThenLive: vi.fn() };
  const unitsMock = { convertToUnit: (_unit: string, value: number) => value };
  const canvasMock = { registerCanvas: vi.fn(), releaseCanvas: vi.fn(), unregisterCanvas: vi.fn() };
  const breakpointMock = { observe: vi.fn().mockReturnValue(of({ matches: false, breakpoints: {} })) };

  const setup = async (timeScale = 'Last 30 Minutes'): Promise<void> => {
    runtimeMock.options.mockReturnValue({ timeScale, color: 'contrast' });

    await TestBed.configureTestingModule({
      imports: [WidgetWindTrendsChartComponent],
      providers: [
        { provide: WidgetRuntimeDirective, useValue: runtimeMock },
        { provide: HistoryChartStreamService, useValue: historyMock },
        { provide: UnitsService, useValue: unitsMock },
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
});
