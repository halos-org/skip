import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetSeaHorizonComponent } from './widget-sea-horizon.component';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective, widgetPathSignature } from '../../core/directives/widget-streams.directive';
import type { IPathUpdate } from '../../core/services/data.service';
import type { IWidgetSvcConfig } from '../../core/interfaces/widgets-interface';

/**
 * The widget draws itself entirely from computed geometry, so the assertions below read those
 * computeds rather than the rendered SVG: the decision is what is worth pinning, and a
 * transform string or a band arc is the decision in its final form.
 */
interface SeaHorizonInternals {
  frameVisible: () => boolean;
  dialTransform: () => string | null;
  overlayTransform: () => string | null;
  cautionAngle: () => number;
  alarmAngle: () => number;
  heelBands: () => { d: string; fill: string }[];
  limitIndexes: () => { x1: number; y1: number; x2: number; y2: number }[];
  heelText: () => string;
  trimText: () => string;
  noData: () => boolean;
  worldTransform: () => string;
  pointerTransform: () => string;
  frameLayers: () => { r: number; fill: string }[];
  frameWedges: () => { a0: number; d: string; c0: string; c1: string }[];
  backgroundGradient: () => { x1?: number; y1?: number; x2?: number; y2?: number; stops: { o: string; c: string }[] } | null;
  backgroundTexture: () => { size: number; shapes: { d: string; fill: string }[] } | null;
  backgroundWedges: () => { a0: number; d: string; c0: string; c1: string }[];
  turnedScribes: () => { cx: number; cy: number; r: number; stroke: string }[];
  faceVignette: () => boolean;
  texturePatternTransform: () => string;
  scribeStrokeWidth: () => string;
  faceFill: () => string;
  labelColor: () => string;
  symbolColor: () => string;
  haloColor: () => string;
  ready: () => boolean;
}

type StreamCallback = (packet: IPathUpdate) => void;

const ATTITUDE_PATHS = {
  gaugePitchPath: { path: 'self.navigation.attitude', pathType: 'number', convertUnitTo: 'deg', source: 'default' },
  gaugeRollPath: { path: 'self.navigation.attitude', pathType: 'number', convertUnitTo: 'deg', source: 'default' }
};

/** Radii the component lays out against: its dial design radius and the steelseries face shading. */
const DIAL_DESIGN_R = 112;
const FACE_SHADOW_R = 124.766;
/** Where the heel bands and the limit index sit on that dial, as the component rules them. */
const BAND_R_OUTER = DIAL_DESIGN_R - 8;
const LIMIT_R_OUTER = DIAL_DESIGN_R - 2;
const LIMIT_R_INNER = DIAL_DESIGN_R - 20;
const COLOR_CAUTION = '#E8912B';
const COLOR_ALARM = '#CE2A20';

/** The component's own polar frame: degrees from 12 o'clock, clockwise positive, about (150, 150). */
function polar(r: number, deg: number): [number, number] {
  const a = (deg - 90) * Math.PI / 180;
  return [150 + r * Math.cos(a), 150 + r * Math.sin(a)];
}

/** Where a band's arc begins, as its path data prints it. */
function arcStart(r: number, deg: number): string {
  const [x, y] = polar(r, deg);
  return `M${x.toFixed(2)},${y.toFixed(2)}`;
}

type GaugeOverrides = Partial<NonNullable<IWidgetSvcConfig['gauge']>>;

/**
 * A merged config as the runtime directive would hand it to the widget, with the gauge block
 * overridable per test. The specs provide it directly rather than leaning on DEFAULT_CONFIG, so a
 * test states the settings it depends on instead of inheriting them silently.
 */
function baseConfig(gauge: GaugeOverrides = {}): IWidgetSvcConfig {
  return {
    numDecimal: 1,
    updateInterval: 1000,
    paths: ATTITUDE_PATHS,
    gauge: { type: 'seaHorizon', ...gauge }
  } as unknown as IWidgetSvcConfig;
}

interface Harness {
  component: SeaHorizonInternals;
  fixture: ComponentFixture<WidgetSeaHorizonComponent>;
  options: WritableSignal<IWidgetSvcConfig | undefined>;
  /** Latest callback registered for a path key, so a test can push a reading through it. */
  emit: (pathKey: string, value: number | null) => void;
  observed: { pathName: string; subField?: string }[];
  /** The fake's live subscriptions, keyed by path. A new object means the pipeline was rebuilt. */
  subscriptions: () => Map<string, FakeSubscription>;
  /** How many times the fake has built a pipeline. Unchanged across a call it treats as a no-op. */
  rebuilds: () => number;
}

/** One live subscription in the fake, mirroring what the real directive keys a rebuild on. */
interface FakeSubscription { next: StreamCallback; subField?: string; signature: string; }

/**
 * Mount the widget against local fakes for the two host directives, and capture the stream
 * callbacks it registers so a test can push readings through them. Each call configures a testing
 * module, so a test comparing two mounts has to reset the module between them.
 */
function mount(config: IWidgetSvcConfig): Harness {
  const options = signal<IWidgetSvcConfig | undefined>(config);
  const callbacks = new Map<string, StreamCallback>();
  const observed: { pathName: string; subField?: string }[] = [];
  const subscriptions = new Map<string, FakeSubscription>();
  let rebuilds = 0;

  TestBed.configureTestingModule({
    imports: [WidgetSeaHorizonComponent],
    providers: [
      { provide: WidgetRuntimeDirective, useValue: { options } },
      {
        provide: WidgetStreamsDirective,
        useValue: {
          // Mirrors WidgetStreamsDirective.observe: an unchanged (signature, callback, sub-field)
          // triple is a no-op, anything else tears the pipeline down and rebuilds it. The real
          // widgetPathSignature is used so the fake cannot drift from the rule it models.
          observe: (pathName: string, next: StreamCallback, subField?: string) => {
            callbacks.set(pathName, next);
            observed.push({ pathName, subField });
            const signature = widgetPathSignature(options()?.paths?.[pathName]) ?? '';
            const live = subscriptions.get(pathName);
            if (live && live.signature === signature && live.next === next && live.subField === subField) return;
            subscriptions.set(pathName, { next, subField, signature });
            rebuilds++;
          }
        }
      }
    ]
  });

  const fixture = TestBed.createComponent(WidgetSeaHorizonComponent);
  fixture.componentRef.setInput('id', 'test-sea-horizon');
  fixture.componentRef.setInput('type', 'widget-sea-horizon');
  fixture.componentRef.setInput('theme', null);
  fixture.detectChanges();

  return {
    component: fixture.componentInstance as unknown as SeaHorizonInternals,
    fixture,
    options,
    observed,
    subscriptions: () => subscriptions,
    rebuilds: () => rebuilds,
    emit: (pathKey, value) => callbacks.get(pathKey)?.({ data: { value } } as unknown as IPathUpdate)
  };
}

describe('WidgetSeaHorizonComponent stream wiring', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('observes the whole navigation.attitude leaf and extracts pitch and roll', () => {
    const h = mount(baseConfig());
    expect(h.observed).toContainEqual({ pathName: 'gaugePitchPath', subField: 'pitch' });
    expect(h.observed).toContainEqual({ pathName: 'gaugeRollPath', subField: 'roll' });
  });

  it('renders heel and trim from the live readings', () => {
    const h = mount(baseConfig());
    h.emit('gaugeRollPath', 18.42);
    h.emit('gaugePitchPath', -2.6);
    expect(h.component.heelText()).toBe('18.4° STBD');
    expect(h.component.trimText()).toBe('TRIM −2.6°');
    expect(h.component.noData()).toBe(false);
  });

  it('signs the trim both ways, bow-up positive and bow-down negative', () => {
    const h = mount(baseConfig());
    h.emit('gaugePitchPath', 2.6);
    expect(h.component.trimText()).toBe('TRIM +2.6°');
    h.emit('gaugePitchPath', -2.6);
    expect(h.component.trimText()).toBe('TRIM −2.6°');
    // Level carries the plus: a trim readout with no sign at all would look like a lost one.
    h.emit('gaugePitchPath', 0);
    expect(h.component.trimText()).toBe('TRIM +0.0°');
  });

  it('names the low side rather than the sign, and calls a level boat level', () => {
    const h = mount(baseConfig());
    h.emit('gaugeRollPath', -21);
    expect(h.component.heelText()).toBe('21.0° PORT');
    h.emit('gaugeRollPath', 0.1);
    expect(h.component.heelText()).toBe('0.1° LEVEL');
  });

  it('reports no data until a reading arrives, and again when one times out', () => {
    const h = mount(baseConfig());
    expect(h.component.noData()).toBe(true);
    expect(h.component.heelText()).toBe('--');

    h.emit('gaugeRollPath', 12);
    expect(h.component.noData()).toBe(false);

    // A stale-data timeout pushes a null through the same callback.
    h.emit('gaugeRollPath', null);
    expect(h.component.noData()).toBe(true);
    expect(h.component.heelText()).toBe('--');
  });

  // Issue #585: WidgetStreamsDirective rebuilds the subscription on a re-point, but
  // suppressBootstrapNull filters the replayed leading null. Against a path that reports nothing
  // the callback never runs, so a widget that does not clear on a signature change leaves the
  // previous path's reading on the dial as a live reading of the new one.
  it('clears the reading when the configured path changes', () => {
    const h = mount(baseConfig());
    h.emit('gaugeRollPath', 25);
    h.emit('gaugePitchPath', 4);
    expect(h.component.noData()).toBe(false);

    h.options.set({
      ...baseConfig(),
      paths: {
        gaugePitchPath: { ...ATTITUDE_PATHS.gaugePitchPath, source: 'imu-2' },
        gaugeRollPath: { ...ATTITUDE_PATHS.gaugeRollPath, source: 'imu-2' }
      }
    } as unknown as IWidgetSvcConfig);
    h.fixture.detectChanges();

    expect(h.component.noData()).toBe(true);
    expect(h.component.heelText()).toBe('--');
  });

  it('leaves the reading alone when an unrelated setting changes', () => {
    const h = mount(baseConfig());
    h.emit('gaugeRollPath', 25);

    h.options.set(baseConfig({ faceColor: 'chrome' }));
    h.fixture.detectChanges();

    expect(h.component.heelText()).toBe('25.0° STBD');
  });

  // WidgetStreamsDirective rebuilds a pipeline unless it is handed the same signature, callback and
  // sub-field, so a fresh closure per effect run would tear down and re-subscribe both paths on
  // every unrelated edit — replaying the last value through the damper and restarting the stale
  // window. The fake models that rule, so this asserts the pipelines survive rather than merely
  // that the callback reference happens to match.
  it('keeps both stream pipelines alive across unrelated config changes', () => {
    const h = mount(baseConfig());
    expect(h.rebuilds()).toBe(2);
    const pitch = h.subscriptions().get('gaugePitchPath');
    const roll = h.subscriptions().get('gaugeRollPath');

    h.options.set(baseConfig({ faceColor: 'chrome', damping: 3, invertRoll: true }));
    h.fixture.detectChanges();

    expect(h.rebuilds()).toBe(2);
    expect(h.subscriptions().get('gaugePitchPath')).toBe(pitch);
    expect(h.subscriptions().get('gaugeRollPath')).toBe(roll);
  });

  // The negative case: without it the test above would pass even if the fake could never observe a
  // rebuild at all.
  it('rebuilds both stream pipelines when the configured path changes', () => {
    const h = mount(baseConfig());
    expect(h.rebuilds()).toBe(2);

    h.options.set({
      ...baseConfig(),
      paths: {
        gaugePitchPath: { ...ATTITUDE_PATHS.gaugePitchPath, source: 'imu-2' },
        gaugeRollPath: { ...ATTITUDE_PATHS.gaugeRollPath, source: 'imu-2' }
      }
    } as unknown as IWidgetSvcConfig);
    h.fixture.detectChanges();

    expect(h.rebuilds()).toBe(4);
  });
});

describe('WidgetSeaHorizonComponent motion transitions', () => {
  // Frames are queued by hand so a test can tell "reading landed" apart from "frame after it".
  let frames: FrameRequestCallback[];
  beforeEach(() => {
    TestBed.resetTestingModule();
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames[id - 1] = () => undefined; });
  });
  afterEach(() => vi.unstubAllGlobals());
  const flushFrames = () => { const due = frames.splice(0); due.forEach(cb => cb(0)); };

  // The step from a level dial to the first real reading must be a snap, not a sweep up from zero,
  // so transitions are armed only once that reading has been drawn without one.
  it('paints the first reading without a transition and animates the ones after it', () => {
    const h = mount(baseConfig());
    expect(h.component.ready()).toBe(false);

    h.emit('gaugeRollPath', 18);
    expect(h.component.ready()).toBe(false);

    flushFrames();
    expect(h.component.ready()).toBe(true);
  });

  it('never arms transitions on a dial that has nothing to show', () => {
    const h = mount(baseConfig());
    flushFrames();
    expect(h.component.ready()).toBe(false);
    expect(frames).toHaveLength(0);
  });

  it('drops transitions when the reading is lost, so recovery snaps too', () => {
    const h = mount(baseConfig());
    h.emit('gaugeRollPath', 18);
    flushFrames();
    expect(h.component.ready()).toBe(true);

    h.emit('gaugeRollPath', null);
    expect(h.component.ready()).toBe(false);
  });

  it('drops transitions on a re-point, so the new path\'s first reading snaps', () => {
    const h = mount(baseConfig());
    h.emit('gaugeRollPath', 18);
    flushFrames();
    expect(h.component.ready()).toBe(true);

    h.options.set({
      ...baseConfig(),
      paths: {
        gaugePitchPath: { ...ATTITUDE_PATHS.gaugePitchPath, source: 'imu-2' },
        gaugeRollPath: { ...ATTITUDE_PATHS.gaugeRollPath, source: 'imu-2' }
      }
    } as unknown as IWidgetSvcConfig);
    h.fixture.detectChanges();

    expect(h.component.ready()).toBe(false);
  });

  it('cancels a pending arm when the reading is lost before the frame runs', () => {
    const h = mount(baseConfig());
    h.emit('gaugeRollPath', 18);
    h.emit('gaugeRollPath', null);
    flushFrames();
    expect(h.component.ready()).toBe(false);
  });
});

describe('WidgetSeaHorizonComponent axis inversion', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('applies the inversion flags to both axes', () => {
    const h = mount(baseConfig({ invertRoll: true, invertPitch: true }));
    h.emit('gaugeRollPath', 15);
    h.emit('gaugePitchPath', 3);
    expect(h.component.heelText()).toBe('15.0° PORT');
    expect(h.component.trimText()).toBe('TRIM −3.0°');
  });

  // The signals hold the raw reading and invert in a computed, so flipping an axis takes effect at
  // once instead of waiting for the next sample to arrive.
  it('re-reads the stored sample when an axis is flipped', () => {
    const h = mount(baseConfig());
    h.emit('gaugeRollPath', 15);
    expect(h.component.heelText()).toBe('15.0° STBD');

    h.options.set(baseConfig({ invertRoll: true }));
    h.fixture.detectChanges();

    expect(h.component.heelText()).toBe('15.0° PORT');
  });
});

describe('WidgetSeaHorizonComponent dial geometry', () => {
  beforeEach(() => TestBed.resetTestingModule());

  // "Show Frame" binds straight to gauge.noFrameVisible with no inversion, so true means draw the
  // bezel. The dial scales up when it is off, to fill the space the bezel would have taken.
  it('draws the bezel and leaves the dial unscaled when Show Frame is on', () => {
    const h = mount(baseConfig({ noFrameVisible: true }));
    expect(h.component.frameVisible()).toBe(true);
    // The dial is laid out against a 112 radius and scaled onto the 124.5 steelseries face.
    expect(h.component.dialTransform()).toContain('scale(1.1116)');
  });

  it('hides the bezel and grows the dial into the whole tile when Show Frame is off', () => {
    const h = mount(baseConfig({ noFrameVisible: false }));
    expect(h.component.frameVisible()).toBe(false);
    expect(h.component.dialTransform()).toContain('scale(1.3393)');
  });

  /** The radius a circle authored at `authoredR` actually paints at under a transform. */
  function paintedRadius(transform: string | null, authoredR: number): number {
    const m = transform?.match(/scale\(([\d.]+)\)/);
    return authoredR * (m ? parseFloat(m[1]) : 1);
  }

  // The face shading and the glass dome are authored at the steelseries face radius while the dial
  // is authored at its own, so the two line up only if both are scaled to the same extent.
  it('paints the face shading and glass out to the dial edge, case on or off', () => {
    for (const noFrameVisible of [true, false]) {
      TestBed.resetTestingModule();
      const c = mount(baseConfig({ noFrameVisible })).component;
      expect(paintedRadius(c.overlayTransform(), FACE_SHADOW_R))
        .toBeCloseTo(paintedRadius(c.dialTransform(), DIAL_DESIGN_R), 0);
    }
  });

  it('rotates the world against the boat, not the boat against the world', () => {
    const h = mount(baseConfig());
    h.emit('gaugeRollPath', 20);
    // Heeled 20° to starboard, the horizon tips 20° the other way.
    expect(h.component.worldTransform()).toContain('rotate(-20.00 150 150)');
    expect(h.component.pointerTransform()).toContain('rotate(20.00 150 150)');
  });

  it('translates the world for trim, bow-up moving the horizon down the window', () => {
    const h = mount(baseConfig());
    h.emit('gaugePitchPath', 5);
    expect(h.component.worldTransform()).toContain('translate(0 29.00)');
  });

  // The scale is only ruled to 45°; the index parks near the last mark rather than running round
  // the dial, while the horizon itself keeps rotating truthfully.
  it('parks the index at the end of the scale past 45° but keeps rotating the horizon', () => {
    const h = mount(baseConfig());
    h.emit('gaugeRollPath', 80);
    expect(h.component.pointerTransform()).toContain('rotate(48.00');
    expect(h.component.worldTransform()).toContain('rotate(-80.00');
  });

  it('falls back to a level dial when there is no reading', () => {
    const h = mount(baseConfig());
    expect(h.component.worldTransform()).toContain('rotate(0.00 150 150) translate(0 0.00)');
    expect(h.component.noData()).toBe(true);
  });
});

describe('WidgetSeaHorizonComponent heel bands', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('mirrors every band port and starboard', () => {
    const h = mount(baseConfig());
    // Three spans (nominal, caution, alarm), each drawn on both sides.
    expect(h.component.heelBands()).toHaveLength(6);
    expect(h.component.limitIndexes()).toHaveLength(2);
  });

  it('uses the configured caution and alarm angles', () => {
    const h = mount(baseConfig({ heelCautionAngle: 12, heelAlarmAngle: 24 }));
    expect(h.component.cautionAngle()).toBe(12);
    expect(h.component.alarmAngle()).toBe(24);
  });

  // The angles above are what the settings panel shows; this is what the dial draws. Without tying
  // the two together a band geometry that stopped following the config would leave both green
  // while the panel said 35° and the dial drew 30°.
  it('draws the bands and the limit index at the configured angles', () => {
    const h = mount(baseConfig({ heelCautionAngle: 12, heelAlarmAngle: 24 }));
    const bands = h.component.heelBands();

    // Starboard first, then its port mirror, for each of nominal, caution, alarm.
    const caution = bands[2];
    const alarm = bands[4];
    expect(caution.fill).toBe(COLOR_CAUTION);
    expect(caution.d.startsWith(arcStart(BAND_R_OUTER, 12))).toBe(true);
    expect(alarm.fill).toBe(COLOR_ALARM);
    expect(alarm.d.startsWith(arcStart(BAND_R_OUTER, 24))).toBe(true);
    expect(bands[5].fill).toBe(COLOR_ALARM);
    expect(bands[5].d.startsWith(arcStart(BAND_R_OUTER, -45 - 1))).toBe(true);

    const [starboard, port] = h.component.limitIndexes();
    const [ox, oy] = polar(LIMIT_R_OUTER, 24);
    const [ix, iy] = polar(LIMIT_R_INNER, 24);
    expect(starboard.x1).toBeCloseTo(ox, 6);
    expect(starboard.y1).toBeCloseTo(oy, 6);
    expect(starboard.x2).toBeCloseTo(ix, 6);
    expect(starboard.y2).toBeCloseTo(iy, 6);
    // Mirrored about the vertical axis, at the same height.
    expect(port.x1).toBeCloseTo(300 - ox, 6);
    expect(port.y1).toBeCloseTo(oy, 6);
  });

  it('moves the bands and the limit index when the angles change', () => {
    const h = mount(baseConfig({ heelCautionAngle: 12, heelAlarmAngle: 24 }));
    const before = { bands: h.component.heelBands(), index: h.component.limitIndexes()[0] };

    h.options.set(baseConfig({ heelCautionAngle: 15, heelAlarmAngle: 35 }));
    h.fixture.detectChanges();

    expect(h.component.heelBands()[2].d.startsWith(arcStart(BAND_R_OUTER, 15))).toBe(true);
    expect(h.component.heelBands()[4].d.startsWith(arcStart(BAND_R_OUTER, 35))).toBe(true);
    expect(h.component.heelBands()[2].d).not.toBe(before.bands[2].d);
    const [x] = polar(LIMIT_R_OUTER, 35);
    expect(h.component.limitIndexes()[0].x1).toBeCloseTo(x, 6);
    expect(h.component.limitIndexes()[0].x1).not.toBeCloseTo(before.index.x1, 6);
  });

  // The two specs above pin the geometry; this pins the template's bindings to it, so a band or
  // index that was computed correctly but rendered from something else would not pass unnoticed.
  it('renders the bands and the limit index from that geometry', () => {
    const h = mount(baseConfig({ heelCautionAngle: 12, heelAlarmAngle: 24 }));
    const svg = h.fixture.nativeElement as HTMLElement;
    const attr = (el: Element, name: string) => Number(el.getAttribute(name));

    const paths = svg.querySelectorAll('.bands path');
    expect(paths).toHaveLength(6);
    h.component.heelBands().forEach((band, i) => {
      expect(paths[i].getAttribute('d')).toBe(band.d);
      expect(paths[i].getAttribute('fill')).toBe(band.fill);
    });
    expect(paths[2].getAttribute('d')?.startsWith(arcStart(BAND_R_OUTER, 12))).toBe(true);

    const lines = svg.querySelectorAll('.limit-index line');
    expect(lines).toHaveLength(2);
    const [ox, oy] = polar(LIMIT_R_OUTER, 24);
    expect(attr(lines[0], 'x1')).toBeCloseTo(ox, 6);
    expect(attr(lines[0], 'y1')).toBeCloseTo(oy, 6);
    expect(attr(lines[1], 'x1')).toBeCloseTo(300 - ox, 6);

    h.options.set(baseConfig({ heelCautionAngle: 15, heelAlarmAngle: 35 }));
    h.fixture.detectChanges();
    expect(svg.querySelectorAll('.bands path')[2].getAttribute('d')?.startsWith(arcStart(BAND_R_OUTER, 15))).toBe(true);
    expect(attr(svg.querySelectorAll('.limit-index line')[0], 'x1')).toBeCloseTo(polar(LIMIT_R_OUTER, 35)[0], 6);
  });

  it('defaults to a cruising band when the angles are missing', () => {
    const h = mount(baseConfig());
    expect(h.component.cautionAngle()).toBe(20);
    expect(h.component.alarmAngle()).toBe(30);
  });

  // An alarm at or below the caution angle would collapse the caution band to zero width and start
  // the alarm before the caution it escalates from.
  it('keeps the alarm angle above the caution angle', () => {
    const h = mount(baseConfig({ heelCautionAngle: 25, heelAlarmAngle: 10 }));
    expect(h.component.alarmAngle()).toBe(26);
    expect(h.component.heelBands()).toHaveLength(6);
  });

  it('clamps angles to the ruled part of the scale', () => {
    const h = mount(baseConfig({ heelCautionAngle: 900, heelAlarmAngle: 900 }));
    expect(h.component.cautionAngle()).toBe(44);
    expect(h.component.alarmAngle()).toBe(45);
  });
});

describe('WidgetSeaHorizonComponent damping', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => vi.restoreAllMocks());

  it('passes samples straight through when damping is off', () => {
    const h = mount(baseConfig({ damping: 0 }));
    h.emit('gaugeRollPath', 10);
    h.emit('gaugeRollPath', 30);
    expect(h.component.heelText()).toBe('30.0° STBD');
  });

  it('takes the first sample verbatim rather than ramping up from zero', () => {
    const h = mount(baseConfig({ damping: 3 }));
    h.emit('gaugeRollPath', 22);
    expect(h.component.heelText()).toBe('22.0° STBD');
  });

  it('eases toward later samples with the configured time constant', () => {
    let clock = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);

    const h = mount(baseConfig({ damping: 1 }));
    h.emit('gaugeRollPath', 0);
    clock += 1000; // one time constant later
    h.emit('gaugeRollPath', 10);

    // alpha = 1 - e^-1 = 0.632, so the dial moves most but not all of the way.
    expect(h.component.heelText()).toBe('6.3° STBD');
  });

  it('clears rather than smoothing when a reading goes away', () => {
    const h = mount(baseConfig({ damping: 3 }));
    h.emit('gaugeRollPath', 20);
    h.emit('gaugeRollPath', null);
    expect(h.component.heelText()).toBe('--');
  });

  // The panel offers up to 5 s, but the stored number is unbounded and other tools write it: a
  // constant of hours would park the dial on its first sample for good.
  it('confines an off-menu time constant so the dial stays live', () => {
    let clock = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);

    const h = mount(baseConfig({ damping: 1e9 }));
    h.emit('gaugeRollPath', 0);
    clock += 10_000; // one capped time constant later
    h.emit('gaugeRollPath', 10);

    // Damped as if the constant were 10 s: alpha = 1 - e^-1, the same step the 1 s case takes.
    expect(h.component.heelText()).toBe('6.3° STBD');
  });

  it('treats a damping value that is not a number as no damping', () => {
    const h = mount(baseConfig({ damping: 'fast' as unknown as number }));
    h.emit('gaugeRollPath', 10);
    h.emit('gaugeRollPath', 30);
    expect(h.component.heelText()).toBe('30.0° STBD');
  });
});

describe('WidgetSeaHorizonComponent bezel finishes', () => {
  beforeEach(() => TestBed.resetTestingModule());

  /** Each mount needs its own module, so finishes are captured one at a time and compared after. */
  function finish(faceColor: string) {
    TestBed.resetTestingModule();
    const c = mount(baseConfig({ faceColor })).component;
    return { layers: c.frameLayers(), wedges: c.frameWedges() };
  }

  // The case is steelseries' own, so the finishes have to be too — these pin the shape each one
  // takes, not just that they differ.
  it('draws a gradient-stack finish as filled circles and no wedges', () => {
    const anthracite = finish('anthracite');
    expect(anthracite.layers).toHaveLength(1);
    expect(anthracite.layers[0].r).toBeCloseTo(148.598, 3);
    expect(anthracite.layers[0].fill).toContain('url(#');
    expect(anthracite.wedges).toHaveLength(0);
  });

  // SVG has no conical gradient, so a brushed finish becomes a ring of wedges instead.
  it('draws a brushed finish as a wedge ring and no circles', () => {
    const blackMetal = finish('blackMetal');
    expect(blackMetal.layers).toHaveLength(0);
    expect(blackMetal.wedges.length).toBeGreaterThanOrEqual(24);
  });

  /**
   * Every colour stop gets a wedge edge of its own, on top of the regular subdivision. A wedge
   * carries a two-colour gradient, so one straddling a stop averages across it — which measured 3.8
   * RGB counts out over the chrome bezel, with excursions of 29, against the real gauge.
   */
  it('gives every colour stop a wedge edge of its own', () => {
    for (const [design, stops] of [['blackMetal', [45, 115.0002, 180, 235.0001, 315]],
                                   ['chrome', [10.8, 46.8, 61.2, 72, 115.2, 133.2]]] as const) {
      const starts = finish(design).wedges.map(w => w.a0);
      for (const stop of stops) {
        expect(starts.some(a => Math.abs(a - stop) < 0.001)).toBe(true);
      }
    }
  });

  // Sampling the real gauge gives white at the top, black on the diagonals and grey at the sides;
  // if the sweep were mapped the other way round these would be inverted.
  it('sweeps a brushed finish the same way round as the real gauge', () => {
    const wedges = finish('blackMetal').wedges;
    const at = (deg: number) => wedges.find(w => Math.abs(w.a0 - deg) < 0.001)?.c0;
    expect(at(0)).toBe('rgb(254, 254, 254)');          // top
    expect(at(45)).toBe('rgb(0, 0, 0)');
    expect(at(180)).toBe('rgb(0, 0, 0)');              // bottom
  });

  it('keeps the extra layers a multi-pass finish needs', () => {
    expect(finish('glossyMetal').layers).toHaveLength(4);
  });

  it('falls back to anthracite for a finish it does not know', () => {
    expect(finish('not-a-finish')).toEqual(finish('anthracite'));
  });
});

describe('WidgetSeaHorizonComponent dial faces', () => {
  beforeEach(() => TestBed.resetTestingModule());

  function face(backgroundColor?: string) {
    TestBed.resetTestingModule();
    return mount(baseConfig(backgroundColor === undefined ? {} : { backgroundColor })).component;
  }

  // Classic Steel defaults to carbon, and these two sit side by side on a dashboard.
  it('wears carbon by default, as the Classic Steel gauge does', () => {
    const c = face();
    expect(c.backgroundTexture()?.size).toBe(12);
    expect(c.backgroundGradient()).toBeNull();
    expect(c.backgroundWedges()).toHaveLength(0);
  });

  // drawBackground.js runs the plain finishes down a linear gradient — not the radial one a dial
  // face looks like it ought to have — from y = width * 0.084112 to the face diameter, and puts its
  // middle colour at 0.4 rather than halfway.
  it('runs a plain finish down the gradient drawBackground.js uses', () => {
    const gradient = face('blue').backgroundGradient();
    expect(gradient).not.toBeNull();
    expect(gradient?.y1).toBeCloseTo(25.234, 3);
    expect(gradient?.y2).toBeCloseTo(249.532, 3);
    expect(gradient?.stops).toEqual([
      { o: '0', c: '#2D537A' }, { o: '0.4', c: '#7390AA' }, { o: '1', c: '#E3EAEE' }
    ]);
  });

  it('tiles the two textured finishes rather than shading them', () => {
    expect(face('carbon').backgroundTexture()?.shapes).toHaveLength(8);
    expect(face('punchedSheet').backgroundTexture()?.size).toBe(15);
    expect(face('punchedSheet').backgroundGradient()).toBeNull();
  });

  it('sweeps stainless, and lays the lathe turnings over turned only', () => {
    const stainless = face('stainless');
    expect(stainless.backgroundWedges().length).toBeGreaterThan(48);
    expect(stainless.turnedScribes()).toHaveLength(0);
    // A light pass and its shadow per step, all the way round.
    expect(face('turned').turnedScribes()).toHaveLength(180);
  });

  /**
   * steelseries paints its side vignette *before* the brushed texture and *after* the two tiles, so
   * only carbon and punchedSheet keep it — the brushed pair paint straight over theirs. Reading the
   * branch as "textures get a vignette" darkens the brushed faces by a quarter, which measured 40+
   * RGB counts against the real gauge on the part of the face this widget actually leaves bare.
   */
  it('vignettes only the finishes steelseries leaves vignetted', () => {
    expect(face('carbon').faceVignette()).toBe(true);
    expect(face('punchedSheet').faceVignette()).toBe(true);
    expect(face('brushedMetal').faceVignette()).toBe(false);
    expect(face('brushedStainless').faceVignette()).toBe(false);
    expect(face('blue').faceVignette()).toBe(false);
  });

  // Engraved marks take their ink from the face the way steelseries' tick labels take theirs from
  // the background's labelColor, so a light face does not end up carrying white numerals.
  it('takes the dial ink from the face', () => {
    expect(face('carbon').labelColor()).toBe('#FFFFFF');
    expect(face('white').labelColor()).toBe('#000000');
    expect(face('white').haloColor()).toBe('#FFFFFF');
    expect(face('blue').symbolColor()).toBe('#00005A');
  });

  it('falls back to carbon for a face it does not know', () => {
    expect(face('not-a-face').backgroundTexture()?.size).toBe(12);
  });
});

/**
 * The texture tiles are the one thing here specified in device pixels rather than as a fraction of
 * the dial, so they are the one thing that has to know how big the widget was painted. These drive
 * the ResizeObserver callback directly rather than waiting on a layout that jsdom never performs.
 */
describe('WidgetSeaHorizonComponent texture scale', () => {
  const originalResizeObserver = globalThis.ResizeObserver;
  let measure: ((width: number, height: number) => void) | null = null;

  beforeEach(() => {
    TestBed.resetTestingModule();
    measure = null;
    class CapturingResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        measure = (width, height) =>
          callback([{ contentRect: { width, height } } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      public observe(): void { /* the spec drives the callback itself */ }
      public unobserve(): void { /* unused */ }
      public disconnect(): void { /* unused */ }
    }
    globalThis.ResizeObserver = CapturingResizeObserver as unknown as typeof ResizeObserver;
  });

  afterEach(() => { globalThis.ResizeObserver = originalResizeObserver; });

  function paintedAt(width: number, height: number, gauge: GaugeOverrides = {}) {
    TestBed.resetTestingModule();
    const h = mount(baseConfig({ noFrameVisible: true, backgroundColor: 'carbon', ...gauge }));
    measure?.(width, height);
    h.fixture.detectChanges();
    return h.component;
  }

  /**
   * The invariant the whole mechanism exists for: carbon's tile is 12 device pixels on a Classic
   * Steel gauge at any size, so it has to be 12 device pixels here too. Sized in viewBox units
   * instead it is a fixed fraction of the dial, which measured 7 RGB counts out against the real
   * gauge at every size except the 300 the viewBox happens to be.
   */
  it('keeps a texture tile the size steelseries draws it, whatever the widget is painted at', () => {
    for (const painted of [150, 300, 380, 600]) {
      const c = paintedAt(painted, painted, { noFrameVisible: true });
      const scale = Number(/scale\(([\d.]+)\)/.exec(c.texturePatternTransform())?.[1]);
      const tileUnits = (c.backgroundTexture()?.size ?? 0) * scale;
      expect(tileUnits * (painted / 300)).toBeCloseTo(12, 3);
    }
  });

  // xMidYMid meet paints into the largest square that fits, so an oblong tile is sized by its
  // shorter side; taking the width would shrink the weave on a wide, short tile.
  it('measures the square the instrument is actually painted into', () => {
    expect(paintedAt(600, 200).texturePatternTransform()).toBe('scale(1.50000)');
    expect(paintedAt(200, 600).texturePatternTransform()).toBe('scale(1.50000)');
  });

  // contentRect is fractional, so a drag would otherwise hand the pattern a new scale every frame.
  it('measures in whole pixels, so a sub-pixel resize does not re-tile the face', () => {
    expect(paintedAt(200.4, 600).texturePatternTransform()).toBe('scale(1.50000)');
    expect(paintedAt(200.9, 600).texturePatternTransform()).toBe('scale(1.50000)');
  });

  // With the case hidden the face is painted inside a group that scales it up to the whole tile,
  // which would carry the tile with it.
  it('divides out the scale the frameless face is drawn under', () => {
    expect(paintedAt(300, 300, { noFrameVisible: true }).texturePatternTransform()).toBe('scale(1.00000)');
    expect(paintedAt(300, 300, { noFrameVisible: false }).texturePatternTransform()).toBe('scale(0.83000)');
  });

  it('binds the measured scale to the texture pattern itself', () => {
    TestBed.resetTestingModule();
    const h = mount(baseConfig({ noFrameVisible: true, backgroundColor: 'carbon' }));
    measure?.(600, 600);
    h.fixture.detectChanges();
    const pattern = (h.fixture.nativeElement as HTMLElement).querySelector('pattern');
    expect(pattern?.getAttribute('patternTransform')).toBe('scale(0.50000)');
    expect(pattern?.getAttribute('patternTransform')).toBe(h.component.texturePatternTransform());
  });

  it('falls back to the authored size when nothing ever measures the widget', () => {
    TestBed.resetTestingModule();
    const c = mount(baseConfig({ noFrameVisible: true, backgroundColor: 'carbon' })).component;
    expect(c.texturePatternTransform()).toBe('scale(1.00000)');
  });

  // steelseries scribes its turnings with a half-pixel stroke, so this follows the painted size too.
  it('scribes the turnings with a half-pixel stroke', () => {
    expect(paintedAt(600, 600, { noFrameVisible: true, backgroundColor: 'turned' }).scribeStrokeWidth()).toBe('0.2500');
    expect(paintedAt(150, 150, { noFrameVisible: true, backgroundColor: 'turned' }).scribeStrokeWidth()).toBe('1.0000');
  });
});
