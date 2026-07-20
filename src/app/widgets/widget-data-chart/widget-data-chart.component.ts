import { IDatasetServiceDatasetConfig, TimeScaleFormat } from '../../core/interfaces/dataset.interfaces';
import { Component, OnDestroy, ElementRef, viewChild, inject, effect, NgZone, input, untracked, computed, signal, ChangeDetectionStrategy } from '@angular/core';
import { IWidgetSvcConfig } from '../../core/interfaces/widgets-interface';
import { IDatasetServiceDatapoint, IDatasetServiceDataSourceInfo } from '../../core/interfaces/dataset.interfaces';
import { Subscription, distinctUntilChanged, map, of, switchMap } from 'rxjs';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CanvasService } from '../../core/services/canvas.service';
import { DataService } from '../../core/services/data.service';
import { UnitsService } from '../../core/services/units.service';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { ITheme } from '../../core/services/app-service';
import { HistoryChartStreamService, IHistoryChartStreamParams, isHistoryUnavailable } from '../../core/services/history-chart-stream.service';
import { resolveWindowMs, deriveDataSourceInfo } from '../../core/utils/chart-window.util';

import { Chart, ChartConfiguration, ChartData, ChartType, TimeUnit } from 'chart.js';
import 'chartjs-adapter-date-fns';
import { registerChartComponents } from '../../core/utils/chart-registration.util';

registerChartComponents();

interface AnnLine {
  display?: boolean;
  value?: number;
  label: { display?: boolean; content?: string };
}
interface AnnPlugin {
  annotation?: {
    annotations?: Record<string, AnnLine>
  }
}
interface IChartColors {
  valueLine: string,
  valueFill: string,
  averageLine: string,
  averageFill: string,
  averageChartLine: string,
  chartLabel: string,
  chartValue: string
}
interface IDataSetRow { x: number | null, y: number | null }

@Component({
  selector: 'widget-data-chart',
  templateUrl: './widget-data-chart.component.html',
  styleUrl: './widget-data-chart.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WidgetDataChartComponent implements OnDestroy {
  // Host2 functional inputs supplied by host container
  public id = input.required<string>();
  public type = input.required<string>();
  public theme = input.required<ITheme | null>();

  // Host2 runtime directive (merged config)
  private readonly runtime = inject(WidgetRuntimeDirective);

  private readonly ngZone = inject(NgZone);
  private readonly canvasService = inject(CanvasService);
  private readonly unitsService = inject(UnitsService);
  private readonly dataService = inject(DataService);
  private readonly historyStream = inject(HistoryChartStreamService);
  readonly widgetDataChart = viewChild('widgetDataChart', { read: ElementRef });
  public static readonly DEFAULT_CONFIG: IWidgetSvcConfig = {
    displayName: 'Chart Label',
    color: 'contrast',
    filterSelfPaths: true,
    datachartPath: null,
    datachartSource: null,
    datachartAngleRange: null,
    convertUnitTo: null,
    timeScale: 'minute', // second | minute | hour
    period: 10,
    numDecimal: 1,
    inverseYAxis: false,
    datasetAverageArray: 'sma', // sma | ema | dema | avg
    showDataPoints: false,
    showAverageData: true,
    trackAgainstAverage: false,
    showDatasetMinimumValueLine: false,
    showDatasetMaximumValueLine: false,
    showDatasetAverageValueLine: true,
    showDatasetAngleAverageValueLine: false, // legacy (not currently rendered separately)
    showLabel: true,
    showTimeScale: false,
    startScaleAtZero: false,
    verticalChart: false,
    showYScale: false,
    yScaleSuggestedMin: undefined,
    yScaleSuggestedMax: undefined,
    enableMinMaxScaleLimit: false,
    yScaleMin: undefined,
    yScaleMax: undefined,
  };
  public lineChartData: ChartData<'line', { x: number, y: number }[]> = { datasets: [] };
  public lineChartOptions: NonNullable<ChartConfiguration['options']> = {
    parsing: false,
    datasets: { line: { pointRadius: 0, pointHoverRadius: 0, tension: 0.4 } },
    animations: { tension: { easing: 'easeInOutCubic' } }
  };
  public lineChartType: ChartType = 'line';
  private chart: Chart;
  private streamSub: Subscription | null = null;
  private datasetConfig: IDatasetServiceDatasetConfig | null = null;
  private dataSourceInfo: IDatasetServiceDataSourceInfo | null = null;
  private lastVerticalChart: boolean | null | undefined = null;
  // Latest finite annotation values; NaN until real data arrives, which keeps the
  // min/max/average lines and their labels hidden instead of drawing at a placeholder 0.
  private lastAverageValue = NaN;
  private lastMinimumValue = NaN;
  private lastMaximumValue = NaN;
  protected hasPath = computed<boolean>(() => {
    const cfg = this.runtime.options();
    return !!cfg?.datachartPath;
  });
  // True when no history provider is available, so the widget shows the
  // "history unavailable" empty state instead of a blank chart (no recorder live-only fallback).
  protected historyUnavailable = signal<boolean>(false);
  private datachartPath = computed<string | null>(() => this.runtime.options()?.datachartPath ?? null);
  // Reactive resolved measure: resolvePathMeasure() reads a non-signal meta cache, so it is folded
  // through the path's meta subject here to re-emit when the server's units/displayUnits land late or
  // change. distinctUntilChanged gates the pathSignature (and thus the rebuild effect) to genuine
  // measure changes; switchMap re-tracks meta when the configured path changes. Mirrors the live
  // tiles' reactive-measure tick in WidgetStreamsDirective.
  private pathMeasure = toSignal(
    toObservable(this.datachartPath).pipe(
      switchMap(path => path
        ? this.dataService.getPathMetaObservable(path).pipe(map(() => this.unitsService.resolvePathMeasure(path)))
        : of<string | undefined>(undefined)),
      distinctUntilChanged()
    )
  );
  private pathSignature = computed<string | undefined>(() => {
    const cfg = this.runtime.options();
    if (!cfg?.datachartPath) {
      return undefined;
    }
    return [cfg.datachartPath, this.pathMeasure(), cfg.datachartSource, cfg.timeScale, cfg.period, cfg.datachartAngleRange].join('|');
  });
  private previousPathSignature: string | undefined = undefined;

  constructor() {
    // Effect: react to Dataset config changes
    effect(() => {
      const sig = this.pathSignature();

      untracked(() => {
        if (sig !== this.previousPathSignature) {
          const cfg = this.runtime.options();
          if (!cfg) return;
          untracked(() => {
          this.previousPathSignature = sig;
          this.rebuildForDataset(cfg);
          });
        }
      });
    });

    // Effect: react to Display config or theme changes
    effect(() => {
      const cfg = this.runtime.options();
      const theme = this.theme();
      if (!cfg || !theme) return;
      untracked(() => {
        const verticalChanged = this.lastVerticalChart !== null && this.lastVerticalChart !== cfg.verticalChart;
        if (verticalChanged) {
          this.lastVerticalChart = cfg.verticalChart;
          this.rebuildForDataset(cfg);
        } else if (this.chart) {
          // Styling / axis / annotation toggles / showAverageData. setChartOptions rebuilds the
          // annotation plugin wholesale, so annotation visibility is re-applied after it — otherwise
          // an already-enabled avg/min/max line is reset to hidden until the next stream emission.
          this.ensureAverageDatasetPresence();
          this.applyDynamicTrackAverageStyling();
          this.setChartOptions(cfg);
          this.updateAnnotationVisibility();
          this.setDatasetsColors();
          this.ngZone.runOutsideAngular(() => this.chart?.update('none'));
        }
      });
    });

    // Guard: ensure chart builds once canvas exists after initial render
    effect(() => {
      const cfg = this.runtime.options();
      const canvas = this.widgetDataChart();
      const hasPath = this.hasPath();
      if (!cfg || !hasPath || !canvas || this.chart) return;
      untracked(() => this.rebuildForDataset(cfg));
    });
  }

  private rebuildForDataset(cfg: IWidgetSvcConfig): void {
    if (!cfg.datachartPath) return; // Widget not yet configured
    const canvasRef = this.widgetDataChart();
    if (!canvasRef) return; // View not ready yet

    this.streamSub?.unsubscribe(); // Cleanup old subscription & chart data
    this.lineChartData.datasets = [];
    this.lastAverageValue = NaN;
    this.lastMinimumValue = NaN;
    this.lastMaximumValue = NaN;
    this.historyUnavailable.set(false);

    // Synthesize the config + cadence the axis/streaming options expect, derived from the widget's
    // display window.
    const period = cfg.period ?? 10;
    const windowMs = resolveWindowMs(cfg.timeScale as TimeScaleFormat, period);
    this.dataSourceInfo = deriveDataSourceInfo(windowMs);
    this.datasetConfig = {
      uuid: this.id(),
      path: cfg.datachartPath,
      pathSource: cfg.datachartSource ?? 'default',
      baseUnit: '',
      timeScaleFormat: cfg.timeScale as TimeScaleFormat,
      period: period,
      label: '',
      angleDomainOverride: cfg.datachartAngleRange ?? undefined
    };
    this.createDatasets(cfg);
    this.setChartOptions(cfg);
    // Always recreate chart instance on rebuild to ensure orientation/scale axis changes apply
    this.chart?.destroy();
    this.chart = new Chart(canvasRef.nativeElement.getContext('2d'), {
      type: this.lineChartType,
      data: this.lineChartData,
      options: this.lineChartOptions
    });
    this.startStreaming();
    this.ngZone.runOutsideAngular(() => this.chart?.update());
  }

  private setChartOptions(cfg: IWidgetSvcConfig): void {
    // Both fields are always populated by rebuildForDataset() before a chart exists, and
    // setChartOptions() is only ever called once a chart does; theme() can only be transiently
    // null during the app's very first render tick, before AppService publishes the real palette.
    const theme = this.theme();
    const datasetConfig = this.datasetConfig;
    const dataSourceInfo = this.dataSourceInfo;
    if (!theme || !datasetConfig || !dataSourceInfo) return;

    this.lineChartOptions.maintainAspectRatio = false;
    this.lineChartOptions.animation = false;
    this.lineChartOptions.indexAxis = cfg.verticalChart ? 'y' : 'x';

    if (cfg.verticalChart) {
      this.lineChartOptions.scales = {
        y: {
          type: "realtime",
          display: cfg.showTimeScale,
          position: cfg.verticalChart ? "right" : "left",
          suggestedMin: "",
          suggestedMax: "",
          title: {
            display: true,
            text: `Last ${datasetConfig.period} ${datasetConfig.timeScaleFormat}`,
            align: "center",
            color: this.getThemeColors().averageChartLine
          },
          time: {
            unit: datasetConfig.timeScaleFormat as TimeUnit,
            minUnit: "second",
            round: "second",
            displayFormats: {
              // eslint-disable-next-line no-useless-escape
              hour: `k:mm\''`,
              // eslint-disable-next-line no-useless-escape
              minute: `mm\''`,
              second: `ss"`,
              millisecond: "SSS"
            },
          },
          ticks: {
            autoSkip: true,
            color: this.getThemeColors().averageChartLine,
            major: {
              enabled: true
            }
          },
          grid: {
            display: true,
            color: theme.contrastDimmer
          }
        },
        x: {
          type: "linear",
          display: cfg.showYScale,
          position: cfg.verticalChart ? "top" : "bottom",
          suggestedMin: cfg.enableMinMaxScaleLimit ? undefined : cfg.yScaleSuggestedMin,
          suggestedMax: cfg.enableMinMaxScaleLimit ? undefined : cfg.yScaleSuggestedMax,
          min: cfg.enableMinMaxScaleLimit ? cfg.yScaleMin : undefined,
          max: cfg.enableMinMaxScaleLimit ? cfg.yScaleMax : undefined,
          beginAtZero: cfg.startScaleAtZero,
          reverse: cfg.inverseYAxis,
          title: {
            display: false,
            text: "Value Axis",
            align: "center",
            color: this.getThemeColors().averageChartLine
          },
          ticks: {
            maxTicksLimit: 8,
            precision: cfg.numDecimal,
            color: this.getThemeColors().averageChartLine,
            major: {
              enabled: true,
            }
          },
          grid: {
            display: true,
            color: theme.contrastDimmer,
          }
        }
      }
    } else {
      this.lineChartOptions.scales = {
        x: {
          type: "realtime",
          display: cfg.showTimeScale,
          title: {
            display: true,
            text: `Last ${datasetConfig.period} ${datasetConfig.timeScaleFormat}`,
            align: "center",
            color: this.getThemeColors().averageChartLine
          },
          time: {
            unit: datasetConfig.timeScaleFormat as TimeUnit,
            minUnit: "second",
            round: "second",
            displayFormats: {
              // eslint-disable-next-line no-useless-escape
              hour: `k:mm\''`,
              // eslint-disable-next-line no-useless-escape
              minute: `mm\''`,
              second: `ss"`,
              millisecond: "SSS"
            },
          },
          ticks: {
            autoSkip: true,
            color: this.getThemeColors().averageChartLine,
            major: {
              enabled: true
            }
          },
          grid: {
            display: true,
            color: theme.contrastDimmer
          }
        },
        y: {
          display: cfg.showYScale,
          position: "right",
          suggestedMin: cfg.enableMinMaxScaleLimit ? undefined : cfg.yScaleSuggestedMin,
          suggestedMax: cfg.enableMinMaxScaleLimit ? undefined : cfg.yScaleSuggestedMax,
          min: cfg.enableMinMaxScaleLimit ? cfg.yScaleMin : undefined,
          max: cfg.enableMinMaxScaleLimit ? cfg.yScaleMax : undefined,
          beginAtZero: cfg.startScaleAtZero,
          reverse: cfg.inverseYAxis,
          title: {
            display: false,
            text: "Value Axis",
            align: "center",
            color: this.getThemeColors().averageChartLine
          },
          ticks: {
            maxTicksLimit: 8,
            precision: cfg.numDecimal,
            color: this.getThemeColors().averageChartLine,
            major: {
              enabled: true,
            }
          },
          grid: {
            display: true,
            color: theme.contrastDimmer,
          }
        }
      }
    }
    this.lineChartOptions.plugins = {
      title: {
        display: true,
        align: "end",
        padding: {
          top: 3,
          bottom: 0
        },
        text: "",
        font: {
          size: 32,

        },
        color: this.getThemeColors().chartValue
      },
      subtitle: {
        display: cfg.showLabel,
        align: "start",
        padding: {
          top: -35,
          bottom: 20
        },
        text: `  ${cfg.displayName}`,
        font: {
          size: 22,
        },
        color: this.getThemeColors().chartLabel
      },
      annotation: {
        annotations: {
          minimumLine: {
            type: 'line',
            scaleID: cfg.verticalChart ? 'x' : 'y',
            display: false,
            value: undefined,
            drawTime: 'afterDatasetsDraw',
            label: {
              display: false,
              position: "start",
              yAdjust: 12,
              padding: 4,
              color: this.getThemeColors().averageChartLine,
              backgroundColor: 'rgba(63,63,63,0.0)'
            }
          },
          maximumLine: {
            type: 'line',
            scaleID: cfg.verticalChart ? 'x' : 'y',
            display: false,
            value: undefined,
            drawTime: 'afterDatasetsDraw',
            label: {
              display: false,
              position: "start",
              yAdjust: -12,
              padding: 4,
              color: this.getThemeColors().averageChartLine,
              backgroundColor: 'rgba(63,63,63,0.0)'
            }
          },
          averageLine: {
            type: 'line',
            scaleID: cfg.verticalChart ? 'x' : 'y',
            display: false,
            value: undefined,
            borderDash: [6, 6],
            borderColor: this.getThemeColors().averageChartLine,
            drawTime: 'afterDatasetsDraw',
            label: {
              display: false,
              position: "start",
              padding: 4,
              color: this.getThemeColors().chartValue,
              backgroundColor: 'rgba(63,63,63,0.7)'
            }
          }
        }
      },
      legend: {
        display: false
      },
       streaming: {
        duration: dataSourceInfo.maxDataPoints * dataSourceInfo.sampleTime,
        delay: dataSourceInfo.sampleTime,
        frameRate: datasetConfig.timeScaleFormat === "day" ? 5 : datasetConfig.timeScaleFormat === "hour" ? 8 : datasetConfig.timeScaleFormat === "minute" ? 15 : 30,
       }
    }
  }

  private createDatasets(cfg: IWidgetSvcConfig): void {
    let valueFillDirection: string | boolean;
    let averageFillDirection: string | boolean;
    if (cfg.inverseYAxis && cfg.trackAgainstAverage) {
      valueFillDirection = "start";
      averageFillDirection = false;
    } else if (cfg.inverseYAxis && !cfg.trackAgainstAverage) {
      valueFillDirection = false;
      averageFillDirection = "start";
    } else if (!cfg.inverseYAxis && cfg.trackAgainstAverage) {
      valueFillDirection = true;
      averageFillDirection = false;
    } else {
      valueFillDirection = false;
      averageFillDirection = true;
    }

    this.lineChartData.datasets = [];
    this.lineChartData.datasets.push(
      {
        label: 'Value',
        data: [],
        order: cfg.trackAgainstAverage ? 1 : 0,
        parsing: false,
        tension: 0,
        pointRadius: cfg.showDataPoints ? (cfg.trackAgainstAverage ? 0 : 1.5) : 0,
        pointHoverRadius: 0,
        pointHitRadius: 0,
        borderWidth: cfg.trackAgainstAverage ? 0 : (cfg.showDataPoints ? 0 : 3),
        fill: valueFillDirection,
      }
    );

    if (cfg.showAverageData) {
      this.lineChartData.datasets.push(
        {
          label: 'Average',
          data: [],
          order: cfg.trackAgainstAverage ? 0 : 1,
          parsing: false,
          tension: 0.4,
          pointRadius: cfg.showDataPoints ? (cfg.trackAgainstAverage ? 1.5 : 0) : 0,
          pointHoverRadius: 0,
          pointHitRadius: 0,
          borderWidth: cfg.trackAgainstAverage ? (cfg.showDataPoints ? 0 : 3) : 0,
          fill: averageFillDirection,
        }
      );
    }
    this.setDatasetsColors();
  }

  private setDatasetsColors(): void {
    this.lineChartData.datasets.forEach((dataset) => {
      if (dataset.label === 'Value') {
        dataset.borderColor = this.getThemeColors().valueLine;
        dataset.backgroundColor = this.getThemeColors().valueFill;
      } else if (dataset.label === 'Average') {
        dataset.borderColor = this.getThemeColors().averageLine;
        dataset.backgroundColor = this.getThemeColors().averageFill;
      }
    });
  }

  // Ensure average dataset added or removed when showAverageData toggles without full rebuild
  private ensureAverageDatasetPresence(): void {
    const cfg = this.runtime.options();
    if (!cfg || !this.chart) return;
    const hasAverage = this.lineChartData.datasets.some(d => d.label === 'Average');
    if (cfg.showAverageData && !hasAverage) {
      // Insert average dataset maintaining order semantics
      const valueIdx = this.lineChartData.datasets.findIndex(d => d.label === 'Value');
      if (valueIdx >= 0) {
        const fillDir = cfg.inverseYAxis
          ? (cfg.trackAgainstAverage ? false : 'start')
          : (cfg.trackAgainstAverage ? false : true);
        this.lineChartData.datasets.push({
          label: 'Average', data: [], order: cfg.trackAgainstAverage ? 0 : 1, parsing: false, tension: 0.4,
          pointRadius: 0, pointHoverRadius: 0, pointHitRadius: 0, borderWidth: cfg.trackAgainstAverage ? 3 : 0, fill: fillDir
        });
      }
    } else if (!cfg.showAverageData && hasAverage) {
      this.lineChartData.datasets = this.lineChartData.datasets.filter(d => d.label !== 'Average');
    }
  }

  // Recompute mutable dataset styling that depends on trackAgainstAverage + inverseYAxis without full rebuild
  private applyDynamicTrackAverageStyling(): void {
    const cfg = this.runtime.options();
    if (!cfg) return;
    const valueDs = this.lineChartData.datasets.find(d => d.label === 'Value');
    const avgDs = this.lineChartData.datasets.find(d => d.label === 'Average');
    // Fill directions replicate legacy matrix
    let valueFill: string | boolean;
    let averageFill: string | boolean;
    if (cfg.inverseYAxis && cfg.trackAgainstAverage) {
      valueFill = 'start';
      averageFill = false;
    } else if (cfg.inverseYAxis && !cfg.trackAgainstAverage) {
      valueFill = false;
      averageFill = 'start';
    } else if (!cfg.inverseYAxis && cfg.trackAgainstAverage) {
      valueFill = true; // fill downwards from average line
      averageFill = false;
    } else {
      valueFill = false;
      averageFill = true;
    }
    if (valueDs) {
      valueDs.order = cfg.trackAgainstAverage ? 1 : 0;
      valueDs.borderWidth = cfg.trackAgainstAverage ? 0 : 3;
      valueDs.fill = valueFill;
    }
    if (avgDs) {
      avgDs.order = cfg.trackAgainstAverage ? 0 : 1;
      avgDs.borderWidth = cfg.trackAgainstAverage ? 3 : 0;
      avgDs.fill = averageFill;
    }
  }

  private updateAnnotationVisibility(): void {
    const cfg = this.runtime.options();
    if (!cfg || !this.chart) return;
    const annCfg = (this.chart.options.plugins as unknown as AnnPlugin).annotation?.annotations;
    if (!annCfg) return;
    this.applyAnnotationLine(annCfg.minimumLine, cfg.showDatasetMinimumValueLine, this.lastMinimumValue, cfg.numDecimal);
    this.applyAnnotationLine(annCfg.maximumLine, cfg.showDatasetMaximumValueLine, this.lastMaximumValue, cfg.numDecimal);
    this.applyAnnotationLine(annCfg.averageLine, cfg.showDatasetAverageValueLine, this.lastAverageValue, cfg.numDecimal);
  }

  // The line and its label stay hidden until the tracked value is finite, so an enabled line never
  // renders at a placeholder 0 with an empty label before real data arrives.
  private applyAnnotationLine(line: AnnLine | undefined, enabled: boolean | undefined, value: number, numDecimal: number | undefined): void {
    if (!line) return;
    const visible = Boolean(enabled) && Number.isFinite(value);
    line.display = visible;
    line.label.display = visible;
    if (visible) {
      line.value = value;
      line.label.content = value.toFixed(numDecimal);
    }
  }

  private getThemeColors(): IChartColors {
    // Fallback (transparent) sentinel: theme() is only transiently null during the app's very
    // first render tick, and widgetColor only escapes the switch below for a corrupted/legacy
    // config value outside the fixed palette offered by the widget's color picker.
    const NO_COLOR = 'rgba(0,0,0,0)';
    const widgetColor = this.runtime.options()?.color;
    const colors: IChartColors = {
      valueLine: NO_COLOR,
      valueFill: NO_COLOR,
      averageLine: NO_COLOR,
      averageFill: NO_COLOR,
      averageChartLine: NO_COLOR,
      chartLabel: NO_COLOR,
      chartValue: NO_COLOR
    };

    const theme = this.theme();
    if (!theme) return colors;

    switch (widgetColor) {
      case "contrast":
        if (this.runtime.options()?.trackAgainstAverage) {
          colors.valueLine = theme.contrastDimmer;
          colors.valueFill = theme.contrastDimmer;
          colors.averageLine = theme.contrast;
          colors.averageFill = theme.contrast;
          colors.chartValue = colors.averageLine;
        } else {
          colors.valueLine = theme.contrast;
          colors.valueFill = theme.contrast;
          colors.averageLine = theme.contrastDimmer;
          colors.averageFill = theme.contrastDimmer;
          colors.chartValue = theme.contrast;
        }
        colors.averageChartLine = theme.contrastDim;
        colors.chartLabel = theme.contrastDim;
        break;

      case "blue":
        if (this.runtime.options()?.trackAgainstAverage) {
          colors.valueLine = theme.blueDimmer;
          colors.valueFill = theme.blueDimmer;
          colors.averageLine = theme.blue;
          colors.averageFill = theme.blue;
          colors.chartValue = colors.averageLine;
        } else {
          colors.valueLine = theme.blue;
          colors.valueFill = theme.blue;
          colors.averageLine = theme.blueDimmer;
          colors.averageFill = theme.blueDimmer;
          colors.chartValue = colors.valueFill;
        }
        colors.averageChartLine = theme.blueDim;
        colors.chartLabel = theme.contrastDim;
        break;

      case "green":
        if (this.runtime.options()?.trackAgainstAverage) {
          colors.valueLine = theme.greenDimmer;
          colors.valueFill = theme.greenDimmer;
          colors.averageLine = theme.green;
          colors.averageFill = theme.green;
          colors.chartValue = colors.averageLine;
        } else {
          colors.valueLine = theme.green;
          colors.valueFill = theme.green;
          colors.averageLine = theme.greenDimmer;
          colors.averageFill = theme.greenDimmer;
          colors.chartValue = colors.valueFill;
        }
        colors.averageChartLine = theme.greenDim;
        colors.chartLabel = theme.contrastDim;
        break;

      case "pink":
        if (this.runtime.options()?.trackAgainstAverage) {
          colors.valueLine = theme.pinkDimmer;
          colors.valueFill = theme.pinkDimmer;
          colors.averageLine = theme.pink;
          colors.averageFill = theme.pink;
          colors.chartValue = colors.averageLine;
        } else {
          colors.valueLine = theme.pink;
          colors.valueFill = theme.pink;
          colors.averageLine = theme.pinkDimmer;
          colors.averageFill = theme.pinkDimmer;
          colors.chartValue = colors.valueFill;
        }
        colors.averageChartLine = theme.pinkDim;
        colors.chartLabel = theme.contrastDim;
        break;

      case "orange":
        if (this.runtime.options()?.trackAgainstAverage) {
          colors.valueLine = theme.orangeDimmer;
          colors.valueFill = theme.orangeDimmer;
          colors.averageLine = theme.orange;
          colors.averageFill = theme.orange;
          colors.chartValue = colors.averageLine;
        } else {
          colors.valueLine = theme.orange;
          colors.valueFill = theme.orange;
          colors.averageLine = theme.orangeDimmer;
          colors.averageFill = theme.orangeDimmer;
          colors.chartValue = colors.valueFill;
        }
        colors.averageChartLine = theme.orangeDim;
        colors.chartLabel = theme.contrastDim;
        break;

      case "purple":
        if (this.runtime.options()?.trackAgainstAverage) {
          colors.valueLine = theme.purpleDimmer;
          colors.valueFill = theme.purpleDimmer;
          colors.averageLine = theme.purple;
          colors.averageFill = theme.purple;
          colors.chartValue = colors.averageLine;
        } else {
          colors.valueLine = theme.purple;
          colors.valueFill = theme.purple;
          colors.averageLine = theme.purpleDimmer;
          colors.averageFill = theme.purpleDimmer;
          colors.chartValue = colors.valueFill;
        }
        colors.averageChartLine = theme.purpleDim;
        colors.chartLabel = theme.contrastDim;
        break;

      case "grey":
        if (this.runtime.options()?.trackAgainstAverage) {
          colors.valueLine = theme.greyDimmer;
          colors.valueFill = theme.greyDimmer;
          colors.averageLine = theme.grey;
          colors.averageFill = theme.grey;
          colors.chartValue = colors.averageLine;
        } else {
          colors.valueLine = theme.grey;
          colors.valueFill = theme.grey;
          colors.averageLine = theme.greyDimmer;
          colors.averageFill = theme.greyDimmer;
          colors.chartValue = colors.valueFill;
        }
        colors.averageChartLine = theme.greyDim;
        colors.chartLabel = theme.contrastDim;
        break;

      case "yellow":
        if (this.runtime.options()?.trackAgainstAverage) {
          colors.valueLine = theme.yellowDimmer;
          colors.valueFill = theme.yellowDimmer;
          colors.averageLine = theme.yellow;
          colors.averageFill = theme.yellow;
          colors.chartValue = colors.averageLine;
        } else {
          colors.valueLine = theme.yellow;
          colors.valueFill = theme.yellow;
          colors.averageLine = theme.yellowDimmer;
          colors.averageFill = theme.yellowDimmer;
          colors.chartValue = colors.valueFill;
        }
        colors.averageChartLine = theme.yellowDim;
        colors.chartLabel = theme.contrastDim;
        break;
    }
    return colors;
  }

  private startStreaming(): void {
    const cfg = this.runtime.options();
    if (!cfg?.datachartPath) return;
    this.streamSub?.unsubscribe();

    // Always set by rebuildForDataset() just before startStreaming() is called (its only caller).
    const info = this.dataSourceInfo;
    if (!info) return;
    const params: IHistoryChartStreamParams = {
      path: cfg.datachartPath,
      source: cfg.datachartSource ?? 'default',
      angleDomainOverride: cfg.datachartAngleRange === 'signed' || cfg.datachartAngleRange === 'direction'
        ? cfg.datachartAngleRange
        : undefined,
      windowMs: resolveWindowMs(cfg.timeScale as TimeScaleFormat, cfg.period ?? 10),
      sampleTime: info.sampleTime,
      maxDataPoints: info.maxDataPoints,
      smoothingPeriod: info.smoothingPeriod
    };
    this.streamSub = this.historyStream.getBackfillThenLive(params).subscribe(emission => {
      if (isHistoryUnavailable(emission)) {
        this.historyUnavailable.set(true);
        return;
      }
      this.historyUnavailable.set(false);
      this.handleDatasetEmission(emission, cfg);
    });
  }

  private handleDatasetEmission(dsPointOrBatch: IDatasetServiceDatapoint[] | IDatasetServiceDatapoint, cfg: IWidgetSvcConfig): void {
    if (!this.chart) return;
    if (Array.isArray(dsPointOrBatch)) {
      const valueRows = this.transformDatasetRows(dsPointOrBatch, 0);
      this.chart.data.datasets[0].data.push(...valueRows);
      if (cfg.showAverageData && this.lineChartData.datasets[1]) {
        const avgRows = this.transformDatasetRows(dsPointOrBatch, cfg.datasetAverageArray);
        this.chart.data.datasets[1].data.push(...avgRows);
      }

      const lastBatchPoint = dsPointOrBatch[dsPointOrBatch.length - 1];
      if (lastBatchPoint) {
        this.applyTitleAndAnnotationValues(lastBatchPoint, cfg);
      }
    } else {
      const valueRow = this.transformDatasetRows([dsPointOrBatch], 0)[0];
      this.chart.data.datasets[0].data.push(valueRow);
      if (cfg.showAverageData && this.lineChartData.datasets[1]) {
        const avgRow = this.transformDatasetRows([dsPointOrBatch], cfg.datasetAverageArray)[0];
        this.chart.data.datasets[1].data.push(avgRow);
      }
      this.applyTitleAndAnnotationValues(dsPointOrBatch, cfg);
    }
    this.ngZone.runOutsideAngular(() => this.chart?.update('none'));
  }

  private applyTitleAndAnnotationValues(point: IDatasetServiceDatapoint, cfg: IWidgetSvcConfig): void {
    const measure = this.unitsService.resolvePathMeasure(cfg.datachartPath ?? '');
    const trackValue: number = cfg.trackAgainstAverage ? (point.data.sma ?? point.data.value) : point.data.value;
    const convertedTrack = this.unitsService.convertToUnit(measure, trackValue);
    if (convertedTrack !== null && Number.isFinite(convertedTrack)) {
      const titlePlugin = this.chart.options.plugins?.title;
      if (titlePlugin) {
        titlePlugin.text = `${convertedTrack.toFixed(cfg.numDecimal)} ${this.unitsService.getUnitDisplaySymbol(measure)} `;
      }
    }

    // A missing rolling stat (insufficient history yet) converts like the pre-existing code's
    // implicit `+undefined` did: NaN in, NaN out, so the finite-checks below skip it exactly as before.
    const lastAverage = this.unitsService.convertToUnit(measure, point.data.lastAverage ?? NaN);
    const lastMinimum = this.unitsService.convertToUnit(measure, point.data.lastMinimum ?? NaN);
    const lastMaximum = this.unitsService.convertToUnit(measure, point.data.lastMaximum ?? NaN);

    if (lastAverage !== null && Number.isFinite(lastAverage)) this.lastAverageValue = lastAverage;
    if (lastMinimum !== null && Number.isFinite(lastMinimum)) this.lastMinimumValue = lastMinimum;
    if (lastMaximum !== null && Number.isFinite(lastMaximum)) this.lastMaximumValue = lastMaximum;

    this.updateAnnotationVisibility();
  }

  private transformDatasetRows(rows: IDatasetServiceDatapoint[], datasetType): IDataSetRow[] {
    const cfg = this.runtime.options();
    if (!cfg) return [];
    const measure = this.unitsService.resolvePathMeasure(cfg.datachartPath ?? '');
    const convert = (v: number) => this.unitsService.convertToUnit(measure, v);
    const verticalChart = cfg.verticalChart;
    const avgKey = cfg.datasetAverageArray ?? 'sma';

    return rows.map(row => {
      if (verticalChart) {
        if (datasetType === 0) {
          return { x: convert(row.data.value), y: row.timestamp };
        } else {
          const avgMap = {
            sma: row.data.sma,
            ema: row.data.ema,
            dema: row.data.doubleEma,
            avg: row.data.lastAverage
          };
          return { x: convert(avgMap[avgKey]), y: row.timestamp };
        }
      } else {
        if (datasetType === 0) {
          return { x: row.timestamp, y: convert(row.data.value) };
        } else {
          const avgMap = {
            sma: row.data.sma,
            ema: row.data.ema,
            dema: row.data.doubleEma,
            avg: row.data.lastAverage
          };
          return { x: row.timestamp, y: convert(avgMap[avgKey]) };
        }
      }
    });
  }

  ngOnDestroy(): void {
    this.streamSub?.unsubscribe();
    this.chart?.destroy();
    const canvas = this.widgetDataChart?.()?.nativeElement as HTMLCanvasElement | undefined;
    this.canvasService.releaseCanvas(canvas, { clear: true, removeFromDom: true });
  }
}
