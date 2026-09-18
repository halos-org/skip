import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { IWidgetSvcConfig } from '../../core/interfaces/widgets-interface';
import { CanvasService } from '../../core/services/canvas.service';
import { SkipResizeObserverDirective } from '../../core/directives/skip-resize-observer.directive';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective, widgetPathSignature, normalizeWidgetPath, WidgetRepointTracker } from '../../core/directives/widget-streams.directive';
import { ITheme } from '../../core/services/app-service';

/**
 * The slice of the steelseries global this widget paints with. The library is loaded from
 * index.html as a browser global, the same way the Classic Steel gauges reach it; typing it here
 * rather than as `any` keeps the lint rule honest about what we actually call.
 */
interface ISteelseries {
  drawFrame(ctx: CanvasRenderingContext2D, frameDesign: unknown, centerX: number, centerY: number, width: number, height: number): void;
  drawBackground(ctx: CanvasRenderingContext2D, background: unknown, centerX: number, centerY: number, width: number, height: number): void;
  drawForeground(ctx: CanvasRenderingContext2D, foregroundType: unknown, width: number, height: number, withCenterKnob: boolean): void;
  // Every member is optional on purpose. The global is whatever happens to be on the page: the real
  // library in the app, and in the unit tests the minimal stand-in gauge-steel installs at module
  // load — which carries these names as plain strings, with no colour objects under them.
  FrameDesign?: Record<string, unknown>;
  BackgroundColor?: Record<string, { labelColor?: ISteelColor; symbolColor?: ISteelColor } | undefined>;
  ForegroundType?: Record<string, unknown>;
  LcdColor?: Record<string, { gradientStartColor?: string; gradientStopColor?: string; textColor?: string } | undefined>;
  ColorDef?: Record<string, { medium?: ISteelColor } | undefined>;
}
interface ISteelColor { getRgbaColor(): string }

/** The gauge property bag this widget reads, narrowed from the shared widget config. */
type ICompassGauge = NonNullable<IWidgetSvcConfig['gauge']>;

function steelseriesGlobal(): ISteelseries | null {
  return (globalThis as { steelseries?: ISteelseries }).steelseries ?? null;
}

/** `brushedStainless` -> `BRUSHED_STAINLESS`: the config keys are the Classic Steel ones. */
function toEnumKey(configKey: string): string {
  return configKey.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
}

/** Ink the card is printed in. Taken from the chosen background, so a light face gets dark type. */
interface ICardInk {
  label: string;
  symbol: string;
  index: string;
  lcdTop: string;
  lcdBottom: string;
  lcdInk: string;
}

/**
 * What the card looks like with no steelseries on the page — jsdom in the unit tests, and the
 * moment before the global script has run. The dial still draws; only the case is missing.
 */
const FALLBACK_INK: ICardInk = {
  label: '#FFFFFF',
  symbol: 'rgb(180, 180, 180)',
  index: '#D8232A',
  lcdTop: 'rgb(131, 133, 119)',
  lcdBottom: 'rgb(175, 184, 165)',
  lcdInk: 'rgb(35, 42, 52)'
};

interface ICardTick { x1: number; y1: number; x2: number; y2: number; stroke: string; width: number }
interface ICardLabel { x: number; y: number; text: string; size: number; weight: number; fill: string; rotate: string }

/**
 * Dial geometry, in the 500x500 viewBox every coordinate below is expressed in. The face the
 * library paints ends at 0.831775 of the image width — radius 208 here — so the card, its index and
 * the readout all stay inside that.
 */
const CX = 250;
const CY = 250;
const R_CARD = 188;

function point(radius: number, angleDeg: number): [number, number] {
  const t = (angleDeg - 90) * Math.PI / 180;
  return [CX + radius * Math.cos(t), CY + radius * Math.sin(t)];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Map any angle onto the compass card's [0, 360) domain.
 *
 * Applied to every reading rather than to a list of known signed paths: a card has no negative half,
 * so a value below zero can only be the port-side convention Signal K uses for relative angles, and
 * a value past 360 can only be an accumulated turn. Both have exactly one sensible place.
 */
export function toCompassDegrees(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * The turn from one heading to another, as the card actually swings it: the shorter way round,
 * signed. Passing 359 -> 001 to a CSS rotation unchanged would spin the card 358 degrees backwards
 * through south; this returns +2.
 */
export function shortestTurn(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

/**
 * Steel compass: the card turns under a fixed index at the rim, the way a binnacle compass reads.
 * That is the only mode — there is no needle on this dial in any configuration.
 *
 * The case is painted by steelseries' own `drawFrame` / `drawBackground` / `drawForeground`, the
 * same code the Classic Steel gauges draw with, so the two match on a dashboard down to the
 * material. Only the card is ours: the library's `Compass` draws its index as a full needle from
 * the hub, and a needle on a compass reads as a magnetic needle pointing north rather than as the
 * lubber line you steer against. None of its sixteen pointer types is a rim index, so the card,
 * the index and the readout are SVG layered over the painted case.
 */
@Component({
  selector: 'widget-gauge-steel-compass',
  templateUrl: './widget-gauge-steel-compass.component.html',
  styleUrl: './widget-gauge-steel-compass.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SkipResizeObserverDirective]
})
export class WidgetSteelCompassComponent implements OnDestroy {
  // Functional Host2 inputs
  public id = input.required<string>();
  public type = input.required<string>();
  public theme = input.required<ITheme | null>();

  // Host directives
  protected readonly runtime = inject(WidgetRuntimeDirective);
  private readonly streams = inject(WidgetStreamsDirective);
  private readonly canvas = inject(CanvasService);

  // Not `required`: the destroy hook below reads it, and a required query that has not resolved
  // throws NG0951 there and aborts the rest of the teardown. Absent, there is simply nothing to
  // paint or release.
  private readonly caseCanvas = viewChild<ElementRef<HTMLCanvasElement>>('caseCanvas');

  /**
   * Side of the square dial, in CSS pixels. Both layers are sized to it: the library paints the
   * case into a canvas of exactly this many CSS pixels (it sets the backing store itself, 1:1, the
   * way the Classic Steel gauges are drawn), and the SVG card is laid over the same square.
   */
  // Nothing to set up on view init: the observer's first resize brings the side, and the effect
  // below paints from it.
  protected readonly side = signal(0);
  private resizeTimer: number | null = null;
  private lastSide = 0;

  public static readonly DEFAULT_CONFIG: IWidgetSvcConfig = {
    displayName: 'Heading',
    filterSelfPaths: true,
    supportAutomaticHistoricalSeries: true,
    paths: {
      gaugePath: {
        description: 'Heading',
        path: null,
        source: null,
        pathType: 'number',
        suppressBootstrapNull: true,
        isPathConfigurable: true,
        showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 'rad',
        showConvertUnitTo: false,
        convertUnitTo: 'deg'
      }
    },
    gauge: {
      type: 'steelCompass',
      degreeScale: true,
      // The Classic Steel defaults, so a compass dropped beside one matches out of the box.
      backgroundColor: 'carbon',
      faceColor: 'anthracite'
    },
    updateInterval: 500,
    enableTimeout: false,
    dataTimeout: 5
  };

  /** Heading in degrees on [0, 360), or null while nothing has been received on the path. */
  protected readonly heading = signal<number | null>(null);

  /**
   * Heading as an unbounded angle: every update adds the shorter turn rather than jumping to the
   * new value, so the CSS transition on the card always takes the short way round north.
   */
  private readonly turned = signal(0);

  protected readonly displayName = computed(() => this.runtime.options()?.displayName ?? '');

  /** Three digits, or `---` with no reading: a card parked on 000 is indistinguishable from north. */
  protected readonly headingText = computed(() => {
    const value = this.heading();
    if (value === null) return '---';
    // Rounded first, so 359.7 reads as 000 rather than 360.
    return String(Math.round(value) % 360).padStart(3, '0');
  });

  /**
   * The reference the number is measured against, read off the path itself. A heading gauge that
   * doesn't say magnetic or true is a heading gauge you have to go and check.
   */
  protected readonly unitLabel = computed(() => {
    const path = normalizeWidgetPath(this.runtime.options()?.paths?.['gaugePath']?.path) ?? '';
    // Only a bearing measured from north earns the reference letter: headingMagnetic,
    // courseOverGroundTrue, directionTrue, nextPoint.bearingTrue. "True" in a wind angle names the
    // velocity frame, not the reference — angleTrueWater is 45° off the bow, not 045 true — and
    // those paths end in Water, Ground or Damped, so the anchored match leaves them plain.
    if (/Magnetic$/.test(path)) return '°M';
    if (/True$/.test(path)) return '°T';
    return '°';
  });

  /**
   * Card ink, read off the steelseries background the case is painted with: its own `labelColor`
   * and `symbolColor` are what the library prints its scales in, so a white or beige face gets dark
   * type without a second table to keep in step.
   */
  protected readonly ink = computed<ICardInk>(() => {
    const steel = steelseriesGlobal();
    if (!steel) return FALLBACK_INK;
    const background = steel.BackgroundColor?.[toEnumKey(this.runtime.options()?.gauge?.backgroundColor ?? 'carbon')];
    const lcd = steel.LcdColor?.['STANDARD'];
    const red = steel.ColorDef?.['RED'];
    return {
      label: background?.labelColor?.getRgbaColor?.() ?? FALLBACK_INK.label,
      symbol: background?.symbolColor?.getRgbaColor?.() ?? FALLBACK_INK.symbol,
      index: red?.medium?.getRgbaColor?.() ?? FALLBACK_INK.index,
      lcdTop: lcd?.gradientStartColor ?? FALLBACK_INK.lcdTop,
      lcdBottom: lcd?.gradientStopColor ?? FALLBACK_INK.lcdBottom,
      lcdInk: lcd?.textColor ?? FALLBACK_INK.lcdInk
    };
  });

  /**
   * Card rotation. Negated because the card turns against the heading to bring it under the index;
   * as a subtraction rather than a unary minus so a card reset to 0 rotates by 0, not -0.
   */
  protected readonly cardRotation = computed(() => 0 - this.turned());

  /** Unique per instance: two compasses on one dashboard must not share gradient ids. */
  protected readonly gradientId = computed(() => `sc-${this.id()}`);

  protected readonly cardTicks = computed<ICardTick[]>(() => {
    const ink = this.ink();
    const ticks: ICardTick[] = [];
    for (let a = 0; a < 360; a += 5) {
      const major = a % 30 === 0;
      const mid = a % 10 === 0;
      const length = major ? 24 : mid ? 15 : 8;
      const [x1, y1] = point(R_CARD - length, a);
      const [x2, y2] = point(R_CARD, a);
      ticks.push({
        x1: round(x1), y1: round(y1), x2: round(x2), y2: round(y2),
        stroke: major ? ink.label : ink.symbol,
        width: major ? 5 : mid ? 3 : 2
      });
    }
    return ticks;
  });

  protected readonly cardLabels = computed<ICardLabel[]>(() => {
    const ink = this.ink();
    const withDegrees = this.runtime.options()?.gauge?.degreeScale !== false;
    const cardinals: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
    const inter: Record<number, string> = { 45: 'NE', 135: 'SE', 225: 'SW', 315: 'NW' };
    const labels: ICardLabel[] = [];

    const push = (radius: number, angle: number, text: string, size: number, weight: number, fill: string) => {
      const [x, y] = point(radius, angle);
      labels.push({
        x: round(x), y: round(y), text, size, weight, fill,
        // Upright against the card's own radius, as printed on a real card: the numbers at the
        // bottom of the dial read upside down, and that is what tells you the card has turned.
        rotate: `rotate(${round(angle)} ${round(x)} ${round(y)})`
      });
    };

    for (let a = 0; a < 360; a += 30) {
      const cardinal = cardinals[a];
      if (cardinal) {
        push(R_CARD - 48, a, cardinal, 40, 700, a === 0 ? ink.index : ink.label);
      } else if (withDegrees) {
        // The whole bearing: 30, 60, 120 — not the tens shorthand a printed card uses.
        push(R_CARD - 46, a, String(a), 26, 600, ink.label);
      }
    }
    for (const angle of [45, 135, 225, 315]) {
      push(R_CARD - 88, angle, inter[angle], 19, 600, ink.symbol);
    }
    return labels;
  });

  /** Path identity behind the reading below; see {@link WidgetRepointTracker}. */
  private readonly repoint = new WidgetRepointTracker();

  /**
   * Drop the reading when the widget is re-pointed at another path (#585). Both halves of it: the
   * LCD and the card are separate signals, and clearing only the number would leave the card turned
   * to the old path's bearing under a `---`, which reads as a live heading with a dead readout. The
   * card goes back to 000 and dims, which is the stale state the stylesheet describes.
   */
  private clearReadingOnRepoint(signature: string | null): void {
    if (!this.repoint.repointed(signature)) return;
    this.heading.set(null);
    this.turned.set(0);
  }

  /** Apply a new heading, turning the card the short way round from wherever it is. */
  private applyHeading(value: number | null): void {
    this.heading.set(value);
    if (value === null) return;
    this.turned.update(current => current + shortestTurn(toCompassDegrees(current), value));
  }

  /**
   * Sizing follows the Classic Steel gauge exactly: ignore a box too small to draw in, skip a
   * resize that does not change the side, and debounce the rest by 120ms — a repaint rebuilds every
   * cached layer in the library, so a drag that fires dozens of resizes must not run it dozens of
   * times.
   */
  protected onResized(entry: ResizeObserverEntry): void {
    const { width, height } = entry.contentRect;
    if (width < 50 || height < 50) return;
    const side = Math.floor(Math.min(width, height));
    if (side === this.lastSide) return;
    this.lastSide = side;
    if (this.resizeTimer) window.clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => {
      this.side.set(side);
      this.resizeTimer = null;
    }, 120);
  }

  ngOnDestroy(): void {
    if (this.resizeTimer !== null) {
      window.clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
    // Same release the Classic Steel gauge does, so a removed tile frees its backing store.
    const canvas = this.caseCanvas()?.nativeElement;
    if (canvas) this.canvas.releaseCanvas(canvas, { clear: true, removeFromDom: false });
  }

  /**
   * Paint the case with the library's own painters, so it is the Classic Steel case rather than a
   * drawing of one.
   *
   * The canvas is sized here, in CSS pixels at 1:1, because that is what steelseries does with the
   * `size` it is given and what the Classic Steel gauges therefore get. Setting width clears the
   * canvas and resets its context, so sizing and painting have to happen together — driving the
   * size from anywhere else leaves the paint cleared, or scaled against a transform that is no
   * longer there.
   */
  private paintCase(side: number, gauge: ICompassGauge | null): void {
    const steel = steelseriesGlobal();
    if (!steel || side < 1 || typeof steel.drawFrame !== 'function') return;
    const frame = steel.FrameDesign?.[toEnumKey(gauge?.faceColor ?? 'anthracite')];
    const background = steel.BackgroundColor?.[toEnumKey(gauge?.backgroundColor ?? 'carbon')];
    // A partial global (the unit tests' stand-in) has the names but not the painters.
    if (!frame || !background) return;

    const canvas = this.caseCanvas()?.nativeElement;
    if (!canvas) return;
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const centre = side / 2;
    steel.drawFrame(ctx, frame, centre, centre, side, side);
    steel.drawBackground(ctx, background, centre, centre, side, side);
    // TYPE1 with no centre knob: the glass highlight, and nothing at the hub — the card has no
    // needle for a knob to hold down.
    steel.drawForeground(ctx, steel.ForegroundType?.['TYPE1'], side, side, false);
  }

  constructor() {
    // Repaint on a resize or a material change; both are rare, and the card above is untouched.
    effect(() => {
      const side = this.side();
      const gauge = this.runtime.options()?.gauge ?? null;
      untracked(() => this.paintCase(side, gauge));
    });

    effect(() => {
      const cfg = this.runtime.options();
      if (!cfg) return;
      const pathCfg = cfg.paths?.['gaugePath'];
      // Computed before the bail-out and null exactly when there is no usable path: the streams
      // directive drops the subscription in that case, so the reading has to go with it.
      const signature = widgetPathSignature(pathCfg);
      untracked(() => {
        this.clearReadingOnRepoint(signature);
        if (!signature) return;
        // A fresh closure on every run by design: the directive compares callback identity as well
        // as the signature, and a stable reference would early-return instead of replaying the
        // current value into a component that has just cleared itself.
        this.streams.observe('gaugePath', pkt => {
          const raw = (pkt?.data?.value as number) ?? null;
          // A non-numeric reading would otherwise print "NaN" on the LCD and leave the card where
          // it was: a misconfigured source is a no-reading, the same as a null.
          this.applyHeading(Number.isFinite(raw) ? toCompassDegrees(raw as number) : null);
        });
      });
    });
  }
}
