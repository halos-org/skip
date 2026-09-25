import { Component, OnDestroy, inject, ChangeDetectionStrategy, input, effect, untracked, signal, computed, linkedSignal, WritableSignal } from '@angular/core';
import { Subscription, interval } from 'rxjs';
import { IWidgetSvcConfig } from '../../core/interfaces/widgets-interface';
import { POLAR_OVERLAY_DIAL_RADIUS, POLAR_OVERLAY_PEAK_RADIUS, PolarOverlayMode, SvgWindsteerComponent, WindTraceSample } from '../svg-windsteer/svg-windsteer.component';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective } from '../../core/directives/widget-streams.directive';
import { IPathUpdate } from '../../core/services/data.service';
import { ITheme } from '../../core/services/app-service';
import { UnitsService } from '../../core/services/units.service';
import { ActivePolarService } from '../../core/services/active-polar.service';
import { OverlayPoint, OverlayScale, POLAR_PATH_KEYS, PolarSpeedProfile, VmcOptimum, normalizeRadians, polarCurve, polarSpeedProfile, speedToRadius, vmcCurve, vmcDotRadius, vmcOptimum } from '../../core/utils/polar-overlay.util';
import { presentationValue } from '../../core/utils/si-presentation.util';
import { PolarResult, PolarTargets } from '../../core/utils/polar-engine.util';

// Default rolling window (seconds) for the wind shift traces; the single
// source of truth for both the default config and the missing-value fallback.
const DEFAULT_WIND_SECTOR_WINDOW_SECONDS = 5;

// Default stale-data TTL (seconds): an indicator hides this long after its last valid sample.
// Single source of truth for the default config and the missing/invalid-value fallback.
const DEFAULT_DATA_TIMEOUT_SECONDS = 5;

// 45° in rad, as a literal: the dashboard-schema generator reads DEFAULT_CONFIG values statically.
const DEFAULT_CLOSE_HAULED_LINE_ANGLE_RAD = 0.7853981633974483;

// Overlay auto-hide thresholds in m/s. The current-set arrow shows from SHOW and hides only below
// HIDE, so a drift estimate hovering near one limit cannot blink it; the COG arrow hides below SOG.
const SET_ARROW_SHOW_MS = 0.1;
const SET_ARROW_HIDE_MS = 0.05;
const SOG_HIDE_LIMIT_MS = 0.05;
// Change-detection dedup granularity: a speed signal only re-sets when it moves at least this much.
const SPEED_DEDUP_MS = 0.05;
const DEG_TO_RAD = Math.PI / 180;
// Angle dedup granularity: an angle signal only re-sets when it moves at least 1°.
const ANGLE_DEDUP_RAD = DEG_TO_RAD;

@Component({
  selector: 'widget-wind-steer',
  templateUrl: './widget-windsteer.component.html',
  imports: [SvgWindsteerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WidgetWindComponent implements OnDestroy {
  public id = input.required<string>();
  public type = input.required<string>();
  public theme = input.required<ITheme|null>();

  public static readonly DEFAULT_CONFIG: IWidgetSvcConfig = {
    supportAutomaticHistoricalSeries: false,
    filterSelfPaths: true,
    paths: {
      headingPath: {
        description: 'Heading',
        pathOptions: [
          { label: 'True', path: 'self.navigation.headingTrue' },
          { label: 'Magnetic', path: 'self.navigation.headingMagnetic' }
        ],
        path: 'self.navigation.headingTrue',
        source: 'default',
        pathType: 'number',
        isPathConfigurable: true,
        pathRequired: true,
        showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 'rad',
        convertUnitTo: 'deg',
        showConvertUnitTo: false
      },
      appWindAngle: {
        description: 'Apparent Wind Angle',
        path: 'self.environment.wind.angleApparent',
        source: 'default',
        pathType: 'number',
        isPathConfigurable: false,
        pathRequired: true,
        showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 'rad',
        convertUnitTo: 'deg',
        showConvertUnitTo: false
      },
      appWindSpeed: {
        description: 'Apparent Wind Speed',
        path: 'self.environment.wind.speedApparent',
        source: 'default',
        pathType: 'number',
        isPathConfigurable: false,
        pathRequired: true,
        showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 'm/s',
        convertUnitTo: 'knots'
      },
      trueWindAngle: {
        description: 'Wind Angle',
        pathOptions: [
          { label: 'Water', path: 'self.environment.wind.angleTrueWater' },
          { label: 'Ground', path: 'self.environment.wind.angleTrueGround' }
        ],
        path: 'self.environment.wind.angleTrueWater',
        source: 'default',
        pathType: 'number',
        isPathConfigurable: true,
        pathRequired: false,
        showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 'rad',
        convertUnitTo: 'deg',
        showConvertUnitTo: false
      },
      trueWindSpeed: {
        description: 'True Wind Speed',
        path: 'self.environment.wind.speedTrue',
        source: 'default',
        pathType: 'number',
        isPathConfigurable: false,
        pathRequired: false,
        showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 'm/s',
        convertUnitTo: 'knots'
      },
      courseOverGround: {
        description: 'Course Over Ground',
        pathOptions: [
          { label: 'True', path: 'self.navigation.courseOverGroundTrue' },
          { label: 'Magnetic', path: 'self.navigation.courseOverGroundMagnetic' }
        ],
        path: 'self.navigation.courseOverGroundTrue',
        source: 'default',
        pathType: 'number',
        isPathConfigurable: true,
        pathRequired: false,
        showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 'rad',
        showConvertUnitTo: false,
        convertUnitTo: 'deg'
      },
      speedOverGround: {
        description: 'Speed Over Ground',
        path: 'self.navigation.speedOverGround',
        source: 'default',
        pathType: 'number',
        isPathConfigurable: false,
        hideFromConfig: true,
        pathRequired: false,
        showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 'm/s',
        convertUnitTo: 'knots'
      },
      nextWaypointBearing: {
        description: 'Next Waypoint True Bearing',
        path: 'self.navigation.course.calcValues.bearingTrue',
        source: 'default',
        pathType: 'number',
        isPathConfigurable: false,
        pathRequired: false,
        showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 'rad',
        convertUnitTo: 'deg',
        showConvertUnitTo: false
      },
      set: {
        description: 'True Drift Set',
        path: 'self.environment.current.setTrue',
        source: 'default',
        pathType: 'number',
        isPathConfigurable: false,
        pathRequired: false,
        showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 'rad',
        convertUnitTo: 'deg',
        showConvertUnitTo: false
      },
      drift: {
        description: 'Drift Speed Impact',
        path: 'self.environment.current.drift',
        source: 'default',
        pathType: 'number',
        isPathConfigurable: false,
        pathRequired: false,
        showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 'm/s',
        convertUnitTo: 'knots'
      },
      polarTrueWindSpeed: {
        description: 'Polar Overlay True Wind Speed',
        path: 'self.environment.wind.speedTrue',
        source: 'default',
        sourceFromPath: 'trueWindSpeed',
        pathType: 'number',
        isPathConfigurable: false,
        hideFromConfig: true,
        pathRequired: false,
        showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 'm/s',
        convertUnitTo: 'm/s',
        showConvertUnitTo: false
      },
      polarTrueWindAngle: {
        description: 'Polar Overlay True Wind Angle (water)',
        path: 'self.environment.wind.angleTrueWater',
        source: 'default',
        sourceFromPath: 'trueWindAngle',
        pathType: 'number',
        isPathConfigurable: false,
        hideFromConfig: true,
        pathRequired: false,
        showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 'rad',
        convertUnitTo: 'rad',
        showConvertUnitTo: false
      },
      polarSpeedThroughWater: {
        description: 'Polar Overlay Speed Through Water',
        path: 'self.navigation.speedThroughWater',
        source: 'default',
        pathType: 'number',
        isPathConfigurable: false,
        hideFromConfig: true,
        pathRequired: false,
        showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 'm/s',
        convertUnitTo: 'm/s',
        showConvertUnitTo: false
      },
      rudderAngle: {
        description: 'Rudder Angle',
        path: 'self.steering.rudderAngle',
        source: 'default',
        pathType: 'number',
        isPathConfigurable: true,
        pathRequired: false,
        showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 'rad',
        convertUnitTo: 'deg',
        showConvertUnitTo: false
      }
    },
    compassModeEnabled: true,
    windSectorEnable: true,
    windSectorWindowSeconds: DEFAULT_WIND_SECTOR_WINDOW_SECONDS,
    closeHauledLineEnable: true,
    closeHauledLineAngle: DEFAULT_CLOSE_HAULED_LINE_ANGLE_RAD,
    closeHauledAngleFromPolar: true,
    runLineEnable: false,
    waypointEnable: true,
    courseOverGroundEnable: true,
    driftEnable: true,
    awsEnable: true,
    twsEnable: true,
    twaEnable: true,
    sailSetupEnable: false,
    rudderEnable: true,
    invertRudder: false,
    polarOverlayEnable: true,
    updateInterval: 1000,
    enableTimeout: false,
    dataTimeout: DEFAULT_DATA_TIMEOUT_SECONDS,
    siVersion: 20
  };

  /** Options stored in a unit their value alone does not show; published in the dashboard schema. */
  public static readonly OPTION_UNITS: Record<string, string> = {
    closeHauledLineAngle: 'rad'
  };

  public readonly runtime = inject(WidgetRuntimeDirective); // accessed in template
  private readonly stream = inject(WidgetStreamsDirective);
  private readonly unitsService = inject(UnitsService);
  private readonly activePolar = inject(ActivePolarService);

  private hasHeading = false;
  private hasCOG = false;
  private hasAWA = false;
  private hasAWS = false;
  private hasTWA = false;
  private hasTWS = false;
  private hasSet = false;
  private hasDrift = false;
  private hasWPT = false;
  private hasSOG = false;
  private lastRawTrueWindAngle: number | null = null;
  private lastRawRudder: number | null = null;

  protected currentHeading = signal(0);
  protected courseOverGroundAngle = signal(0);
  protected appWindAngle = signal(0);
  protected appWindSpeed = signal(0);
  private appWindSpeedMeasure = signal('');
  protected appWindSpeedDisplay = computed(() => presentationValue(this.unitsService, this.appWindSpeedMeasure(), this.appWindSpeed()));
  protected appWindSpeedUnit = computed(() => this.speedUnitSymbol(this.appWindSpeedMeasure()));
  protected trueWindAngle = signal(0);
  protected trueWindFresh = signal(false);
  protected trueWindSpeed = signal(0);
  private trueWindSpeedMeasure = signal('');
  protected trueWindSpeedDisplay = computed(() => presentationValue(this.unitsService, this.trueWindSpeedMeasure(), this.trueWindSpeed()));
  protected trueWindSpeedUnit = computed(() => this.speedUnitSymbol(this.trueWindSpeedMeasure()));
  protected driftFlow = signal(0);
  private driftMeasure = signal('');
  protected driftFlowDisplay = computed(() => presentationValue(this.unitsService, this.driftMeasure(), this.driftFlow()));
  protected driftUnit = computed(() => this.speedUnitSymbol(this.driftMeasure()));
  // Evaluated on every raw sample, not the deduped driftFlow: the dedup step equals the band width.
  protected setArrowActive = signal(false);
  protected driftSet = signal(0);
  protected sog = signal<number | undefined>(undefined);
  // SOG absent (boat publishes COG but not speed) is treated as "moving" so the COG arrow still
  // shows; only a present, sub-threshold SOG hides it.
  protected sogActive = computed(() => {
    const s = this.sog();
    return s == null || s >= SOG_HIDE_LIMIT_MS;
  });
  protected waypointAngle = signal<number | undefined>(undefined);
  // Per-path data freshness: true while a valid sample arrived within the TTL, false after it
  // lapses. The value signals hold their last value (freeze); these gate whether the indicator
  // is shown, so absent/invalid data hides rather than rendering as 0. trueWindFresh (above)
  // is the true-wind-angle member of this set.
  protected headingFresh = signal(false);
  protected courseFresh = signal(false);
  protected appWindFresh = signal(false);
  protected appWindSpeedFresh = signal(false);
  protected trueWindSpeedFresh = signal(false);
  // Current/drift has two independent paths: drift = speed (readout), set = direction (arrow).
  // Each tracks its own freshness so a stalled half hides rather than showing a frozen value.
  protected driftFresh = signal(false);
  protected setFresh = signal(false);
  // Signed rad, +ve = starboard (after invertRudder). null = no rudder data (bar hidden).
  protected rudderAngle = signal<number | null>(null);
  // The bearing's own freshness gates only the overlay mode; the waypoint marker keeps its own rule.
  private waypointFresh = signal(false);

  // Polar inputs, in SI from the hidden structural slots, never from the display paths. TWS feeds the
  // overlay and the polar lines; water TWA and STW only the overlay.
  private readonly registeredPolarSlots = new Set<(typeof POLAR_PATH_KEYS)[number]>();
  private hasPolarTws = false;
  private hasOverlayTwa = false;
  private hasOverlayStw = false;
  private polarTws = signal(0);          // m/s
  private polarTwsFresh = signal(false);
  protected overlayTwa = signal(0);        // rad, water-referenced, signed
  private overlayTwaFresh = signal(false);
  private overlayStw = signal(0);          // m/s
  private overlayStwFresh = signal(false);

  /** The active polar's beat and run targets for the present TWS; null without a usable polar or fresh TWS. */
  private polarTargets = computed<PolarResult<PolarTargets> | null>(() => {
    const polar = this.activePolar.polar();
    if (!polar || this.activePolar.status().kind !== 'ready' || !this.polarTwsFresh()) return null;
    return polar.targetsAt({ tws: this.polarTws(), performanceFactor: this.activePolar.performanceFactor() });
  });
  private polarLineAngles = computed(() => {
    const cfg = this.runtime.options();
    return resolvePolarLineAngles({
      fixedCloseHauledAngle: cfg?.closeHauledLineAngle ?? DEFAULT_CLOSE_HAULED_LINE_ANGLE_RAD,
      angleFromPolar: !!cfg?.closeHauledAngleFromPolar,
      runLines: !!cfg?.runLineEnable,
      targets: this.polarTargets()
    });
  });
  /** The close-hauled angle the lines and the wind shift traces use, rad. */
  protected closeHauledAngle = computed(() => this.polarLineAngles().closeHauled);
  /** The run angle off the true wind, rad; null hides the run lines. */
  protected runLineAngle = computed(() => this.polarLineAngles().run);

  protected overlayMode = computed<PolarOverlayMode>(() => {
    const cfg = this.runtime.options();
    const bearing = this.waypointAngle();
    return resolvePolarOverlayMode({
      enabled: !!cfg?.polarOverlayEnable,
      polarReady: this.activePolar.status().kind === 'ready',
      twsFresh: this.polarTwsFresh(),
      twaFresh: this.overlayTwaFresh(),
      compassMode: !!cfg?.compassModeEnabled,
      headingFresh: this.headingFresh(),
      waypointActive: !!cfg?.waypointEnable && bearing != null && Number.isFinite(bearing) && this.waypointFresh()
    });
  });
  private overlayScale = computed<OverlayScale | null>(() => {
    const peakSpeed = this.activePolar.peakSpeed();
    return peakSpeed ? { peakSpeed, peakRadius: POLAR_OVERLAY_PEAK_RADIUS, dialRadius: POLAR_OVERLAY_DIAL_RADIUS } : null;
  });
  /** Wind-frame polar curve; its shape depends only on TWS, the performance factor and the polar. */
  protected polarCurvePoints = computed<OverlayPoint[] | null>(() => {
    if (this.overlayMode() !== 'polar') return null;
    const polar = this.activePolar.polar();
    const scale = this.overlayScale();
    if (!polar || !scale) return null;
    return polarCurve(polar, this.polarTws(), this.activePolar.performanceFactor(), scale);
  });
  /** Polar speeds per TWA for the present TWS, reused by every VMC recompute until TWS changes. */
  private vmcSpeedProfile = computed(() => {
    if (this.overlayMode() !== 'vmc') return null;
    const polar = this.activePolar.polar();
    return polar ? polarSpeedProfile(polar, this.polarTws(), this.activePolar.performanceFactor()) : null;
  });
  /** Water TWD = HDG + water TWA, rad; changes under 1° do not propagate. */
  private overlayTwd = computed(
    () => normalizeRadians(this.currentHeading() + this.overlayTwa()),
    { equal: (a, b) => radianDelta(a, b) < ANGLE_DEDUP_RAD }
  );
  /** Compass-frame VMC curve toward the waypoint. */
  protected vmcCurvePoints = computed<OverlayPoint[] | null>(() => {
    const profile = this.vmcSpeedProfile();
    const scale = this.overlayScale();
    const bearing = this.waypointAngle();
    if (!profile || !scale || bearing == null) return null;
    return vmcCurve(profile, this.overlayTwd(), bearing, scale);
  });
  /**
   * The best VMC heading on each tack, null for a tack with no positive VMC; null outside VMC mode.
   * Each tack's previous marker is passed on, so it holds its peak until another clearly beats it.
   */
  protected vmcOptima = linkedSignal<
    { profile: PolarSpeedProfile; scale: OverlayScale; twd: number; btw: number } | null,
    { port: VmcOptimum | null; starboard: VmcOptimum | null } | null
  >({
    source: () => {
      const profile = this.vmcSpeedProfile();
      const scale = this.overlayScale();
      const btw = this.waypointAngle();
      return profile && scale && btw != null ? { profile, scale, twd: this.overlayTwd(), btw } : null;
    },
    computation: (inputs, previous) => {
      if (!inputs) return null;
      const optimum = (tack: 'port' | 'starboard'): VmcOptimum | null =>
        vmcOptimum(inputs.profile, inputs.twd, inputs.btw, inputs.scale, tack, previous?.value?.[tack]?.twa ?? null);
      return { port: optimum('port'), starboard: optimum('starboard') };
    }
  });
  /** Radius of the dot on the bow axis; null hides it. */
  protected overlayDotRadius = computed<number | null>(() => {
    const mode = this.overlayMode();
    const scale = this.overlayScale();
    if (mode === 'hidden' || !scale || !this.overlayStwFresh()) return null;
    const stw = this.overlayStw();
    if (mode === 'polar') return speedToRadius(stw, scale);
    const bearing = this.waypointAngle();
    return bearing == null ? null : vmcDotRadius(stw, this.currentHeading(), bearing, scale);
  });

  /** The wind shift traces: true wind directions of the last windSectorWindowSeconds, each swept from the one before. */
  protected windTrace = signal<readonly WindTraceSample[]>([]);
  protected windTraceSeconds = computed(() => this.runtime.options()?.windSectorWindowSeconds ?? DEFAULT_WIND_SECTOR_WINDOW_SECONDS);
  private windSamples: { t: number; sample: WindTraceSample }[] = [];
  private windSampleId = 0;

  private windTraceCleanupSub: Subscription | null = null;

  // On each valid sample a path's active flag is set true and its hide-timer re-armed; when the
  // timer fires (no valid sample within the TTL) the flag goes false and the indicator hides.
  // Independent of the streams-directive enableTimeout, so it works whether that is on or off.
  private readonly freshnessTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private dataTtlMs(): number {
    const cfg = this.runtime.options();
    const configured = cfg?.dataTimeout;
    const base = (typeof configured === 'number' && configured > 0 ? configured : DEFAULT_DATA_TIMEOUT_SECONDS) * 1000;
    // Never shorter than twice the sample cadence, so a healthy but slow-updating stream cannot
    // lapse between samples and flicker the indicator.
    const cadence = typeof cfg?.updateInterval === 'number' && cfg.updateInterval > 0 ? cfg.updateInterval : 0;
    return Math.max(base, cadence * 2);
  }
  private markFresh(key: string, active: WritableSignal<boolean>): void {
    active.set(true);
    const existing = this.freshnessTimers.get(key);
    if (existing) clearTimeout(existing);
    this.freshnessTimers.set(key, setTimeout(() => active.set(false), this.dataTtlMs()));
  }

  constructor() {
    // Stable stream callbacks registered via effect; directive handles diffing
    effect(() => {
      const cfg = this.runtime.options();
      if (!cfg) return;
      untracked(() => {
        if (usesPolar(cfg)) this.activePolar.ensureStarted();
        this.registerStreams();
        this.stopWindTrace();
        this.startWindTrace();
        // A live compass-mode or TWA-path change does not re-fire the wind stream, so recompute
        // the displayed base from the cached sample here; otherwise the dial keeps a stale heading
        // offset until the next sample arrives (#73). currentHeading is read untracked to avoid
        // re-running this effect on every heading tick.
        this.applyTrueWindBase();
        // A live invertRudder toggle must re-sign the cached sample without a new stream tick.
        this.applyRudder();
      });
    });
  }

  // Stable callbacks -------------------------------------------------
  private onHeadingUpdate = (u: IPathUpdate) => {
    const raw = u.data.value;
    if (raw == null || !Number.isFinite(raw)) return;   // freeze on absent/invalid
    const next = normalizeRadians(raw);
    this.markFresh('heading', this.headingFresh);
    if (!this.hasHeading || radianDelta(this.currentHeading(), next) >= ANGLE_DEDUP_RAD) {
      this.currentHeading.set(next); this.hasHeading = true;
    }
  };
  private onCOGUpdate = (u: IPathUpdate) => {
    const raw = u.data.value;
    if (raw == null || !Number.isFinite(raw)) return;
    const next = normalizeRadians(raw);
    this.markFresh('cog', this.courseFresh);
    if (!this.hasCOG || radianDelta(this.courseOverGroundAngle(), next) >= ANGLE_DEDUP_RAD) {
      this.courseOverGroundAngle.set(next); this.hasCOG = true;
    }
  };
  private onDriftUpdate = (u: IPathUpdate) => {
    const raw = u.data.value;
    if (raw == null || !Number.isFinite(raw)) return;
    this.markFresh('drift', this.driftFresh);
    this.driftMeasure.set(u.data.measure ?? '');
    const limit = this.setArrowActive() ? SET_ARROW_HIDE_MS : SET_ARROW_SHOW_MS;
    this.setArrowActive.set(raw >= limit);
    if (!this.hasDrift || Math.abs(this.driftFlow() - raw) >= SPEED_DEDUP_MS) {
      this.driftFlow.set(raw); this.hasDrift = true;
    }
  };
  private onSOGUpdate = (u: IPathUpdate) => {
    // Absence is distinct from zero: a boat may publish COG without SOG, and its COG arrow must
    // still show underway. Propagate undefined for no data so only a real near-zero SOG hides it.
    if (u.data.value == null) {
      this.sog.set(undefined); this.hasSOG = true;
      return;
    }
    const next = u.data.value;
    const cur = this.sog();
    if (!this.hasSOG || cur == null || Math.abs(cur - next) >= SPEED_DEDUP_MS) {
      this.sog.set(next); this.hasSOG = true;
    }
  };
  private onSetUpdate = (u: IPathUpdate) => {
    const raw = u.data.value;
    if (raw == null || !Number.isFinite(raw)) return;
    const next = normalizeRadians(raw);
    this.markFresh('set', this.setFresh);
    if (!this.hasSet || radianDelta(this.driftSet(), next) >= ANGLE_DEDUP_RAD) {
      this.driftSet.set(next); this.hasSet = true;
    }
  };
  private onWaypointUpdate = (u: IPathUpdate) => {
    const raw = u.data.value;
    if (raw == null) {
      this.waypointAngle.set(undefined); this.hasWPT = true;
      return;
    }
    const next = normalizeRadians(raw);
    if (Number.isFinite(next)) this.markFresh('wpt', this.waypointFresh);
    const cur = this.waypointAngle();
    if (!this.hasWPT || cur == null || radianDelta(cur, next) >= ANGLE_DEDUP_RAD) {
      this.waypointAngle.set(next); this.hasWPT = true;
    }
  };
  private onPolarTws = (u: IPathUpdate) => {
    const raw = u.data.value;
    if (raw == null || !Number.isFinite(raw)) return;
    this.markFresh('polarTrueWindSpeed', this.polarTwsFresh);
    if (!this.hasPolarTws || Math.abs(this.polarTws() - raw) >= SPEED_DEDUP_MS) {
      this.polarTws.set(raw); this.hasPolarTws = true;
    }
  };
  private onOverlayTwa = (u: IPathUpdate) => {
    const raw = u.data.value;
    if (raw == null || !Number.isFinite(raw)) return;
    this.markFresh('polarTrueWindAngle', this.overlayTwaFresh);
    if (!this.hasOverlayTwa || radianDelta(this.overlayTwa(), raw) >= ANGLE_DEDUP_RAD) {
      this.overlayTwa.set(raw); this.hasOverlayTwa = true;
    }
  };
  private onOverlayStw = (u: IPathUpdate) => {
    const raw = u.data.value;
    if (raw == null || !Number.isFinite(raw)) return;
    this.markFresh('polarSpeedThroughWater', this.overlayStwFresh);
    if (!this.hasOverlayStw || Math.abs(this.overlayStw() - raw) >= SPEED_DEDUP_MS) {
      this.overlayStw.set(raw); this.hasOverlayStw = true;
    }
  };
  /** Each polar slot's handler, freshness signal and sample reset; the slot key is also its freshness-timer key. */
  private readonly polarInputs: Record<(typeof POLAR_PATH_KEYS)[number], { onUpdate: (u: IPathUpdate) => void; fresh: WritableSignal<boolean>; reset: () => void }> = {
    polarTrueWindSpeed: { onUpdate: this.onPolarTws, fresh: this.polarTwsFresh, reset: () => { this.hasPolarTws = false; } },
    polarTrueWindAngle: { onUpdate: this.onOverlayTwa, fresh: this.overlayTwaFresh, reset: () => { this.hasOverlayTwa = false; } },
    polarSpeedThroughWater: { onUpdate: this.onOverlayStw, fresh: this.overlayStwFresh, reset: () => { this.hasOverlayStw = false; } }
  };
  private onRudderUpdate = (u: IPathUpdate) => {
    // A non-finite or absent value hides the bar; a real 0 keeps it present but draws nothing.
    // Cache the raw value so a live invertRudder toggle can re-sign it without a new sample.
    this.lastRawRudder = Number.isFinite(u.data.value) ? u.data.value : null;
    this.applyRudder();
  };
  private onAppWindAngle = (u: IPathUpdate) => {
    const raw = u.data.value;
    if (raw == null || !Number.isFinite(raw)) return;
    const next = normalizeRadians(raw);
    this.markFresh('awa', this.appWindFresh);
    if (!this.hasAWA || radianDelta(this.appWindAngle(), next) >= ANGLE_DEDUP_RAD) {
      this.appWindAngle.set(next); this.hasAWA = true;
    }
  };
  private onAppWindSpeed = (u: IPathUpdate) => {
    const raw = u.data.value;
    if (raw == null || !Number.isFinite(raw)) return;
    this.markFresh('aws', this.appWindSpeedFresh);
    this.appWindSpeedMeasure.set(u.data.measure ?? '');
    if (!this.hasAWS || Math.abs(this.appWindSpeed() - raw) >= SPEED_DEDUP_MS) {
      this.appWindSpeed.set(raw); this.hasAWS = true;
    }
  };
  private onTrueWindSpeed = (u: IPathUpdate) => {
    const raw = u.data.value;
    if (raw == null || !Number.isFinite(raw)) return;
    this.markFresh('tws', this.trueWindSpeedFresh);
    this.trueWindSpeedMeasure.set(u.data.measure ?? '');
    if (!this.hasTWS || Math.abs(this.trueWindSpeed() - raw) >= SPEED_DEDUP_MS) {
      this.trueWindSpeed.set(raw); this.hasTWS = true;
    }
  };
  private onTrueWindAngle = (u: IPathUpdate) => {
    const raw = u.data.value;
    if (raw == null || !Number.isFinite(raw)) return;   // freeze; the TTL timer hides after lapse
    this.lastRawTrueWindAngle = raw;
    this.markFresh('twa', this.trueWindFresh);
    const next = normalizeRadians(this.computeTrueWindBase(raw));
    if (!this.hasTWA || radianDelta(this.trueWindAngle(), next) >= ANGLE_DEDUP_RAD) {
      this.trueWindAngle.set(next); this.hasTWA = true;
    }
    // A boat-relative angle only becomes a direction once the heading is known.
    if (this.runtime.options()?.windSectorEnable && this.hasHeading) {
      this.addHistoricalWindDirection(normalizeRadians(this.computeTrueWindDirection(raw)));
    }
  };

  private trueWindPath(): string {
    return this.runtime.options()?.paths?.['trueWindAngle']?.path || '';
  }

  private computeTrueWindBase(rawAngle: number): number {
    const compassMode = !!this.runtime.options()?.compassModeEnabled;
    return computeTrueWindBaseAngle(this.trueWindPath(), rawAngle, this.currentHeading(), compassMode);
  }

  // The wind shift traces record the true wind DIRECTION (compass frame), so heading and
  // boat-speed changes don't paint traces; only real wind shifts do.
  private computeTrueWindDirection(rawAngle: number): number {
    return computeTrueWindBaseAngle(this.trueWindPath(), rawAngle, this.currentHeading(), true);
  }

  private applyTrueWindBase() {
    if (this.lastRawTrueWindAngle == null) return;
    this.trueWindAngle.set(normalizeRadians(this.computeTrueWindBase(this.lastRawTrueWindAngle)));
  }

  // Resolve the signed rudder angle from the last raw sample. steering.rudderAngle is +ve to
  // starboard, and a rudder to starboard turns the boat to starboard, so the raw sign already
  // matches the side the boat turns (green to the right); invertRudder corrects a reversed sensor.
  private applyRudder() {
    const raw = this.lastRawRudder;
    if (raw == null) {
      if (this.rudderAngle() !== null) this.rudderAngle.set(null);
      return;
    }
    const signed = (this.runtime.options()?.invertRudder ?? false) ? -raw : raw;
    const cur = this.rudderAngle();
    if (cur == null || Math.abs(cur - signed) >= ANGLE_DEDUP_RAD) {
      this.rudderAngle.set(signed);
    }
  }

  private registerStreams() {
    const cfg = this.runtime.options();
    if (!cfg) return;
    this.stream.observe('headingPath', this.onHeadingUpdate);
    this.stream.observe('courseOverGround', this.onCOGUpdate);
    this.stream.observe('speedOverGround', this.onSOGUpdate);
    this.stream.observe('drift', this.onDriftUpdate);
    this.stream.observe('set', this.onSetUpdate);
    this.stream.observe('nextWaypointBearing', this.onWaypointUpdate);
    this.stream.observe('appWindAngle', this.onAppWindAngle);
    this.stream.observe('appWindSpeed', this.onAppWindSpeed);
    this.stream.observe('trueWindSpeed', this.onTrueWindSpeed);
    this.stream.observe('trueWindAngle', this.onTrueWindAngle);
    this.stream.observe('rudderAngle', this.onRudderUpdate);
    const overlay = !!cfg.polarOverlayEnable;
    const tws = usesPolar(cfg);
    this.registerPolarSlot('polarTrueWindSpeed', tws);
    this.registerPolarSlot('polarTrueWindAngle', overlay);
    this.registerPolarSlot('polarSpeedThroughWater', overlay);
  }

  // Each polar SI slot is subscribed only while a feature that reads it is on.
  private registerPolarSlot(key: (typeof POLAR_PATH_KEYS)[number], enabled: boolean) {
    if (enabled) {
      this.stream.observe(key, this.polarInputs[key].onUpdate);
      this.registeredPolarSlots.add(key);
      return;
    }
    if (!this.registeredPolarSlots.delete(key)) return;
    // A later re-enable must wait for a fresh sample rather than draw from the old one.
    this.polarInputs[key].reset();
    this.stream.unobserve(key);
    clearTimeout(this.freshnessTimers.get(key));
    this.freshnessTimers.delete(key);
    this.polarInputs[key].fresh.set(false);
  }

  ngOnDestroy() {
    this.stopWindTrace();
    this.freshnessTimers.forEach(clearTimeout);
    this.freshnessTimers.clear();
  }

  private startWindTrace() {
    this.windSamples = [];
    this.windTrace.set([]);
    if (!this.runtime.options()?.windSectorEnable) return;
    this.windTraceCleanupSub = interval(1000).subscribe(() => this.historicalCleanup());
  }

  private addHistoricalWindDirection(direction: number) {
    // A sample sweeps from the one before it, as the close-hauled line moved between them, unless
    // that one is already past the window.
    this.historicalCleanup();
    const from = this.windSamples.at(-1)?.sample.to ?? direction;
    this.windSamples.push({ t: Date.now(), sample: { id: ++this.windSampleId, from, to: direction } });
    this.windTrace.set(this.windSamples.map(entry => entry.sample));
  }

  private historicalCleanup() {
    // The samples form a FIFO: oldest first, dropped from the front once past the window.
    const cutoff = Date.now() - this.windTraceSeconds() * 1000;
    const before = this.windSamples.length;
    while (this.windSamples.length && this.windSamples[0].t < cutoff) this.windSamples.shift();
    if (this.windSamples.length !== before) this.windTrace.set(this.windSamples.map(entry => entry.sample));
  }

  private stopWindTrace() {
    this.windTraceCleanupSub?.unsubscribe();
  }

  // The speed readouts derive their unit symbol from the measure the streams directive tagged the
  // value with (server-resolved for these display paths), never the stored convertUnitTo. An empty
  // or still-unitless measure (meta not yet resolved) renders no symbol rather than a wrong one, so
  // the label always matches the value.
  private speedUnitSymbol(measure: string): string {
    return measure && measure !== 'unitless' ? this.unitsService.getUnitDisplaySymbol(measure) : '';
  }

}

export interface PolarOverlayModeInputs {
  enabled: boolean;
  polarReady: boolean;
  twsFresh: boolean;
  twaFresh: boolean;
  compassMode: boolean;
  headingFresh: boolean;
  /** waypointEnable on, bearing finite and fresh. */
  waypointActive: boolean;
}

/** The polar overlay's mode; the first matching rule wins. */
export function resolvePolarOverlayMode(inputs: PolarOverlayModeInputs): PolarOverlayMode {
  if (!inputs.enabled || !inputs.polarReady) return 'hidden';
  if (!inputs.twsFresh || !inputs.twaFresh) return 'hidden';
  if (inputs.compassMode && inputs.headingFresh && inputs.waypointActive) return 'vmc';
  return 'polar';
}

/**
 * Whether any option that reads the active polar is on: the overlay, the run lines, or the polar
 * close-hauled angle while something draws at it (the close-hauled lines or the wind shift traces).
 */
function usesPolar(cfg: IWidgetSvcConfig): boolean {
  const closeHauledShown = !!cfg.closeHauledLineEnable || !!cfg.windSectorEnable;
  return !!cfg.polarOverlayEnable || !!cfg.runLineEnable || (closeHauledShown && !!cfg.closeHauledAngleFromPolar);
}

export interface PolarLineAnglesInputs {
  /** The configured close-hauled angle, rad. */
  fixedCloseHauledAngle: number;
  angleFromPolar: boolean;
  runLines: boolean;
  /** The polar targets for the present TWS; null without a usable polar or fresh TWS. */
  targets: PolarResult<PolarTargets> | null;
}

/**
 * The close-hauled and run angles off the true wind, rad. Outside the table's TWS range the polar
 * gives its nearest column's angles, so gusts across the edge do not flip the lines. Without polar
 * angles the close-hauled lines keep the fixed angle and the run lines, which have no fixed angle, hide.
 */
export function resolvePolarLineAngles(inputs: PolarLineAnglesInputs): { closeHauled: number; run: number | null } {
  const value = inputs.targets?.state.available === true ? inputs.targets.value : null;
  const beat = value?.beat?.twa ?? null;
  const run = value?.run?.twa ?? null;
  return {
    closeHauled: inputs.angleFromPolar && beat !== null ? beat : inputs.fixedCloseHauledAngle,
    run: inputs.runLines ? run : null
  };
}

/** Unsigned smallest difference between two angles in rad. */
function radianDelta(a: number, b: number): number {
  return Math.abs(normalizeRadians(b - a + Math.PI) - Math.PI);
}

/**
 * Resolves the base angle to display for the configured true-wind path; angles in rad.
 *
 * `angleTrueWater` / `angleTrueGround` are boat-relative (true wind ANGLE). In enhanced/compass
 * mode the dial rotates with heading, so for those paths the heading is added to convert the angle
 * into a compass-frame true wind DIRECTION before rendering. In simple (bow-fixed) mode the dial
 * does not rotate, so the angle must stay boat-relative - matching apparent wind - otherwise it is
 * displaced by the heading (#1066, #1063). Direction-style paths are always passed through unchanged.
 */
export function computeTrueWindBaseAngle(path: string, value: number, heading: number, compassModeEnabled: boolean): number {
  const isBoatRelativeTrueWind = path.includes('angleTrueWater') || path.includes('angleTrueGround');
  return isBoatRelativeTrueWind && compassModeEnabled ? normalizeRadians(heading + value) : value;
}
