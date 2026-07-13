import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Chart.js and its plugins cannot instantiate under jsdom. Mock them self-contained (no
// importOriginal, no outer references) so the vi.mock hoisting does not trip a TDZ. The mock
// Chart carries a truthy `ctx` so the streaming callback's ctx guard passes.
vi.mock('chart.js', () => {
  class MockChart {
    public static register(): void { /* noop */ }
    public ctx = {};
    public data: { datasets: { data: unknown[] }[] };
    public options: unknown;
    constructor(_ctx: unknown, config: { data: { datasets: { data: unknown[] }[] }; options: unknown }) {
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
    LineElement: {}, Filler: {}, CategoryScale: {}
  };
});
vi.mock('chartjs-adapter-date-fns', () => ({}));
vi.mock('chartjs-plugin-annotation', () => ({ default: {} }));
vi.mock('@aziham/chartjs-plugin-streaming', () => ({ default: {} }));

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { MinichartComponent } from './minichart.component';
import { HistoryChartStreamService, HISTORY_UNAVAILABLE } from '../../core/services/history-chart-stream.service';
import { UnitsService } from '../../core/services/units.service';
import { CanvasService } from '../../core/services/canvas.service';
import type { ITheme } from '../../core/services/app-service';
import type { IDatasetServiceDatapoint } from '../../core/interfaces/dataset.interfaces';

const themeMock = new Proxy({}, { get: () => '#000000' }) as unknown as ITheme;

function chartValueData(component: MinichartComponent): unknown[] {
  return (component as unknown as { chart: { data: { datasets: { data: unknown[] }[] } } }).chart.data.datasets[0].data;
}

describe('MinichartComponent', () => {
  let fixture: ComponentFixture<MinichartComponent>;
  let component: MinichartComponent;
  const historyMock = { getBackfillThenLive: vi.fn() };
  const unitsMock = { convertToUnit: (_unit: string, value: number) => value };
  const canvasMock = { releaseCanvas: vi.fn() };

  beforeEach(async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as unknown as CanvasRenderingContext2D);
    historyMock.getBackfillThenLive.mockReset().mockReturnValue(new Subject());

    await TestBed.configureTestingModule({
      imports: [MinichartComponent],
      providers: [
        { provide: HistoryChartStreamService, useValue: historyMock },
        { provide: UnitsService, useValue: unitsMock },
        { provide: CanvasService, useValue: canvasMock }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(MinichartComponent);
    fixture.componentRef.setInput('theme', themeMock);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('streams from the History engine using the fixed 12s mini-chart window', () => {
    component.dataPath = 'self.navigation.speedOverGround';
    component.dataSource = 'default';
    component.startChart();

    expect(historyMock.getBackfillThenLive).toHaveBeenCalledTimes(1);
    const params = historyMock.getBackfillThenLive.mock.calls[0][0];
    expect(params.path).toBe('self.navigation.speedOverGround');
    expect(params.source).toBe('default');
    // resolveWindowMs('minute', 0.2) → deriveDataSourceInfo: 12000ms / 100ms / 120pts / smoothing 30.
    expect(params.windowMs).toBe(12_000);
    expect(params.sampleTime).toBe(100);
    expect(params.maxDataPoints).toBe(120);
    expect(params.smoothingPeriod).toBe(30);
  });

  it('does not stream without a data path', () => {
    component.dataPath = null;
    component.startChart();
    expect(historyMock.getBackfillThenLive).not.toHaveBeenCalled();
  });

  it('handles a HISTORY_UNAVAILABLE emission cleanly (empty sparkline, no crash)', () => {
    const stream = new Subject();
    historyMock.getBackfillThenLive.mockReturnValue(stream);
    component.dataPath = 'self.navigation.speedOverGround';
    component.startChart();

    expect(() => stream.next(HISTORY_UNAVAILABLE)).not.toThrow();
    expect(chartValueData(component).length).toBe(0);
  });

  it('plots a backfill batch and then a live point off the history stream', () => {
    const stream = new Subject();
    historyMock.getBackfillThenLive.mockReturnValue(stream);
    component.dataPath = 'self.navigation.speedOverGround';
    component.startChart();

    const batch: IDatasetServiceDatapoint[] = [
      { timestamp: 1000, data: { value: 1 } },
      { timestamp: 2000, data: { value: 2 } }
    ];
    stream.next(batch);
    stream.next({ timestamp: 3000, data: { value: 3 } });

    expect(chartValueData(component).length).toBe(3);
  });
});
