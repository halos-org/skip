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
    TimeScale: {}, LinearScale: {}, LineController: {}, PointElement: {},
    LineElement: {}, Filler: {}, Title: {}, SubTitle: {}
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
  const unitsMock = { convertToUnit: (_unit: string, value: number) => value };
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

  it('routes a stale chartEngine:"recorder" config to the History engine (field ignored)', async () => {
    await setup(makeConfig({ chartEngine: 'recorder' }));
    expect(historyMock.getBackfillThenLive).toHaveBeenCalled();
  });

  it('renders the "History data unavailable" empty state on a HISTORY_UNAVAILABLE emission', async () => {
    const emissions$ = new Subject<typeof HISTORY_UNAVAILABLE>();
    historyMock.getBackfillThenLive.mockReturnValue(emissions$);

    await setup(makeConfig({ chartEngine: 'history' }));
    expect(historyMock.getBackfillThenLive).toHaveBeenCalled();

    emissions$.next(HISTORY_UNAVAILABLE);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('History data unavailable');
  });
});
