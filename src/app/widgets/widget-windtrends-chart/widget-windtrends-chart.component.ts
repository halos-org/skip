import { Component, OnDestroy, ElementRef, viewChild, inject, effect, NgZone, input, untracked, computed, Signal, ChangeDetectionStrategy } from '@angular/core';
import { BreakpointObserver, Breakpoints, BreakpointState } from '@angular/cdk/layout';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { IWidgetSvcConfig, IWidgetPath } from '../../core/interfaces/widgets-interface';
import { HistoryChartStreamService, IHistoryChartStreamParams, isHistoryUnavailable } from '../../core/services/history-chart-stream.service';
import { IDatasetServiceDatapoint } from '../../core/interfaces/dataset.interfaces';
import { resolveWindowMs, deriveDataSourceInfo, IChartDataSourceInfo } from '../../core/utils/chart-window.util';
import { Subscription, distinctUntilChanged, map, of, switchMap } from 'rxjs';
import { CanvasService } from '../../core/services/canvas.service';
import { DataService } from '../../core/services/data.service';
import { UnitsService } from '../../core/services/units.service';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { ITheme } from '../../core/services/app-service';
import { TimeScaleFormat } from '../../core/interfaces/dataset.interfaces';

import { Chart, ChartConfiguration, ChartData, ChartType, ChartArea, Scale, ChartTypeRegistry } from 'chart.js';
import 'chartjs-adapter-date-fns';
import { registerChartComponents } from '../../core/utils/chart-registration.util';

registerChartComponents();

/** Rolling-window period (in the widget's time-scale units) the trend backfill/live streams span. */
const WINDTRENDS_PERIOD = 30;

interface IChartColors {
  valueLine: string | null,
  valueFill: string | null,
  averageLine: string | null,
  averageFill: string | null,
  averageChartLine: string | null,
  chartLabel: string | null,
  chartValue: string | null
}
interface IDataSetRow {
  x: number,
  y: number,     // age in ms (computed each update), or temporary ts at insert
  ts?: number    // original timestamp in ms, used to recompute age
}

@Component({
  selector: 'widget-windtrends-chart',
  templateUrl: './widget-windtrends-chart.component.html',
  styleUrl: './widget-windtrends-chart.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WidgetWindTrendsChartComponent implements OnDestroy {
  // Host2 functional inputs
  public id = input.required<string>();
  public type = input.required<string>();
  public theme = input.required<ITheme | null>();
  // Runtime directive (merged config) provided by Host2
  private readonly runtime = inject(WidgetRuntimeDirective, { optional: true });
  // Static default config consumed by Host2 runtime merge
  public static readonly DEFAULT_CONFIG: IWidgetSvcConfig = {
    filterSelfPaths: true,
    color: 'contrast',
    timeScale: 'Last 30 Minutes',
    // TWD is STRUCTURAL: fixed to degrees (showConvertUnitTo:false) because the widget's angle-wrap and
    // tick math are degree-native — the history dialog keeps it in degrees too. TWS is a DISPLAY path:
    // it follows the server's displayUnits preference, resolved at render like widget-data-chart (and by
    // the history dialog via resolvePathMeasure), so it must NOT carry showConvertUnitTo:false — that
    // flag would pin the dialog to the stored knots while the tile shows the server unit. Skip owns no
    // per-widget speed unit; convertUnitTo:'knots' is an inert stored default kept to match the other
    // wind widgets. showPathSkUnitsFilter:false hides the unit-filter on both slots.
    paths: {
      trueWindDirection: {
        description: 'True Wind Direction',
        path: 'self.environment.wind.directionTrue',
        source: 'default',
        pathType: 'number',
        isPathConfigurable: true,
        pathRequired: false,
        showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 'rad',
        convertUnitTo: 'deg',
        showConvertUnitTo: false,
        sampleTime: 1000
      },
      trueWindSpeed: {
        description: 'True Wind Speed',
        path: 'self.environment.wind.speedTrue',
        source: 'default',
        pathType: 'number',
        isPathConfigurable: true,
        pathRequired: false,
        showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 'm/s',
        convertUnitTo: 'knots',
        sampleTime: 1000
      }
    }
  };
  private readonly ngZone = inject(NgZone);
  private readonly historyStream = inject(HistoryChartStreamService);
  private readonly canvasService = inject(CanvasService);
  private readonly unitsService = inject(UnitsService);
  private readonly dataService = inject(DataService);
  private readonly responsive = inject(BreakpointObserver);
  protected isPhonePortrait: Signal<BreakpointState>;
  /** Configured wind-speed path (record-form slot), or null when the slot is cleared. */
  private readonly speedPath = computed<string | null>(() =>
    this.windPathSlot(this.runtime?.options(), 'trueWindSpeed')?.path ?? null);
  /**
   * Server-resolved display measure for the wind-speed series. resolvePathMeasure() reads a non-signal
   * meta cache, so it is folded through the path's meta subject to re-emit when the server's
   * displayUnits land late or change; that change flows into computeRebuildSignature and rebuilds the
   * chart in the new unit. Mirrors widget-data-chart's reactive pathMeasure. The actual conversion and
   * label read the resolved measure directly at build time (see speedMeasureKey).
   */
  private readonly speedMeasure = toSignal(
    toObservable(this.speedPath).pipe(
      switchMap(path => path
        ? this.dataService.getPathMetaObservable(path).pipe(map(() => this.unitsService.resolvePathMeasure(path)))
        : of<string | undefined>(undefined)),
      distinctUntilChanged()
    )
  );
  readonly widgetDataChart = viewChild('widgetDataChart', { read: ElementRef });
  public lineChartData: ChartData<'line', { x: number, y: number }[]> = {
    datasets: []
  };
  public lineChartOptions: NonNullable<ChartConfiguration['options']> = {
    parsing: false,
    datasets: {
      line: {
        pointRadius: 0,
        pointHoverRadius: 0,
        tension: 0.3,
      }
    },
    animations: {
      tension: {
        easing: "easeInOutCubic"
      }
    }
  }
  public lineChartType: ChartType = 'line';
  private chart: Chart<keyof ChartTypeRegistry, { x: number; y: number; }[], unknown>;
  private _dsDirectionSub: Subscription | null = null;
  private _dsSpeedSub: Subscription | null = null;
  /** Pending coalesced chart recompute+repaint frame id (one per animation frame across both streams). */
  private _chartUpdateRafId: number | null = null;
  private timeScale: TimeScaleFormat | null = null;
  /** Signature of the last inputs a full rebuild was performed for (see computeRebuildSignature). */
  private previousRebuildSignature: string | undefined = undefined;
  /** Whether each series has a configured (non-empty) path, i.e. is expected to stream. Set by
   * startStreaming and read by the overlay-readiness gate so a cleared slot is not awaited forever. */
  private dirSeriesActive = false;
  private spdSeriesActive = false;
  /** Server-resolved display measure applied to the speed datasets + big-number label; null when no
   *  speed path. Re-resolved on each (re)build, so a late/changed displayUnits reconverts the series. */
  private speedMeasureKey: string | null = null;
  private dataSourceInfo: IChartDataSourceInfo | null = null;
  private xCenter: number | null = null;
  private xStep: number | null = null;
  private xCenterSpeed: number | null = null;
  private xStepSpeed: number | null = null;
  // Visual constants
  private readonly CENTER_LINE_WIDTH = 4;
  private readonly GRID_LINE_WIDTH = 1;
  private readonly EDGE_EXTEND_UP_PX = 42; // extension height above top scale
  private readonly EDGE_SPEED_LABEL_OFFSET = 5; // px left shift for rightmost speed label
  private readonly EDGE_DIR_LABEL_OFFSET = 5;   // px right shift for leftmost direction label
  private readonly TICK_LABEL_FONT_SIZE = 20;
  private readonly TICK_LABEL_PHONE_PORTRAIT_FONT_SIZE = 11;
  private readonly CENTER_LABEL_FONT_SIZE = 22;
  private readonly CENTER_LABEL_PHONE_PORTRAIT_FONT_SIZE = 13;
  private readonly SPEED_VALUE_FONT_SIZE = 62;
  private readonly SPEED_VALUE_PHONE_PORTRAIT_FONT_SIZE = 32;
  private readonly TOP_VALUE_Y_OFFSET = 62;     // px above area.top for big top values
  private readonly TOP_VALUE_PHONE_PORTRAIT_Y_OFFSET = 44;     // px above area.top for big top values
  private readonly TOP_UNIT_Y_OFFSET = 51;      // px above area.top for units
  private readonly TOP_UNIT_PHONE_PORTRAIT_Y_OFFSET = 38;      // px above area.top for units
  private readonly UNIT_FONT_SIZE = 28;
  private readonly UNIT_PHONE_PORTRAIT_FONT_SIZE = 14;
  private readonly UNIT_PADDING = 8;            // px between speed value and 'kts'
  private readonly UNIT_PHONE_PORTRAIT_PADDING = 3;            // px between speed value and 'kts'

  // Paint background under grid lines (chartArea only) so it appears beneath grids
  private gridBackgroundPlugin = {
    id: 'xSpeedGridBackground',
    beforeDraw: (chart: Chart) => {
      const area = chart.chartArea as ChartArea | undefined;
      if (!area) return;
      const ctx = chart.ctx as CanvasRenderingContext2D;
      const theme = this.theme();
      if (!theme) return;
      ctx.save();
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = theme.background;
      // Fill exactly the plotting area where grid lines are drawn
      ctx.fillRect(area.left, area.top, area.width / 2, area.height);
      ctx.restore();
    }
  };
  private centerTickPlugin = {
    id: 'centerTickStyle',
    afterDraw: (chart) => {
      const ctx = chart.ctx as CanvasRenderingContext2D;
      const area = chart.chartArea as ChartArea;
      const theme = this.theme();
      if (!theme) return;
      const chartColors = this.getThemeColors();
      const def = Chart.defaults.font;
      const scaleMap = chart.scales as Record<string, Scale | undefined>;
      const optScales = chart.options?.scales as Record<string, { min?: number; max?: number }> | undefined;

      // Loading overlay flag; do not skip drawings so all lines are visible on load
      const ready = this.isChartReady(chart);

      const drawForAxis = (axisKey: 'x' | 'xSpeed', format: (v: number) => string) => {
        const scale = scaleMap?.[axisKey] as (Scale | undefined);
        const scales = optScales;
        if (!scale) return;
        // Use configured min/max if present, else fall back to built scale bounds
        const sAny = scale as unknown as { min?: number; max?: number };
        const min = (scales?.[axisKey]?.min as number | undefined) ?? sAny.min;
        const max = (scales?.[axisKey]?.max as number | undefined) ?? sAny.max;
        if (typeof min !== 'number' || typeof max !== 'number' || !isFinite(min) || !isFinite(max)) return;
        const center = (min + max) / 2;
        const px = scale.getPixelForValue(center);
        ctx.save();
        // Center guideline for the given axis
        ctx.strokeStyle = theme.contrastDim;
        ctx.lineWidth = this.CENTER_LINE_WIDTH;
        ctx.beginPath();
        ctx.moveTo(px, area.top);
        ctx.lineTo(px, area.bottom);
        ctx.stroke();
        ctx.restore();
        ctx.save();
        ctx.fillStyle = theme.contrastDim;
        ctx.font = this.isPhonePortrait().matches ? `bold ${this.CENTER_LABEL_PHONE_PORTRAIT_FONT_SIZE}px ${def.family}` : `bold ${this.CENTER_LABEL_FONT_SIZE}px ${def.family}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const y = this.axisTopLabelY(scale);
        ctx.fillText(format(center), px, y);
        ctx.restore();
      };

      drawForAxis('x', (v) => `${(((v % 360) + 360) % 360).toFixed(0)}°`);
      drawForAxis('xSpeed', (v) => `${v.toFixed(1)}`);

      // Draw xSpeed rightmost tick label shifted slightly left (custom label)
      const xSpeedScale = (scaleMap?.['xSpeed'] as (Scale | undefined));
      if (xSpeedScale) {
        const scales = optScales;
        const sAny = xSpeedScale as unknown as { min?: number; max?: number };
        const xmax = (scales?.['xSpeed']?.max as number | undefined) ?? sAny.max;
        if (typeof xmax === 'number' && isFinite(xmax)) {
          const px = xSpeedScale.getPixelForValue(xmax);
          ctx.save();
          // Match tick label color for xSpeed axis
          ctx.fillStyle = this.resolveTickColor(chart, xSpeedScale, xmax);
          ctx.font = this.isPhonePortrait().matches ? `normal ${this.TICK_LABEL_PHONE_PORTRAIT_FONT_SIZE}px ${def.family}` : `normal ${this.TICK_LABEL_FONT_SIZE}px ${def.family}`;
          ctx.textAlign = 'right';
          ctx.textBaseline = 'top';
          const y = this.axisTopLabelY(xSpeedScale);
          const step = this.xStepSpeed ?? 1;
          const dp = Math.max(0, Math.min(3, Math.ceil(-Math.log10(step))));
          ctx.fillText(`${xmax.toFixed(dp)}`, px - this.EDGE_SPEED_LABEL_OFFSET, y);
          ctx.restore();

          // Extend the rightmost xSpeed tick vertical line 10px above the top time scale line
          ctx.save();
          ctx.strokeStyle = theme.contrastDim;
          ctx.lineWidth = this.GRID_LINE_WIDTH;
          ctx.beginPath();
          const xLine = Math.round(px) + 0.5;
          ctx.moveTo(xLine, area.bottom);
          ctx.lineTo(xLine, area.top - this.EDGE_EXTEND_UP_PX);
          ctx.stroke();
          ctx.restore();
        }
      }

      // Draw x leftmost tick label shifted slightly right (custom label)
      const xScale = (scaleMap?.['x'] as (Scale | undefined));
      if (xScale) {
        const scales = optScales;
        const sAny = xScale as unknown as { min?: number; max?: number };
        const xmin = (scales?.['x']?.min as number | undefined) ?? sAny.min;
        if (typeof xmin === 'number' && isFinite(xmin)) {
          const px = xScale.getPixelForValue(xmin);
          ctx.save();
          // Match tick label color for x axis
          ctx.fillStyle = this.resolveTickColor(chart, xScale, xmin);
          ctx.font = this.isPhonePortrait().matches ? `normal ${this.TICK_LABEL_PHONE_PORTRAIT_FONT_SIZE}px ${def.family}` : `normal ${this.TICK_LABEL_FONT_SIZE}px ${def.family}`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          const y = this.axisTopLabelY(xScale);
          const wrapped = this.normalizeAngle(xmin);
          ctx.fillText(`${wrapped.toFixed(0)}°`, px + this.EDGE_DIR_LABEL_OFFSET, y);
          ctx.restore();
        }
      }

      // Top-right speed value
      const ds = chart.data?.datasets as unknown as { label?: string; data: IDataSetRow[] }[];
      const speedVal = ds?.[5]?.data; // first speed dataset index (see dataset order)
      const last = speedVal?.length ? speedVal.length - 1 : -1;
      const lastSpeed = last >= 0 ? speedVal[last]?.x : undefined;

      if (typeof lastSpeed === 'number' && isFinite(lastSpeed)) {
        ctx.save();
        ctx.fillStyle = chartColors.chartValue ?? ctx.fillStyle;
        // Draw speed value centered
        ctx.font = this.isPhonePortrait().matches ? `bold ${this.SPEED_VALUE_PHONE_PORTRAIT_FONT_SIZE}px ${def.family}` : `bold ${this.SPEED_VALUE_FONT_SIZE}px ${def.family}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const speedText = `${lastSpeed.toFixed(1)}`;
        const speedX = area.left + (area.width / 4);
        const speedY = area.top - (this.isPhonePortrait().matches ? this.TOP_VALUE_PHONE_PORTRAIT_Y_OFFSET : this.TOP_VALUE_Y_OFFSET);
        ctx.fillText(speedText, speedX, speedY);
        // Measure speed text to place unit right after it
        const metrics = ctx.measureText(speedText);
        const unitX = speedX + (metrics.width / 2) + (this.isPhonePortrait().matches ? this.UNIT_PHONE_PORTRAIT_PADDING : this.UNIT_PADDING);
        const unitY = area.top - (this.isPhonePortrait().matches ? this.TOP_UNIT_PHONE_PORTRAIT_Y_OFFSET : this.TOP_UNIT_Y_OFFSET);
        ctx.font = this.isPhonePortrait().matches ? `bold ${this.UNIT_PHONE_PORTRAIT_FONT_SIZE}px ${def.family}` : `bold ${this.UNIT_FONT_SIZE}px ${def.family}`;
        ctx.textAlign = 'left';
        ctx.fillText(this.speedUnitSymbol(), unitX, unitY);
        ctx.restore();
      }

      // Top direction value
      const dirVal = ds?.[0]?.data; // first direction dataset index
      const lastDirIdx = dirVal?.length ? dirVal.length - 1 : -1;
      const lastDir = lastDirIdx >= 0 ? dirVal[lastDirIdx]?.x : undefined;
      if (typeof lastDir === 'number' && isFinite(lastDir)) {
        const dir = this.normalizeAngle(lastDir);
        ctx.save();
        ctx.fillStyle = chartColors.chartValue ?? ctx.fillStyle;
        ctx.font = this.isPhonePortrait().matches ? `bold ${this.SPEED_VALUE_PHONE_PORTRAIT_FONT_SIZE}px ${def.family}` : `bold ${this.SPEED_VALUE_FONT_SIZE}px ${def.family}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${dir.toFixed(0)}°`, area.left + (3 * area.width / 4), area.top - (this.isPhonePortrait().matches ? this.TOP_VALUE_PHONE_PORTRAIT_Y_OFFSET : this.TOP_VALUE_Y_OFFSET));
        ctx.restore();
      }

      // Draw loading overlay box/text visible above background; keep lines visible via semi-transparent fill
      if (!ready) {
        const boxW = Math.min(area.width * 0.7, 420);
        const boxH = 90;
        const x = area.left + (area.width - boxW) / 2;
        const y = area.top + (area.height - boxH) / 2;
        // Background with slight transparency so lines remain visible
        ctx.save();
        ctx.globalAlpha = 0.82;
        ctx.fillStyle = theme.background;
        ctx.fillRect(x, y, boxW, boxH);
        ctx.restore();
        // Border on top
        ctx.save();
        ctx.strokeStyle = theme.contrastDim;
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, boxW, boxH);
        ctx.restore();
        // Text over everything
        ctx.save();
        ctx.fillStyle = this.getThemeColors().chartLabel ?? ctx.fillStyle;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `bold 18px ${def.family}`;
        ctx.fillText('Data acquisition...', x + boxW / 2, y + boxH / 2);
        ctx.restore();
      }
    }
  };

  constructor() {
    this.isPhonePortrait = toSignal(this.responsive.observe(Breakpoints.HandsetPortrait), { initialValue: { matches: false, breakpoints: {} } });
    // Theme or config color changes -> restyle chart
    effect(() => {
      const theme = this.theme();
      const cfg = this.runtime?.options();
      if (!theme || !cfg) return;
      untracked(() => {
        if (this.timeScale && this.chart) {
          this.setChartOptions();
          this.setDatasetsColors();
          this.ngZone.runOutsideAngular(() => this.chart?.update('none'));
        }
      });
    });

    // Config lifecycle: rebuild the streams + datasets when the time scale or either series'
    // path/source changes; a color-only edit leaves the signature unchanged and just refreshes options.
    effect(() => {
      const cfg = this.runtime?.options();
      if (!cfg) return;
      const signature = this.computeRebuildSignature(cfg);
      if (signature !== this.previousRebuildSignature) {
        this.startWidget();
      } else if (this.chart) {
        this.setChartOptions();
      }
    });
  }

  private startWidget(): void {
    // Guard until canvas view is ready
    const widgetDataChartRef = this.widgetDataChart();
    if (!widgetDataChartRef) return;
    const cfg = this.runtime?.options();
    if (!cfg || !cfg.timeScale) return;
    // Commit the signature only once the canvas is ready and the build proceeds, so a pre-canvas
    // effect run cannot mark it seen and suppress the real first build.
    this.previousRebuildSignature = this.computeRebuildSignature(cfg);
    const timeScale = cfg.timeScale as TimeScaleFormat;
    this.timeScale = timeScale;
    this.dataSourceInfo = deriveDataSourceInfo(resolveWindowMs(timeScale, WINDTRENDS_PERIOD));
    this.createDatasets();
    this.setChartOptions();
    if (!this.chart) {
      this.chart = new Chart(widgetDataChartRef.nativeElement.getContext('2d'), {
        type: this.lineChartType,
        data: this.lineChartData,
        options: this.lineChartOptions,
        plugins: [this.gridBackgroundPlugin, this.centerTickPlugin]
      });
      this.ngZone.runOutsideAngular(() => this.chart?.update('none'));
    } else {
      this.ngZone.runOutsideAngular(() => this.chart?.update('none'));
    }
    this.startStreaming();
  }

  private setChartOptions() {
    const theme = this.theme();
    const dataSourceInfo = this.dataSourceInfo;
    if (!theme || !dataSourceInfo) return;

    this.lineChartOptions.maintainAspectRatio = false;
    this.lineChartOptions.animation = false;

    this.lineChartOptions.indexAxis = 'y';

    // Provide initial x (direction) range so ticks/center line render before data arrives
    const xDefaultMin = 0;
    const xDefaultMax = 360;
    const xDefaultStep = (xDefaultMax - xDefaultMin) / 4; // 5 ticks
    // Provide an initial xSpeed range (display-unit agnostic; the dynamic scaler resizes from data)
    const xsDefaultMin = 0;
    const xsDefaultMax = 20;
    const xsDefaultStep = (xsDefaultMax - xsDefaultMin) / 4; // 5 ticks

    this.lineChartOptions.scales = {
      y: {
        type: "linear",
        display: true,
        position: "right",
        reverse: true, // 0 (now) at top; older increases downward
        title: {
          display: true,
          text: `${this.timeScale}`,
          align: "center"
        },
        ticks: {
          count: 6,            // 6 lines including start/end
          autoSkip: false,
          includeBounds: true,
          align: 'inner',
          major: { enabled: true },
          font: this.isPhonePortrait().matches ? { size: 12 } : { size: 16 },
          callback: (value: number) => {
            const ms = Number(value);
            const fmt = this.timeScale;
            const windowMs = this.getWindowMs(fmt);
            // 5-minute scale: show whole minutes
            if (fmt === 'Last 5 Minutes') {
              const m = Math.round(ms / 60_000);
              return `${m}'`;
            }
            // >= 10 minutes → minutes; else seconds
            if (windowMs >= 10 * 60_000) {
              const m = Math.round(ms / 60_000);
              return `${m}'`;
            }
            const s = Math.round(ms / 1000);
            return `${s}"`;
          }
        },
        grid: {
          display: true,
          color: theme.contrastDimmer
        }
      },
      x: {
        type: "linear",
        position: "top",
        stack: 'trends',
        beginAtZero: false,
        bounds: 'ticks',
        min: xDefaultMin,
        max: xDefaultMax,
        // min/max will be set dynamically in updateChartAfterDataChange
        title: { display: false },
        ticks: {
          count: 5,
          align: 'inner',
          autoSkip: false,
          includeBounds: true,
          stepSize: xDefaultStep,
          minRotation: 0,
          maxRotation: 0,
          callback: (value: number) => {
            // Hide the default center tick label; plugin will draw a bold themed label there
            const center = this.xCenter ?? Number.NaN;
            if (this.nearlyEqual(value, center)) return '';
            // Hide leftmost label (at min) to avoid overlap with custom shifted label
            const scales = this.chart?.options?.scales as unknown as { x?: { min?: number } } | undefined;
            const minOpt = scales?.x?.min;
            if (typeof minOpt === 'number' && this.nearlyEqual(value as number, minOpt)) return '';
            const wrapped = ((value % 360 + 360) % 360);
            return `${wrapped.toFixed(0)}°`;
          },
          // Make the center tick bold and themed using precomputed midpoint/step
          font: (ctx) => {
            const tickVal = (ctx as unknown as { tick?: { value: number } }).tick?.value ?? Number.NaN;
            const center = this.xCenter ?? Number.NaN;
            const isCenter = this.nearlyEqual(tickVal, center);
            return this.isPhonePortrait().matches ? { size: 11, weight: isCenter ? 'bold' : 'normal' } : { size: 20, weight: isCenter ? 'bold' : 'normal' };
          },
          color: (ctx) => {
            const tickVal = (ctx as unknown as { tick?: { value: number } }).tick?.value ?? Number.NaN;
            const center = this.xCenter ?? Number.NaN;
            const isCenter = this.nearlyEqual(tickVal, center);
            return isCenter ? this.theme()?.contrast : undefined;
          },
        },
        grid: {
          display: true,
          color: (ctx) => {
            const tickVal = (ctx as unknown as { tick?: { value: number }, scale: Scale }).tick?.value ?? Number.NaN;
            const scale = (ctx as unknown as { scale: Scale }).scale;
            const scales = this.chart?.options?.scales as unknown as { x?: { min?: number } } | undefined;
            const sAny = scale as unknown as { min?: number };
            const min = (scales?.x?.min as number | undefined) ?? sAny.min;
            const isMin = this.nearlyEqual(tickVal, min as number);
            return isMin ? 'rgba(0,0,0,0)' : this.theme()?.contrastDimmer;
          },
          lineWidth: 1
        }
      },
      xSpeed: {
        type: "linear",
        position: "top",
        stack: 'trends',
        beginAtZero: false,
        bounds: 'ticks',
        min: xsDefaultMin,
        max: xsDefaultMax,
        title: { display: false },
        ticks: {
          count: 5,
          align: 'inner',
          autoSkip: false,
          includeBounds: true,
          stepSize: xsDefaultStep,
          minRotation: 0,
          maxRotation: 0,
          callback: (value: number) => {
            const center = this.xCenterSpeed ?? Number.NaN;
            if (this.nearlyEqual(value as number, center)) return '';
            // Hide rightmost label (at max) to avoid overlap with custom shifted label
            const scales = this.chart?.options?.scales as unknown as { xSpeed?: { max?: number } } | undefined;
            const maxOpt = scales?.xSpeed?.max;
            if (typeof maxOpt === 'number' && this.nearlyEqual(value as number, maxOpt)) return '';
            // Derive decimals from step so adjacent ticks remain distinct
            const stepS = this.xStepSpeed ?? Number.NaN;
            const s = Number.isFinite(stepS) ? stepS : 1;
            const dp = Math.max(0, Math.min(3, Math.ceil(-Math.log10(s))));
            return `${(value as number).toFixed(dp)}`;
          },
          font: (ctx) => {
            const tickVal = (ctx as unknown as { tick?: { value: number } }).tick?.value ?? Number.NaN;
            const center = this.xCenterSpeed ?? Number.NaN;
            const isCenter = this.nearlyEqual(tickVal, center);
            return this.isPhonePortrait().matches ? { size: 11, weight: isCenter ? 'bold' : 'normal' } : { size: 20, weight: isCenter ? 'bold' : 'normal' };
          },
          color: (ctx) => {
            const tickVal = (ctx as unknown as { tick?: { value: number } }).tick?.value ?? Number.NaN;
            const center = this.xCenterSpeed ?? Number.NaN;
            const isCenter = this.nearlyEqual(tickVal, center);
            return isCenter ? this.theme()?.contrast : undefined;
          },
        },
        grid: {
          display: true,
          color: (ctx) => {
            const tickVal = (ctx as unknown as { tick?: { value: number }, scale: Scale }).tick?.value ?? Number.NaN;
            const scale = (ctx as unknown as { scale: Scale }).scale;
            const scales = this.chart?.options?.scales as unknown as { xSpeed?: { max?: number } } | undefined;
            const sAny = scale as unknown as { max?: number };
            const max = (scales?.xSpeed?.max as number | undefined) ?? sAny.max;
            const isMax = this.nearlyEqual(tickVal, max as number);
            return isMax ? 'rgba(0,0,0,0)' : this.theme()?.contrastDimmer;
          },
          lineWidth: 1
        }
      }
    };

    this.lineChartOptions.plugins = {
      title: {
        display: true,
        align: "end",
        text: `TWD `,
        color: this.getThemeColors().chartLabel ?? undefined,
        padding: this.isPhonePortrait().matches ? { top: 3, bottom: 0 } : { top: 3, bottom: 0 },
        font: this.isPhonePortrait().matches ? { size: 16, weight: 'normal' } : { size: 35, weight: 'normal' }
      },
      subtitle: {
        display: true,
        align: "start",
         text: ` TWS`,
        color: this.getThemeColors().chartLabel ?? undefined,
        padding: this.isPhonePortrait().matches ? { top: -18, bottom: 12 } : { top: -41, bottom: 12 },
        font: this.isPhonePortrait().matches ? { size: 16 } : { size: 35 }
      },
      legend: { display: false
      },
      streaming: {
        duration: dataSourceInfo.maxDataPoints * dataSourceInfo.sampleTime,
        delay: dataSourceInfo.sampleTime,
        frameRate: this.timeScale === "day" ? 5 : this.timeScale === "hour" ? 8 : this.timeScale === "minute" ? 15 : 30,
      }
    }

    // Cache initial centers/steps for tick styling before first data update
    this.xCenter = (xDefaultMin + xDefaultMax) / 2;
    this.xStep = xDefaultStep;
    this.xCenterSpeed = (xsDefaultMin + xsDefaultMax) / 2;
    this.xStepSpeed = xsDefaultStep;
  }

  private createDatasets() {
    this.lineChartData.datasets = [];
    this.lineChartData.datasets.push(
      {
        label: 'Value',
        data: [],
        order: 2,
        parsing: false,
        normalized: true,
        tension: 0,
        pointRadius: 0,
        pointHoverRadius: 0,
        pointHitRadius: 0,
        borderWidth: 1,
        fill: false,
        xAxisID: 'x'
      },
      {
        label: 'SMA',
        data: [],
        order: 0,
        parsing: false,
        normalized: true,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 0,
        pointHitRadius: 0,
        borderWidth: 10,
        fill: false,
        borderColor: (context) => {
          const chart = context.chart as Chart;
          const { ctx } = chart;
          return this.lineGradientForAxis(ctx, chart, 'x') ?? undefined;
        },
        backgroundColor: 'red',
        xAxisID: 'x'
      },
      {
        label: 'lastAverage',
        data: [],
        order: 1,
        parsing: false,
        normalized: true,
        tension: 0,
        pointRadius: 0,
        pointHoverRadius: 0,
        pointHitRadius: 0,
        borderWidth: 0,
        borderColor: '',
        fill: false,
        hidden: true,
        xAxisID: 'x'
      },
      {
        label: 'lastMinimum',
        data: [],
        order: 3,
        parsing: false,
        normalized: true,
        hidden: true,
        xAxisID: 'x'
      },
      {
        label: 'lastMaximum',
        data: [],
        order: 4,
        parsing: false,
        normalized: true,
        hidden: true,
        xAxisID: 'x'
      },
      // Speed datasets (5..9)
      {
        label: 'Value Speed',
        data: [],
        order: 2,
        parsing: false,
        normalized: true,
        tension: 0,
        pointRadius: 0,
        pointHoverRadius: 0,
        pointHitRadius: 0,
        borderWidth: 1,
        fill: false,
        xAxisID: 'xSpeed'
      },
      {
        label: 'SMA Speed',
        data: [],
        order: 0,
        parsing: false,
        normalized: true,
        tension: 0.2,
        pointRadius: 0,
        pointHoverRadius: 0,
        pointHitRadius: 0,
        borderWidth: 3,
        fill: false,
        borderColor: (context) => {
          const chart = context.chart as Chart;
          const { ctx } = chart;
          return this.lineGradientForAxis(ctx, chart, 'xSpeed') ?? undefined;
        },
        xAxisID: 'xSpeed'
      },
      {
        label: 'lastAverage Speed',
        data: [],
        order: 1,
        parsing: false,
        normalized: true,
        tension: 0,
        pointRadius: 0,
        pointHoverRadius: 0,
        pointHitRadius: 0,
        borderWidth: 0,
        borderColor: '',
        fill: false,
        hidden: true,
        xAxisID: 'xSpeed'
      },
      {
        label: 'lastMinimum Speed',
        data: [],
        order: 3,
        parsing: false,
        normalized: true,
        hidden: true,
        xAxisID: 'xSpeed'
      },
      {
        label: 'lastMaximum Speed',
        data: [],
        order: 4,
        parsing: false,
        normalized: true,
        hidden: true,
        xAxisID: 'xSpeed'
      }
    );

    this.setDatasetsColors();
  }

  /** Read a single configurable path slot from the merged config, tolerating the array path form. */
  private windPathSlot(cfg: IWidgetSvcConfig | undefined, slot: string): IWidgetPath | undefined {
    const paths = cfg?.paths;
    if (!paths || Array.isArray(paths)) return undefined;
    return paths[slot];
  }

  /** Signature over the inputs that require a full stream/dataset rebuild (time scale + both series). */
  private computeRebuildSignature(cfg: IWidgetSvcConfig): string {
    const dir = this.windPathSlot(cfg, 'trueWindDirection');
    const spd = this.windPathSlot(cfg, 'trueWindSpeed');
    return [cfg.timeScale, dir?.path, dir?.source, spd?.path, spd?.source, this.speedMeasure()].join('|');
  }

  /**
   * Whether the loading overlay can clear: every *configured* series must have enough points. A
   * cleared slot (per-series stream gating) is not awaited — otherwise its empty datasets would hold
   * the overlay up forever. With no series configured at all, stay in the acquiring state.
   */
  private isChartReady(chart: Chart): boolean {
    const dirVals = chart.data?.datasets?.[0]?.data as (IDataSetRow[] | undefined);
    const spdVals = chart.data?.datasets?.[5]?.data as (IDataSetRow[] | undefined);
    const dirReady = !this.dirSeriesActive || (dirVals?.length ?? 0) >= 2;
    const spdReady = !this.spdSeriesActive || (spdVals?.length ?? 0) >= 2;
    return (this.dirSeriesActive || this.spdSeriesActive) && dirReady && spdReady;
  }

  private startStreaming(): void {
    this._dsDirectionSub?.unsubscribe();
    this._dsSpeedSub?.unsubscribe();
    this._dsDirectionSub = null;
    this._dsSpeedSub = null;

    const timeScale = this.timeScale;
    const info = this.dataSourceInfo;
    const cfg = this.runtime?.options();
    if (!timeScale || !info || !cfg) return;
    const baseParams = {
      windowMs: resolveWindowMs(timeScale, WINDTRENDS_PERIOD),
      sampleTime: info.sampleTime,
      maxDataPoints: info.maxDataPoints,
      smoothingPeriod: info.smoothingPeriod
    };

    // Each series subscribes independently on its own configured path. pathRequired is false, so a
    // user can clear one slot; gating per series keeps the other one rendering rather than tearing
    // down the whole chart. Source falls back to the SK default when the slot leaves it unset.
    const dir = this.windPathSlot(cfg, 'trueWindDirection');
    const dirPath = dir?.path;
    const spd = this.windPathSlot(cfg, 'trueWindSpeed');
    const spdPath = spd?.path;
    this.dirSeriesActive = !!dirPath;
    this.spdSeriesActive = !!spdPath;
    // Resolve the server's display measure for the speed path once per build; a late/changed
    // displayUnits re-emits through speedMeasure and triggers another build (see computeRebuildSignature).
    this.speedMeasureKey = spdPath ? this.unitsService.resolvePathMeasure(spdPath) : null;

    if (dirPath) {
      // TWD is a direction path; the History engine auto-resolves its circular domain from the unit.
      const twdParams: IHistoryChartStreamParams = { ...baseParams, path: dirPath, source: dir?.source ?? 'default' };
      this._dsDirectionSub = this.historyStream.getBackfillThenLive(twdParams).subscribe(emission => {
        if (isHistoryUnavailable(emission)) return;
        if (Array.isArray(emission)) {
          this.pushRowsToDatasets(emission);
        } else {
          this.pushRowsToDatasets([emission]);
          if (this.chart.data.datasets[0].data.length > info.maxDataPoints) {
            for (let i = 0; i <= 4; i++) this.chart.data.datasets[i].data.shift();
          }
        }
        this.scheduleChartUpdate();
      });
    }

    if (spdPath) {
      const twsParams: IHistoryChartStreamParams = { ...baseParams, path: spdPath, source: spd?.source ?? 'default' };
      this._dsSpeedSub = this.historyStream.getBackfillThenLive(twsParams).subscribe(emission => {
        if (isHistoryUnavailable(emission)) return;
        if (Array.isArray(emission)) {
          this.pushRowsToSpeedDatasets(emission);
        } else {
          this.pushRowsToSpeedDatasets([emission]);
          if (this.chart.data.datasets[5].data.length > info.maxDataPoints) {
            for (let i = 5; i <= 9; i++) this.chart.data.datasets[i].data.shift();
          }
        }
        this.scheduleChartUpdate();
      });
    }
  }

  private unwrapAngles(degrees: (number | null)[]): (number | null)[] {
    if (degrees.length === 0) return [];
    const unwrapped: (number | null)[] = [];
    let prev: number | null = null;
    let lastUnwrapped: number | null = null;
    for (const val of degrees) {
      if (val == null) {
        unwrapped.push(null);
        continue;
      }
      if (prev == null || lastUnwrapped == null) {
        unwrapped.push(val);
        prev = val;
        lastUnwrapped = val;
        continue;
      }
      let delta = val - prev;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      const next = lastUnwrapped + delta;
      unwrapped.push(next);
      lastUnwrapped = next;
      prev = val;
    }
    return unwrapped;
  }

  private pushRowsToDatasets(rows: IDatasetServiceDatapoint[]): void {
    this.pushRowsGeneric(rows, 0, 'deg', true);
  }

  private pushRowsToSpeedDatasets(rows: IDatasetServiceDatapoint[]): void {
    this.pushRowsGeneric(rows, 5, this.speedMeasureKey ?? 'unitless', false);
  }

  /** Display symbol for the resolved wind-speed measure; empty (no label) before the server's
   *  displayUnits resolve or when the path carries no unit preference — never a wrong or raw-key label. */
  private speedUnitSymbol(): string {
    const measure = this.speedMeasureKey;
    return measure && measure !== 'unitless' ? this.unitsService.getUnitDisplaySymbol(measure) : '';
  }

  private getRowValue(row: IDatasetServiceDatapoint, datasetType: 'value' | 'sma' | 'ema' | 'dema' | 'avg' | 'min' | 'max'): number | null {
    switch (datasetType) {
      case 'value': return row.data.value ?? null;
      case 'sma': return row.data.sma ?? null;
      case 'ema': return row.data.ema ?? null;
      case 'dema': return row.data.doubleEma ?? null;
      case 'avg': return row.data.lastAverage ?? null;
      case 'min': return row.data.lastMinimum ?? null;
      case 'max': return row.data.lastMaximum ?? null;
      default: return null;
    }
  }

  // Generic transform for the degree (structural) and speed (server-resolved measure) series
  private transformRows(rows: IDatasetServiceDatapoint[], datasetType: 'value' | 'sma' | 'ema' | 'dema' | 'avg' | 'min' | 'max', toUnit: string, unwrap: boolean): IDataSetRow[] {
    const vals = rows.map(row => {
      const raw = this.getRowValue(row, datasetType);
      return raw == null ? null : this.unitsService.convertToUnit(toUnit, raw);
    });

    const xs = unwrap ? this.unwrapAngles(vals) : vals;

    return rows.map((row, idx) => ({
      x: xs[idx] as number,
      y: row.timestamp,
      ts: row.timestamp,
    }));
  }

  // Push a batch of rows into 5 consecutive datasets starting at baseIndex
  private pushRowsGeneric(rows: IDatasetServiceDatapoint[], baseIndex: 0 | 5, toUnit: string, unwrap: boolean): void {
    const types: ('value' | 'sma' | 'avg' | 'min' | 'max')[] = ['value', 'sma', 'avg', 'min', 'max'];
    types.forEach((type, i) => {
      (this.chart.data.datasets[baseIndex + i].data as IDataSetRow[])
        .push(...this.transformRows(rows, type, toUnit, unwrap));
    });
  }

  private normalizeAngle(angle: number): number {
    return ((angle % 360) + 360) % 360;
  }

  // Minimal absolute angular distance in degrees [0, 180]
  private angularDiff(a: number, b: number): number {
    const d = ((a - b + 540) % 360) - 180; // [-180, 180)
    return Math.abs(d);
  }

  // More flexible: choose from provided mantissas (ascending) for a nice step
  private niceStepFromMantissas(step: number, mantissas: number[]): number {
    if (!isFinite(step) || step <= 0) return 1;
    const exp = Math.floor(Math.log10(step));
    const base = step / Math.pow(10, exp);
    const chosen = mantissas.find(m => base <= m) ?? mantissas[mantissas.length - 1];
    return chosen * Math.pow(10, exp);
  }

  /**
   * Coalesce the chart recompute + repaint into a single animation frame. The direction (-twd) and
   * speed (-tws) streams frequently emit in the same frame; without this, each emission runs the
   * full 10-dataset y recompute and a chart.update('none'), doing that work twice per frame.
   */
  private scheduleChartUpdate(): void {
    if (this._chartUpdateRafId != null) return;
    this._chartUpdateRafId = requestAnimationFrame(() => {
      this._chartUpdateRafId = null;
      if (!this.chart) return;
      this.updateChartAfterDataChange();
      this.ngZone.runOutsideAngular(() => this.chart?.update('none'));
    });
  }

  private updateChartAfterDataChange() {
    // Calculate dynamic x (direction) scale range based on lastAverage center and lastMin/Max distances (with wrap-around)
    const dirAvgArr = this.chart.data.datasets[2]?.data as IDataSetRow[] | undefined;
    const dirSmaArr = this.chart.data.datasets[1]?.data as IDataSetRow[] | undefined;
    const dirValArr = this.chart.data.datasets[0]?.data as IDataSetRow[] | undefined;
    // Center MUST be the latest lastAverage value when available, else fall back to SMA, else Value
    const centerVal = dirAvgArr?.length
      ? dirAvgArr[dirAvgArr.length - 1].x
      : dirSmaArr?.length
        ? dirSmaArr[dirSmaArr.length - 1].x
        : dirValArr?.length
          ? dirValArr[dirValArr.length - 1].x
          : undefined;
    if (typeof centerVal === 'number' && isFinite(centerVal)) {
      // Try to use lastMinimum/Maximum if available; else derive half-range from recent window using angular distance
      const minDs = this.chart.data.datasets[3]?.data as IDataSetRow[] | undefined;
      const maxDs = this.chart.data.datasets[4]?.data as IDataSetRow[] | undefined;
      const lastMin = minDs?.length ? minDs[minDs.length - 1].x : undefined;
      const lastMax = maxDs?.length ? maxDs[maxDs.length - 1].x : undefined;
      const minDiff = typeof lastMin === 'number' && isFinite(lastMin) ? this.angularDiff(centerVal, lastMin) : Number.NaN;
      const maxDiff = typeof lastMax === 'number' && isFinite(lastMax) ? this.angularDiff(centerVal, lastMax) : Number.NaN;
      let halfRange = Number.isFinite(minDiff) || Number.isFinite(maxDiff)
        ? Math.max(Number.isFinite(minDiff) ? minDiff : 0, Number.isFinite(maxDiff) ? maxDiff : 0)
        : Number.NaN;
      if (!Number.isFinite(halfRange)) {
        const src = dirAvgArr?.length ? dirAvgArr : dirSmaArr?.length ? dirSmaArr : dirValArr;
        if (src && src.length > 1) {
          const take = Math.min(30, src.length);
          const slice = src.slice(src.length - take);
          const xs = slice.map(p => p.x).filter(v => typeof v === 'number' && isFinite(v)) as number[];
          if (xs.length) {
            halfRange = xs.reduce((m, v) => Math.max(m, this.angularDiff(centerVal, v)), 0);
          }
        }
      }
      // Ensure a sensible minimum half-range so the axis doesn't collapse on first point
      const minHalfRangeDeg = 15; // shows a 30° window initially
      halfRange = Math.max(halfRange || 0, minHalfRangeDeg);
      // 5 ticks (4 intervals) with a nice step, snapped to grid around the chosen center
      const requestedStep = (2 * halfRange) / 4; // = halfRange / 2
      // Allow 15° by including 1.5 mantissa; also support 7.5
      const dStep = this.niceStepFromMantissas(requestedStep, [1, 1.5, 2, 2.5, 5, 7.5, 10]);
      // Place center exactly at lastAverage
      const xMin = centerVal - 2 * dStep;
      const xMax = centerVal + 2 * dStep;
      const xScale = this.chart.options.scales as unknown as { x: { min?: number; max?: number; ticks?: { stepSize?: number } } };
      xScale.x.min = xMin;
      xScale.x.max = xMax;
      xScale.x.ticks = { ...(xScale.x.ticks ?? {}), stepSize: dStep };

      // Cache for tick styling
      this.xCenter = centerVal;
      this.xStep = dStep;
    }

    // Calculate dynamic xSpeed (knots) scale range based on lastAverage center and lastMin/Max distances
    const sAvgArr = this.chart.data.datasets[7]?.data as IDataSetRow[] | undefined;
    if (sAvgArr && sAvgArr.length) {
      const sIdx = sAvgArr.length - 1;
      const sAvg = sAvgArr[sIdx]?.x ?? 0;
      const sMin = (this.chart.data.datasets[8].data as IDataSetRow[])[sIdx]?.x ?? sAvg;
      const sMax = (this.chart.data.datasets[9].data as IDataSetRow[])[sIdx]?.x ?? sAvg;
      const sDiffMin = Math.abs(sAvg - sMin);
      const sDiffMax = Math.abs(sMax - sAvg);
      let halfRangeS = Math.max(sDiffMin, sDiffMax);
      // Guard minimum half-range to avoid collapse (in the resolved display unit)
      const minHalfRangeS = 0.5;
      halfRangeS = Math.max(halfRangeS, minHalfRangeS);
      // Target 5 ticks (4 intervals) with a nice step (ceiling)
      const requestedStep = (2 * halfRangeS) / 4; // = halfRangeS / 2
      // Preserve previous speed behavior (no 1.5/7.5 mantissas)
      const spStep = this.niceStepFromMantissas(requestedStep, [1, 2, 2.5, 5, 10]);
      // Keep center exactly at lastAverage Speed
      const spMin = sAvg - 2 * spStep;
      const spMax = sAvg + 2 * spStep;
      const scales = this.chart.options.scales as unknown as { xSpeed: { min?: number; max?: number; ticks?: { stepSize?: number } } };
      scales.xSpeed.min = spMin;
      scales.xSpeed.max = spMax;
      scales.xSpeed.ticks = { ...(scales.xSpeed.ticks ?? {}), stepSize: spStep };

      // cache for tick styling on speed axis
      this.xCenterSpeed = sAvg;
      this.xStepSpeed = spStep;
    }

    // Fixed, non-scrolling y-axis window (relative age). Gate on either series so a cleared
    // direction slot still lets the speed series recompute its age-based y positions.
    const windowMs = this.getWindowMs(this.timeScale);
    const dirData = this.chart.data.datasets[0].data as (IDataSetRow[]);
    const speedData = this.chart.data.datasets[5].data as (IDataSetRow[]);
    if (dirData.length > 0 || speedData.length > 0) {
      const nowTs = Date.now();
      // Recompute y for all datasets as age (ms) relative to now
      this.chart.data.datasets.forEach(ds => {
        (ds.data as IDataSetRow[]).forEach(p => {
          const ts = p.ts ?? p.y;
          p.y = Math.max(0, Math.min(windowMs, nowTs - ts));
        });
      });
      // Explicit step per selected window
      let step: number;
      const fmt = this.timeScale;
      switch (fmt) {
        case 'Last Minute':
          step = 15_000; // 15 seconds
          break;
        case 'Last 5 Minutes':
          step = 60_000; // 1 minute
          break;
        case 'Last 30 Minutes':
          step = 5 * 60_000; // 5 minutes
          break;
        default:
          // fallback keeps 6 ticks => 5 intervals
          step = windowMs / 5;
          break;
      }
      const yScale = this.chart.options.scales as unknown as { y: { min?: number; max?: number; ticks?: { stepSize?: number; count?: number } } };
      // Lock y scale to [0, window]
      yScale.y.min = 0;
      yScale.y.max = windowMs;
      const ticksCopy = { ...(yScale.y.ticks ?? {}) } as { stepSize?: number; count?: number };
      delete ticksCopy.count;
      ticksCopy.stepSize = step;
      yScale.y.ticks = ticksCopy;
    }
  }

  private getWindowMs(fmt: TimeScaleFormat | null | undefined): number {
    switch (fmt) {
      case 'Last 30 Minutes':
        return 30 * 60_000;
      case 'Last 5 Minutes':
        return 5 * 60_000;
      case 'Last Minute':
        return 60_000;
      default:
        return 60_000; // fallback 1 minute
    }
  }

  private lineGradientForAxis(ctx: CanvasRenderingContext2D, chart: Chart, axisKey: 'x' | 'xSpeed'): CanvasGradient | null {
    const chartArea = chart.chartArea as ChartArea | undefined;
    if (!chartArea) return null;
    const scale = chart.scales?.[axisKey] as (Scale | undefined);
    if (!scale) return null;
    const theme = this.theme();
    if (!theme) return null;
    const scales = chart.options?.scales as Record<string, { min?: number; max?: number }> | undefined;
    const sAny = scale as unknown as { min?: number; max?: number };
    const min = (scales?.[axisKey]?.min as number | undefined) ?? sAny.min;
    const max = (scales?.[axisKey]?.max as number | undefined) ?? sAny.max;
    if (typeof min !== 'number' || typeof max !== 'number' || !isFinite(min) || !isFinite(max)) return null;
    const center = (min + max) / 2;
    const centerPx = scale.getPixelForValue(center);
    const offset = Math.max(0, Math.min(1, (centerPx - chartArea.left) / chartArea.width));
    const gradient = ctx.createLinearGradient(chartArea.left, 0, chartArea.right, 0);
    gradient.addColorStop(0, theme.port);
    gradient.addColorStop(offset, theme.port);
    gradient.addColorStop(offset, theme.starboard);
    gradient.addColorStop(1, theme.starboard);
    return gradient;
  }

  private setDatasetsColors(): void {
    this.lineChartData.datasets.forEach((dataset) => {
      if (dataset.label === 'Value') {
        dataset.borderColor = this.getThemeColors().valueLine ?? undefined;
        dataset.backgroundColor = this.getThemeColors().valueFill ?? undefined;
      }
      if (dataset.label === 'Value Speed') {
        dataset.borderColor = this.getThemeColors().valueLine ?? undefined;
        dataset.backgroundColor = this.getThemeColors().valueFill ?? undefined;
      }
    });
  }

  private getThemeColors(): IChartColors {
    const widgetColor = this.runtime?.options()?.color;
    const colors: IChartColors = {
      valueLine: null,
      valueFill: null,
      averageLine: null,
      averageFill: null,
      averageChartLine: null,
      chartLabel: null,
      chartValue: null
    };

    const theme = this.theme();
    if (!theme) return colors;

    switch (widgetColor) {
      case "contrast":
        colors.valueLine = theme.contrastDim;
        colors.valueFill = theme.contrastDimmer;
        colors.averageLine = theme.contrast;
        colors.averageFill = theme.contrast;
        colors.chartValue = theme.contrast;
        colors.averageChartLine = theme.contrast;
        colors.chartLabel = theme.contrastDim;
        break;
      case "blue":
        colors.valueLine = theme.blueDim;
        colors.valueFill = theme.blueDimmer;
        colors.averageLine = theme.blue;
        colors.averageFill = theme.blue;
        colors.chartValue = theme.blue;
        colors.averageChartLine = theme.blueDim;
        colors.chartLabel = theme.blueDim;
        break;
      case "green":
        colors.valueLine = theme.greenDim;
        colors.valueFill = theme.greenDimmer;
        colors.averageLine = theme.green;
        colors.averageFill = theme.green;
        colors.chartValue = theme.green;
        colors.averageChartLine = theme.greenDim;
        colors.chartLabel = theme.greenDim;
        break;
      case "pink":
        colors.valueLine = theme.pinkDim;
        colors.valueFill = theme.pinkDimmer;
        colors.averageLine = theme.pink;
        colors.averageFill = theme.pink;
        colors.chartValue = theme.pink;
        colors.averageChartLine = theme.pinkDim;
        colors.chartLabel = theme.pinkDim;
        break;
      case "orange":
        colors.valueLine = theme.orangeDim;
        colors.valueFill = theme.orangeDimmer;
        colors.averageLine = theme.orange;
        colors.averageFill = theme.orange;
        colors.chartValue = theme.orange;
        colors.averageChartLine = theme.orangeDim;
        colors.chartLabel = theme.orangeDim;
        break;
      case "purple":
        colors.valueLine = theme.purpleDim;
        colors.valueFill = theme.purpleDimmer;
        colors.averageLine = theme.purple;
        colors.averageFill = theme.purple;
        colors.chartValue = theme.purple;
        colors.averageChartLine = theme.purpleDim;
        colors.chartLabel = theme.purpleDim;
        break;
      case "grey":
        colors.valueLine = theme.greyDim;
        colors.valueFill = theme.greyDimmer;
        colors.averageLine = theme.grey;
        colors.averageFill = theme.grey;
        colors.chartValue = theme.grey;
        colors.averageChartLine = theme.greyDim;
        colors.chartLabel = theme.greyDim;
        break;
      case "yellow":
        colors.valueLine = theme.yellowDim;
        colors.valueFill = theme.yellowDimmer;
        colors.averageLine = theme.yellow;
        colors.averageFill = theme.yellow;
        colors.chartValue = theme.yellow;
        colors.averageChartLine = theme.yellowDim;
        colors.chartLabel = theme.yellowDim;
        break;
    }
    return colors;
  }

  // Helper: robust near-equality to avoid suppressing non-target ticks
  private nearlyEqual(a: number, b: number, eps = 1e-6): boolean {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    const scale = Math.max(1, Math.max(Math.abs(a), Math.abs(b)));
    return Math.abs(a - b) <= eps * scale;
  }

  // Helper: resolve tick color from scale ticks.color (string or function)
  private resolveTickColor(chart: Chart, scale: Scale, tickValue: number): string {
    const ticksOpt = (scale.options as unknown as { ticks?: { color?: string | ((ctx: { chart: Chart; scale: Scale; tick: { value: number } }) => string | undefined) } }).ticks;
    const col = ticksOpt?.color;
    if (typeof col === 'function') {
      const resolved = (col as (ctx: { chart: Chart; scale: Scale; tick: { value: number } }) => string | undefined)({ chart, scale, tick: { value: tickValue } });
      return resolved ?? Chart.defaults.color as string;
    }
    return typeof col === 'string' ? col : (Chart.defaults.color as string);
  }

  // Helper: y position for top scale labels relative to an axis scale
  private axisTopLabelY(scale: Scale): number {
    const pos = (scale.options as { position?: string })?.position;
    return pos === 'top' ? (scale.top + 4) : (scale.bottom + 2);
  }

  ngOnDestroy(): void {
    this._dsDirectionSub?.unsubscribe();
    this._dsSpeedSub?.unsubscribe();
    if (this._chartUpdateRafId != null) {
      cancelAnimationFrame(this._chartUpdateRafId);
      this._chartUpdateRafId = null;
    }
    // we need to destroy when moving Pages to remove Chart Objects
    this.chart?.destroy();
    const canvas = this.widgetDataChart?.()?.nativeElement as HTMLCanvasElement | undefined;
    this.canvasService.releaseCanvas(canvas, { clear: true, removeFromDom: true });
  }
}
