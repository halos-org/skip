/**
 * Responsibilities:
 *  - Reactive config via WidgetRuntimeDirective
 *  - Data subscription via WidgetStreamsDirective
 *  - Zones metadata via WidgetMetadataDirective (highlights + state colors)
 *  - Resize handling and scale recalculation
 */
import { Component, AfterViewInit, ElementRef, effect, viewChild, input, inject, untracked, computed, signal } from '@angular/core';
import { ChangeDetectionStrategy } from '@angular/core';
import { LinearGaugeOptions, LinearGauge, GaugesModule } from '@godind/ng-canvas-gauges';
import { IWidgetSvcConfig, IDataHighlight } from '../../core/interfaces/widgets-interface';
import { adjustLinearScaleAndMajorTicks, IScale } from '../../core/utils/dataScales.util';
import { gaugeAnimationDurationMs, gaugeAnimationOptions } from '../../core/utils/gauge-animation.util';
import { getHighlights } from '../../core/utils/zones-highlight.utils';
import { getColors } from '../../core/utils/themeColors.utils';
import { States } from '../../core/interfaces/signalk-interfaces';
import { SkipResizeObserverDirective } from '../../core/directives/skip-resize-observer.directive';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective } from '../../core/directives/widget-streams.directive';
import { WidgetMetadataDirective } from '../../core/directives/widget-metadata.directive';
import { UnitsService } from '../../core/services/units.service';
import { ITheme } from '../../core/services/app-service';

/** Cap on the gauge's short axis as a fraction of its long axis, so the bar never turns squat. */
const GAUGE_MAX_THICKNESS = 0.3;
/** Breathing room kept below the canvas so the value box never touches the card edge. */
const GAUGE_HEIGHT_INSET = 10;

@Component({
  selector: 'widget-gauge-ng-linear',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './widget-gauge-ng-linear.component.html',
  styleUrls: ['./widget-gauge-ng-linear.component.scss'],
  imports: [SkipResizeObserverDirective, GaugesModule]
})
export class WidgetGaugeNgLinearComponent implements AfterViewInit {
  // Host2 functional inputs
  public id = input.required<string>();
  public type = input.required<string>();
  public theme = input.required<ITheme | null>();

  // Inject directives/services
  private readonly runtime = inject(WidgetRuntimeDirective);
  private readonly streams = inject(WidgetStreamsDirective);
  private readonly metadata = inject(WidgetMetadataDirective);
  private readonly unitsService = inject(UnitsService);

  // Static default config (legacy parity)
  public static readonly DEFAULT_CONFIG: IWidgetSvcConfig = {
    supportAutomaticHistoricalSeries: true,
    displayName: 'Gauge Label',
    filterSelfPaths: true,
    paths: {
      gaugePath: {
        description: 'Numeric Data',
        path: null,
        source: null,
        pathType: 'number',
        suppressBootstrapNull: true,
        isPathConfigurable: true,
        showPathSkUnitsFilter: true,
        pathSkUnitsFilter: null,
        convertUnitTo: 'unitless'
      }
    },
    displayScale: { lower: 0, upper: 100, type: 'linear' },
    gauge: {
      type: 'ngLinear',
      subType: 'vertical', // vertical | horizontal
      highlightsWidth: 5,
      enableTicks: true,
      enableNeedle: false
    },
    numInt: 1,
    numDecimal: 0,
    color: 'contrast',
    updateInterval: 500,
    enableTimeout: false,
    dataTimeout: 5,
    ignoreZones: false
  };

  protected readonly ngGauge = viewChild<LinearGauge>('linearGauge');
  protected readonly gauge = viewChild('linearGauge', { read: ElementRef });

  // Reactive presentation
  protected textValue = signal('--');
  protected value = signal<number | null | undefined>(undefined);
  /** True while a non-null datapoint is in hand; needle and progress bar are suppressed when false. */
  protected dataAvailable = signal(false);
  /**
   * Gates the gauge element on the first buildGaugeOptions() run. The library builds its geometry
   * in the constructor and throws on the empty initial options object, so the gauge has to wait for
   * config and theme — but not for data.
   */
  protected optionsReady = signal(false);
  protected gaugeOptions: LinearGaugeOptions = {} as LinearGaugeOptions;
  private viewReady = signal(false);
  /** True after first non-animated frame has been rendered. */
  private gaugeBootstrapped = signal(false);
  /** Enables smooth transitions only after the first static frame. */
  private animationEnabled = computed(() => this.gaugeBootstrapped());
  private currentState = signal<string>(States.Normal);
  /** Measure the incoming value was converted to (server-resolved for this display path). '' = boot placeholder. */
  private effectiveUnit = signal<string>('');

  protected adjustedScale = computed<IScale>(() => {
    const cfg = this.runtime.options();
    if (!cfg) return { min: 0, max: 100, majorTicks: [] };
    // displayScale bounds are stored in the user-picked convertUnitTo; re-express them in the
    // effective (server-resolved) measure so the scale lines up with the converted value.
    const stored = cfg.paths?.['gaugePath']?.convertUnitTo ?? 'unitless';
    const effective = this.effectiveUnit();
    const lower = this.unitsService.convertBetweenMeasures(stored, effective, cfg.displayScale?.lower ?? 0);
    const upper = this.unitsService.convertBetweenMeasures(stored, effective, cfg.displayScale?.upper ?? 100);
    if (cfg.gauge?.enableTicks) {
      return adjustLinearScaleAndMajorTicks(lower, upper);
    }
    return { min: lower, max: upper, majorTicks: [] };
  });
  private highlights = computed<IDataHighlight[]>(() => {
    const zones = this.metadata.zones();
    const cfg = this.runtime.options();
    const theme = this.theme();

    if (!zones?.length) return [];
    if (!cfg || !theme) return [];
    if (cfg.ignoreZones) return [];

    if (!cfg.paths?.['gaugePath']) return [];
    // Zones are in SI base; convert them to the effective measure so the bands align with the
    // converted value and the reinterpreted scale. Fall back to the stored unit before first data.
    const effective = this.effectiveUnit() || (cfg.paths['gaugePath'].convertUnitTo ?? 'unitless');
    return getHighlights(zones, theme, effective, this.unitsService, this.adjustedScale().min, this.adjustedScale().max);
  });
  protected displayName = computed(() => this.runtime.options()?.displayName || 'Gauge Label');
  /** Unit symbol for the header row; blank for a measure that carries none. */
  protected readonly unitSymbol = computed(() => this.unitsService.getRenderableUnitSymbol(this.effectiveUnit()));

  constructor() {
    // Observe data stream reactively
    effect(() => {
      const cfg = this.runtime.options();
      const theme = this.theme();
      if (!cfg || !theme) return;
      if (!cfg.paths?.['gaugePath'].path) return;

      untracked(() => {
        // Reset the tagged measure so a stale unit never paints the new subscription's value.
        this.effectiveUnit.set('');
        this.streams.observe('gaugePath', path => {
          const raw = (path?.data?.value as number) ?? null;
          const measure = path.data.measure ?? '';
          this.effectiveUnit.set(measure);
          // Clamp against the stored displayScale bounds re-expressed in the effective measure,
          // so the (already-converted) value and the reinterpreted scale share one unit space.
          const stored = cfg.paths?.['gaugePath']?.convertUnitTo ?? 'unitless';
          const lower = this.unitsService.convertBetweenMeasures(stored, measure, cfg.displayScale?.lower ?? 0);
          const upper = this.unitsService.convertBetweenMeasures(stored, measure, cfg.displayScale?.upper ?? 100);
          this.dataAvailable.set(raw != null);
          if (raw == null) {
            this.value.set(lower);
            this.textValue.set('--');
          } else {
            const clamped = Math.min(Math.max(raw, lower), upper);
            this.value.set(clamped);
            if (this.textValue() === '--') this.textValue.set('');
          }
          if (path.state !== this.currentState()) {
            this.currentState.set(path.state);
          }
        });
      });
    });

    // Metadata observation
    effect(() => {
      const cfg = this.runtime.options();
      if (!cfg || cfg.ignoreZones) return;
      untracked(() => this.metadata.observe('gaugePath'));
    });

    // Apply highlights to gauge post-init
    effect(() => {
      const hl = this.highlights();
      if (!this.viewReady()) return;

      untracked(() => {
        try {
          if (!hl.length) {
            this.ngGauge()?.update({ highlights: [] });
          } else {
            const serialized = JSON.stringify(hl) as unknown as string; // gauge lib tolerates stringified form
            this.ngGauge()?.update({ highlights: serialized, highlightsWidth: this.runtime.options()?.gauge?.highlightsWidth });
          }
        } catch { /* ignore */ }
      });
    });

    // Build / update gauge options when config/theme/scale change. The scale itself is derived from
    // the effective measure, so a unit change reaches the options through it.
    effect(() => {
      const theme = this.theme();
      const scale = this.adjustedScale();

      untracked(() => {
        const cfg = this.runtime.options();
        if (!cfg || !theme) return;
        this.buildGaugeOptions(cfg, theme, scale);
        this.optionsReady.set(true);
        if (this.viewReady()) {
          try {
            this.ngGauge()?.update(this.gaugeOptions);
            this.applyInitialSize();
          } catch { /* ignore */ }
        }
      });
    });

    // Hide the needle and progress bar while no datapoint is in hand, so an unfed gauge reads
    // as "no data" instead of parking both at the scale minimum as if it were a real reading.
    effect(() => {
      const hasData = this.dataAvailable();
      if (!this.viewReady()) return;
      untracked(() => {
        const cfg = this.runtime.options();
        const theme = this.theme();
        if (!cfg || !theme) return;
        const enableNeedle = !!cfg.gauge?.enableNeedle;
        const opt: LinearGaugeOptions = { needle: enableNeedle && hasData };
        if (!enableNeedle) {
          opt.colorBarProgress = this.barColor(cfg, theme, this.currentState());
        }
        try {
          this.ngGauge()?.update(opt);
        } catch { /* ignore */ }
      });
    });

    // Enable animation only after the first datapoint has been placed, so the bar never
    // sweeps up from the scale minimum on the first real reading.
    effect(() => {
      const gauge = this.ngGauge();
      if (!gauge || !this.dataAvailable() || this.gaugeBootstrapped()) return;
      untracked(() => {
        try {
          requestAnimationFrame(() => {
            this.gaugeBootstrapped.set(true);
            try { gauge.update(gaugeAnimationOptions(true)); } catch { /* ignore */ }
          });
        } catch { /* ignore */ }
      });
    });

    // Apply state-based colors (after view ready)
    effect(() => {
      const state = this.currentState();
      if (!this.viewReady()) return;
      untracked(() => {
        const cfg = this.runtime.options();
        const theme = this.theme();
        if (!cfg || !theme || cfg.ignoreZones) return;

        const enableNeedle = cfg.gauge?.enableNeedle;
        const palette = getColors(cfg.color ?? 'contrast', theme);
        const stateColor = this.zoneColor(theme, palette.color, state);
        const opt: LinearGaugeOptions = { colorValueText: stateColor };
        if (enableNeedle) {
          opt.colorNeedle = stateColor;
        } else {
          opt.colorBarProgress = this.barColor(cfg, theme, state);
        }
        try {
          this.ngGauge()?.update(opt);
        } catch { /* ignore */ }
      });
    });
  }

  /**
   * The single decision about what colour the bar is painted, shared by the no-data effect, the
   * zone-state effect and the option builder so they cannot disagree. Transparent stands in for
   * "hidden": switching barProgress off makes the library skip the pass that computes
   * barDimensions, which every later draw step reads, so it throws on construction.
   */
  private barColor(cfg: IWidgetSvcConfig, theme: ITheme, state: string): string {
    if (!this.dataAvailable()) return 'rgba(0,0,0,0)';
    const palette = getColors(cfg.color ?? 'contrast', theme);
    // The zone-state effect returns early under ignoreZones, so a zone colour written anywhere
    // else would stick with nothing to correct it.
    return cfg.ignoreZones ? palette.color : this.zoneColor(theme, palette.color, state);
  }

  /** Zone colour for the indicator and value text, falling back to the widget's own palette. */
  private zoneColor(theme: ITheme, paletteColor: string, state: string): string {
    switch (state) {
      case States.Alarm: return theme.zoneAlarm;
      case States.Warn: return theme.zoneWarn;
      case States.Alert: return theme.zoneAlert;
      default: return paletteColor;
    }
  }

  private buildGaugeOptions(cfg: IWidgetSvcConfig, theme: ITheme, scale: IScale) {
    const opt = this.gaugeOptions = {} as LinearGaugeOptions;
    const isVertical = cfg.gauge?.subType === 'vertical';
    const enableNeedle = cfg.gauge?.enableNeedle;
    const ticks = cfg.gauge?.enableTicks;
    // Canvas size (defer dynamic resize until AfterViewInit)
    opt.minValue = scale.min; opt.maxValue = scale.max;
    opt.valueInt = cfg.numInt ?? 1; opt.valueDec = cfg.numDecimal ?? 2;
    // No title or units: the component renders both in its own header row, and leaving these unset
    // stops the library reserving a band for each (top and bottom) — that height goes to the bar.
    // Bar geometry (match legacy defaults)
    opt.barLength = isVertical ? 80 : 90;
    opt.barWidth = ticks ? (enableNeedle ? 0 : 30) : 60;
    // barProgress stays on even with no data. The library computes barDimensions inside the
    // progress-bar pass, and every later draw step reads it, so switching barProgress off throws
    // on construction. The bar is hidden by painting it transparent instead — see barColor().
    opt.barProgress = true; opt.barBeginCircle = 0; opt.barStrokeWidth = 0; opt.barShadow = 0;
    // Needle geometry
    opt.needle = !!enableNeedle && this.dataAvailable(); opt.needleType = enableNeedle ? 'arrow' : 'line';
    opt.needleStart = enableNeedle ? (isVertical ? 200 : 155) : -45;
    opt.needleEnd = enableNeedle ? (isVertical ? 175 : 180) : 55;
    opt.needleShadow = true; opt.needleSide = 'both';
    opt.borders = false; opt.borderOuterWidth = 0; opt.borderMiddleWidth = 0; opt.borderInnerWidth = 0; opt.borderShadowWidth = 0; opt.borderRadius = 0;
    // Value box
    opt.valueBox = true; opt.valueBoxWidth = 35; opt.valueBoxStroke = 0; opt.valueBoxBorderRadius = 10;
    opt.colorValueBoxRect = ''; opt.colorValueBoxRectEnd = ''; opt.colorValueBoxShadow = '';
    opt.fontValueSize = 50; opt.fontValue = 'Roboto'; opt.fontValueWeight = 'bold'; opt.valueTextShadow = false;
    opt.fontNumbers = 'Roboto'; opt.fontNumbersWeight = 'normal';
    opt.colorValueBoxBackground = theme.background;
    const palette = getColors(cfg.color ?? 'contrast', theme);
    // baseline colors
    opt.colorValueText = palette.color;
    if (enableNeedle) {
      opt.colorNeedle = palette.color; opt.colorNeedleEnd = palette.color; opt.needleWidth = 45;
      opt.colorNeedleShadowUp = palette.color; opt.colorNeedleShadowDown = palette.color;
    } else {
      opt.colorBarProgress = this.barColor(cfg, theme, this.currentState()); opt.colorBarProgressEnd = ''; opt.needleWidth = 0;
    }
    opt.colorPlate = theme.cardColor; opt.colorBar = theme.background; opt.colorBarEnd = ''; opt.colorBarStroke = '0';
    opt.colorMajorTicks = getColors('contrast', theme).dim; opt.colorMinorTicks = getColors('contrast', theme).dim; opt.colorNumbers = getColors('contrast', theme).dim;
    opt.majorTicks = ticks ? scale.majorTicks as unknown as string[] : [];
    opt.majorTicksInt = cfg.numInt ?? 1; opt.majorTicksDec = cfg.numDecimal ?? 2;
    opt.strokeTicks = !!ticks; opt.minorTicks = ticks ? 2 : 0; opt.ticksWidthMinor = ticks ? 6 : 0;
    opt.numberSide = enableNeedle ? 'right' : 'left';
    opt.fontNumbersSize = ticks ? (isVertical ? 22 : 30) : 0;
    opt.numbersMargin = isVertical ? (enableNeedle ? -7 : -3) : (enableNeedle ? -33 : -5);
    opt.ticksWidth = ticks ? (enableNeedle ? (isVertical ? 15 : 10) : 10) : 0;
    opt.ticksPadding = ticks ? (isVertical ? (enableNeedle ? 0 : 5) : (enableNeedle ? 9 : 8)) : 0;
    opt.tickSide = 'left';
    Object.assign(opt, gaugeAnimationOptions(this.animationEnabled())); opt.animationDuration = gaugeAnimationDurationMs(cfg.updateInterval ?? 500);
    opt.highlights = []; opt.highlightsWidth = cfg.gauge?.highlightsWidth;
    // pre-populate highlights if already available
    const h = this.highlights();
    if (h.length) { opt.highlights = JSON.stringify(h) as unknown as string; }
  }

  ngAfterViewInit(): void {
    this.viewReady.set(true);
    this.applyInitialSize();
    try {
      this.ngGauge()?.update(this.gaugeOptions);
    } catch { /* ignore */ }
  }

  /**
   * Hands a size to the gauge only when both axes are positive. The library computes arc radii from
   * these, and a non-positive value makes it throw an IndexSizeError from inside its own mutation
   * observer — past this component's try/catch — leaving the canvas blank until the next resize.
   */
  private updateGaugeSize(width: number, height: number): void {
    if (!(width > 0) || !(height > 0)) return;
    try { this.ngGauge()?.update({ width, height } as LinearGaugeOptions); } catch { /* ignore */ }
  }

  /**
   * The gauge runs the full length of its box and is only ever thinned across, never shortened: a
   * bar that gave up length to keep a fixed aspect left the card mostly empty on either side of it.
   * Capping the short axis also keeps it below the long one, which is how the library decides
   * whether it is drawing a vertical or a horizontal gauge.
   */
  private gaugeSize(boxWidth: number, boxHeight: number, isVertical: boolean): { width: number; height: number } {
    return isVertical
      ? { width: Math.min(boxHeight * GAUGE_MAX_THICKNESS, boxWidth), height: boxHeight }
      : { width: boxWidth, height: Math.min(boxWidth * GAUGE_MAX_THICKNESS, boxHeight) };
  }

  private applyInitialSize(): void {
    const el = this.gauge()?.nativeElement as HTMLElement | null;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const isVertical = this.runtime.options()?.gauge?.subType === 'vertical';
    const { width, height } = this.gaugeSize(rect.width, rect.height, isVertical);
    this.updateGaugeSize(width, height);
  }

  public onResized(evt: ResizeObserverEntry): void {
    const cfg = this.runtime.options();
    if (!cfg) return;
    const isVertical = cfg.gauge?.subType === 'vertical';
    const { width, height } = this.gaugeSize(evt.contentRect.width, evt.contentRect.height, isVertical);
    this.updateGaugeSize(width, height - GAUGE_HEIGHT_INSET);
  }
}
