import { Component, OnDestroy, AfterViewInit, ElementRef, inject, signal, viewChild, effect, untracked, input, OnInit, computed } from '@angular/core';
import { ChangeDetectionStrategy } from '@angular/core';
import { IWidgetSvcConfig } from '../../core/interfaces/widgets-interface';
import { MinichartComponent } from '../minichart/minichart.component';
import { reduceMinMax } from './numeric-minmax.util';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective } from '../../core/directives/widget-streams.directive';
import { IPathUpdate } from '../../core/services/data.service';
import { CanvasService } from '../../core/services/canvas.service';
import { UnitsService } from '../../core/services/units.service';
import { ITheme } from '../../core/services/app-service';
import { getColors } from '../../core/utils/themeColors.utils';
import { States } from '../../core/interfaces/signalk-interfaces';

/** Measures whose value arrives already formatted as a string, so it is drawn verbatim. */
const PRE_FORMATTED_MEASURES = ['latitudeSec', 'latitudeMin', 'longitudeSec', 'longitudeMin', 'D HH:MM:SS'];
/** Measures whose '%' this widget appends to the value text itself. */
const PERCENT_MEASURES = ['percent', 'percentraw'];
/** Measures that must not put a symbol in the label row: it is already in the value, or there is none. */
const UNLABELLED_MEASURES = new Set([...PRE_FORMATTED_MEASURES, ...PERCENT_MEASURES, 'ratio']);
/** Fraction of the tile height given to the label row. */
const LABEL_ROW_FRACTION = 0.1;

@Component({
  selector: 'widget-numeric',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './widget-numeric.component.html',
  styleUrls: ['./widget-numeric.component.scss'],
  imports: [MinichartComponent]
})
export class WidgetNumericComponent implements OnInit, AfterViewInit, OnDestroy {
  public id = input.required<string>();
  public type = input.required<string>();
  public theme = input.required<ITheme|null>();
  public static readonly DEFAULT_CONFIG: IWidgetSvcConfig = {
    supportAutomaticHistoricalSeries: true,
    displayName: 'Gauge Label',
    filterSelfPaths: true,
    paths: {
      "numericPath": {
        description: "Numeric Data",
        path: null,
        source: null,
        pathType: "number",
        suppressBootstrapNull: true,
        isPathConfigurable: true,
        convertUnitTo: "unitless",
        showPathSkUnitsFilter: true,
        pathSkUnitsFilter: null
      }
    },
    showMax: false,
    showMin: false,
    numDecimal: 1,
    showMiniChart: false,
    yScaleMin: 0,
    yScaleMax: 10,
    inverseYAxis: false,
    verticalChart: false,
    color: 'contrast',
    updateInterval: 500,
    enableTimeout: false,
    dataTimeout: 5,
    ignoreZones: false
  };
  private readonly runtime = inject(WidgetRuntimeDirective);
  private readonly stream = inject(WidgetStreamsDirective);

  private readonly canvas = inject(CanvasService);
  private readonly unitsService = inject(UnitsService);
  protected miniChart = viewChild(MinichartComponent);
  private canvasMainRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvasMainRef');

  protected showMiniChart = signal<boolean>(false);
  protected labelColor = signal<string>('');
  private canvasElement: HTMLCanvasElement;
  private canvasCtx: CanvasRenderingContext2D | null;
  private cssWidth = 0;
  private cssHeight = 0;
  private foregroundBitmap: HTMLCanvasElement | null = null;
  private foregroundBitmapText: string | null = null;

  private dataValue: number | null = null;
  private effectiveUnit = signal<string>('');
  private maxValue: number | null = null;
  private minValue: number | null = null;
  private valueColor: string | undefined = undefined;
  private valueStateColor: string | undefined = undefined;
  private maxValueTextWidth = 0;
  private maxValueTextHeight = 0;
  private maxMinMaxTextWidth = 0;
  private maxMinMaxTextHeight = 0;
  private streamRegistered = false;
  private pathDataState: States | null = null;
  private isDestroyed = false;
  private lastSubscriptionSignature: string | null = null;

  private subscriptionSignature = computed(() => {
    const cfg = this.runtime?.options();
    const pathCfg = cfg?.paths?.['numericPath'];
    if (!pathCfg?.path) return null;
    const src = (pathCfg.source?.trim() || 'default');
    return [
      pathCfg.path,
      pathCfg.pathType,
      cfg?.updateInterval,
      pathCfg.convertUnitTo,
      src,
      pathCfg.suppressBootstrapNull ? '1' : '0'
    ].join('|');
  });

  private onNumericValue = (newValue: IPathUpdate) => {
    const dataValue = newValue.data.value as number | null;
    this.dataValue = dataValue;
    this.effectiveUnit.set(newValue.data.measure ?? '');
    const minMax = reduceMinMax(this.minValue, this.maxValue, dataValue);
    this.minValue = minMax.min;
    this.maxValue = minMax.max;

    if (!this.runtime?.options()?.ignoreZones) {
      if (this.pathDataState !== newValue.state) {
        this.pathDataState = newValue.state as States;
        const theme = this.theme();
        switch (newValue.state) {
          case States.Alarm:
            this.valueStateColor = theme?.zoneAlarm ?? this.valueColor;
            break;
          case States.Warn:
            this.valueStateColor = theme?.zoneWarn ?? this.valueColor;
            break;
          case States.Alert:
            this.valueStateColor = theme?.zoneAlert ?? this.valueColor;
            break;
          default:
            this.valueStateColor = this.valueColor;
            break;
        }
      }
    }
    this.drawWidget();
  };

  constructor() {
    this.showMiniChart.set(this.runtime.options()?.showMiniChart ?? false);
    effect(() => {
      const theme = this.theme();
      const color = this.runtime?.options()?.color;

      untracked(() => {
        if (theme && color !== undefined) {
          this.setColors();
          this.drawWidget();
        }
      });
    });

    effect(() => {
      const sig = this.subscriptionSignature();
      untracked(() => {
        if (this.isDestroyed || !this.canvasCtx) return;

        // Guard: if subscription signature unchanged and already subscribed, skip
        if (sig === this.lastSubscriptionSignature && this.streamRegistered) {
          return;
        }

        // Subscription changed: reset state and subscribe
        this.minValue = null;
        this.maxValue = null;
        this.dataValue = null;
        this.pathDataState = null;
        this.effectiveUnit.set('');
        this.lastSubscriptionSignature = sig;

        if (sig) {
          this.stream?.observe('numericPath', this.onNumericValue);
          this.streamRegistered = true;
          this.updateMiniChartVisibility();
        }
      });
    });

    effect(() => {
      const show = this.showMiniChart();
      const chart = this.miniChart();
      const cfg = this.runtime?.options();
      const pathInfo = cfg?.paths?.['numericPath'];
      const effUnit = this.effectiveUnit();
      const miniChartSignature = [
        cfg?.showMiniChart ? '1' : '0',
        pathInfo?.path ?? '',
        pathInfo?.source ?? 'default',
        effUnit,
        cfg?.numDecimal ?? '',
        cfg?.yScaleMin ?? '',
        cfg?.yScaleMax ?? '',
        cfg?.inverseYAxis ? '1' : '0',
        cfg?.verticalChart ? '1' : '0',
        cfg?.color ?? ''
      ].join('|');
      if (!miniChartSignature) return;
      if (!show) return;
      if (!chart) return; // will re-run when present
      this.setMiniChart(chart);
      chart.startChart();
    });
  }

  ngOnInit(): void {
    this.setColors();
    this.canvasElement = this.canvasMainRef().nativeElement;
    this.canvasCtx = this.canvasElement.getContext('2d');
    this.canvas.registerCanvas(this.canvasElement, {
      autoRelease: true,
      onResize: (w, h) => {
        this.cssWidth = w;
        this.cssHeight = h;
        this.drawWidget();
      },
    });
    // The label row is laid out from measured text, and a cold boot measures the fallback font:
    // drop the cached bitmap once the web font settles so the row is re-fitted to real metrics.
    this.canvas.whenFontsReady().then(() => {
      if (this.isDestroyed) return;
      this.foregroundBitmap = null;
      this.drawWidget();
    }).catch(() => { /* ignore */ });
  }

  ngAfterViewInit(): void {
    if (this.isDestroyed) return;

    // Effects will auto-run when subscriptionSignature is first accessed
    // This is a sanity check in case subscription effect hasn't fired yet
    if (!this.streamRegistered && this.subscriptionSignature()) {
      this.stream?.observe('numericPath', this.onNumericValue);
      this.streamRegistered = true;
      this.updateMiniChartVisibility();
    }
  }

  private labelRowHeight(): number {
    return Math.round(this.cssHeight * LABEL_ROW_FRACTION);
  }

  /**
   * Baseline the label and the unit sit on, which is also the bottom edge of their band: everything
   * below it belongs to the value, and {@link drawValue} sizes and centres itself off this number.
   */
  private labelBaselineY(): number {
    return this.canvas.EDGE_BUFFER + this.labelRowHeight();
  }

  /** Top edge of the band {@link drawMinMax} writes into, or the card bottom when it draws nothing. */
  private valueBoxBottom(): number {
    const cfg = this.runtime.options();
    return (cfg?.showMin || cfg?.showMax) ? this.cssHeight - this.maxMinMaxTextHeight : this.cssHeight;
  }

  private calculateMaxMinTextDimensions(): void {
    this.maxMinMaxTextWidth = Math.floor(this.cssWidth * 0.57);
    this.maxMinMaxTextHeight = Math.floor(this.cssHeight * 0.1);
    // The value owns the card between the label row and the min/max row. This is an em box and
    // glyphs fill about 70% of it, so the fitted text keeps clear of both.
    this.maxValueTextWidth = Math.floor(this.cssWidth * 0.90);
    this.maxValueTextHeight = Math.max(1, Math.floor(this.valueBoxBottom() - this.labelBaselineY()));
  }

  private updateMiniChartVisibility(): void {
    this.showMiniChart.set(!!this.runtime.options()?.showMiniChart);
  }

  private setMiniChart(chart: MinichartComponent): void {
    const cfg = this.runtime.options();
    if (!cfg) return;
    const pathInfo = cfg.paths?.['numericPath'];
    chart.dataPath = pathInfo?.path ?? null;
    chart.dataSource = pathInfo?.source ?? 'default';
    chart.color = cfg.color ?? 'contrast';
    chart.convertUnitTo = this.effectiveUnit();
    chart.numDecimal = cfg.numDecimal ?? 1;
    chart.yScaleMin = cfg.yScaleMin ?? 0;
    chart.yScaleMax = cfg.yScaleMax ?? 10;
    chart.inverseYAxis = cfg.inverseYAxis ?? false;
    chart.verticalChart = cfg.verticalChart ?? false;
  }

  private setColors(): void {
    const cfg = this.runtime.options();
    const theme = this.theme();
    if (!cfg || !theme) return;
    this.labelColor.set(getColors(cfg.color ?? 'contrast', theme).dim);
    this.valueStateColor = this.valueColor = getColors(cfg.color ?? 'contrast', theme).color;
    this.foregroundBitmap = null;
    this.foregroundBitmapText = null;
  }

  private drawWidget(): void {
    const ctx = this.canvasCtx;
    if (!ctx) return;
    const cfg = this.runtime.options();
    if (!cfg) return;
    const unit = this.effectiveUnit();
    const displayName = cfg.displayName ?? 'Gauge Label';
    // Background-color halo: invisible over the empty card, carves the value out only where the
    // floored label/unit overlap it. Requires the label/unit to be composited above the value below.
    const haloColor = this.theme()?.cardColor || undefined;
    const fgText = displayName + '|' + unit;
    // The boxes track the min/max rows, which a config edit can toggle without a resize.
    this.calculateMaxMinTextDimensions();

    if (!this.foregroundBitmap ||
        this.foregroundBitmap.width !== this.canvasElement.width ||
        this.foregroundBitmap.height !== this.canvasElement.height ||
        this.foregroundBitmapText !== fgText) {
      this.foregroundBitmap = this.canvas.renderStaticToBitmap(
        ctx,
        this.cssWidth,
        this.cssHeight,
        (bitmapCtx) => this.drawLabelRow(bitmapCtx, displayName, unit, haloColor)
      );
      this.foregroundBitmapText = fgText;
    }

    this.canvas.clearCanvas(ctx, this.cssWidth, this.cssHeight);
    this.drawValue(ctx);
    if (cfg.showMax || cfg.showMin) {
      this.drawMinMax(ctx);
    }
    // Label + unit composite last so the background-color halo can knock the value out behind them.
    this.canvas.drawTextBitmap(ctx, this.foregroundBitmap, this.cssWidth, this.cssHeight);
  }

  /**
   * Label and unit share the top band — one in each corner — so chrome costs the tile a single row
   * and the value keeps everything below it. Both sit on the band's bottom edge as a common
   * baseline, which lines them up even though the unit is set bold and at its own size. The unit
   * gets its share of the row first: it is the shorter of the two and the one the reading needs.
   */
  private drawLabelRow(ctx: CanvasRenderingContext2D, displayName: string, unit: string, haloColor: string | undefined): void {
    const edge = this.canvas.EDGE_BUFFER;
    const rowHeight = this.labelRowHeight();
    const baselineY = this.labelBaselineY();
    const unitBoxWidth = Math.floor(this.cssWidth * 0.25);
    const symbol = UNLABELLED_MEASURES.has(unit) ? '' : this.unitsService.getRenderableUnitSymbol(unit);
    let labelWidth = this.cssWidth - 2 * edge;

    if (symbol) {
      const unitFontSize = this.canvas.calculateOptimalFontSize(ctx, symbol, unitBoxWidth, rowHeight, 'bold', this.canvas.MIN_UNIT_PX);
      labelWidth -= this.canvas.measureTextWidth(symbol, `bold ${unitFontSize}px ${this.canvas.DEFAULT_FONT}`) + edge;
    }

    const label = this.truncateLabel(displayName, labelWidth);
    if (label) {
      this.canvas.drawText(
        ctx,
        label,
        edge,
        baselineY,
        labelWidth,
        rowHeight,
        'normal',
        this.labelColor(),
        'left',
        'alphabetic',
        haloColor,
        this.canvas.MIN_LABEL_PX
      );
    }

    if (symbol) {
      this.canvas.drawText(
        ctx,
        symbol,
        this.cssWidth - edge,
        baselineY,
        unitBoxWidth,
        rowHeight,
        'bold',
        this.valueColor,
        'right',
        'alphabetic',
        haloColor,
        this.canvas.MIN_UNIT_PX
      );
    }
  }

  /**
   * Fits a name to its share of the row, ellipsising it and dropping it entirely when even one
   * character will not fit. A label is never drawn below {@link CanvasService.MIN_LABEL_PX} and a
   * floored draw carries no width cap, so anything that does not fit at that size runs into the
   * unit. Measured and sliced by code point, so an emoji in the name cannot be cut in half.
   */
  private truncateLabel(text: string, maxWidth: number): string {
    if (maxWidth <= 0) return '';
    const font = `normal ${this.canvas.MIN_LABEL_PX}px ${this.canvas.DEFAULT_FONT}`;
    if (this.canvas.measureTextWidth(text, font) <= maxWidth) return text;
    const glyphs = Array.from(text);
    while (glyphs.length > 0 && this.canvas.measureTextWidth(`${glyphs.join('')}…`, font) > maxWidth) {
      glyphs.pop();
    }
    return glyphs.length > 0 ? `${glyphs.join('')}…` : '';
  }

  private drawValue(ctx: CanvasRenderingContext2D): void {
    const valueText = this.getValueText();
    this.canvas.drawText(
      ctx,
      valueText,
      Math.floor(this.cssWidth / 2),
      Math.floor((this.labelBaselineY() + this.valueBoxBottom()) / 2),
      this.maxValueTextWidth,
      this.maxValueTextHeight,
      'bold',
      this.valueStateColor
    );
  }

  private getValueText(): string {
    const dataValue = this.dataValue;
    if (dataValue === null) return "--";
    const cfg = this.runtime.options();
    // The format decision must follow the measure the value was actually converted to (the tagged
    // effective measure), not the stored convertUnitTo: a display path's resolved measure can differ,
    // and a position/duration format measure arrives as a pre-formatted string — testing the stored
    // unit here would call toFixed() on that string (crash) or print a raw number for a format measure.
    const measure = this.effectiveUnit();
    if (PRE_FORMATTED_MEASURES.includes(measure)) {
      return dataValue.toString();
    }
    return this.applyDecorations(dataValue.toFixed(cfg?.numDecimal));
  }

  private drawMinMax(ctx: CanvasRenderingContext2D): void {
    const cfg = this.runtime.options();
    if (!cfg) return;
    if (!cfg.showMin && !cfg.showMax) return;
    let valueText = '';
    if (cfg.showMin) {
      valueText = this.minValue != null ? ` Min: ${this.applyDecorations(this.minValue.toFixed(cfg.numDecimal))}` : ' Min: --';
    }
    if (cfg.showMax) {
      valueText += this.maxValue != null ? ` Max: ${this.applyDecorations(this.maxValue.toFixed(cfg.numDecimal))}` : ' Max: --';
    }
    valueText = valueText.trim();
    const marginX = 10 * this.canvas.scaleFactor;
    const marginY = 5 * this.canvas.scaleFactor;
    this.canvas.drawText(
      ctx,
      valueText,
      marginX,
      Math.floor(this.cssHeight - marginY),
      this.maxMinMaxTextWidth,
      this.maxMinMaxTextHeight,
      'normal',
      this.valueColor,
      'start',
      'bottom'
    );
  }

  private applyDecorations(txtValue: string): string {
    // Percent decoration follows the applied measure, not the stored convertUnitTo — same reason as
    // getValueText: a display path's value is scaled per the resolved measure, so the '%' must too.
    return PERCENT_MEASURES.includes(this.effectiveUnit()) ? `${txtValue}%` : txtValue;
  }

  ngOnDestroy(): void {
    this.isDestroyed = true;
    try { this.canvas.unregisterCanvas(this.canvasElement); } catch { /* ignore */ }
  }
}
