import { Component, ElementRef, input, viewChild, signal, effect, computed, untracked, OnDestroy, NgZone, inject, ChangeDetectionStrategy } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { animateRotation, animateAngleTransition, animateSectorTransition, effectiveAnimationDuration, type SectorAngles } from '../../core/utils/svg-animate.util';
import { toDegrees } from '../../core/utils/si-presentation.util';

const angle = ([a,b],[c,d],[e,f]) => (Math.atan2(f-d,e-c)-Math.atan2(b-d,a-c)+3*Math.PI)%(2*Math.PI)-Math.PI;

interface ISVGRotationObject {
  oldValue: number,
  newValue: number,
}

@Component({
    selector: 'svg-racesteer',
    templateUrl: './svg-racesteer.component.svg',
    styleUrl: './svg-racesteer.component.scss',
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SvgRacesteerComponent implements OnDestroy {
  protected readonly rotatingDial = viewChild.required<ElementRef<SVGGElement>>('rotatingDial');
  protected readonly twaIndicator = viewChild.required<ElementRef<SVGGElement>>('twaIndicator');
  protected readonly wptIndicator = viewChild.required<ElementRef<SVGGElement>>('wptIndicator');
  protected readonly setIndicator = viewChild.required<ElementRef<SVGGElement>>('setIndicator');
  protected readonly tackIndicator = viewChild.required<ElementRef<SVGGElement>>('tackIndicator');

  // Angles are in rad, speeds are in their presentation unit.
  protected readonly compassHeading = input.required<number>();
  protected readonly updateInterval = input<number | undefined>(undefined);
  protected readonly tackTrue = input.required<number>();
  protected readonly polarSpeedRatio = input.required<number>();
  protected readonly trueWindAngle = input.required<number>();
  protected readonly trueWindSpeed = input.required<number>();
  protected readonly targetAngle = input.required<number | null>();
  protected readonly optimalWindAngle = input.required<number>();
  protected readonly targetVMG = input.required<number>();
  protected readonly targetVMGOffset = input.required<number>();
  protected readonly targetVMGRatio = input.required<number>();
  protected readonly sailSetupEnabled = input.required<boolean>();
  protected readonly driftEnabled = input.required<boolean>();
  protected readonly driftSet = input<number | undefined>(undefined);
  protected readonly driftFlow = input<number | undefined>(undefined);
  protected readonly waypointEnabled = input.required<boolean>();
  protected readonly waypointAngle = input<number | undefined>(undefined);
  protected readonly vmgToWaypoint = input<number | undefined>(undefined);
  protected readonly trueWindMinHistoric = input<number | undefined>(undefined);
  protected readonly trueWindMidHistoric = input<number | undefined>(undefined);
  protected readonly trueWindMaxHistoric = input<number | undefined>(undefined);
  protected readonly gradianColor = input.required<{ start: string; stop: string }>();
  protected readonly vmgSpeedUnitSymbol = input<string>('');
  protected readonly waypointSpeedUnitSymbol = input<string>('');

  // Angle inputs arrive in rad; the rotation attributes, dial geometry and readouts below work in degrees.
  private readonly compassHeadingDeg = computed(() => toDegrees(this.compassHeading()));
  private readonly tackTrueDeg = computed(() => Math.round(toDegrees(this.tackTrue())));
  private readonly trueWindAngleDeg = computed(() => toDegrees(this.trueWindAngle()));
  private readonly targetAngleDeg = computed(() => { const a = this.targetAngle(); return a == null ? null : toDegrees(a); });
  private readonly optimalWindAngleDeg = computed(() => toDegrees(this.optimalWindAngle()));
  private readonly driftSetDeg = computed(() => toDegrees(this.driftSet()));
  /** Whole degrees: the waypoint readout shows it, and 0 hides the marker. */
  protected readonly waypointAngleDeg = computed(() => { const a = this.waypointAngle(); return a == null ? undefined : Math.round(toDegrees(a)) % 360; });
  private readonly trueWindMinHistoricDeg = computed(() => toDegrees(this.trueWindMinHistoric()));
  private readonly trueWindMidHistoricDeg = computed(() => toDegrees(this.trueWindMidHistoric()));
  private readonly trueWindMaxHistoricDeg = computed(() => toDegrees(this.trueWindMaxHistoric()));

  protected compass: ISVGRotationObject = { oldValue: 0, newValue: 0 };
  protected twa: ISVGRotationObject = { oldValue: 0, newValue: 0 };
  protected wpt: ISVGRotationObject = { oldValue: 0, newValue: 0 };
  protected tack: ISVGRotationObject = { oldValue: 0, newValue: 0 };
  protected set: ISVGRotationObject = { oldValue: 0, newValue: 0 };
  private compassInitialized = false;
  private twaInitialized = false;
  private wptInitialized = false;
  private tackInitialized = false;
  private setInitialized = false;
  private laylinesInitialized = false;

  protected headingValue = signal<string>("--");
  private windSectorsInitialized = false;
  private trueWindHeading = 0;

  protected nextTargetDirection = computed(() => {
    const hdg = this.compassHeadingDeg();
    const targetDirection = this.tackTrueDeg();
    if (hdg == null || targetDirection == null) return 0;
    return this.unsignedAngleDelta(hdg, targetDirection);
  });
  protected trueWindSpeedDisplay = computed(() => {
    const trueWindSpeed = this.trueWindSpeed();
    if (trueWindSpeed == null) return "--";
    return trueWindSpeed.toFixed(1);
  });
  protected windAnglePerformanceRatioColor = computed(() => {
    const optimal = this.optimalWindAngleDeg();
    const target = this.targetAngleDeg();
    const start = this.gradianColor().start;
    const stop = this.gradianColor().stop;
    if (optimal == null || target == null) return start;
    const ratio = 1 - Math.abs(optimal - target) / 180;
    return this.interpolateColor(start, stop, ratio);
  });
  protected targetVMGOffsetText = computed(() => this.targetVMGOffset().toFixed(1));
  protected targetVMGOffsetRatioColor = computed(() =>
    this.interpolateColor(this.gradianColor().start, this.gradianColor().stop, this.targetVMGRatio()));
  protected waypointActive = signal<boolean>(false);
  protected flow = computed(() => {
    const flow = this.driftFlow();
    if (flow == null) return "--";
    return flow.toFixed(1);
  });

  //laylines
  private portLaylinePrev = 0;
  private stbdLaylinePrev = 0;
  private portLaylineCancel: (() => void) | null = null;
  private stbdLaylineCancel: (() => void) | null = null;
  private readonly CENTER_X = 600;
  private readonly CENTER_Y = 620;
  private readonly RADIUS = 540;
  private readonly animationDuration = computed(() => effectiveAnimationDuration(this.updateInterval()));
  protected laylinePortPath = signal<string>(`M ${this.CENTER_X},${this.CENTER_Y} ${this.CENTER_X},${this.CENTER_Y}`);
  protected laylineStbdPath = signal<string>(`M ${this.CENTER_X},${this.CENTER_Y} ${this.CENTER_X},${this.CENTER_Y}`);
  //Wind Sectors
  private portSectorPrev: SectorAngles = { min: 0, mid: 0, max: 0 };
  private stbdSectorPrev: SectorAngles = { min: 0, mid: 0, max: 0 };
  private portSectorCancel: (() => void) | null = null;
  private stbdSectorCancel: (() => void) | null = null;
  protected portWindSectorPath = signal<string>('');
  protected stbdWindSectorPath = signal<string>('');
  // Speed Line
  protected speedLineTipY = signal<number>(620);
  protected speedTipPoints = signal<string>('600,570 580,600 620,600');
  protected speedRatioColor = signal<string>('');
  private speedLinePrevRatio = 0;
  private speedLinePrevTipY = 600;
  private speedLineAnimId: number | null = null;
  private speedLineInitialized = false;
  // Rotation Animation
  private animationFrameIds = new WeakMap<SVGGElement, number>();
  private readonly ngZone = inject(NgZone);

  private setRotationImmediate(element: SVGGElement, angle: number): void {
    element.setAttribute('transform', `rotate(${angle} 600 620)`);
  }

  constructor() {
    effect(() => {
      const waypoint = this.waypointEnabled();

      untracked(() => {
        this.waypointActive.set(waypoint);
      });
    });

    effect(() => {
      const raw = this.compassHeadingDeg();
      const heading = Number.isFinite(raw) ? Math.round(raw as number) : null;
      if (heading == null) return;

      untracked(() => {
        if (!this.compassInitialized) {
          this.compass.oldValue = heading;
          this.compass.newValue = heading;
          this.compassInitialized = true;
        } else {
          this.compass.oldValue = this.compass.newValue;
          this.compass.newValue = heading;
        }
        this.headingValue.set(heading.toString());
        if (this.rotatingDial()?.nativeElement) {
          if (this.compass.oldValue === this.compass.newValue) {
            this.setRotationImmediate(this.rotatingDial().nativeElement, -this.compass.newValue);
          } else {
            animateRotation(this.rotatingDial().nativeElement, -this.compass.oldValue, -this.compass.newValue, this.animationDuration(), undefined, this.animationFrameIds, [600, 620], this.ngZone);
          }
          this.updateWindSectors();
        }
      });
    });

    effect(() => {
      const raw = this.targetAngleDeg();
      // target angle path automatically switches between tack and Gybe angles calculations. No need to use dedicated beat and gybe angle paths
      const targetAngle = Number.isFinite(raw) ? Math.round(raw as number) : null;
      if (targetAngle == null) return;

      untracked(() => {
        if (!this.tackInitialized) {
          this.tack.oldValue = targetAngle;
          this.tack.newValue = targetAngle;
          this.tackInitialized = true;
        } else {
          this.tack.oldValue = this.tack.newValue;
          this.tack.newValue =  targetAngle;
        }
        if (this.tackIndicator()?.nativeElement) {
          if (this.tack.oldValue === this.tack.newValue) {
            this.setRotationImmediate(this.tackIndicator().nativeElement, this.tack.newValue);
          } else {
            animateRotation(this.tackIndicator().nativeElement, this.tack.oldValue, this.tack.newValue, this.animationDuration(), undefined, this.animationFrameIds, [600, 620], this.ngZone);
          }
        }
        this.updateLaylines();
      });
    });

    effect(() => {
      const wptAngle = this.waypointAngleDeg();

      untracked(() => {
        if (!wptAngle) {
            this.waypointActive.set(false);
          return;
        }

        if (this.waypointEnabled()) {
          this.waypointActive.set(true);
        } else {
          this.waypointActive.set(false);
        }
        if (!this.wptInitialized) {
          this.wpt.oldValue = wptAngle;
          this.wpt.newValue = wptAngle;
          this.wptInitialized = true;
        } else {
          this.wpt.oldValue = this.wpt.newValue;
          this.wpt.newValue = wptAngle;
        }
        if (this.wptIndicator()?.nativeElement) {
          if (this.wpt.oldValue === this.wpt.newValue) {
            this.setRotationImmediate(this.wptIndicator().nativeElement, this.wpt.newValue);
          } else {
            animateRotation(this.wptIndicator().nativeElement, this.wpt.oldValue, this.wpt.newValue, this.animationDuration(), undefined, this.animationFrameIds, [600, 620], this.ngZone);
          }
        }
      });
    });

    effect(() => {
      const raw = this.trueWindAngleDeg();
      const trueWindAngle = Number.isFinite(raw) ? Math.round(raw as number) : null;
      const compassRaw = this.compassHeadingDeg();
      const compassHeading = Number.isFinite(compassRaw) ? Math.round(compassRaw as number) : null;
      if (trueWindAngle == null || compassHeading == null) return;

      untracked(() => {
        this.trueWindHeading = trueWindAngle;
        const nextTwa = this.addHeading(this.trueWindHeading, (compassHeading * -1));
        if (!this.twaInitialized) {
          this.twa.oldValue = nextTwa;
          this.twa.newValue = nextTwa;
          this.twaInitialized = true;
        } else {
          this.twa.oldValue = this.twa.newValue;
          this.twa.newValue = nextTwa;
        }
         if (this.twaIndicator()?.nativeElement) {
          if (this.twa.oldValue === this.twa.newValue) {
            this.setRotationImmediate(this.twaIndicator().nativeElement, this.twa.newValue);
          } else {
            animateRotation(this.twaIndicator().nativeElement, this.twa.oldValue, this.twa.newValue, this.animationDuration(), undefined, this.animationFrameIds, [600, 620], this.ngZone);
          }
          this.updateLaylines();
        }
      });
    });

    effect(() => {
      const ratio = this.polarSpeedRatio();

      // Clamp ratio
      const clampedRatio = Math.max(0, Math.min(1, ratio));
      const yBase = 620;
      const yTop = 166;
      const length = yBase - yTop;
      const newTipY = yBase - length * clampedRatio;

      if (!this.speedLineInitialized) {
        this.speedLineInitialized = true;
        this.speedLineTipY.set(newTipY);
        const tipHeight = 30;
        const tipBaseHalf = 20;
        const tipApexY = newTipY - tipHeight;
        this.speedTipPoints.set(`${600},${tipApexY} ${600 - tipBaseHalf},${newTipY} ${600 + tipBaseHalf},${newTipY}`);
        this.speedRatioColor.set(this.interpolateColor(this.gradianColor().start, this.gradianColor().stop, clampedRatio));
        this.speedLinePrevTipY = newTipY;
        this.speedLinePrevRatio = clampedRatio;
        return;
      }

      // Animate from previous tipY to new tipY
      this.animateSpeedLine(this.speedLinePrevTipY, newTipY);

      // Store for next animation
      this.speedLinePrevTipY = newTipY;
      this.speedLinePrevRatio = clampedRatio;
    });

    effect(() => {
      const raw = this.driftSetDeg();
      const driftSet = Number.isFinite(raw as number) ? Math.round(raw as number) : null;
      if (driftSet == null) return;

      untracked(() => {
        if (!this.setInitialized) {
          this.set.oldValue = driftSet;
          this.set.newValue = driftSet;
          this.setInitialized = true;
        } else {
          this.set.oldValue = this.set.newValue;
          this.set.newValue =  driftSet;
        }
        if (this.setIndicator()?.nativeElement) {
          if (this.set.oldValue === this.set.newValue) {
            this.setRotationImmediate(this.setIndicator().nativeElement, this.set.newValue);
          } else {
            animateRotation(this.setIndicator().nativeElement, this.set.oldValue, this.set.newValue, this.animationDuration(), undefined, this.animationFrameIds, [600, 620], this.ngZone);
          }
        }
      });
    });
  }

  private updateLaylines(): void {
    if (!this.twaInitialized) return;

    const raw = this.targetAngleDeg();
    let targetAngle = Number.isFinite(raw) ? Math.round(raw as number) : null;
    if (targetAngle == null) return;
    targetAngle = targetAngle / 2;
    const base = Number(this.twa.newValue);

    // Animate Port Layline
    const portLaylineRotate = base - targetAngle;
    const stbdLaylineRotate = base + targetAngle;
    if (!this.laylinesInitialized) {
      this.laylinesInitialized = true;
      this.setLaylinePath(portLaylineRotate, true);
      this.setLaylinePath(stbdLaylineRotate, false);
      this.portLaylinePrev = portLaylineRotate;
      this.stbdLaylinePrev = stbdLaylineRotate;
      return;
    }

    this.animateLayline(this.portLaylinePrev, portLaylineRotate, true);
    this.portLaylinePrev = portLaylineRotate;

    this.animateLayline(this.stbdLaylinePrev, stbdLaylineRotate, false);
    this.stbdLaylinePrev = stbdLaylineRotate;
  }

  private animateLayline(from: number, to: number, isPort: boolean) {
    (isPort ? this.portLaylineCancel : this.stbdLaylineCancel)?.();

    const onDone = () => {
      if (isPort) this.portLaylineCancel = null;
      else this.stbdLaylineCancel = null;
    };

    const cancel = animateAngleTransition(
      from,
      to,
      this.animationDuration(),
      angle => this.setLaylinePath(angle, isPort),
      onDone,
      this.ngZone
    );

    if (isPort) this.portLaylineCancel = cancel;
    else this.stbdLaylineCancel = cancel;
  }

  private updateWindSectors() {
    const min = this.trueWindMinHistoricDeg();
    const mid = this.trueWindMidHistoricDeg();
    const max = this.trueWindMaxHistoricDeg();
    if (min == null || mid == null || max == null) {
      return;
    }

    const portNew: SectorAngles = { min, mid, max };
    const stbdNew: SectorAngles = { min, mid, max };

    if (!this.windSectorsInitialized) {
      this.portSectorPrev = portNew;
      this.stbdSectorPrev = stbdNew;
      this.windSectorsInitialized = true;
      // Draw in place, no animation
      this.animateWindSector(portNew, portNew, true);
      this.animateWindSector(stbdNew, stbdNew, false);
      return;
    }

    // Animate as usual
    this.animateWindSector(this.portSectorPrev, portNew, true);
    this.animateWindSector(this.stbdSectorPrev, stbdNew, false);

    this.portSectorPrev = portNew;
    this.stbdSectorPrev = stbdNew;
  }

  private animateWindSector(from: SectorAngles, to: SectorAngles, isPort: boolean) {
    (isPort ? this.portSectorCancel : this.stbdSectorCancel)?.();
    const onDone = () => {
      if (isPort) this.portSectorCancel = null;
      else this.stbdSectorCancel = null;
    };

    const cancel = animateSectorTransition(
      from,
      to,
      this.animationDuration(),
      sector => this.setWindSectorPath(sector, isPort),
      onDone,
      this.ngZone
    );

    if (isPort) this.portSectorCancel = cancel;
    else this.stbdSectorCancel = cancel;
  }

  private animateSpeedLine(from: number, to: number): void {
    if (this.speedLineAnimId) {
      cancelAnimationFrame(this.speedLineAnimId);
      this.speedLineAnimId = null;
    }
    const duration = 1000; // Animation duration in ms
    const start = performance.now();
    const startRatio = this.speedLinePrevRatio;
    const endRatio = (600 - to) / (600 - 146); // Calculate ratio from tipY

    const ease = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    const animate = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = ease(progress);

      // Interpolate tipY
      const lerp = (a: number, b: number) => a + (b - a) * eased;
      const tipY = lerp(from, to);

      // Interpolate ratio for color
      const currentRatio = lerp(startRatio, endRatio);

      // Update line, tip, and color
      this.speedLineTipY.set(tipY);

      const tipHeight = 30;
      const tipBaseHalf = 20;
      const tipApexY = tipY - tipHeight;
      this.speedTipPoints.set(`${600},${tipApexY} ${600 - tipBaseHalf},${tipY} ${600 + tipBaseHalf},${tipY}`);
      this.speedRatioColor.set(this.interpolateColor(this.gradianColor().start, this.gradianColor().stop, currentRatio));

      if (progress < 1) {
        this.speedLineAnimId = requestAnimationFrame(animate);
      } else {
        this.speedLineAnimId = null;
      }
    };

    requestAnimationFrame(animate);
  }

  private interpolateColor(color1: string, color2: string, ratio: number): string {
    // Clamp ratio
    ratio = Math.max(0, Math.min(1, ratio));

    // Helper to parse hex color to [r,g,b]
    function hexToRgb(hex: string): [number, number, number] {
      hex = hex.replace('#', '');
      if (hex.length === 3) hex = hex.split('').map(x => x + x).join('');
      const num = parseInt(hex, 16);
      return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
    }

    const [r1, g1, b1] = hexToRgb(color1);
    const [r2, g2, b2] = hexToRgb(color2);

    const r = Math.round(r1 + (r2 - r1) * ratio);
    const g = Math.round(g1 + (g2 - g1) * ratio);
    const b = Math.round(b1 + (b2 - b1) * ratio);

    return `rgb(${r},${g},${b})`;
  }

  private addHeading(h1 = 0, h2 = 0) {
    const sum = h1 + h2;
    return ((sum % 360) + 360) % 360;
  }

  private unsignedAngleDelta(a: number, b: number): number {
    const delta = ((a - b + 540) % 360) - 180;
    return Math.abs(delta);
  }

  private normalizeAngle(angle: number): number {
    return ((angle % 360) + 360) % 360;
  }

  private setLaylinePath(angle: number, isPort: boolean): void {
    const radian = (this.normalizeAngle(angle) * Math.PI) / 180;
    const x = Math.floor(this.RADIUS * Math.sin(radian) + this.CENTER_X);
    const y = Math.floor((this.RADIUS * Math.cos(radian) * -1) + this.CENTER_Y);

    if (isPort) {
      this.laylinePortPath.set(`M ${this.CENTER_X},${this.CENTER_Y} L ${x},${y}`);
    } else {
      this.laylineStbdPath.set(`M ${this.CENTER_X},${this.CENTER_Y} L ${x},${y}`);
    }
  }

  private setWindSectorPath(sector: SectorAngles, isPort: boolean): void {
    const minAngle = this.addHeading(this.addHeading(sector.min, Number(this.compass.newValue) * -1), (this.targetAngleDeg() ?? 0) / 2 * (isPort ? -1 : 1));
    const midAngle = this.addHeading(this.addHeading(sector.mid, Number(this.compass.newValue) * -1), (this.targetAngleDeg() ?? 0) / 2 * (isPort ? -1 : 1));
    const maxAngle = this.addHeading(this.addHeading(sector.max, Number(this.compass.newValue) * -1), (this.targetAngleDeg() ?? 0) / 2 * (isPort ? -1 : 1));

    const minX = this.RADIUS * Math.sin((minAngle * Math.PI) / 180) + this.CENTER_X;
    const minY = (this.RADIUS * Math.cos((minAngle * Math.PI) / 180) * -1) + this.CENTER_Y;
    const midX = this.RADIUS * Math.sin((midAngle * Math.PI) / 180) + this.CENTER_X;
    const midY = (this.RADIUS * Math.cos((midAngle * Math.PI) / 180) * -1) + this.CENTER_Y;
    const maxX = this.RADIUS * Math.sin((maxAngle * Math.PI) / 180) + this.CENTER_X;
    const maxY = (this.RADIUS * Math.cos((maxAngle * Math.PI) / 180) * -1) + this.CENTER_Y;

    const largeArcFlag = Math.abs(angle([minX, minY], [midX, midY], [maxX, maxY])) > Math.PI / 2 ? 0 : 1;
    const sweepFlag = angle([maxX, maxY], [minX, minY], [midX, midY]) > 0 ? 0 : 1;

    const path = `M ${this.CENTER_X},${this.CENTER_Y} L ${minX},${minY} A ${this.RADIUS},${this.RADIUS} 0 ${largeArcFlag} ${sweepFlag} ${maxX},${maxY} z`;

    if (isPort) {
      this.portWindSectorPath.set(path);
    } else {
      this.stbdWindSectorPath.set(path);
    }
  }

  ngOnDestroy(): void {
    // Cancel layline animations
    this.portLaylineCancel?.();
    this.stbdLaylineCancel?.();
    this.portLaylineCancel = null;
    this.stbdLaylineCancel = null;

    // Cancel wind sector animations
    this.portSectorCancel?.();
    this.stbdSectorCancel?.();
    this.portSectorCancel = null;
    this.stbdSectorCancel = null;

    // Cancel any animateRotation frames tracked in WeakMap for known elements
    const els: (ElementRef<SVGGElement> | undefined)[] = [
      this.rotatingDial(),
      this.twaIndicator(),
      this.wptIndicator(),
      this.setIndicator(),
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
