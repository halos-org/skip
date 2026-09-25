import { Component, ElementRef, input, viewChild, signal, computed, effect, untracked, ChangeDetectionStrategy, OnDestroy, NgZone, inject } from '@angular/core';
import { animateProgress, animateRotation, effectiveAnimationDuration } from '../../core/utils/svg-animate.util';
import { DecimalPipe } from '@angular/common';
import { OverlayPoint, interpolateOverlay, vmcEdgeRuns } from '../../core/utils/polar-overlay.util';
import { toDegrees } from '../../core/utils/si-presentation.util';
import { DEFAULT_WIDGET_UPDATE_INTERVAL_MS } from '../../core/interfaces/widgets-interface';

/** Polar overlay state the parent resolves: hidden, the polar curve, or the VMC curve. */
export type PolarOverlayMode = 'hidden' | 'polar' | 'vmc';
/** Radius, in viewBox units, the active polar's peak speed maps to: inside the COG and waypoint ring (r ≈ 325). */
export const POLAR_OVERLAY_PEAK_RADIUS = 300;
/** The dial radius, in viewBox units, and so the outer limit of the overlay. */
export const POLAR_OVERLAY_DIAL_RADIUS = 350;

/** One true-wind sample of the wind shift traces: the direction swept from `from` to `to`, rad. */
export interface WindTraceSample { readonly id: number; readonly from: number; readonly to: number }

/** Narrowest wind shift trace, degrees, so a sample in a steady wind still shows. */
const MIN_TRACE_WIDTH_DEG = 2;
/** Opacity a lone trace starts at; also the most any one trace starts at. */
const MAX_TRACE_PEAK_OPACITY = 0.35;
/**
 * The summed starting opacity of a window's traces. Each trace starts at this over the samples in
 * the window, so a steady wind builds to the same strength at any update rate.
 */
const TRACE_WINDOW_OPACITY = 3;

/**
 * An overlay element's drawn state. It eases from what is drawn to each new target over one update
 * interval, and jumps when it appears or when the overlay mode, and so its meaning, changes.
 */
class OverlayTween<T> {
  readonly shown = signal<T | null>(null);
  private mode: PolarOverlayMode | null = null;
  private cancel: (() => void) | null = null;

  constructor(private readonly lerp: (from: T, to: T, t: number) => T) {}

  to(target: T | null, mode: PolarOverlayMode, duration: number, ngZone: NgZone): void {
    this.stop();
    const from = this.shown();
    const jump = from === null || target === null || mode !== this.mode;
    this.mode = mode;
    if (jump) {
      this.shown.set(target);
      return;
    }
    this.cancel = animateProgress(duration, t => this.shown.set(this.lerp(from, target, t)), ngZone);
  }

  stop(): void {
    this.cancel?.();
    this.cancel = null;
  }
}

/** Dial angle changes smaller than this (degrees) draw at once instead of easing. */
const DIAL_EPSILON_DEG = 1;

/** The signed turn from one dial angle to another along the shorter arc, degrees in [−180, 180). */
function dialTurn(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/**
 * A line from the dial center to its rim at a dial angle (degrees, clockwise from up). It eases from
 * the angle drawn to each new angle along the shorter arc, so a new target mid-ease carries on from
 * where the line is; the first angle, and a change under DIAL_EPSILON_DEG, draw at once.
 */
class DialLine {
  readonly path = signal('');
  private drawn: number | null = null;
  private cancel: (() => void) | null = null;

  constructor(private readonly draw: (angleDeg: number) => string) {}

  moveTo(angleDeg: number, duration: number | null, ngZone: NgZone): void {
    this.stop();
    const from = this.drawn;
    const turn = from === null ? 0 : dialTurn(from, angleDeg);
    if (from === null || duration === null || Math.abs(turn) < DIAL_EPSILON_DEG) {
      this.show(angleDeg);
      return;
    }
    this.cancel = animateProgress(duration, t => this.show(from + turn * t), ngZone);
  }

  clear(): void {
    this.stop();
    this.drawn = null;
    this.path.set('');
  }

  stop(): void {
    this.cancel?.();
    this.cancel = null;
  }

  private show(angleDeg: number): void {
    this.drawn = angleDeg;
    this.path.set(this.draw(angleDeg));
  }
}

interface ISVGRotationObject {
  oldValue: number,
  newValue: number,
}

@Component({
  selector: 'svg-windsteer',
  templateUrl: './svg-windsteer.component.svg',
  styleUrl: './svg-windsteer.component.scss',
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SvgWindsteerComponent implements OnDestroy {
  protected readonly rotatingDial = viewChild.required<ElementRef<SVGGElement>>('rotatingDial');
  protected readonly awaIndicator = viewChild.required<ElementRef<SVGGElement>>('awaIndicator');
  protected readonly twaIndicator = viewChild.required<ElementRef<SVGGElement>>('twaIndicator');
  protected readonly wptIndicator = viewChild.required<ElementRef<SVGGElement>>('wptIndicator');
  protected readonly setIndicator = viewChild.required<ElementRef<SVGGElement>>('setIndicator');
  protected readonly cogIndicator = viewChild.required<ElementRef<SVGGElement>>('cogIndicator');
  protected readonly polarOverlay = viewChild.required<ElementRef<SVGGElement>>('polarOverlay');

  // Angles are in rad, speeds are in their presentation unit.
  protected readonly compassHeading = input.required<number>();
  protected readonly compassModeEnabled = input.required<boolean>();
  protected readonly updateInterval = input<number | undefined>(undefined);
  protected readonly courseOverGroundAngle = input<number | undefined>(undefined);
  protected readonly courseOverGroundEnabled = input.required<boolean>();
  protected readonly sogActive = input<boolean>(true);
  protected readonly trueWindAngle = input.required<number>();
  protected readonly trueWindFresh = input<boolean>(false);
  protected readonly twsEnabled = input.required<boolean>();
  protected readonly twaEnabled = input.required<boolean>();
  protected readonly trueWindSpeed = input.required<number>();
  protected readonly trueWindSpeedUnit = input.required<string>();
  protected readonly appWindAngle = input.required<number>();
  protected readonly awsEnabled = input.required<boolean>();
  protected readonly appWindSpeed = input.required<number>();
  protected readonly appWindSpeedUnit = input.required<string>();
  protected readonly closeHauledLineAngle = input<number | undefined>(undefined);
  /** The run angle off the true wind, rad; null hides the run lines. */
  protected readonly runLineAngle = input<number | null>(null);
  protected readonly closeHauledLineEnabled = input.required<boolean>();
  protected readonly sailSetupEnabled = input.required<boolean>();
  protected readonly windTraceEnabled = input.required<boolean>();
  protected readonly driftEnabled = input.required<boolean>();
  protected readonly setArrowActive = input<boolean>(false);
  protected readonly driftSet = input<number | undefined>(undefined);
  protected readonly driftFlow = input<number | undefined>(undefined);
  protected readonly driftUnit = input<string>('');
  protected readonly waypointAngle = input<number | undefined>(undefined);
  protected readonly waypointEnabled = input.required<boolean>();
  /** The true wind samples of the last `windTraceSeconds`, oldest first. */
  protected readonly windTrace = input<readonly WindTraceSample[]>([]);
  protected readonly windTraceSeconds = input.required<number>();
  // Rudder-angle bar: signed rad, +ve = starboard (right). null hides the bar.
  protected readonly rudderAngle = input<number | null>(null);
  protected readonly rudderEnabled = input<boolean>(false);
  // Per-path data freshness: false once a path has had no valid sample within the TTL, so the
  // matching indicator hides instead of showing a frozen/zero value. (trueWindFresh above is TWA.)
  protected readonly headingFresh = input<boolean>(true);
  protected readonly courseFresh = input<boolean>(true);
  protected readonly appWindFresh = input<boolean>(true);
  protected readonly appWindSpeedFresh = input<boolean>(true);
  protected readonly trueWindSpeedFresh = input<boolean>(true);
  protected readonly driftFresh = input<boolean>(true);
  protected readonly setFresh = input<boolean>(true);
  // Polar overlay, resolved by the parent. The polar curve is in the wind frame and its group turns
  // by the water TWA; the VMC curve is in the compass frame inside the rotating dial; the dot is at
  // this radius on the bow axis in the boat frame.
  protected readonly polarOverlayMode = input<PolarOverlayMode>('hidden');
  protected readonly polarCurve = input<OverlayPoint[] | null>(null);
  protected readonly polarCurveRotation = input<number>(0);
  protected readonly vmcCurve = input<OverlayPoint[] | null>(null);
  /** Each tack's best VMC heading on the VMC curve, in its compass frame; null for a tack without one. */
  protected readonly vmcOptima = input<{ port: OverlayPoint | null; starboard: OverlayPoint | null } | null>(null);
  protected readonly overlayDotRadius = input<number | null>(null);

  // Angle inputs arrive in rad; the rotation attributes and dial geometry below work in degrees.
  private readonly compassHeadingDeg = computed(() => toDegrees(this.compassHeading()));
  private readonly courseOverGroundDeg = computed(() => toDegrees(this.courseOverGroundAngle()));
  private readonly trueWindAngleDeg = computed(() => toDegrees(this.trueWindAngle()));
  private readonly appWindAngleDeg = computed(() => toDegrees(this.appWindAngle()));
  private readonly closeHauledLineAngleDeg = computed(() => toDegrees(this.closeHauledLineAngle()));
  private readonly runLineAngleDeg = computed(() => { const a = this.runLineAngle(); return a == null ? null : toDegrees(a); });
  private readonly driftSetDeg = computed(() => toDegrees(this.driftSet()));
  private readonly waypointAngleDeg = computed(() => toDegrees(this.waypointAngle()));
  private readonly rudderAngleDeg = computed(() => { const a = this.rudderAngle(); return a == null ? null : toDegrees(a); });
  private readonly polarCurveRotationDeg = computed(() => toDegrees(this.polarCurveRotation()));

  protected compass: ISVGRotationObject = { oldValue: 0, newValue: 0 };
  protected twa: ISVGRotationObject = { oldValue: 0, newValue: 0 };
  protected awa: ISVGRotationObject = { oldValue: 0, newValue: 0 };
  protected wpt: ISVGRotationObject = { oldValue: 0, newValue: 0 };
  protected cog: ISVGRotationObject = { oldValue: 0, newValue: 0 };
  protected set: ISVGRotationObject = { oldValue: 0, newValue: 0 };
  private polarRotation: ISVGRotationObject = { oldValue: 0, newValue: 0 };
  private polarRotationInitialized = false;
  private compassInitialized = false;
  private twaInitialized = false;
  private awaInitialized = false;
  private wptInitialized = false;
  private cogInitialized = false;
  private setInitialized = false;

  protected headingValue = signal<string>("--");
  private trueWindHeading = 0;
  private courseOverGround = 0;
  // The bearing circle is meaningful only with an active waypoint. The set-arrow/COG visibility gates
  // (setArrowActive/sogActive) are physical-speed thresholds resolved by the parent and passed in.
  protected waypointActive = computed(() => {
    const a = this.waypointAngle();
    return this.waypointEnabled() && a != null && Number.isFinite(a);
  });

  private readonly polarCurveTween = new OverlayTween<OverlayPoint[]>(interpolateOverlay);
  private readonly vmcCurveTween = new OverlayTween<OverlayPoint[]>(interpolateOverlay);
  private readonly overlayDotTween = new OverlayTween<number>((from, to, t) => t >= 1 ? to : from + (to - from) * t);
  private readonly portOptimumTween = new OverlayTween<OverlayPoint>((from, to, t) => interpolateOverlay([from], [to], t)[0]);
  private readonly stbdOptimumTween = new OverlayTween<OverlayPoint>((from, to, t) => interpolateOverlay([from], [to], t)[0]);

  protected readonly polarCurvePath = computed(() => this.overlayPath(this.polarCurveTween.shown(), false));
  protected readonly vmcFillPath = computed(() => this.overlayPath(this.vmcCurveTween.shown(), true));
  protected readonly vmcEdgePath = computed(() =>
    vmcEdgeRuns(this.vmcCurveTween.shown() ?? []).map(run => this.overlayPath(run, false)).join(' '));
  protected readonly portOptimumCenter = computed(() => this.overlayCenter(this.portOptimumTween.shown()));
  protected readonly stbdOptimumCenter = computed(() => this.overlayCenter(this.stbdOptimumTween.shown()));
  /** Y of the dot's center on the bow axis, or null when it is hidden. */
  protected readonly overlayDotY = computed(() => {
    const r = this.overlayDotTween.shown();
    return r === null ? null : this.CENTER - r;
  });

  /** How far the newest trace has grown toward its sample, in step with the close-hauled line's ease. */
  private readonly traceGrowth = signal<{ id: number; progress: number } | null>(null);
  private traceGrowthCancel: (() => void) | null = null;
  private newestTraceId: number | null = null;
  protected readonly tracePeakOpacity = computed(() => {
    const interval = this.updateInterval();
    const samples = this.windTraceSeconds() * 1000 / (interval && interval > 0 ? interval : DEFAULT_WIDGET_UPDATE_INTERVAL_MS);
    return Number(Math.min(MAX_TRACE_PEAK_OPACITY, TRACE_WINDOW_OPACITY / samples).toFixed(3));
  });

  // Close-hauled and run lines, named by the tack whose course they mark: a heading clockwise of the
  // true wind has the wind on the port side.
  protected readonly portTackCloseHauledLine = new DialLine(angle => this.dialLinePath(angle));
  protected readonly stbdTackCloseHauledLine = new DialLine(angle => this.dialLinePath(angle));
  protected readonly portTackRunLine = new DialLine(angle => this.dialLinePath(angle));
  protected readonly stbdTackRunLine = new DialLine(angle => this.dialLinePath(angle));
  /**
   * The wind shift traces: each sample's swept wedge, offset by the close-hauled angle to either tack
   * like the close-hauled lines. The samples are true wind directions, so they are placed in the dial
   * frame as they are in compass mode and less the heading in simple mode.
   */
  protected readonly traceWedges = computed(() => {
    const closeHauled = Number(this.closeHauledLineAngleDeg()) || 0;
    const headingOffset = this.compassModeEnabled() ? 0 : Number(this.compassHeadingDeg()) || 0;
    const growth = this.traceGrowth();
    return this.windTrace().map(({ id, from, to }) => {
      const fromDeg = toDegrees(from) - headingOffset;
      // The newest trace is painted as the close-hauled line eases across it.
      const progress = growth?.id === id ? growth.progress : 1;
      const [start, end] = traceSpan(fromDeg, fromDeg + dialTurn(fromDeg, toDegrees(to) - headingOffset) * progress);
      return {
        id,
        port: this.wedgePath(start + closeHauled, end + closeHauled),
        stbd: this.wedgePath(start - closeHauled, end - closeHauled)
      };
    });
  });
  // Rotation Animation
  private animationFrameIds = new WeakMap<SVGGElement, number>();

  private readonly CENTER = 500;
  private readonly RADIUS = POLAR_OVERLAY_DIAL_RADIUS;
  // Pivot of the corner set arrow: the visual centre of the drift value's digits, the point of the
  // corner farthest from the dial edge and the viewBox (87.5 units). The arrow reaches 80 from it.
  private readonly SET_ARROW_CENTER: [number, number] = [904, 912];
  protected readonly setArrowTranslate = `translate(${this.SET_ARROW_CENTER[0]} ${this.SET_ARROW_CENTER[1]})`;
  private readonly animationDuration = computed(() => effectiveAnimationDuration(this.updateInterval()));

  // Rudder bar: the SVG holds a static 35 arc per side (pathLength 100); the reveal is the
  // stroke-dashoffset. offset 100 = empty, 0 = full; fraction is 1:1 with the rudder angle.
  private readonly RUDDER_MAX_DEG = 35;
  protected readonly rudderStbdOffset = computed(() => this.rudderDashOffset(true));
  protected readonly rudderPortOffset = computed(() => this.rudderDashOffset(false));
  protected readonly rudderTransition = computed(() => `stroke-dashoffset ${this.animationDuration()}ms linear`);

  private rudderDashOffset(starboard: boolean): number {
    if (!this.rudderEnabled()) return 100;
    const angle = this.rudderAngleDeg();
    if (angle == null || !Number.isFinite(angle)) return 100;
    const magnitude = starboard ? Math.max(angle, 0) : Math.max(-angle, 0);
    const fraction = Math.min(magnitude, this.RUDDER_MAX_DEG) / this.RUDDER_MAX_DEG;
    return 100 * (1 - fraction);
  }

  private readonly ngZone = inject(NgZone);

  private setRotationImmediate(element: SVGGElement, angle: number, center: [number, number] = [this.CENTER, this.CENTER]): void {
    element.setAttribute('transform', `rotate(${angle} ${center[0]} ${center[1]})`);
  }

  constructor() {
    effect(() => {
      const modeEnabled = this.compassModeEnabled();
      const rawHeading = this.compassHeadingDeg();
      const heading = Number.isFinite(rawHeading) ? Math.round(rawHeading as number) : null;
      if (heading == null) return;

      untracked(() => {
        const dialHeading = modeEnabled ? heading : 0;
        const isFirstCompass = !this.compassInitialized;
        if (isFirstCompass) {
          this.compass.oldValue = dialHeading;
          this.compass.newValue = dialHeading;
          this.compassInitialized = true;
        } else {
          this.compass.oldValue = this.compass.newValue;
          this.compass.newValue = dialHeading;
        }
        this.headingValue.set(heading.toString());
        if (this.rotatingDial()?.nativeElement) {
          if (isFirstCompass || this.compass.oldValue === this.compass.newValue) {
            this.setRotationImmediate(this.rotatingDial().nativeElement, -this.compass.newValue);
          } else {
            animateRotation(this.rotatingDial().nativeElement, -this.compass.oldValue, -this.compass.newValue, this.animationDuration(), undefined, this.animationFrameIds, undefined, this.ngZone);
          }
          // The COG and true-wind pointers sit in the boat frame, so a heading change turns them
          // (with the dial); the tack lines are in the dial frame and redraw in place.
          const animate = !isFirstCompass && this.compass.oldValue !== this.compass.newValue;
          if (this.cogInitialized) this.placeCogPointer(animate);
          if (this.twaInitialized) this.placeTrueWindPointer(animate);
          this.updateTackLines(false);
        }
      });
    });

    effect(() => {
      const raw = this.courseOverGroundDeg();
      const cogAngle = Number.isFinite(raw as number) ? Math.round(raw as number) : null;
      // The heading effect re-places the arrow on a mode toggle, but only while a heading is present.
      void this.compassModeEnabled();
      if (cogAngle == null) return;

      untracked(() => {
        this.courseOverGround = cogAngle;
        const isFirstCog = !this.cogInitialized;
        this.cogInitialized = true;
        this.placeCogPointer(!isFirstCog);
      });
    });

    effect(() => {
      const wptAngle = this.waypointAngleDeg();

      untracked(() => {
        if (wptAngle == null || !Number.isFinite(wptAngle)) {
          return;
        }
        const isFirstWaypoint = !this.wptInitialized;
        if (isFirstWaypoint) {
          this.wpt.oldValue = wptAngle;
          this.wpt.newValue = wptAngle;
          this.wptInitialized = true;
        } else {
          this.wpt.oldValue = this.wpt.newValue;
          this.wpt.newValue = wptAngle;
        }
        if (this.wptIndicator()?.nativeElement) {
          if (isFirstWaypoint || this.wpt.oldValue === this.wpt.newValue) {
            this.setRotationImmediate(this.wptIndicator().nativeElement, this.wpt.newValue);
          } else {
            animateRotation(this.wptIndicator().nativeElement, this.wpt.oldValue, this.wpt.newValue, this.animationDuration(), undefined, this.animationFrameIds, undefined, this.ngZone);
          }
        }
      });
    });

    effect(() => {
      const raw = this.appWindAngleDeg();
      const appWindAngle = Number.isFinite(raw as number) ? Math.round(raw as number) : null;
      if (appWindAngle == null) return;

      untracked(() => {
        const isFirstAwa = !this.awaInitialized;
        if (isFirstAwa) {
          this.awa.oldValue = appWindAngle;
          this.awa.newValue = appWindAngle;
          this.awaInitialized = true;
        } else {
          this.awa.oldValue = this.awa.newValue;
          this.awa.newValue = appWindAngle;
        }
        if (this.awaIndicator()?.nativeElement) {
          if (isFirstAwa || this.awa.oldValue === this.awa.newValue) {
            this.setRotationImmediate(this.awaIndicator().nativeElement, this.awa.newValue);
          } else {
            animateRotation(this.awaIndicator().nativeElement, this.awa.oldValue, this.awa.newValue, this.animationDuration(), undefined, this.animationFrameIds, undefined, this.ngZone);
          }
        }
      });
    });

    effect(() => {
      const raw = this.trueWindAngleDeg();
      const trueWindAngle = Number.isFinite(raw as number) ? Math.round(raw as number) : null;
      // The heading effect re-places the pointer on a mode toggle, but only while a heading is present.
      void this.compassModeEnabled();
      if (trueWindAngle == null) return;

      untracked(() => {
        this.trueWindHeading = trueWindAngle;
        const isFirstTwa = !this.twaInitialized;
        this.twaInitialized = true;
        this.placeTrueWindPointer(!isFirstTwa);
        // The tack lines are centered on the true wind; recompute whenever TWA changes
        this.updateTackLines(!isFirstTwa);
      });
    });

    // A new trace grows with the close-hauled line's ease; the traces present at first draw do not.
    effect(() => {
      const newest = this.windTrace().at(-1)?.id ?? null;
      untracked(() => {
        const previous = this.newestTraceId;
        this.newestTraceId = newest;
        if (newest === null || previous === null || newest === previous) return;
        this.traceGrowthCancel?.();
        this.traceGrowth.set({ id: newest, progress: 0 });
        this.traceGrowthCancel = animateProgress(this.animationDuration(), progress => this.traceGrowth.set({ id: newest, progress }), this.ngZone);
      });
    });

    // Recompute the tack lines when their angles change or a set is switched on or off
    effect(() => {
      void this.closeHauledLineAngleDeg();
      void this.closeHauledLineEnabled();
      void this.runLineAngleDeg();
      untracked(() => this.updateTackLines());
    });

    // The set arrow sits outside the rotating dial, so it takes the heading itself to stay heading-up.
    effect(() => {
      const rawSet = this.driftSetDeg();
      const rawHeading = this.compassHeadingDeg();
      if (!Number.isFinite(rawSet as number) || !Number.isFinite(rawHeading)) return;
      const relativeSet = this.addHeading(Math.round(rawSet as number), -Math.round(rawHeading));

      untracked(() => {
        const isFirstSet = !this.setInitialized;
        if (isFirstSet) {
          this.set.oldValue = relativeSet;
          this.set.newValue = relativeSet;
          this.setInitialized = true;
        } else {
          this.set.oldValue = this.set.newValue;
          this.set.newValue = relativeSet;
        }
        if (this.setIndicator()?.nativeElement) {
          if (isFirstSet || this.set.oldValue === this.set.newValue) {
            this.setRotationImmediate(this.setIndicator().nativeElement, this.set.newValue, this.SET_ARROW_CENTER);
          } else {
            animateRotation(this.setIndicator().nativeElement, this.set.oldValue, this.set.newValue, this.animationDuration(), undefined, this.animationFrameIds, this.SET_ARROW_CENTER, this.ngZone);
          }
        }
      });
    });

    // The overlay curves and the dot ease between updates like the pointers around them.
    effect(() => {
      const mode = this.polarOverlayMode();
      const curve = this.polarCurve();
      untracked(() => this.polarCurveTween.to(mode === 'polar' && curve?.length ? curve : null, mode, this.animationDuration(), this.ngZone));
    });
    effect(() => {
      const mode = this.polarOverlayMode();
      const curve = this.vmcCurve();
      untracked(() => this.vmcCurveTween.to(mode === 'vmc' && curve?.length ? curve : null, mode, this.animationDuration(), this.ngZone));
    });
    effect(() => {
      const mode = this.polarOverlayMode();
      const optima = mode === 'vmc' ? this.vmcOptima() : null;
      untracked(() => {
        this.portOptimumTween.to(optima?.port ?? null, mode, this.animationDuration(), this.ngZone);
        this.stbdOptimumTween.to(optima?.starboard ?? null, mode, this.animationDuration(), this.ngZone);
      });
    });
    effect(() => {
      const mode = this.polarOverlayMode();
      const r = this.overlayDotRadius();
      const shown = mode !== 'hidden' && r != null && Number.isFinite(r) ? r : null;
      untracked(() => this.overlayDotTween.to(shown, mode, this.animationDuration(), this.ngZone));
    });

    // The polar curve turns with the water TWA, eased like the true-wind pointer so the two move together.
    effect(() => {
      const raw = this.polarCurveRotationDeg();
      if (!Number.isFinite(raw)) return;
      const rotation = this.addHeading(Math.round(raw), 0);

      untracked(() => {
        const element = this.polarOverlay()?.nativeElement;
        if (!element) return;
        const isFirst = !this.polarRotationInitialized;
        this.polarRotation.oldValue = isFirst ? rotation : this.polarRotation.newValue;
        this.polarRotation.newValue = rotation;
        this.polarRotationInitialized = true;
        if (isFirst || this.polarRotation.oldValue === rotation) {
          this.setRotationImmediate(element, rotation);
        } else {
          animateRotation(element, this.polarRotation.oldValue, rotation, this.animationDuration(), undefined, this.animationFrameIds, undefined, this.ngZone);
        }
      });
    });

  }

  // Dial-local placement: convert a boat-relative angle into the rotating dial's local frame
  // so the dial's -heading rotation (compass mode) yields the correct boat-relative result.
  private toDialLocal(boatRelative: number): number {
    const heading = this.compassModeEnabled() ? (Number(this.compass.newValue) || 0) : 0;
    return this.addHeading(heading, boatRelative);
  }

  /** Turns the COG arrow to the course relative to the bow: in compass mode COG less the heading. */
  private placeCogPointer(animate: boolean): void {
    const headingOffset = this.compassModeEnabled() ? this.compass.newValue : 0;
    this.rotateIndicator(this.cog, this.courseOverGround - headingOffset, this.cogIndicator()?.nativeElement, animate);
  }

  /** Turns the true-wind pointer to the wind relative to the bow: in compass mode TWD less the heading. */
  private placeTrueWindPointer(animate: boolean): void {
    const headingOffset = this.compassModeEnabled() ? this.compass.newValue * -1 : 0;
    this.rotateIndicator(this.twa, this.addHeading(this.trueWindHeading, headingOffset), this.twaIndicator()?.nativeElement, animate);
  }

  /** Rotates an indicator to `next`, easing from its last target or, with animate false, at once. */
  private rotateIndicator(rotation: ISVGRotationObject, next: number, element: SVGGElement | undefined, animate: boolean): void {
    // An ease already heading to this target is left to finish.
    if (element && next === rotation.newValue && this.animationFrameIds.has(element)) return;
    rotation.oldValue = animate ? rotation.newValue : next;
    rotation.newValue = next;
    if (!element) return;
    if (!animate || rotation.oldValue === rotation.newValue) {
      // A running ease would otherwise finish at its own, older target.
      const pending = this.animationFrameIds.get(element);
      if (pending) cancelAnimationFrame(pending);
      this.animationFrameIds.delete(element);
      this.setRotationImmediate(element, next);
    } else {
      animateRotation(element, rotation.oldValue, next, this.animationDuration(), undefined, this.animationFrameIds, undefined, this.ngZone);
    }
  }

  private updateTackLines(animate = true): void {
    // Each pair straddles the true wind: boat-relative TWA ± its angle, placed in the dial frame.
    const base = Number(this.twa.newValue) || 0;
    const duration = animate ? this.animationDuration() : null;
    const place = (line: DialLine, offset: number) =>
      line.moveTo(this.toDialLocal(this.addHeading(base, offset)), duration, this.ngZone);

    if (this.closeHauledLineEnabled()) {
      const closeHauled = Number(this.closeHauledLineAngleDeg()) || 0;
      place(this.portTackCloseHauledLine, closeHauled);
      place(this.stbdTackCloseHauledLine, -closeHauled);
    } else {
      this.portTackCloseHauledLine.clear();
      this.stbdTackCloseHauledLine.clear();
    }

    const run = this.runLineAngleDeg();
    if (run == null) {
      this.portTackRunLine.clear();
      this.stbdTackRunLine.clear();
    } else {
      place(this.portTackRunLine, run);
      place(this.stbdTackRunLine, -run);
    }
  }

  /** Project a dial angle (degrees, 0 = up) onto the dial circle. Unrounded; callers round if needed. */
  private dialPoint(angleDeg: number): [number, number] {
    const radian = (angleDeg * Math.PI) / 180;
    return [
      this.RADIUS * Math.sin(radian) + this.CENTER,
      (this.RADIUS * Math.cos(radian) * -1) + this.CENTER,
    ];
  }

  /** A `d` path through overlay points: angle clockwise from up, r from the dial center. */
  private overlayPath(points: OverlayPoint[] | null, closed: boolean): string {
    if (!points?.length) return '';
    const coords = points.map(point => { const { x, y } = this.overlayXY(point); return `${x},${y}`; });
    return `M ${coords.join(' L ')}${closed ? ' Z' : ''}`;
  }

  /** An overlay point's SVG coordinates, to one decimal; null for no point. */
  private overlayCenter(point: OverlayPoint | null): { x: string; y: string } | null {
    return point ? this.overlayXY(point) : null;
  }

  private overlayXY({ angle, r }: OverlayPoint): { x: string; y: string } {
    return { x: (this.CENTER + r * Math.sin(angle)).toFixed(1), y: (this.CENTER - r * Math.cos(angle)).toFixed(1) };
  }

  /** A wedge from the dial center across the rim, clockwise from one dial angle to another (degrees). */
  private wedgePath(fromDeg: number, toDeg: number): string {
    const [x1, y1] = this.dialPoint(fromDeg);
    const [x2, y2] = this.dialPoint(toDeg);
    return `M ${this.CENTER},${this.CENTER} L ${x1.toFixed(1)},${y1.toFixed(1)} A ${this.RADIUS},${this.RADIUS} 0 0 1 ${x2.toFixed(1)},${y2.toFixed(1)} Z`;
  }

  private dialLinePath(angleDeg: number): string {
    const [x, y] = this.dialPoint(angleDeg);
    return `M ${this.CENTER},${this.CENTER} L ${Math.floor(x)},${Math.floor(y)}`;
  }

  private addHeading(h1 = 0, h2 = 0) {
    let h3 = (h1 + h2) % 360;
    if (h3 < 0) h3 += 360;
    return h3;
  }

  ngOnDestroy(): void {
    this.polarCurveTween.stop();
    this.vmcCurveTween.stop();
    this.overlayDotTween.stop();
    this.portOptimumTween.stop();
    this.stbdOptimumTween.stop();

    this.traceGrowthCancel?.();
    for (const line of [this.portTackCloseHauledLine, this.stbdTackCloseHauledLine, this.portTackRunLine, this.stbdTackRunLine]) line.stop();

    // Cancel any animateRotation frames tracked in WeakMap for known elements
    const els: (ElementRef<SVGGElement> | undefined)[] = [
      this.rotatingDial(),
      this.awaIndicator(),
      this.twaIndicator(),
      this.wptIndicator(),
      this.setIndicator(),
      this.cogIndicator(),
      this.polarOverlay(),
    ];
    for (const ref of els) {
      const el = ref?.nativeElement;
      if (!el) continue;
      const id = this.animationFrameIds.get(el);
      if (id) cancelAnimationFrame(id);
      this.animationFrameIds.delete(el);
    }
  }

}

/** A sample's swept span as [start, end] dial degrees, clockwise, at least MIN_TRACE_WIDTH_DEG wide. */
function traceSpan(fromDeg: number, toDeg: number): [number, number] {
  const turn = dialTurn(fromDeg, toDeg);
  if (Math.abs(turn) < MIN_TRACE_WIDTH_DEG) {
    const center = fromDeg + turn / 2;
    return [center - MIN_TRACE_WIDTH_DEG / 2, center + MIN_TRACE_WIDTH_DEG / 2];
  }
  return turn > 0 ? [fromDeg, fromDeg + turn] : [toDeg, toDeg - turn];
}
