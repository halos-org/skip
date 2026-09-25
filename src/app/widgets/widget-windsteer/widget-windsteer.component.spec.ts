import { WritableSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetWindComponent, computeTrueWindBaseAngle, resolvePolarOverlayMode, PolarOverlayModeInputs, resolvePolarLineAngles } from './widget-windsteer.component';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective } from '../../core/directives/widget-streams.directive';
import { UnitsService } from '../../core/services/units.service';
import { IPathUpdate } from '../../core/services/data.service';
import { IWidgetPath, IWidgetSvcConfig } from '../../core/interfaces/widgets-interface';
import { ActivePolarService, ActivePolarStatus } from '../../core/services/active-polar.service';
import { Polar, PolarResult, PolarTargets, toCanonicalPolarTable } from '../../core/utils/polar-engine.util';
import { OverlayPoint, OverlayScale, POLAR_PATH_KEYS, VMC_HEADING_STEP, polarCurve, speedToRadius } from '../../core/utils/polar-overlay.util';
import { PolarOverlayMode, WindTraceSample } from '../svg-windsteer/svg-windsteer.component';
import { SI_VERSION_KEY, V20_MIGRATION_OUTPUT_VERSION } from '../../core/utils/config-migration.util';
import hurmaPolar from '../../core/utils/polar-engine.hurma-polar.fixture.json';

const DEG = Math.PI / 180;

const unitsServiceStub = {
  getUnitDisplaySymbol: (measure: string | null | undefined) => measure ?? '',
  // Model only what the gate needs: SI m/s in, display unit out (knots ~1.94384x; m/s identity).
  convertToUnit: (unit: string, value: number) => unit === 'knots' ? value * 1.94384 : value
};

/**
 * Regression tests for #1066 / #1063.
 *
 * In "simple" mode (enhanced/advanced compass mode OFF) the wind rose is bow-fixed, so the
 * True Wind ANGLE (boat-relative angleTrueWater / angleTrueGround) must be shown as-is, exactly
 * like Apparent Wind Angle. The previous code always added the boat heading to true wind,
 * turning it into a compass-frame direction, which displaced TWA by the heading (~90° in the
 * reports) only in simple mode. Enhanced mode rotates the dial by heading, so the offset is
 * correct there and must be preserved.
 */
describe('computeTrueWindBaseAngle (#1066, #1063)', () => {
  const TRUE_WATER = 'self.environment.wind.angleTrueWater';
  const TRUE_GROUND = 'self.environment.wind.angleTrueGround';
  const DIRECTION_TRUE = 'self.environment.wind.directionTrue';

  it('keeps boat-relative true wind angle unchanged in simple mode (compass mode off)', () => {
    // heading 90°, boat-relative TWA 45° -> must stay 45° in simple mode (NOT 135°)
    expect(computeTrueWindBaseAngle(TRUE_WATER, 45 * DEG, 90 * DEG, false)).toBe(45 * DEG);
    expect(computeTrueWindBaseAngle(TRUE_GROUND, 45 * DEG, 90 * DEG, false)).toBe(45 * DEG);
  });

  it('converts true wind angle to the compass frame (adds heading) in enhanced/compass mode', () => {
    expect(computeTrueWindBaseAngle(TRUE_WATER, 45 * DEG, 90 * DEG, true)).toBeCloseTo(135 * DEG, 12);
  });

  it('wraps the compass-frame result into [0, 2π) in enhanced/compass mode', () => {
    expect(computeTrueWindBaseAngle(TRUE_WATER, 300 * DEG, 90 * DEG, true)).toBeCloseTo(30 * DEG, 12); // 390 -> 30
  });

  it('passes through non boat-relative true wind paths (e.g. directionTrue) in both modes', () => {
    expect(computeTrueWindBaseAngle(DIRECTION_TRUE, 200 * DEG, 90 * DEG, false)).toBe(200 * DEG);
    expect(computeTrueWindBaseAngle(DIRECTION_TRUE, 200 * DEG, 90 * DEG, true)).toBe(200 * DEG);
  });
});

/**
 * Regression test for #73.
 *
 * Toggling compass mode live must recompute the displayed TWA base immediately from the last
 * received sample. The wind stream does not re-emit on an options change, so before the fix the
 * dial kept the previous base and showed a one-frame heading-offset transient until the next
 * sample arrived.
 */
describe('WidgetWindComponent live compass-mode toggle (#73)', () => {
  let component: WidgetWindComponent;
  let options: WritableSignal<IWidgetSvcConfig | undefined>;
  let callbacks: Map<string, (u: IPathUpdate) => void>;

  const makeConfig = (compassModeEnabled: boolean): IWidgetSvcConfig => ({
    ...WidgetWindComponent.DEFAULT_CONFIG,
    compassModeEnabled,
    windSectorEnable: false
  });

  const update = (value: number): IPathUpdate => ({ data: { value, timestamp: null }, state: 'normal' });

  const twa = (): number => (component as unknown as { trueWindAngle: () => number }).trueWindAngle();

  beforeEach(() => {
    options = signal<IWidgetSvcConfig | undefined>(makeConfig(false));
    callbacks = new Map<string, (u: IPathUpdate) => void>();

    const streamsMock = {
      observe: (pathName: string, next: (u: IPathUpdate) => void) => { callbacks.set(pathName, next); }
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: WidgetRuntimeDirective, useValue: { options } },
        { provide: WidgetStreamsDirective, useValue: streamsMock },
        { provide: UnitsService, useValue: unitsServiceStub }
      ]
    });

    component = TestBed.runInInjectionContext(() => new WidgetWindComponent());
    TestBed.tick(); // flush the options effect so streams register and callbacks are captured
  });

  it('recomputes the TWA base on a live compass-mode toggle without a new wind sample', () => {
    callbacks.get('headingPath')!(update(90 * DEG));
    callbacks.get('trueWindAngle')!(update(45 * DEG));
    expect(twa()).toBeCloseTo(45 * DEG, 12); // simple mode: boat-relative angle shown as-is

    options.set(makeConfig(true));
    TestBed.tick();

    expect(twa()).toBeCloseTo(135 * DEG, 12); // compass mode: heading (90) added to the cached angle (45)
  });
});

/**
 * The wind shift traces and the close-hauled line gating are driven by TRUE wind, not apparent
 * wind. The traces must be fed only from the true-wind stream, and trueWindFresh must track
 * whether the configured true-wind path is currently delivering a value.
 */
describe('WidgetWindComponent wind shift traces', () => {
  let component: WidgetWindComponent;
  let options: WritableSignal<IWidgetSvcConfig | undefined>;
  let callbacks: Map<string, (u: IPathUpdate) => void>;

  const makeConfig = (): IWidgetSvcConfig => ({
    ...WidgetWindComponent.DEFAULT_CONFIG,
    compassModeEnabled: true,
    windSectorEnable: true
  });
  const update = (value: number | null): IPathUpdate => ({ data: { value, timestamp: null }, state: 'normal' });
  const trace = (): readonly WindTraceSample[] => (component as unknown as { windTrace: () => readonly WindTraceSample[] }).windTrace();
  const sampleCount = (): number => trace().length;
  const active = (): boolean => (component as unknown as { trueWindFresh: () => boolean }).trueWindFresh();

  beforeEach(() => {
    options = signal<IWidgetSvcConfig | undefined>(makeConfig());
    callbacks = new Map<string, (u: IPathUpdate) => void>();
    const streamsMock = {
      observe: (pathName: string, next: (u: IPathUpdate) => void) => { callbacks.set(pathName, next); }
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: WidgetRuntimeDirective, useValue: { options } },
        { provide: WidgetStreamsDirective, useValue: streamsMock },
        { provide: UnitsService, useValue: unitsServiceStub }
      ]
    });
    component = TestBed.runInInjectionContext(() => new WidgetWindComponent());
    TestBed.tick();
  });

  it('feeds the wind shift traces from true wind and not from apparent wind', () => {
    callbacks.get('headingPath')!(update(0));
    callbacks.get('appWindAngle')!(update(30));
    expect(sampleCount()).toBe(0); // apparent wind does not feed the traces

    callbacks.get('trueWindAngle')!(update(40));
    expect(sampleCount()).toBe(1); // true wind does
  });

  describe('sample FIFO', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => { component.ngOnDestroy(); vi.useRealTimers(); });
    const start = (config: Partial<IWidgetSvcConfig> = {}): void => {
      options.set({ ...makeConfig(), ...config });
      component = TestBed.runInInjectionContext(() => new WidgetWindComponent());
      TestBed.tick();
      callbacks.get('headingPath')!(update(0));
    };
    const sweeps = (): number[][] => trace().map(({ from, to }) => [from, to].map(angle => Number(angle.toFixed(6))));

    it('sweeps each sample from the one before, and drops samples older than the window', () => {
      start();
      callbacks.get('trueWindAngle')!(update(0.1));
      vi.advanceTimersByTime(3000);
      callbacks.get('trueWindAngle')!(update(0.2));
      expect(sweeps()).toEqual([[0.1, 0.1], [0.1, 0.2]]);

      vi.advanceTimersByTime(3000); // the first sample is now 6 s old, past the 5 s window
      expect(sweeps()).toEqual([[0.1, 0.2]]);
      vi.advanceTimersByTime(3000);
      expect(trace()).toEqual([]);
    });

    it('follows a configured window length', () => {
      start({ windSectorWindowSeconds: 2 });
      callbacks.get('trueWindAngle')!(update(0.1));
      vi.advanceTimersByTime(3000);
      expect(trace()).toEqual([]);
    });

    it('starts a sample after a gap longer than the window from its own direction', () => {
      start();
      callbacks.get('trueWindAngle')!(update(0.1));
      vi.advanceTimersByTime(5500); // past the window, before the next cleanup tick drops it
      callbacks.get('trueWindAngle')!(update(0.3));
      expect(sweeps()).toEqual([[0.3, 0.3]]);
    });

    it('records nothing until the heading is known, so a boat-relative angle is not taken for a direction', () => {
      options.set(makeConfig());
      component = TestBed.runInInjectionContext(() => new WidgetWindComponent());
      TestBed.tick();
      callbacks.get('trueWindAngle')!(update(0.1));
      expect(trace()).toEqual([]);
      callbacks.get('headingPath')!(update(1.0));
      callbacks.get('trueWindAngle')!(update(0.1));
      expect(sweeps()).toEqual([[1.1, 1.1]]);
    });

    it('clears the traces and stops sampling with the option off, and starts afresh when it is back on', () => {
      start();
      callbacks.get('trueWindAngle')!(update(0.1));
      options.set({ ...makeConfig(), windSectorEnable: false });
      TestBed.tick();
      expect(trace()).toEqual([]);
      callbacks.get('trueWindAngle')!(update(0.2));
      expect(trace()).toEqual([]);

      options.set(makeConfig());
      TestBed.tick();
      callbacks.get('trueWindAngle')!(update(0.3));
      expect(sweeps()).toEqual([[0.3, 0.3]]);
    });
  });

  it('freezes true wind on a null sample and clears trueWindFresh only after the data TTL', () => {
    const twa = (): number => (component as unknown as { trueWindAngle: () => number }).trueWindAngle();
    vi.useFakeTimers();
    try {
      expect(active()).toBe(false); // nothing received yet
      callbacks.get('trueWindAngle')!(update(40));
      expect(active()).toBe(true);
      const frozen = twa();
      callbacks.get('trueWindAngle')!(update(null));
      expect(active()).toBe(true);   // brief null -> freeze, still shown
      expect(twa()).toBe(frozen);    // value held, not reset to 0
      vi.advanceTimersByTime(5000);  // TTL (dataTimeout 5s) lapses with no valid sample
      expect(active()).toBe(false);  // now hides
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * #475: absent/invalid samples must never render as 0. Each angle/speed handler freezes (holds
 * its last value) on a null/non-finite sample, and a per-path freshness flag hides the indicator
 * only after the data TTL (5s) lapses with no valid sample.
 */
describe('WidgetWindComponent freeze-then-hide on data loss (#475)', () => {
  let component: WidgetWindComponent;
  let options: WritableSignal<IWidgetSvcConfig | undefined>;
  let callbacks: Map<string, (u: IPathUpdate) => void>;
  const update = (value: number | null): IPathUpdate => ({ data: { value, timestamp: null }, state: 'normal' });
  const sig = (name: string): unknown => (component as unknown as Record<string, () => unknown>)[name]();

  beforeEach(() => {
    options = signal<IWidgetSvcConfig | undefined>({ ...WidgetWindComponent.DEFAULT_CONFIG });
    callbacks = new Map<string, (u: IPathUpdate) => void>();
    const streamsMock = {
      observe: (pathName: string, next: (u: IPathUpdate) => void) => { callbacks.set(pathName, next); }
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: WidgetRuntimeDirective, useValue: { options } },
        { provide: WidgetStreamsDirective, useValue: streamsMock },
        { provide: UnitsService, useValue: unitsServiceStub }
      ]
    });
    component = TestBed.runInInjectionContext(() => new WidgetWindComponent());
    TestBed.tick();
  });

  it('freezes every angle/speed path on a null sample instead of resetting it to 0', () => {
    vi.useFakeTimers();
    try {
      callbacks.get('headingPath')!(update(123 * DEG));
      callbacks.get('appWindAngle')!(update(45 * DEG));
      callbacks.get('courseOverGround')!(update(20 * DEG));
      callbacks.get('trueWindSpeed')!(update(12));
      callbacks.get('appWindSpeed')!(update(9));
      callbacks.get('set')!(update(80 * DEG));
      callbacks.get('drift')!(update(0.4));
      callbacks.get('headingPath')!(update(null));
      callbacks.get('appWindAngle')!(update(null));
      callbacks.get('courseOverGround')!(update(null));
      callbacks.get('trueWindSpeed')!(update(null));
      callbacks.get('appWindSpeed')!(update(null));
      callbacks.get('set')!(update(null));
      callbacks.get('drift')!(update(null));
      expect(sig('currentHeading')).toBeCloseTo(123 * DEG, 12);        // all frozen, none reset to 0
      expect(sig('appWindAngle')).toBeCloseTo(45 * DEG, 12);
      expect(sig('courseOverGroundAngle')).toBeCloseTo(20 * DEG, 12);
      expect(sig('trueWindSpeed')).toBe(12);
      expect(sig('appWindSpeed')).toBe(9);
      expect(sig('driftSet')).toBeCloseTo(80 * DEG, 12);
      expect(sig('driftFlow')).toBe(0.4);
    } finally { vi.useRealTimers(); }
  });

  it('marks each path fresh on valid data and hides it after the TTL', () => {
    vi.useFakeTimers();
    try {
      callbacks.get('headingPath')!(update(10));
      callbacks.get('appWindAngle')!(update(30));
      callbacks.get('courseOverGround')!(update(20));
      callbacks.get('trueWindSpeed')!(update(12));
      callbacks.get('appWindSpeed')!(update(9));
      for (const s of ['headingFresh', 'appWindFresh', 'courseFresh', 'trueWindSpeedFresh', 'appWindSpeedFresh']) {
        expect(sig(s)).toBe(true);
      }
      vi.advanceTimersByTime(5000);
      for (const s of ['headingFresh', 'appWindFresh', 'courseFresh', 'trueWindSpeedFresh', 'appWindSpeedFresh']) {
        expect(sig(s)).toBe(false);
      }
    } finally { vi.useRealTimers(); }
  });

  it('tracks drift (speed) and set (direction) freshness independently', () => {
    vi.useFakeTimers();
    try {
      callbacks.get('set')!(update(80));      // only direction flows
      expect(sig('setFresh')).toBe(true);
      expect(sig('driftFresh')).toBe(false);  // speed never arrived -> not fresh
      callbacks.get('drift')!(update(0.4));
      expect(sig('driftFresh')).toBe(true);
      vi.advanceTimersByTime(5000);           // both lapse
      expect(sig('setFresh')).toBe(false);
      expect(sig('driftFresh')).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it('re-shows a path when data resumes after it went stale', () => {
    vi.useFakeTimers();
    try {
      callbacks.get('appWindAngle')!(update(30 * DEG));
      vi.advanceTimersByTime(5000);
      expect(sig('appWindFresh')).toBe(false);   // hidden
      callbacks.get('appWindAngle')!(update(35 * DEG)); // data resumes
      expect(sig('appWindFresh')).toBe(true);     // shown again
      expect(sig('appWindAngle')).toBeCloseTo(35 * DEG, 12);
    } finally { vi.useRealTimers(); }
  });

  it('re-arms freshness on each valid sample so it stays shown while data flows', () => {
    vi.useFakeTimers();
    try {
      callbacks.get('appWindAngle')!(update(30));
      vi.advanceTimersByTime(4000);
      callbacks.get('appWindAngle')!(update(35)); // fresh sample re-arms the timer
      vi.advanceTimersByTime(4000);               // 4s since the last valid sample
      expect(sig('appWindFresh')).toBe(true);
      vi.advanceTimersByTime(1500);               // now >5s since the last valid sample
      expect(sig('appWindFresh')).toBe(false);
    } finally { vi.useRealTimers(); }
  });
});

/**
 * The apparent/true wind speed readouts are DISPLAY paths: the streams directive tags each
 * numeric update with the server-resolved measure the value was converted to. The unit symbol
 * must derive from that tagged measure, not from the stored convertUnitTo ('knots'), so the
 * label always matches the value's actual unit and neutrals out until data arrives.
 */
describe('WidgetWindComponent speed unit symbol source', () => {
  let component: WidgetWindComponent;
  let options: WritableSignal<IWidgetSvcConfig | undefined>;
  let callbacks: Map<string, (u: IPathUpdate) => void>;

  const makeConfig = (): IWidgetSvcConfig => ({ ...WidgetWindComponent.DEFAULT_CONFIG });
  const speedUpdate = (value: number, measure?: string): IPathUpdate =>
    ({ data: { value, timestamp: null, measure }, state: 'normal' });
  const awsUnit = (): string => (component as unknown as { appWindSpeedUnit: () => string }).appWindSpeedUnit();
  const twsUnit = (): string => (component as unknown as { trueWindSpeedUnit: () => string }).trueWindSpeedUnit();

  beforeEach(() => {
    options = signal<IWidgetSvcConfig | undefined>(makeConfig());
    callbacks = new Map<string, (u: IPathUpdate) => void>();
    const streamsMock = {
      observe: (pathName: string, next: (u: IPathUpdate) => void) => { callbacks.set(pathName, next); }
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: WidgetRuntimeDirective, useValue: { options } },
        { provide: WidgetStreamsDirective, useValue: streamsMock },
        { provide: UnitsService, useValue: unitsServiceStub }
      ]
    });
    component = TestBed.runInInjectionContext(() => new WidgetWindComponent());
    TestBed.tick();
  });

  it('renders a neutral label before any update (boot placeholder)', () => {
    expect(awsUnit()).toBe('');
    expect(twsUnit()).toBe('');
  });

  it('derives each speed unit symbol from the update measure, not the stored convertUnitTo', () => {
    // both paths store convertUnitTo: 'knots' but the server-resolved measure differs
    callbacks.get('appWindSpeed')!(speedUpdate(10, 'm/s'));
    callbacks.get('trueWindSpeed')!(speedUpdate(8, 'kph'));
    expect(awsUnit()).toBe('m/s');
    expect(twsUnit()).toBe('kph');
  });

  it('keeps a neutral label when an update carries no measure', () => {
    callbacks.get('appWindSpeed')!(speedUpdate(10));
    expect(awsUnit()).toBe('');
  });

  it('keeps a neutral label while the measure is still unitless (meta unresolved)', () => {
    callbacks.get('appWindSpeed')!(speedUpdate(10, 'unitless'));
    expect(awsUnit()).toBe('');
  });
});

/**
 * #441: the bearing circle must hide when no waypoint is active. The presence signal lives in the
 * child, keyed off whether waypointAngle is null. This parent must therefore propagate the SK
 * `null` (no destination) as absence, not coerce it to a finite 0 that reads as "bearing due north".
 */
describe('WidgetWindComponent waypoint presence (#441)', () => {
  let component: WidgetWindComponent;
  let options: WritableSignal<IWidgetSvcConfig | undefined>;
  let callbacks: Map<string, (u: IPathUpdate) => void>;

  const update = (value: number | null): IPathUpdate => ({ data: { value, timestamp: null }, state: 'normal' });
  const wpt = (): number | undefined =>
    (component as unknown as { waypointAngle: () => number | undefined }).waypointAngle();

  beforeEach(() => {
    options = signal<IWidgetSvcConfig | undefined>({ ...WidgetWindComponent.DEFAULT_CONFIG });
    callbacks = new Map<string, (u: IPathUpdate) => void>();
    const streamsMock = {
      observe: (pathName: string, next: (u: IPathUpdate) => void) => { callbacks.set(pathName, next); }
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: WidgetRuntimeDirective, useValue: { options } },
        { provide: WidgetStreamsDirective, useValue: streamsMock },
        { provide: UnitsService, useValue: unitsServiceStub }
      ]
    });
    component = TestBed.runInInjectionContext(() => new WidgetWindComponent());
    TestBed.tick();
  });

  it('propagates a real waypoint bearing', () => {
    callbacks.get('nextWaypointBearing')!(update(120 * DEG));
    expect(wpt()).toBeCloseTo(120 * DEG, 12);
  });

  it('treats a zero bearing as a real value (waypoint due north)', () => {
    callbacks.get('nextWaypointBearing')!(update(0));
    expect(wpt()).toBe(0);
  });

  it('clears the bearing to undefined when the destination goes away (null)', () => {
    callbacks.get('nextWaypointBearing')!(update(120 * DEG));
    expect(wpt()).toBeCloseTo(120 * DEG, 12);
    callbacks.get('nextWaypointBearing')!(update(null));
    expect(wpt()).toBeUndefined();
  });
});

/**
 * #435: rudder angle drives a bar on the windsteer dial. steering.rudderAngle is +ve to starboard,
 * and a rudder to starboard turns the boat to starboard, so the raw sign already matches the
 * boat-turn side; invertRudder flips it for a reversed sensor. Absence (null) hides the bar
 * entirely rather than drawing a centred zero.
 */
describe('WidgetWindComponent rudder angle (#435)', () => {
  let component: WidgetWindComponent;
  let options: WritableSignal<IWidgetSvcConfig | undefined>;
  let callbacks: Map<string, (u: IPathUpdate) => void>;

  const update = (value: number | null): IPathUpdate => ({ data: { value, timestamp: null }, state: 'normal' });
  const rudder = (): number | null =>
    (component as unknown as { rudderAngle: () => number | null }).rudderAngle();

  const build = (cfg: Partial<IWidgetSvcConfig> = {}) => {
    options = signal<IWidgetSvcConfig | undefined>({ ...WidgetWindComponent.DEFAULT_CONFIG, ...cfg });
    callbacks = new Map<string, (u: IPathUpdate) => void>();
    const streamsMock = {
      observe: (pathName: string, next: (u: IPathUpdate) => void) => { callbacks.set(pathName, next); }
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: WidgetRuntimeDirective, useValue: { options } },
        { provide: WidgetStreamsDirective, useValue: streamsMock },
        { provide: UnitsService, useValue: unitsServiceStub }
      ]
    });
    component = TestBed.runInInjectionContext(() => new WidgetWindComponent());
    TestBed.tick();
  };

  it('registers the rudder stream on a configurable, degree-converted path', () => {
    build();
    expect(callbacks.has('rudderAngle')).toBe(true);
    const path = WidgetWindComponent.DEFAULT_CONFIG.paths?.['rudderAngle'];
    expect(path?.isPathConfigurable).toBe(true);
    expect(path?.convertUnitTo).toBe('deg');
    expect(path?.path).toBe('self.steering.rudderAngle');
  });

  it('passes the raw value through by default (starboard rudder = boat turns starboard)', () => {
    build();
    callbacks.get('rudderAngle')!(update(10));
    expect(rudder()).toBe(10);
  });

  it('flips the sign when invertRudder is enabled (reversed sensor)', () => {
    build({ invertRudder: true });
    callbacks.get('rudderAngle')!(update(10));
    expect(rudder()).toBe(-10);
  });

  it('hides the bar (null) when the rudder value goes away', () => {
    build();
    callbacks.get('rudderAngle')!(update(10));
    expect(rudder()).toBe(10);
    callbacks.get('rudderAngle')!(update(null));
    expect(rudder()).toBeNull();
  });

  it('re-signs the cached sample on a live invertRudder toggle (no new sample)', () => {
    build();
    callbacks.get('rudderAngle')!(update(10));
    expect(rudder()).toBe(10);
    options.set({ ...WidgetWindComponent.DEFAULT_CONFIG, invertRudder: true });
    TestBed.tick();
    expect(rudder()).toBe(-10);
  });

  it('keeps a centred (0) rudder present rather than coercing it to null', () => {
    build();
    callbacks.get('rudderAngle')!(update(0));
    expect(rudder()).toBe(0);
  });

  it('hides the bar on a non-finite value so a NaN sample cannot stick', () => {
    build();
    callbacks.get('rudderAngle')!(update(NaN));
    expect(rudder()).toBeNull();
    callbacks.get('rudderAngle')!(update(12));
    expect(rudder()).toBe(12);
  });
});

/**
 * #442: the COG arrow hides at rest. That needs a speed-over-ground value the widget doesn't
 * otherwise use — plumbed as a hidden, source-linked path and tracked in `sog`.
 */
describe('WidgetWindComponent speed-over-ground gating (#442)', () => {
  let component: WidgetWindComponent;
  let options: WritableSignal<IWidgetSvcConfig | undefined>;
  let callbacks: Map<string, (u: IPathUpdate) => void>;

  const update = (value: number | null, measure?: string): IPathUpdate => ({ data: { value, timestamp: null, measure }, state: 'normal' });
  const sog = (): number | undefined => (component as unknown as { sog: () => number | undefined }).sog();
  const sogActive = (): boolean => (component as unknown as { sogActive: () => boolean }).sogActive();

  beforeEach(() => {
    options = signal<IWidgetSvcConfig | undefined>({ ...WidgetWindComponent.DEFAULT_CONFIG });
    callbacks = new Map<string, (u: IPathUpdate) => void>();
    const streamsMock = {
      observe: (pathName: string, next: (u: IPathUpdate) => void) => { callbacks.set(pathName, next); }
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: WidgetRuntimeDirective, useValue: { options } },
        { provide: WidgetStreamsDirective, useValue: streamsMock },
        { provide: UnitsService, useValue: unitsServiceStub }
      ]
    });
    component = TestBed.runInInjectionContext(() => new WidgetWindComponent());
    TestBed.tick();
  });

  it('registers the SOG stream and configures it as a hidden, source-default path', () => {
    expect(callbacks.has('speedOverGround')).toBe(true);
    const sogPath = WidgetWindComponent.DEFAULT_CONFIG.paths?.['speedOverGround'];
    expect(sogPath?.hideFromConfig).toBe(true);
    expect(sogPath?.isPathConfigurable).toBe(false);
    expect(sogPath?.source).toBe('default');
  });

  it('tracks speed-over-ground from the stream', () => {
    callbacks.get('speedOverGround')!(update(3.2));
    expect(sog()).toBeCloseTo(3.2);
  });

  it('reports SOG as absent (undefined), not zero, on a null update so the COG arrow keeps showing', () => {
    callbacks.get('speedOverGround')!(update(3.2));
    expect(sog()).toBeCloseTo(3.2);
    callbacks.get('speedOverGround')!(update(null));
    expect(sog()).toBeUndefined();
  });

  it('gates the COG arrow on a 0.05 m/s SOG threshold, treating absence as moving', () => {
    expect(sogActive()).toBe(true);                          // nothing received yet -> show
    callbacks.get('speedOverGround')!(update(0.02, 'm/s'));  // present, below 0.05 m/s -> hide
    expect(sogActive()).toBe(false);
    callbacks.get('speedOverGround')!(update(0.3, 'm/s'));   // above -> show
    expect(sogActive()).toBe(true);
    callbacks.get('speedOverGround')!(update(null));         // GPS dropout -> absent -> show
    expect(sogActive()).toBe(true);
  });
});

/**
 * #441/#637: the drift readout shows at any magnitude; only the set arrow is gated on speed, with
 * hysteresis so an estimate hovering near the limit cannot blink it. The limits and the value are
 * both in m/s, so the cutoff is the same real current whether the readout is in knots, m/s, or km/h.
 */
describe('WidgetWindComponent drift/current gating (#441, #637)', () => {
  let component: WidgetWindComponent;
  let options: WritableSignal<IWidgetSvcConfig | undefined>;
  let callbacks: Map<string, (u: IPathUpdate) => void>;

  const update = (value: number | null, measure?: string): IPathUpdate => ({ data: { value, timestamp: null, measure }, state: 'normal' });
  const setArrowActive = (): boolean => (component as unknown as { setArrowActive: () => boolean }).setArrowActive();
  const driftUnit = (): string => (component as unknown as { driftUnit: () => string }).driftUnit();
  // Show at 0.1 m/s, hide below 0.05 m/s: the band between keeps the arrow's last state.
  const HYSTERESIS_STEPS_MS: [number, boolean][] = [[0.12, true], [0.07, true], [0.04, false], [0.07, false], [0.11, true]];

  beforeEach(() => {
    options = signal<IWidgetSvcConfig | undefined>({ ...WidgetWindComponent.DEFAULT_CONFIG });
    callbacks = new Map<string, (u: IPathUpdate) => void>();
    const streamsMock = {
      observe: (pathName: string, next: (u: IPathUpdate) => void) => { callbacks.set(pathName, next); }
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: WidgetRuntimeDirective, useValue: { options } },
        { provide: WidgetStreamsDirective, useValue: streamsMock },
        { provide: UnitsService, useValue: unitsServiceStub }
      ]
    });
    component = TestBed.runInInjectionContext(() => new WidgetWindComponent());
    TestBed.tick();
  });

  it('starts with the set arrow hidden', () => {
    expect(setArrowActive()).toBe(false);
  });

  it('applies set-arrow hysteresis to drift presented in knots', () => {
    for (const [ms, shown] of HYSTERESIS_STEPS_MS) {
      callbacks.get('drift')!(update(ms, 'knots'));
      expect(setArrowActive(), `${ms} m/s`).toBe(shown);
    }
  });

  it('applies set-arrow hysteresis to drift presented in m/s', () => {
    for (const [ms, shown] of HYSTERESIS_STEPS_MS) {
      callbacks.get('drift')!(update(ms, 'm/s'));
      expect(setArrowActive(), `${ms} m/s`).toBe(shown);
    }
  });

  it('keeps the drift value at any magnitude, including zero', () => {
    const driftFlow = (): number => (component as unknown as { driftFlow: () => number }).driftFlow();
    callbacks.get('drift')!(update(0, 'm/s'));
    expect(driftFlow()).toBe(0);
    expect(setArrowActive()).toBe(false);
  });

  it('exposes the drift display unit for the readout label', () => {
    callbacks.get('drift')!(update(0.4, 'knots'));
    expect(driftUnit()).toBe('knots');
  });
});

describe('WidgetWindComponent default config', () => {
  it('stores the close-hauled angle in rad, 45° by default, and carries the SI marker of the v20 step', () => {
    expect(WidgetWindComponent.DEFAULT_CONFIG.closeHauledLineAngle).toBe(Math.PI / 4);
    expect(WidgetWindComponent.DEFAULT_CONFIG.closeHauledLineEnable).toBe(true);
    expect(WidgetWindComponent.DEFAULT_CONFIG.closeHauledAngleFromPolar).toBe(true);
    expect(WidgetWindComponent.DEFAULT_CONFIG.runLineEnable).toBe(false);
    expect(WidgetWindComponent.DEFAULT_CONFIG[SI_VERSION_KEY as 'siVersion']).toBe(V20_MIGRATION_OUTPUT_VERSION);
    expect(WidgetWindComponent.OPTION_UNITS).toEqual({ closeHauledLineAngle: 'rad' });
  });
});

describe('resolvePolarOverlayMode', () => {
  const all: PolarOverlayModeInputs = {
    enabled: true, polarReady: true, twsFresh: true, twaFresh: true,
    compassMode: true, headingFresh: true, waypointActive: true
  };

  it.each([
    ['option off', { enabled: false }, 'hidden'],
    ['no usable polar', { polarReady: false }, 'hidden'],
    ['stale TWS', { twsFresh: false }, 'hidden'],
    ['stale water TWA', { twaFresh: false }, 'hidden'],
    ['everything for VMC', {}, 'vmc'],
    ['compass mode off', { compassMode: false }, 'polar'],
    ['stale heading', { headingFresh: false }, 'polar'],
    ['no active waypoint', { waypointActive: false }, 'polar']
  ] as [string, Partial<PolarOverlayModeInputs>, PolarOverlayMode][])('%s gives %s', (_label, change, mode) => {
    expect(resolvePolarOverlayMode({ ...all, ...change })).toBe(mode);
  });
});

describe('resolvePolarLineAngles', () => {
  const FIXED = 45 * DEG;
  const targets = (tws: 'in_range' | 'below_range' | 'above_range', beat: number | null, run: number | null): PolarResult<PolarTargets> => ({
    value: {
      beat: beat === null ? null : { twa: beat, speed: 3, vmg: 2 },
      run: run === null ? null : { twa: run, speed: 3, vmg: 2 },
      maxSpeed: { twa: 2, speed: 4 }
    },
    state: { available: true, tws, twa: null }
  });

  it('takes the polar beat and run angles', () => {
    expect(resolvePolarLineAngles({ fixedCloseHauledAngle: FIXED, angleFromPolar: true, runLines: true, targets: targets('in_range', 0.7, 2.6) }))
      .toEqual({ closeHauled: 0.7, run: 2.6 });
  });

  it('keeps the fixed angle with the switch off, and still draws the run lines', () => {
    expect(resolvePolarLineAngles({ fixedCloseHauledAngle: FIXED, angleFromPolar: false, runLines: true, targets: targets('in_range', 0.7, 2.6) }))
      .toEqual({ closeHauled: FIXED, run: 2.6 });
  });

  it.each([
    ['above', targets('above_range', 0.7, 2.6)],
    ['below', targets('below_range', 0.7, 2.6)]
  ])('takes the nearest column\'s angles for a TWS %s the table, so gusts across its edge do not flip the lines', (_label, result) => {
    expect(resolvePolarLineAngles({ fixedCloseHauledAngle: FIXED, angleFromPolar: true, runLines: true, targets: result }))
      .toEqual({ closeHauled: 0.7, run: 2.6 });
  });

  it.each([
    ['no polar targets (no polar, stale TWS)', null],
    ['a table with no beat or run side at this TWS', targets('in_range', null, null)]
  ])('falls back to the fixed angle and hides the run lines with %s', (_label, result) => {
    expect(resolvePolarLineAngles({ fixedCloseHauledAngle: FIXED, angleFromPolar: true, runLines: true, targets: result }))
      .toEqual({ closeHauled: FIXED, run: null });
  });

  it('hides the run lines with their option off', () => {
    expect(resolvePolarLineAngles({ fixedCloseHauledAngle: FIXED, angleFromPolar: true, runLines: false, targets: targets('in_range', 0.7, 2.6) }).run)
      .toBeNull();
  });
});

/** Wind Steer polar overlay (#478): option, SI inputs, mode decision and geometry handed to the SVG. */
describe('WidgetWindComponent polar overlay', () => {
  const TTL_MS = 5000;
  const TWS_MS = 5;
  const WATER_TWA_DEG = 45;

  function polarFrom(source: unknown): Polar {
    const result = toCanonicalPolarTable(source);
    if (!result.ok) throw new Error(result.reason);
    return new Polar(result.table);
  }
  const hurma = polarFrom(hurmaPolar);
  /** Same shape as the fixture, every speed halved: a smaller boat on the same axes. */
  const halfHurma = polarFrom({
    ...hurmaPolar,
    values: { boatSpeedMatrix: hurmaPolar.values.boatSpeedMatrix.map(row => row.map(speed => speed / 2)) }
  });
  const scaleOf = (polar: Polar): OverlayScale => ({ peakSpeed: polar.peakSpeed() ?? 0, peakRadius: 300, dialRadius: 350 });

  class FakeActivePolarService {
    public readonly status = signal<ActivePolarStatus>({ kind: 'ready' });
    public readonly polar = signal<Polar | null>(hurma);
    public readonly peakSpeed = signal<number | null>(hurma.peakSpeed());
    public readonly performanceFactor = signal(1);
    public starts = 0;
    public ensureStarted(): void { this.starts += 1; }
    public use(polar: Polar): void {
      this.polar.set(polar);
      this.peakSpeed.set(polar.peakSpeed());
    }
  }

  interface OverlayView {
    closeHauledAngle: () => number;
    runLineAngle: () => number | null;
    overlayMode: () => PolarOverlayMode;
    polarCurvePoints: () => OverlayPoint[] | null;
    vmcCurvePoints: () => OverlayPoint[] | null;
    overlayTwa: () => number;
    overlayDotRadius: () => number | null;
  }

  let component: WidgetWindComponent;
  let view: OverlayView;
  let options: WritableSignal<IWidgetSvcConfig | undefined>;
  let callbacks: Map<string, (u: IPathUpdate) => void>;
  let unobserved: string[];
  let polarService: FakeActivePolarService;

  const makeConfig = (overrides: Partial<IWidgetSvcConfig> = {}): IWidgetSvcConfig => ({
    ...WidgetWindComponent.DEFAULT_CONFIG,
    compassModeEnabled: true,
    windSectorEnable: false,
    polarOverlayEnable: true,
    ...overrides
  });
  const update = (value: number | null, measure?: string): IPathUpdate =>
    ({ data: { value, timestamp: null, measure }, state: 'normal' } as IPathUpdate);
  const feed = (pathKey: string, value: number | null, measure?: string): void => {
    const callback = callbacks.get(pathKey);
    if (!callback) throw new Error(`${pathKey} is not observed`);
    callback(update(value, measure));
  };
  /** Fresh overlay wind: TWS in m/s and water TWA in rad on the SI slots. */
  const feedWind = (twsMs = TWS_MS, waterTwaDeg = WATER_TWA_DEG): void => {
    feed('polarTrueWindSpeed', twsMs);
    feed('polarTrueWindAngle', waterTwaDeg * DEG);
  };
  /** Compass mode with fresh heading and a fresh waypoint bearing. */
  const feedWaypoint = (headingDeg: number, bearingDeg: number): void => {
    feed('headingPath', headingDeg * DEG);
    feed('nextWaypointBearing', bearingDeg * DEG);
  };
  const create = (config: IWidgetSvcConfig): void => {
    options.set(config);
    component = TestBed.runInInjectionContext(() => new WidgetWindComponent());
    view = component as unknown as OverlayView;
    TestBed.tick();
  };
  const reconfigure = (config: IWidgetSvcConfig): void => {
    options.set(config);
    TestBed.tick();
  };
  const longestSpoke = (points: readonly OverlayPoint[]): OverlayPoint =>
    points.reduce((best, point) => point.r > best.r ? point : best);
  const angleDiff = (a: number, b: number): number => {
    const wrapped = ((a - b) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    return wrapped > Math.PI ? wrapped - 2 * Math.PI : wrapped;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    options = signal<IWidgetSvcConfig | undefined>(undefined);
    callbacks = new Map<string, (u: IPathUpdate) => void>();
    unobserved = [];
    polarService = new FakeActivePolarService();
    const streamsMock = {
      observe: (pathName: string, next: (u: IPathUpdate) => void) => { callbacks.set(pathName, next); },
      unobserve: (pathName: string) => { unobserved.push(pathName); callbacks.delete(pathName); }
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: WidgetRuntimeDirective, useValue: { options } },
        { provide: WidgetStreamsDirective, useValue: streamsMock },
        { provide: UnitsService, useValue: unitsServiceStub },
        { provide: ActivePolarService, useValue: polarService }
      ]
    });
  });

  afterEach(() => {
    component?.ngOnDestroy();
    vi.useRealTimers();
  });

  describe('option and paths', () => {
    it('keeps the overlay off in a stored config that has it off, through the defaults merge', () => {
      const runtime = TestBed.runInInjectionContext(() => new WidgetRuntimeDirective());
      runtime.initialize(WidgetWindComponent.DEFAULT_CONFIG, { polarOverlayEnable: false } as IWidgetSvcConfig);
      expect(runtime.options()?.polarOverlayEnable).toBe(false);
    });

    it('defaults the option on and declares the three SI slots hidden, structural and optional', () => {
      const paths = WidgetWindComponent.DEFAULT_CONFIG.paths as Record<string, IWidgetPath>;
      expect(WidgetWindComponent.DEFAULT_CONFIG.polarOverlayEnable).toBe(true);
      for (const [key, path, unit] of [
        ['polarTrueWindSpeed', 'self.environment.wind.speedTrue', 'm/s'],
        ['polarTrueWindAngle', 'self.environment.wind.angleTrueWater', 'rad'],
        ['polarSpeedThroughWater', 'self.navigation.speedThroughWater', 'm/s']
      ]) {
        expect(paths[key]).toMatchObject({
          path, convertUnitTo: unit, isPathConfigurable: false, hideFromConfig: true,
          showConvertUnitTo: false, pathRequired: false
        });
      }
      expect(paths['polarTrueWindSpeed'].sourceFromPath).toBe('trueWindSpeed');
      expect(paths['polarTrueWindAngle'].sourceFromPath).toBe('trueWindAngle');
      expect(paths['polarSpeedThroughWater'].sourceFromPath).toBeUndefined();
    });

    it('shares its SI slot keys with the options dialog: exactly the hidden polar slots of the default config', () => {
      const paths = WidgetWindComponent.DEFAULT_CONFIG.paths as Record<string, IWidgetPath>;
      const hiddenPolarSlots = Object.keys(paths).filter(key => key.startsWith('polar') && paths[key].hideFromConfig);
      expect([...POLAR_PATH_KEYS].sort()).toEqual(hiddenPolarSlots.sort());
    });

    it('with every polar feature off, observes none of the SI slots and never starts the polar service', () => {
      create(makeConfig({ polarOverlayEnable: false, closeHauledAngleFromPolar: false, runLineEnable: false }));
      expect([...callbacks.keys()].filter(key => key.startsWith('polar'))).toEqual([]);
      expect(polarService.starts).toBe(0);
      expect(view.overlayMode()).toBe('hidden');
    });

    it('with the option on, observes the SI slots and starts the polar service', () => {
      create(makeConfig());
      expect(callbacks.has('polarTrueWindSpeed')).toBe(true);
      expect(callbacks.has('polarTrueWindAngle')).toBe(true);
      expect(callbacks.has('polarSpeedThroughWater')).toBe(true);
      expect(polarService.starts).toBeGreaterThan(0);
    });

    it('releases the SI slots when the option is turned off and hides the overlay', () => {
      create(makeConfig({ closeHauledAngleFromPolar: false }));
      feedWind();
      expect(view.overlayMode()).toBe('polar');

      reconfigure(makeConfig({ polarOverlayEnable: false, closeHauledAngleFromPolar: false }));
      expect(unobserved.sort()).toEqual(['polarSpeedThroughWater', 'polarTrueWindAngle', 'polarTrueWindSpeed']);
      expect(view.overlayMode()).toBe('hidden');
    });

    it('waits for fresh SI samples after the option is turned back on', () => {
      create(makeConfig({ closeHauledAngleFromPolar: false }));
      feedWind();
      reconfigure(makeConfig({ polarOverlayEnable: false, closeHauledAngleFromPolar: false }));
      reconfigure(makeConfig({ closeHauledAngleFromPolar: false }));
      expect(view.overlayMode()).toBe('hidden');
      feedWind();
      expect(view.overlayMode()).toBe('polar');
    });
  });

  describe('close-hauled and run lines', () => {
    const beatAt = (tws: number): number => hurma.targetsAt({ tws }).value?.beat?.twa ?? NaN;
    const runAt = (tws: number): number => hurma.targetsAt({ tws }).value?.run?.twa ?? NaN;

    it('draws the lines at the polar beat angle for a fresh TWS, and moves them with TWS', () => {
      // Beats wider in light air: the fixture's beat angle sits on its 40° floor at every TWS.
      const widening = polarFrom({
        kind: 'polarTable',
        units: { tws: 'm/s', twa: 'rad', boatSpeed: 'm/s' },
        symmetry: { portStarboardSymmetric: true },
        axes: { tws: [3, 8], twa: [30, 40, 50, 60, 90, 120, 150, 180].map(deg => deg * DEG) },
        values: { boatSpeedMatrix: [[1.0, 2.0, 3.2, 3.5, 3.8, 3.6, 3.0, 2.6], [3.0, 5.0, 5.4, 5.6, 6.0, 6.2, 5.8, 5.2]] }
      });
      polarService.use(widening);
      const beat = (tws: number): number => widening.targetsAt({ tws }).value?.beat?.twa ?? NaN;
      create(makeConfig());
      feed('polarTrueWindSpeed', 3.5);
      expect(view.closeHauledAngle()).toBeCloseTo(beat(3.5), 9);
      feed('polarTrueWindSpeed', 7.5);
      expect(view.closeHauledAngle()).toBeCloseTo(beat(7.5), 9);
      expect(beat(7.5)).not.toBeCloseTo(beat(3.5), 2);
    });

    it('keeps the fixed angle with the switch off', () => {
      create(makeConfig({ closeHauledAngleFromPolar: false }));
      feed('polarTrueWindSpeed', 5);
      expect(view.closeHauledAngle()).toBe(Math.PI / 4);
    });

    it('holds the top column\'s angles above the table, and falls back to the fixed angle with stale TWS', () => {
      create(makeConfig({ runLineEnable: true }));
      feed('polarTrueWindSpeed', 12);
      expect(view.closeHauledAngle()).toBeCloseTo(beatAt(9.26), 9);
      expect(view.runLineAngle()).toBeCloseTo(runAt(9.26), 9);

      vi.advanceTimersByTime(TTL_MS + 1);
      expect(view.closeHauledAngle()).toBe(Math.PI / 4);
      expect(view.runLineAngle()).toBeNull();
    });

    it.each([
      ['no active polar', (): void => { polarService.status.set({ kind: 'loading' }); polarService.polar.set(null); }],
      ['a polar that failed to load', (): void => { polarService.status.set({ kind: 'fetch-failed', cause: 401 }); }]
    ])('falls back to the fixed angle and hides the run lines with %s', (_label, lose) => {
      create(makeConfig({ runLineEnable: true }));
      feed('polarTrueWindSpeed', 5);
      expect(view.closeHauledAngle()).toBeCloseTo(beatAt(5), 9);
      expect(view.runLineAngle()).toBeCloseTo(runAt(5), 9);

      lose();
      expect(view.closeHauledAngle()).toBe(Math.PI / 4);
      expect(view.runLineAngle()).toBeNull();
    });

    it('keeps TWS and the polar angle when the overlay is turned off, and releases only the overlay slots', () => {
      create(makeConfig());
      feedWind();
      expect(view.closeHauledAngle()).toBeCloseTo(beatAt(TWS_MS), 9);

      reconfigure(makeConfig({ polarOverlayEnable: false }));
      expect(unobserved.sort()).toEqual(['polarSpeedThroughWater', 'polarTrueWindAngle']);
      expect(view.overlayMode()).toBe('hidden');
      expect(view.closeHauledAngle()).toBeCloseTo(beatAt(TWS_MS), 9);

      reconfigure(makeConfig({ polarOverlayEnable: false, closeHauledAngleFromPolar: false }));
      expect(unobserved).toContain('polarTrueWindSpeed');
      expect(view.closeHauledAngle()).toBe(Math.PI / 4);

      reconfigure(makeConfig({ polarOverlayEnable: false }));
      expect(view.closeHauledAngle()).toBe(Math.PI / 4);
      feed('polarTrueWindSpeed', TWS_MS);
      expect(view.closeHauledAngle()).toBeCloseTo(beatAt(TWS_MS), 9);
    });

    it('keeps the wind shift traces on the polar angle with the close-hauled lines off', () => {
      create(makeConfig({ polarOverlayEnable: false, closeHauledLineEnable: false, windSectorEnable: true }));
      expect(polarService.starts).toBeGreaterThan(0);
      feed('polarTrueWindSpeed', 5);
      expect(view.closeHauledAngle()).toBeCloseTo(beatAt(5), 9);
    });

    it('draws the run lines at the polar run angle only with their option on', () => {
      create(makeConfig());
      feed('polarTrueWindSpeed', 5);
      expect(view.runLineAngle()).toBeNull();

      reconfigure(makeConfig({ runLineEnable: true }));
      expect(view.runLineAngle()).toBeCloseTo(runAt(5), 9);
    });

    it('with the overlay off, loads the polar and observes TWS for the polar lines alone', () => {
      create(makeConfig({ polarOverlayEnable: false }));
      expect(polarService.starts).toBeGreaterThan(0);
      expect([...callbacks.keys()].filter(key => key.startsWith('polar'))).toEqual(['polarTrueWindSpeed']);
      feed('polarTrueWindSpeed', 5);
      expect(view.closeHauledAngle()).toBeCloseTo(beatAt(5), 9);
      expect(view.overlayMode()).toBe('hidden');
    });

    it('with the run lines alone, loads the polar and observes TWS', () => {
      create(makeConfig({ polarOverlayEnable: false, closeHauledAngleFromPolar: false, runLineEnable: true }));
      expect(polarService.starts).toBeGreaterThan(0);
      expect([...callbacks.keys()].filter(key => key.startsWith('polar'))).toEqual(['polarTrueWindSpeed']);
    });

    it('with the close-hauled lines and the wind shift traces off, the angle switch alone does not load the polar', () => {
      create(makeConfig({ polarOverlayEnable: false, closeHauledLineEnable: false, windSectorEnable: false }));
      expect(polarService.starts).toBe(0);
      expect(callbacks.has('polarTrueWindSpeed')).toBe(false);
    });
  });

  describe('polar mode', () => {
    it('draws the polar curve for the SI TWS with a dot at STW when there is no waypoint', () => {
      create(makeConfig());
      feedWind();
      feed('polarSpeedThroughWater', 3);

      expect(view.overlayMode()).toBe('polar');
      expect(view.polarCurvePoints()).toEqual(polarCurve(hurma, TWS_MS, 1, scaleOf(hurma)));
      expect(view.vmcCurvePoints()).toBeNull();
      expect(view.overlayDotRadius()).toBeCloseTo(speedToRadius(3, scaleOf(hurma)), 9);
    });

    it('scales the polar curve by the performance factor', () => {
      polarService.performanceFactor.set(0.8);
      create(makeConfig());
      feedWind();
      expect(view.polarCurvePoints()).toEqual(polarCurve(hurma, TWS_MS, 0.8, scaleOf(hurma)));
    });

    it('takes the geometry TWS from the SI slot, not the displayed TWS', () => {
      create(makeConfig());
      feed('trueWindSpeed', TWS_MS, 'knots');
      feedWind();
      expect(view.polarCurvePoints()).toEqual(polarCurve(hurma, TWS_MS, 1, scaleOf(hurma)));

      feed('trueWindSpeed', 10, 'knots');
      expect(view.polarCurvePoints()).toEqual(polarCurve(hurma, TWS_MS, 1, scaleOf(hurma)));
    });

    it('rotates the curve by the water TWA even when the displayed TWA is the Ground path', () => {
      const paths = WidgetWindComponent.DEFAULT_CONFIG.paths as Record<string, IWidgetPath>;
      create(makeConfig({
        paths: { ...paths, trueWindAngle: { ...paths['trueWindAngle'], path: 'self.environment.wind.angleTrueGround' } }
      }));
      feed('headingPath', 0);
      feed('trueWindAngle', 60 * DEG);
      feedWind(TWS_MS, 45);

      expect(view.overlayTwa()).toBeCloseTo(45 * DEG, 9);
      expect(view.overlayMode()).toBe('polar');
    });

    it('stays hidden without a water TWA even when the displayed true wind is fresh', () => {
      create(makeConfig());
      feed('trueWindAngle', 45 * DEG);
      feed('trueWindSpeed', 10, 'knots');
      feed('polarTrueWindSpeed', TWS_MS);
      expect(view.overlayMode()).toBe('hidden');
    });

    it('does not redraw for water TWA changes under 1°', () => {
      create(makeConfig());
      feedWind(TWS_MS, 45);
      feed('polarTrueWindAngle', 45.6 * DEG);
      expect(view.overlayTwa()).toBeCloseTo(45 * DEG, 9);
      feed('polarTrueWindAngle', 46.2 * DEG);
      expect(view.overlayTwa()).toBeCloseTo(46.2 * DEG, 9);
    });

    it('hides only the dot when STW goes stale', () => {
      create(makeConfig());
      feedWind();
      feed('polarSpeedThroughWater', 3);
      vi.advanceTimersByTime(TTL_MS - 1000);
      feedWind();
      vi.advanceTimersByTime(2000);

      expect(view.overlayDotRadius()).toBeNull();
      expect(view.overlayMode()).toBe('polar');
      expect(view.polarCurvePoints()).not.toBeNull();
    });

    it('hides the overlay when TWS goes stale', () => {
      create(makeConfig());
      feedWind();
      vi.advanceTimersByTime(TTL_MS + 1);
      expect(view.overlayMode()).toBe('hidden');
    });

    it('hides the overlay while the service has no usable polar, such as after a 401', () => {
      create(makeConfig());
      feedWind();
      polarService.status.set({ kind: 'fetch-failed', cause: 401 });
      expect(view.overlayMode()).toBe('hidden');
      expect(view.polarCurvePoints()).toBeNull();
      expect(view.overlayDotRadius()).toBeNull();
    });

    it('redraws with the new scale when the active polar switches mid-session', () => {
      create(makeConfig());
      feedWind();
      feed('polarSpeedThroughWater', 2);
      const before = view.overlayDotRadius();

      polarService.use(halfHurma);
      expect(view.polarCurvePoints()).toEqual(polarCurve(halfHurma, TWS_MS, 1, scaleOf(halfHurma)));
      expect(view.overlayDotRadius()).toBeCloseTo(speedToRadius(2, scaleOf(halfHurma)), 9);
      expect(view.overlayDotRadius()).toBeCloseTo((before ?? 0) * 2, 6);
    });
  });

  describe('VMC mode', () => {
    it('switches to VMC with compass mode, fresh heading and an active waypoint', () => {
      create(makeConfig());
      feedWind();
      feedWaypoint(30, 10);

      expect(view.overlayMode()).toBe('vmc');
      expect(view.vmcCurvePoints()?.length).toBeGreaterThan(0);
      expect(view.polarCurvePoints()).toBeNull();
    });

    it('puts the longest spoke at the best heading for HDG 030°, BTW 010°, water TWA 45°', () => {
      create(makeConfig());
      feedWind(TWS_MS, 45);
      feedWaypoint(30, 10);

      const twd = 75 * DEG;
      const btw = 10 * DEG;
      let best = { heading: 0, vmc: -Infinity };
      for (let heading = 0; heading < 2 * Math.PI; heading += 0.01 * DEG) {
        const vmc = (hurma.speedAt({ tws: TWS_MS, twa: angleDiff(twd, heading) }).value ?? 0) * Math.cos(heading - btw);
        if (vmc > best.vmc) best = { heading, vmc };
      }
      const points = view.vmcCurvePoints();
      expect(points).not.toBeNull();
      expect(Math.abs(angleDiff(longestSpoke(points ?? []).angle, best.heading))).toBeLessThanOrEqual(VMC_HEADING_STEP + 1e-9);
    });

    it('scales every VMC spoke by the performance factor', () => {
      create(makeConfig());
      feedWind();
      feedWaypoint(30, 10);
      const full = view.vmcCurvePoints() ?? [];
      expect(full.some(point => point.r > 0)).toBe(true);

      polarService.performanceFactor.set(0.8);
      const scaled = view.vmcCurvePoints() ?? [];
      expect(scaled.length).toBe(full.length);
      scaled.forEach((point, index) => {
        expect(point.angle).toBe(full[index].angle);
        expect(point.r).toBeCloseTo(0.8 * full[index].r, 9);
      });
    });

    it('draws the VMC dot at STW · cos(HDG − BTW)', () => {
      create(makeConfig());
      feedWind();
      feedWaypoint(30, 10);
      feed('polarSpeedThroughWater', 3);
      expect(view.overlayDotRadius()).toBeCloseTo(speedToRadius(3 * Math.cos(20 * DEG), scaleOf(hurma)), 9);
    });

    it('hides the VMC dot on the losing tack, where VMC is zero or less', () => {
      create(makeConfig());
      feedWind();
      feedWaypoint(120, 10);
      feed('polarSpeedThroughWater', 3);
      expect(view.overlayMode()).toBe('vmc');
      expect(view.overlayDotRadius()).toBeNull();
    });

    it('falls back to polar mode when heading goes stale and returns when it is fresh again', () => {
      create(makeConfig());
      feedWind();
      feedWaypoint(30, 10);
      vi.advanceTimersByTime(TTL_MS - 1000);
      feedWind();
      feed('nextWaypointBearing', 10 * DEG);
      vi.advanceTimersByTime(2000);
      expect(view.overlayMode()).toBe('polar');

      feed('headingPath', 31 * DEG);
      expect(view.overlayMode()).toBe('vmc');
    });

    it('keeps polar mode with waypointEnable off', () => {
      create(makeConfig({ waypointEnable: false }));
      feedWind();
      feedWaypoint(30, 10);
      expect(view.overlayMode()).toBe('polar');
    });

    it('keeps polar mode with compass mode off', () => {
      create(makeConfig({ compassModeEnabled: false }));
      feedWind();
      feedWaypoint(30, 10);
      expect(view.overlayMode()).toBe('polar');
    });

    it('keeps polar mode with a stale bearing', () => {
      create(makeConfig());
      feedWind();
      feedWaypoint(30, 10);
      vi.advanceTimersByTime(TTL_MS - 1000);
      feedWind();
      feed('headingPath', 30 * DEG);
      vi.advanceTimersByTime(2000);
      expect(view.overlayMode()).toBe('polar');
    });

    it('does not recompute the VMC curve for TWD changes under 1°', () => {
      create(makeConfig());
      feedWind(TWS_MS, 45);
      feedWaypoint(30, 10);
      const first = view.vmcCurvePoints();
      feed('polarTrueWindAngle', 45.6 * DEG);
      expect(view.vmcCurvePoints()).toBe(first);
      feed('polarTrueWindAngle', 47 * DEG);
      expect(view.vmcCurvePoints()).not.toBe(first);
    });
  });
});
