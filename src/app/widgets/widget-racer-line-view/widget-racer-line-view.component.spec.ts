import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetRacerLineViewComponent } from './widget-racer-line-view.component';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective } from '../../core/directives/widget-streams.directive';
import { UnitsService } from '../../core/services/units.service';
import { SignalkRequestsService, skRequest } from '../../core/services/signalk-requests.service';
import { Subject } from 'rxjs';
import { DashboardService } from '../../core/services/dashboard.service';
import { signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { RacerLineViewComponent } from './racer-line-view/racer-line-view.component';
import { parsePointer } from '../../core/utils/pointer-path.util';

/**
 * The widget subscribes and hands the values down; the drawing turns them into SVG. These tests
 * drive it from the stream callbacks, which is the seam a real Signal K delta arrives at, and
 * assert on the rendered SVG — so they cover the whole path rather than the geometry alone, which
 * `start-line-geometry.util.spec.ts` already covers on its own.
 */
describe('WidgetRacerLineViewComponent', () => {
  let fixture: ComponentFixture<WidgetRacerLineViewComponent>;
  /** The callback the widget registered per path key, so a test can push values in. */
  let feeds: Map<string, (pkt: unknown) => void>;

  const runtimeMock = { options: () => WidgetRacerLineViewComponent.DEFAULT_CONFIG };
  // The real service answers with the request id it sent under, and the widget treats a
  // null as the request never having gone out - so a mock returning undefined silently
  // turns off everything the widget does optimistically on a successful send.
  // Results are pushed through here by a test, the way the service dispatches a PUT's
  // final status to every subscriber.
  const requestResults = new Subject<skRequest>();
  const requestsMock = {
    putRequest: vi.fn<(path: string, value: unknown, widgetUUID: string) => string | null>(
      () => 'req-1'),
    subscribeRequest: () => requestResults.asObservable()
  };
  // Only the lock state is read, and a locked dashboard is the state the controls are
  // usable in; unlocked covers them with the drag overlay.
  const dashboardMock = { isDashboardStatic: signal(true) };
  const unitsMock: Partial<UnitsService> = {
    convertToUnit: vi.fn((_unit: string, value: number) => value),
    getUnitDisplaySymbol: vi.fn((measure: string | null | undefined) => measure ?? '')
  };

  beforeEach(async () => {
    feeds = new Map();
    requestsMock.putRequest.mockClear();
    const streamsMock = {
      // The real directive throws on a pointer that is not RFC 6901 ('lines' instead of
      // '/lines'), and a mock that takes anything hides it: the widget's effect dies, the
      // named lines never arrive, and every test here still passes because it feeds the
      // callback directly. So the mock applies the same rule.
      observe: vi.fn((key: string, cb: (pkt: unknown) => void, pointer?: string) => {
        if (pointer !== undefined && !parsePointer(pointer)) {
          throw new Error(`observe() pointer '${pointer}' is not an RFC 6901 pointer`);
        }
        feeds.set(key, cb);
      })
    };

    await TestBed.configureTestingModule({
      imports: [WidgetRacerLineViewComponent],
      providers: [
        { provide: WidgetRuntimeDirective, useValue: runtimeMock },
        { provide: WidgetStreamsDirective, useValue: streamsMock },
        { provide: UnitsService, useValue: unitsMock },
        { provide: SignalkRequestsService, useValue: requestsMock },
        { provide: DashboardService, useValue: dashboardMock }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(WidgetRacerLineViewComponent);
    const set = fixture.componentRef.setInput.bind(fixture.componentRef) as (k: string, v: unknown) => void;
    set('id', 'racer-line-view-test');
    set('type', 'widget-racer-line-view');
    set('theme', null);
    fixture.detectChanges();
  });

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const svg = () => host().querySelector('svg.line-svg');

  const feed = (values: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(values)) {
      const cb = feeds.get(key);
      expect(cb, `nothing observed ${key}`).toBeTruthy();
      cb?.({ data: { value, timestamp: new Date() } });
    }
    fixture.detectChanges();
  };

  /**
   * A 140m line bearing 070, with the boat placed the way the delta service delivers a
   * position — one whole {latitude, longitude} object in degrees, at its own path. Object
   * values are never flattened into dotted child paths (SK-02 / #21), so there is no
   * navigation.position.latitude to feed. The pre-start side lies north-west of the line.
   */
  const aLine = (boatLat: number, boatLon: number) => feed({
    portPath: { latitude: 0.00043, longitude: 0.00118 },
    stbPath: { latitude: 0, longitude: 0 },
    lineLengthPath: 140,
    positionPath: { latitude: boatLat, longitude: boatLon },
    headingPath: 1.6, cogPath: 1.6, sogPath: 2.0
  });

  /**
   * The regression that shipped: every position was subscribed as a fabricated leaf path
   * (navigation.position.latitude and the two line ends' own), which the delta service
   * never emits, so a line that was set everywhere else read as no line at all here.
   */
  it('takes compound values whole, not as fabricated child paths', () => {
    // Signal K emits each of these as one object at its own path; a dotted child of one
    // is a path the delta service never emits (SK-02 / #21).
    const compound = [
      'self.navigation.position',
      'self.navigation.racing.startLinePort',
      'self.navigation.racing.startLineStb',
      'self.navigation.racing.lines'
    ];
    const paths = WidgetRacerLineViewComponent.DEFAULT_CONFIG.paths ?? {};
    for (const [key, cfg] of Object.entries(paths)) {
      const path = cfg.path ?? '';
      for (const root of compound) {
        expect(path.startsWith(root + '.'), `${key} subscribes to a child of ${root}`).toBe(false);
      }
    }
  });

  /**
   * Signal K's unit preferences file a metre-valued path under the 'distance' category,
   * which every nautical preset targets at nautical miles — so a 140m start line renders
   * as 0. These are boat-scale measurements and keep the widget's own unit.
   */
  it('draws every distance in the unit the length stream resolved to', () => {
    // The pipeline converts to the server's preferred unit and reports it as `measure`;
    // reading the stored convertUnitTo instead is how the legs came to be drawn in metres
    // beside a line length in another unit.
    aLine(0.00035, 0.00030);
    (unitsMock.convertToUnit as unknown as { mockClear: () => void }).mockClear();
    feeds.get('lineLengthPath')?.({ data: { value: 140, measure: 'foot', timestamp: new Date() } });
    fixture.detectChanges();
    const units = (unitsMock.convertToUnit as unknown as { mock: { calls: unknown[][] } })
      .mock.calls.map(c => c[0]);
    // 'knots' also appears: the VMGs are speeds and have their own unit. What must not
    // appear is 'm' — a distance still being drawn in the stored unit.
    expect(units, 'the resolved unit was never used').toContain('foot');
    expect(units, 'a distance was drawn in the stored unit').not.toContain('m');
  });

  it('measures the line itself rather than converting the published length twice', () => {
    setMode(1);
    // The published length arrives already converted; the drawing converts metres once.
    aLine(0.00035, 0.00030);
    feeds.get('lineLengthPath')?.({ data: { value: 99999, measure: 'm', timestamp: new Date() } });
    fixture.detectChanges();
    expect(svg()?.querySelector('.line-label')?.textContent).not.toContain('99999');
    expect(svg()?.querySelector('.line-label')?.textContent).toContain('140');
  });

  /**
   * The line is published when it changes and then not again, so the widget-wide 5s
   * stale-data TTL would null it moments after it arrived. Everything describing the line
   * has to sit outside that timeout; the live readings stay inside it.
   */
  it('keeps the line’s own state out of the stale-data timeout', () => {
    const paths = WidgetRacerLineViewComponent.DEFAULT_CONFIG.paths ?? {};
    for (const key of ['portPath', 'stbPath', 'lineLengthPath', 'lineBearingPath',
      'startLineNamePath', 'linesPath', 'boatLengthPath']) {
      expect(paths[key]?.enableTimeout, `${key} would be timed out`).toBe(false);
    }
    // The live navigation, and the readings the plugin computes on every position, take
    // the TTL on their own, the widget declaring no timeout of its own for them to inherit.
    for (const key of ['positionPath', 'headingPath', 'cogPath', 'sogPath', 'twdPath',
      'ttlPath', 'ttbPath']) {
      expect(paths[key]?.enableTimeout, `${key} would never go stale`).toBe(true);
    }
    // The countdown is the exception among the live readings: published once when the
    // timer is armed or reset, then every second only while it runs, so a TTL blanks the
    // seeded 5:00 a reset leaves standing.
    expect(paths['ttsPath']?.enableTimeout,
      'a reset countdown would blank five seconds later').toBe(false);
  });

  it('subscribes to every path its config declares', () => {
    const declared = Object.keys(WidgetRacerLineViewComponent.DEFAULT_CONFIG.paths ?? {});
    expect(declared.length).toBeGreaterThan(0);
    for (const key of declared) {
      expect(feeds.has(key), `never observed ${key}`).toBe(true);
    }
  });

  it('says so rather than drawing nothing when no line is set', () => {
    expect(svg()?.textContent).toContain('No start line set');
  });

  it('draws the line, both ends and the boat once a line and a fix arrive', () => {
    aLine(-0.00005, 0.00030);
    expect(svg()?.querySelector('.start-line')).toBeTruthy();
    expect(svg()?.querySelector('.port-mark')).toBeTruthy();
    expect(svg()?.querySelector('.stb-mark')).toBeTruthy();
    expect(svg()?.querySelector('.boat')).toBeTruthy();
    expect(svg()?.textContent).not.toContain('No start line set');
  });

  it('leaves the length and heading off the watching screen by default', () => {
    aLine(0.00035, 0.00030);
    expect(svg()?.querySelector('.line-label')).toBeNull();
  });

  it('shows it on both editing screens whatever the setting says', () => {
    aLine(0.00035, 0.00030);
    for (const m of [1, 2] as const) {
      setMode(m);
      expect(svg()?.querySelector('.line-label'), `missing on screen ${m}`).toBeTruthy();
    }
  });

  // The label is off by default on the watching screen, so these read it where it is
  // always shown; the text is built the same way on every screen.
  it('labels the line with its length and the heading sailed to cross it', () => {
    setMode(1);
    aLine(-0.00005, 0.00030);
    const label = svg()?.querySelector('.line-label')?.textContent ?? '';
    // "140m · 160°T↑" — the arrow says the heading is the way to sail to start.
    expect(label).toMatch(/^\d+m · \d{3}°T↑$/);
  });

  it('draws the start zone it decides the approach against', () => {
    aLine(-0.00005, 0.00030);
    // Two line extensions plus a 45 degree wedge either side of each end.
    expect(svg()?.querySelectorAll('.zone-guide')).toHaveLength(6);
  });

  it('closes the line straight across from inside the zone, and turns a corner outside it', () => {
    // Abeam the line: one leg only, the perpendicular one.
    aLine(-0.00005, 0.00030);
    expect(svg()?.querySelectorAll('.dimension')).toHaveLength(1);

    // Well past the pin: the along-line leg to the wedge appears beside it.
    aLine(0.00090, 0.00200);
    expect(svg()?.querySelectorAll('.dimension')).toHaveLength(2);
  });

  /**
   * The zone and across labels meet at the corner the approach turns, and used to land on
   * top of each other there - both legs short, or the zone leg running away under the
   * across label. Swept over boat positions off both ends, on both sides of the line, far
   * and near, so every combination of leg directions and lengths comes up.
   */
  it('never draws the two leg labels over each other', () => {
    const box = (text: Element) => {
      const F = Number(text.getAttribute('font-size'));
      const width = (text.textContent ?? '').trim().length * F * 0.6;
      const x = Number(text.getAttribute('x')), y = Number(text.getAttribute('y'));
      const anchor = text.getAttribute('text-anchor');
      const left = anchor === 'start' ? x : anchor === 'end' ? x - width : x - width / 2;
      return { left, right: left + width, top: y - F * 0.75, bottom: y + F * 0.25 };
    };
    let pairs = 0;
    for (let lat = -0.0012; lat <= 0.0018; lat += 0.00008) {
      for (let lon = -0.0014; lon <= 0.0026; lon += 0.00016) {
        aLine(lat, lon);
        const texts = [...svg()!.querySelectorAll('.dimension text')];
        if (texts.length !== 2) continue;
        pairs++;
        const [a, b] = texts.map(box);
        const apart = a.right <= b.left || b.right <= a.left
          || a.bottom <= b.top || b.bottom <= a.top;
        expect(apart, `labels overlap with the boat at ${lat.toFixed(5)}, ${lon.toFixed(5)}: `
          + `${JSON.stringify(a)} ${JSON.stringify(b)}`).toBe(true);
      }
    }
    // The sweep has to have actually turned corners for it to prove anything.
    expect(pairs).toBeGreaterThan(50);
  });

  /**
   * The position Signal K reports is the bow, so the hull hangs aft of it: turning the
   * boat swings the stern around a bow that stays where it is.
   */
  it('rotates the boat about the bow, not its middle', () => {
    aLine(0.00035, 0.00030);
    const bow = () => {
      // The hull path starts at the bow: "M<x>,<y> C..."
      const d = svg()!.querySelector('.boat')!.getAttribute('d') ?? '';
      const m = /^M([\d.-]+),([\d.-]+)/.exec(d);
      expect(m, `no bow in ${d.slice(0, 40)}`).toBeTruthy();
      return { x: Number(m![1]), y: Number(m![2]) };
    };
    const before = bow();
    // A quarter turn, with the position untouched.
    feed({ headingPath: 1.6 + Math.PI / 2 });
    const after = bow();
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
  });

  /**
   * The screen button lives outside the drawing's scene, so it is there even when there
   * is no line to draw. Without that, entering a screen with no line set would be a room
   * with no door.
   */
  it('offers the screen button with no line set at all', () => {
    expect(svg()?.textContent).toContain('No start line set');
    const c = [...svg()!.querySelectorAll('.control')];
    expect(c).toHaveLength(1);
    expect(c[0].getAttribute('aria-label')).toContain('Next screen');
  });

  it('shows the countdowns beside it, as minutes and seconds', () => {
    aLine(0.00035, 0.00030);
    feed({ ttlPath: 41, ttbPath: 19 });
    // The caption and the value are separate <text> elements, laid out side by side.
    const readouts = [...svg()!.querySelectorAll('.readout')]
      .map(r => [...r.querySelectorAll('text')].map(t => t.textContent?.trim()));
    expect(readouts).toEqual([['TTL', '0:41'], ['TTB', '0:19']]);
  });

  it('keeps the countdowns to the watching screen', () => {
    aLine(0.00035, 0.00030);
    feed({ ttlPath: 41, ttbPath: 19 });
    setMode(1);
    expect(svg()!.querySelectorAll('.readout')).toHaveLength(0);
  });

  /**
   * The corner controls sit over the drawing, so the fit has to keep the line above
   * them. Everything else may pass behind — the boat included, which is worth seeing
   * where it actually is.
   */
  /**
   * Holding both ends in frame capped the zoom just when the detail near the boat
   * mattered most. One end may leave; the nearer one may not.
   */
  it('zooms past the far end, keeping the nearer one in frame', () => {
    // Hard up by the starboard end of a 140m line.
    aLine(0.00005, 0.00010);
    const portX = Number(svg()!.querySelector('.start-line')!.getAttribute('x1'));
    const stbX = Number(svg()!.querySelector('.start-line')!.getAttribute('x2'));
    const width = Number(svg()!.getAttribute('viewBox')!.split(' ')[2]);
    // The starboard end is the near one and stays on the drawing...
    expect(stbX).toBeGreaterThanOrEqual(0);
    expect(stbX).toBeLessThanOrEqual(width);
    // ...and it is drawn further apart than a fit holding both ends could manage.
    expect(Math.abs(stbX - portX)).toBeGreaterThan(width);
  });

  /**
   * Showing a usable run of the line comes before zooming in: ten boat lengths of it stay
   * in frame whatever that costs in scale. Measured on the line itself rather than on the
   * fitted span, which is mostly open water when the boat is standing off.
   */
  it('always keeps ten boat lengths of the line in frame', () => {
    feed({ boatLengthPath: 12 });
    // Sitting on the starboard end, which is where the zoom would otherwise run away.
    aLine(0.00003, 0.00005);
    const line = svg()!.querySelector('.start-line')!;
    const portX = Number(line.getAttribute('x1'));
    const stbX = Number(line.getAttribute('x2'));
    const width = Number(svg()!.getAttribute('viewBox')!.split(' ')[2]);
    // Units per metre, from the line's own drawn length.
    const scale = Math.abs(stbX - portX) / 140;
    const onScreen = Math.min(Math.max(portX, stbX), width) - Math.max(Math.min(portX, stbX), 0);
    expect(onScreen / scale, 'less than ten boat lengths of line in frame')
      .toBeGreaterThanOrEqual(120 - 0.5);
  });

  /**
   * And it stops there rather than chasing the whole line: on a line far longer than the
   * run it wants, the far end is still allowed to leave, which is what keeps the boat
   * from being zoomed away to nothing on a half-kilometre line.
   */
  it('does not chase a line longer than that', () => {
    feed({ boatLengthPath: 12 });
    // A 560m line — four times the run the fit wants — with the boat at its starboard end.
    feed({
      portPath: { latitude: 0.00172, longitude: 0.00472 },
      stbPath: { latitude: 0, longitude: 0 },
      lineLengthPath: 560,
      positionPath: { latitude: 0.00003, longitude: 0.00005 },
      headingPath: 1.6, cogPath: 1.6, sogPath: 2.0
    });
    const line = svg()!.querySelector('.start-line')!;
    const portX = Number(line.getAttribute('x1'));
    const stbX = Number(line.getAttribute('x2'));
    const width = Number(svg()!.getAttribute('viewBox')!.split(' ')[2]);
    const scale = Math.abs(stbX - portX) / 560;
    const onScreen = (Math.min(Math.max(portX, stbX), width)
      - Math.max(Math.min(portX, stbX), 0)) / scale;
    expect(onScreen, 'the whole line was chased into frame').toBeLessThan(560 * 0.75);
  });

  /**
   * Standing off the line, the across axis is what sets the scale, and the width is left
   * holding far more along-distance than the fitted span asks of it. Centring that span
   * drew empty water either side of it while the line itself ran off the edge; the spare
   * width goes to the line instead, at no cost in scale.
   */
  it('fills the spare width with the line when the boat is standing off it', () => {
    // 59m off the line, abeam the starboard end of a 140m line: the whole span the fit
    // needs is the boat and that one end, a fraction of the width available.
    aLine(0.000499, -0.000181);
    const line = svg()!.querySelector('.start-line')!;
    const portX = Number(line.getAttribute('x1'));
    const stbX = Number(line.getAttribute('x2'));
    const width = Number(svg()!.getAttribute('viewBox')!.split(' ')[2]);
    const scale = Math.abs(stbX - portX) / 140;
    const onScreen = (Math.min(Math.max(portX, stbX), width)
      - Math.max(Math.min(portX, stbX), 0)) / scale;
    // 86m of it was on screen with the span centred, the rest of the width being water.
    expect(onScreen, 'the spare width is not reaching the line').toBeGreaterThan(120);

    // And the pan that buys it must not push the boat off the other edge.
    const d = svg()!.querySelector('.boat')!.getAttribute('d') ?? '';
    const xs = [...d.matchAll(/[ML,]\s*([\d.-]+),/g)].map(m => Number(m[1]));
    expect(xs.length, 'no boat outline to check').toBeGreaterThan(0);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(width);
  });

  it('keeps both ends when there is no boat to zoom towards', () => {
    feed({
      portPath: { latitude: 0.00043, longitude: 0.00118 },
      stbPath: { latitude: 0, longitude: 0 },
      lineLengthPath: 140
    });
    const line = svg()!.querySelector('.start-line')!;
    const portX = Number(line.getAttribute('x1'));
    const stbX = Number(line.getAttribute('x2'));
    const width = Number(svg()!.getAttribute('viewBox')!.split(' ')[2]);
    for (const x of [portX, stbX]) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(width);
    }
  });

  /**
   * The position takes the stale-data TTL. Losing the fix takes the boat off the drawing,
   * but re-fitting to the bare line would zoom out and back in again when it returns.
   */
  it('holds the frame the boat was last seen in when the fix is lost', () => {
    aLine(0.00005, 0.00010);
    const line = () => svg()!.querySelector('.start-line')!;
    const before = ['x1', 'y1', 'x2', 'y2'].map(a => line().getAttribute(a));
    feed({ positionPath: null });
    expect(svg()!.querySelector('.boat')).toBeNull();
    expect(['x1', 'y1', 'x2', 'y2'].map(a => line().getAttribute(a))).toEqual(before);
  });

  it('keeps the line clear of the corner controls', () => {
    // A boat well up-course, which puts the line at the bottom of the fitted span.
    aLine(-0.00060, 0.00030);
    const lineY = Number(svg()!.querySelector('.start-line')!.getAttribute('y1'));
    const buttonTop = Number(svg()!.querySelector('.control rect')!.getAttribute('y'));
    expect(lineY, `line at ${lineY} runs into the controls at ${buttonTop}`)
      .toBeLessThan(buttonTop);
  });

  it('keeps the boat clear of them too', () => {
    // The mirror case: the boat below the line, so it is the low thing in the frame.
    aLine(0.00200, 0.00030);
    const buttonTop = Number(svg()!.querySelector('.control rect')!.getAttribute('y'));
    const d = svg()!.querySelector('.boat')!.getAttribute('d') ?? '';
    const ys = [...d.matchAll(/[ML,]\s*[\d.-]+,([\d.-]+)/g)].map(m => Number(m[1]));
    expect(ys.length, 'no boat outline to check').toBeGreaterThan(0);
    expect(Math.max(...ys), `boat reaches ${Math.max(...ys)}, controls start at ${buttonTop}`)
      .toBeLessThanOrEqual(buttonTop);
  });

  describe('the line\u2019s own colour', () => {
    const lineClasses = () => [...(svg()!.querySelector('.start-line')!.classList)];
    /** The pre-start side lies north-west of the line; the course side is over it. */
    const behind = () => aLine(0.00035, 0.00030);
    const over = () => aLine(-0.00005, 0.00030);

    it('stays plain while the boat is behind the line', () => {
      feed({ startTimePath: '2026-01-01T10:00:00Z', ttsPath: 120 });
      behind();
      expect(lineClasses()).not.toContain('ocs');
      expect(lineClasses()).not.toContain('started');
    });

    it('goes red whenever the boat is over the line', () => {
      feed({ startTimePath: '2026-01-01T10:00:00Z', ttsPath: 120 });
      over();
      expect(lineClasses()).toContain('ocs');
      // And clears again the moment the boat gets back behind it.
      behind();
      expect(lineClasses()).not.toContain('ocs');
    });

    it('goes red with no countdown running at all: being over is a fact, not a phase', () => {
      over();
      expect(lineClasses()).toContain('ocs');
    });

    /**
     * The plugin (signalk-racer) leaves the start time in place at the gun and stops the
     * countdown at zero: as far as it is concerned the timer is still running until the
     * next reset or set. Crossing the line after that is just starting.
     */
    it('goes green at the gun when the boat was behind, and holds it', () => {
      feed({ startTimePath: '2026-01-01T10:00:00Z', ttsPath: 5 });
      behind();
      feed({ ttsPath: 0 });
      expect(lineClasses()).toContain('started');
      over();
      expect(lineClasses()).toContain('started');
      expect(lineClasses()).not.toContain('ocs');
    });

    /** A plugin that does clear the start time at the gun must not take the green either. */
    it('holds the green if the start time is cleared after the gun', () => {
      feed({ startTimePath: '2026-01-01T10:00:00Z', ttsPath: 5 });
      behind();
      feed({ ttsPath: 0 });
      feed({ startTimePath: null });
      expect(lineClasses()).toContain('started');
      over();
      expect(lineClasses()).toContain('started');
    });

    /**
     * After the gun the old start time is still set, so a new one set straight over it
     * never passes through null - the change itself is what arms the next countdown.
     */
    it('lets go of it when a new start time is set over the last one', () => {
      feed({ startTimePath: '2026-01-01T10:00:00Z', ttsPath: 5 });
      behind();
      feed({ ttsPath: 0 });
      expect(lineClasses()).toContain('started');
      feed({ startTimePath: '2026-01-01T10:30:00Z' });
      expect(lineClasses()).not.toContain('started');
    });

    /**
     * The new start time and the new time to start arrive on separate paths, so the start
     * time can land first with the last gun's zero still on hand - and this effect reads
     * the geometry, so the next position update would be taken for a second gun.
     */
    it('does not take the last countdown\u2019s zero for the next one\u2019s gun', () => {
      feed({ startTimePath: '2026-01-01T10:00:00Z', ttsPath: 5 });
      over();
      feed({ ttsPath: 0 });
      expect(lineClasses()).not.toContain('started');

      // Set again, straight over the old time, with the gun's zero still the latest.
      feed({ startTimePath: '2026-01-01T10:30:00Z' });
      // A fresh fix behind the line under the new countdown is not a start. It has to be
      // fresh: the per-field signals gate on the value, so refeeding the same fix changes
      // nothing and the effect would not run at all.
      aLine(0.00036, 0.00031);
      expect(lineClasses()).not.toContain('started');
      // And the real gun, once this countdown has actually run, still is.
      feed({ ttsPath: 5 });
      feed({ ttsPath: 0 });
      expect(lineClasses()).toContain('started');
    });

    /**
     * A countdown sitting at a set time is routinely adjusted before it is started. The
     * plugin changes only the time to start then, never the start time, so none of it is
     * a countdown running - let alone one reaching its gun.
     */
    it('takes no adjustment of a stopped timer for a countdown', () => {
      behind();
      feed({ startTimePath: null, ttsPath: 300 });
      feed({ ttsPath: 600 });
      feed({ ttsPath: 300 });
      aLine(0.00036, 0.00031);
      expect(lineClasses()).not.toContain('started');
    });

    /** Adjusting a running countdown moves its start time; its gun still counts. */
    it('still goes green at the gun of a countdown adjusted while running', () => {
      feed({ startTimePath: '2026-01-01T10:00:00Z', ttsPath: 120 });
      behind();
      feed({ startTimePath: '2026-01-01T10:01:00Z', ttsPath: 180 });
      feed({ ttsPath: 1 });
      feed({ ttsPath: 0 });
      expect(lineClasses()).toContain('started');
    });

    /**
     * The countdown stays at zero with the start time set, so a boat over the line at the
     * gun is judged again on each fix after, and goes green once it is back behind.
     */
    it('goes green once a boat over at the gun gets back behind the line', () => {
      feed({ startTimePath: '2026-01-01T10:00:00Z', ttsPath: 5 });
      over();
      feed({ ttsPath: 0 });
      expect(lineClasses()).toContain('ocs');
      behind();
      expect(lineClasses()).toContain('started');
    });

    /**
     * The position takes the stale-data TTL, so a fix that goes quiet just before the gun
     * arrives there as null. The start is judged from where the boat was last seen.
     */
    it('judges the gun from the last fix when the position has just timed out', () => {
      feed({ startTimePath: '2026-01-01T10:00:00Z', ttsPath: 5 });
      behind();
      feed({ positionPath: null });
      feed({ ttsPath: 0 });
      expect(lineClasses()).toContain('started');
    });

    it('does not judge the gun from a fix lost long before it', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        feed({ startTimePath: '2026-01-01T10:00:00Z', ttsPath: 60 });
        behind();
        feed({ positionPath: null });
        vi.advanceTimersByTime(60_000);
        feed({ ttsPath: 0 });
        expect(lineClasses()).not.toContain('started');
      } finally {
        vi.useRealTimers();
      }
    });

    it('stays red rather than going green when the boat was over at the gun', () => {
      feed({ startTimePath: '2026-01-01T10:00:00Z', ttsPath: 5 });
      over();
      feed({ ttsPath: 0 });
      expect(lineClasses()).not.toContain('started');
      expect(lineClasses()).toContain('ocs');
    });

    it('goes plain again when the timer is reset', () => {
      feed({ startTimePath: '2026-01-01T10:00:00Z', ttsPath: 5 });
      behind();
      feed({ ttsPath: 0 });
      expect(lineClasses()).toContain('started');
      // A reset nulls startTime and re-seeds the countdown.
      feed({ startTimePath: null, ttsPath: 300 });
      expect(lineClasses()).not.toContain('started');
      expect(lineClasses()).not.toContain('ocs');
      // And with the latch gone, being over the line reads red again.
      over();
      expect(lineClasses()).toContain('ocs');
    });
  });

  it('draws the boat as one solid hull scaled to the vessel length', () => {
    aLine(0.00035, 0.00030);
    const boat = svg()!.querySelector('.boat')!;
    const d = boat.getAttribute('d') ?? '';
    // One closed outline, not the two nested ones the even-odd band needed.
    expect(d.match(/Z/g) ?? [], 'more than one hull outline').toHaveLength(1);
    expect(getComputedStyle(boat).fillRule).not.toBe('evenodd');
  });

  it('marks the first leg of a two-leg approach so the pair reads in order', () => {
    // Outside the wedge: the approach turns a corner, so there are two legs.
    aLine(0.00120, 0.00300);
    const legs = [...svg()!.querySelectorAll('.dimension')];
    expect(legs.length, 'expected a two-leg approach').toBe(2);
    expect(legs[0].classList.contains('leading')).toBe(true);
    expect(legs[1].classList.contains('leading')).toBe(false);
  });

  it('flags the boat as OCS only when it is on the course side', () => {
    // The line bears 070, so the pre-start side lies to its north-west: 25m clear of it here.
    aLine(0.00035, 0.00030);
    expect(svg()?.querySelector('.boat')?.classList.contains('ocs')).toBe(false);
    // Across to the course side, 17m over.
    aLine(-0.00005, 0.00030);
    expect(svg()?.querySelector('.boat')?.classList.contains('ocs')).toBe(true);
  });

  it('shows the wind against the line only once a direction is known', () => {
    aLine(-0.00005, 0.00030);
    expect(svg()?.querySelector('.wind-arrow')).toBeNull();
    feed({ twdPath: 0.6 });
    expect(svg()?.querySelector('.wind-arrow')).toBeTruthy();
  });

  it('offers one control while watching, and it is the screen button', () => {
    aLine(-0.00005, 0.00030);
    const controls = [...svg()!.querySelectorAll('.control')];
    expect(controls).toHaveLength(1);
    expect(controls[0].getAttribute('aria-label')).toContain('Next screen');
  });

  /** Every control is an SVG group carrying its own aria-label. */
  const controls = () => [...svg()!.querySelectorAll<SVGElement>('.control')];
  const control = (label: string) =>
    controls().find(c => (c.getAttribute('aria-label') ?? '').includes(label));
  /** A control carrying a word, found by that word rather than by its description. */
  const pressWord = (word: string) => {
    const c = controls().find(x => x.querySelector('text')?.textContent?.trim() === word);
    expect(c, `no control labelled ${word}`).toBeTruthy();
    c!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
  };
  const press = (label: string) => {
    const c = control(label);
    expect(c, `no control matching ${label}`).toBeTruthy();
    c!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
  };
  const mode = () => (fixture.componentInstance as unknown as
    { mode: { (): number; set: (v: number) => void } }).mode();

  const setMode = (m: 0 | 1 | 2 | 3) => {
    (fixture.componentInstance as unknown as { mode: { set: (v: number) => void } })
      .mode.set(m);
    fixture.detectChanges();
  };
  const setEditing = (on: boolean) => setMode(on ? 1 : 0);

  describe('edit mode', () => {
    it('offers no end targets until editing', () => {
      aLine(0.00035, 0.00030);
      expect(svg()?.querySelectorAll('.end-target')).toHaveLength(0);
    });

    it('cycles watch, set ends, adjust ends, adjust VMGs and back on the one button', () => {
      aLine(0.00035, 0.00030);
      expect(mode()).toBe(0);
      press('Next screen');
      expect(mode()).toBe(1);
      expect(svg()?.querySelectorAll('.end-target')).toHaveLength(2);
      press('Next screen');
      expect(mode()).toBe(2);
      expect(svg()?.querySelectorAll('.end-target')).toHaveLength(0);
      expect(control('Lengthen the line'), 'no adjust controls').toBeTruthy();
      press('Next screen');
      expect(mode()).toBe(3);
      expect(svg()?.querySelector('.vmg-caption'), 'no VMG pad').toBeTruthy();
      press('Next screen');
      expect(mode()).toBe(0);
    });

    describe('the best-VMG pad', () => {
      const openPad = () => { aLine(0.00035, 0.00030); setMode(3); };
      const values = () => [...svg()!.querySelectorAll('.vmg-value')];
      const texts = () => values().map(v => v.querySelector('text')?.textContent?.trim());

      it('still draws the line and its label, for orientation', () => {
        openPad();
        expect(svg()?.querySelector('.start-line')).toBeTruthy();
        expect(svg()?.querySelector('.line-label')).toBeTruthy();
      });

      it('lays the four VMGs around the arrow, matching the drawing above them', () => {
        openPad();
        feed({
          vmgToCourseSidePath: 3.1, vmgFromCourseSidePath: 3.2,
          vmgToPortEndPath: 2.7, vmgToStbEndPath: 2.5
        });
        const laid = values().map(v => {
          const t = v.querySelector('text')!;
          return { x: Number(t.getAttribute('x')), y: Number(t.getAttribute('y')),
            text: t.textContent?.trim() };
        });
        expect(laid.map(v => v.text)).toEqual(['3.1', '2.7', '2.5', '3.2']);
        const [course, port, stb, from] = laid;
        expect(course.y).toBeLessThan(from.y);
        expect(port.x).toBeLessThan(stb.x);
        expect(svg()?.querySelector('.vmg-compass'), 'no four-way arrow').toBeTruthy();
        expect(svg()?.querySelector('.vmg-caption')?.textContent).toContain('knots');
      });

      it('shows a VMG it has not got yet as blank rather than zero', () => {
        openPad();
        expect(texts()).toEqual(['--', '--', '--', '--']);
      });

      /** Nothing to press among the readings: the controls are all in the bottom row. */
      it('puts no controls in the reading itself', () => {
        openPad();
        const inPad = controls().filter(c => {
          const r = c.querySelector('rect')!;
          return Number(r.getAttribute('y')) < 200;
        });
        expect(inPad).toHaveLength(0);
      });

    it('offers Reset, VMG and Clear beside the screen button until one is chosen', () => {
        openPad();
        expect(control('Clear every manual VMG adjustment'), 'no Reset').toBeTruthy();
        expect(control('Choose a best VMG to adjust'), 'no VMG').toBeTruthy();
        expect(control('Throw away the collected VMG samples'), 'no Clear').toBeTruthy();
        expect(control('Increase the best VMG'), 'adjust buttons before a choice').toBeFalsy();
        expect(values().some(v => v.classList.contains('selected'))).toBe(false);
      });

      /**
       * Clear and the adjust pair share the space after the VMG button: throwing away
       * every sample is not something to have under the thumb while stepping one VMG.
       */
      it('swaps Clear for the adjust buttons once a VMG is chosen', () => {
        openPad();
        pressWord('VMG');
        expect(control('Throw away the collected VMG samples'), 'Clear while adjusting').toBeFalsy();
        expect(control('Increase the best VMG')).toBeTruthy();
        // Round to no selection, and it comes back.
        for (let i = 0; i < 4; i++) pressWord('VMG');
        expect(control('Throw away the collected VMG samples')).toBeTruthy();
      });

      it('clears the collected samples, which is not what Reset does', () => {
        openPad();
        pressWord('Clear');
        expect(requestsMock.putRequest).toHaveBeenCalledWith(
          'navigation.racing.setBestVmg', { command: 'clear' }, 'racer-line-view-test');
      });

      it('steps the highlight through the four and back off, the buttons following it', () => {
        openPad();
        const selected = () => values().findIndex(v => v.classList.contains('selected'));
        for (const expected of [0, 1, 2, 3]) {
          pressWord('VMG');
          expect(selected(), `expected the ${expected} value highlighted`).toBe(expected);
          expect(control('Increase the best VMG'), 'no adjust buttons').toBeTruthy();
        }
        pressWord('VMG');
        expect(selected()).toBe(-1);
        expect(control('Increase the best VMG'), 'adjust buttons with nothing chosen').toBeFalsy();
      });

      /**
       * A tenth of a knot per press, as the plugin's own webapp uses, sent as the metres
       * per second the plugin works in - and applied to whichever VMG is highlighted.
       */
      it('adjusts the highlighted VMG by a tenth of the shown unit', () => {
        openPad();
        pressWord('VMG');
        pressWord('VMG');
        press('Increase the best VMG');
        expect(requestsMock.putRequest).toHaveBeenCalledTimes(1);
        expect(requestsMock.putRequest.mock.calls[0][0]).toBe('navigation.racing.setBestVmg');
        const args = requestsMock.putRequest.mock.calls[0][1] as { vmg: string; delta: number };
        expect(args.vmg).toBe('toPortEnd');
        // The units mock converts one for one, so a tenth stays a tenth here.
        expect(args.delta).toBeCloseTo(0.1, 6);

        requestsMock.putRequest.mockClear();
        press('Reduce the best VMG');
        expect((requestsMock.putRequest.mock.calls[0][1] as { delta: number }).delta)
          .toBeCloseTo(-0.1, 6);
      });

      it('resets every override at once', () => {
        openPad();
        pressWord('Reset');
        expect(requestsMock.putRequest).toHaveBeenCalledWith(
          'navigation.racing.setBestVmg', { command: 'reset' }, 'racer-line-view-test');
      });

      /**
       * The drawing at a given viewBox width. jsdom lays nothing out, so the width the
       * ResizeObserver would set is set here instead — and narrow is where a row of five
       * controls has to give way rather than run off the edge.
       */
      const atWidth = (w: number) => {
        const view = fixture.debugElement.query(By.directive(RacerLineViewComponent))
          .componentInstance as { vbWidth: { set: (v: number) => void } };
        view.vbWidth.set(w);
        fixture.detectChanges();
      };

      it.each([[400], [260], [200], [160]])(
        'fits the whole control row inside a %ipx drawing', (w) => {
        openPad();
        atWidth(w);
        // Both shapes of the row: Clear with nothing chosen, the adjust pair with one.
        checkRow(w, 'screen, reset, vmg, clear');
        pressWord('VMG');
        checkRow(w, 'screen, reset, vmg, minus, plus');
      });

      const checkRow = (w: number, what: string) => {
        const boxes = controls().map(c => {
          const r = c.querySelector('rect')!;
          return {
            label: c.getAttribute('aria-label') ?? '',
            x: Number(r.getAttribute('x')), w: Number(r.getAttribute('width')),
            y: Number(r.getAttribute('y')), h: Number(r.getAttribute('height'))
          };
        });
        expect(boxes.length, what).toBe(what.split(',').length);
        for (const b of boxes) {
          expect(b.x, `${b.label} runs off the left`).toBeGreaterThanOrEqual(-0.5);
          expect(b.x + b.w, `${b.label} runs off the right`).toBeLessThanOrEqual(w + 0.5);
        }
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i], b = boxes[j];
            const hit = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
            expect(hit, `${a.label} overlaps ${b.label}`).toBe(false);
          }
        }
      };

      it('keeps the top reading clear of the line above it', () => {
        openPad();
        const lineY = Number(svg()!.querySelector('.start-line')!.getAttribute('y1'));
        const tops = values().map(v => {
          const t = v.querySelector('text')!;
          return Number(t.getAttribute('y')) - Number(t.getAttribute('font-size')) * 0.8;
        });
        expect(Math.min(...tops), 'a reading climbed into the line').toBeGreaterThan(lineY);
      });

      it('drops the selection on leaving the screen', () => {
        openPad();
        pressWord('VMG');
        press('Next screen');
        setMode(3);
        expect(values().some(v => v.classList.contains('selected'))).toBe(false);
      });
    });

    /**
     * At the line itself the label is written over by the pair of shorten buttons, which
     * reach much further in than the rotate buttons above and below.
     */
    it('lifts the length label clear of the adjust buttons', () => {
      aLine(0.00035, 0.00030);
      setMode(2);
      const label = svg()!.querySelector('.line-label')!;
      const labelY = Number(label.getAttribute('y'));
      const font = Number(label.getAttribute('font-size'));
      const width = (label.textContent ?? '').length * font * 0.51;
      const labelX = Number(label.getAttribute('x'));
      const box = { top: labelY - font * 0.8, bottom: labelY + font * 0.25,
        left: labelX - width / 2, right: labelX + width / 2 };

      for (const c of controls()) {
        if (!/Lengthen|Shorten|Rotate/.test(c.getAttribute('aria-label') ?? '')) continue;
        const r = c.querySelector('rect')!;
        const x = Number(r.getAttribute('x')), y = Number(r.getAttribute('y'));
        const w = Number(r.getAttribute('width')), h = Number(r.getAttribute('height'));
        const overlaps = x < box.right && x + w > box.left
          && y < box.bottom && y + h > box.top;
        expect(overlaps, `${c.getAttribute('aria-label')} overlaps the label`).toBe(false);
      }
    });

    it('adjusts the end the button sits beside, and only that end', () => {
      aLine(0.00035, 0.00030);
      setMode(2);
      press('Lengthen the line by 5m at the port (pin) end');
      expect(requestsMock.putRequest).toHaveBeenCalledTimes(1);
      expect(requestsMock.putRequest.mock.calls[0][0]).toBe('navigation.racing.setStartLine');
      expect(requestsMock.putRequest.mock.calls[0][1])
        .toEqual({ end: 'port', delta: 5, rotate: null });
    });

    it('rotates the two ends in opposite senses, an end moving up being one way round', () => {
      aLine(0.00035, 0.00030);
      setMode(2);
      press('Rotate the line by moving the port (pin) end up');
      press('Rotate the line by moving the starboard (boat) end up');
      const [port, stb] = requestsMock.putRequest.mock.calls.map(c => c[1] as { rotate: number });
      expect(port.rotate).toBeGreaterThan(0);
      expect(stb.rotate).toBeLessThan(0);
    });

    it('hides its controls behind the drag overlay while the dashboard is unlocked', () => {
      aLine(0.00035, 0.00030);
      expect(host().querySelector('.widgetOverlay')).toBeNull();
      dashboardMock.isDashboardStatic.set(false);
      fixture.detectChanges();
      expect(host().querySelector('.widgetOverlay')).toBeTruthy();
      dashboardMock.isDashboardStatic.set(true);
      fixture.detectChanges();
    });

    /**
     * The case edit mode exists for: no line yet, so there is nothing to draw and nothing
     * to press. It still has to offer both ends, or the ends can never be set.
     */
    it('draws a line to press when none is set, with both ends greyed', () => {
      setEditing(true);
      expect(svg()?.textContent).not.toContain('No start line set');
      expect(svg()?.querySelector('.start-line')).toBeTruthy();
      expect(svg()?.querySelectorAll('.end-target')).toHaveLength(2);
      expect(svg()?.querySelector('.port-mark.undefined')).toBeTruthy();
      expect(svg()?.querySelector('.stb-mark.undefined')).toBeTruthy();
    });

    it('sets an end from that placeholder like any other', () => {
      setEditing(true);
      svg()!.querySelector<SVGElement>('.end-target.stb')!.dispatchEvent(
        new MouseEvent('click', { bubbles: true }));
      expect(requestsMock.putRequest).toHaveBeenCalledWith(
        'navigation.racing.setStartLine', { end: 'stb', position: 'bow' },
        'racer-line-view-test');
    });

    it('still draws nothing but the empty state when only watching', () => {
      expect(svg()?.textContent).toContain('No start line set');
      expect(svg()?.querySelector('.start-line')).toBeNull();
    });

    it('stops greying the ends once the line resolves', () => {
      setEditing(true);
      aLine(0.00035, 0.00030);
      expect(svg()?.querySelector('.port-mark.undefined')).toBeNull();
      expect(svg()?.querySelector('.stb-mark.undefined')).toBeNull();
    });

    it('puts a target on each end, larger than the mark it covers', () => {
      aLine(0.00035, 0.00030);
      setEditing(true);
      const targets = [...svg()!.querySelectorAll('.end-target')];
      expect(targets).toHaveLength(2);
      const pinRadius = Number(svg()!.querySelector('.port-mark')!.getAttribute('r'));
      for (const t of targets) {
        // Square like every other control, and wider than the mark under it.
        expect(t.tagName.toLowerCase()).toBe('rect');
        expect(Number(t.getAttribute('width'))).toBe(Number(t.getAttribute('height')));
        expect(Number(t.getAttribute('width'))).toBeGreaterThan(pinRadius * 2);
      }
    });

    it('drops the boat and its approach so only the line is in play', () => {
      aLine(0.00035, 0.00030);
      feed({ twdPath: 0.6 });
      expect(svg()?.querySelector('.boat')).toBeTruthy();
      setEditing(true);
      expect(svg()?.querySelector('.boat')).toBeNull();
      expect(svg()?.querySelector('.dimension')).toBeNull();
      expect(svg()?.querySelector('.wind-arrow')).toBeNull();
      expect(svg()?.querySelector('.start-line')).toBeTruthy();
    });

    it('sets the end that was pressed, and only that end', () => {
      aLine(0.00035, 0.00030);
      setEditing(true);
      svg()!.querySelector<SVGElement>('.end-target.port')!.dispatchEvent(
        new MouseEvent('click', { bubbles: true }));
      expect(requestsMock.putRequest).toHaveBeenCalledTimes(1);
      expect(requestsMock.putRequest.mock.calls[0][0]).toBe('navigation.racing.setStartLine');
      expect(requestsMock.putRequest.mock.calls[0][1]).toEqual({ end: 'port', position: 'bow' });
    });

    /**
     * The line in use is a label and any other is a button, so the control says whether
     * pressing it will do anything.
     */
    it('browses the named lines, showing the one in use as a label', () => {
      aLine(0.00035, 0.00030);
      // The directive extracts the sub-field before the callback, so a test feeds the
      // extracted value — the whole navigation.racing.lines object never reaches here.
      feeds.get('linesPath')?.({ data: { value: [{ startLineName: 'Race 1' }, { startLineName: 'Race 2' }] } });
      feeds.get('startLineNamePath')?.({ data: { value: 'Race 2' } });
      setMode(1);
      expect(svg()?.querySelector('.name-label')?.textContent?.trim()).toBe('Race 2');
      expect(control('Use the'), 'the line in use offered itself as a button').toBeFalsy();

      press('Show the next named line');
      expect(svg()?.querySelector('.name-label')).toBeNull();
      expect(control('Use the Default line'), 'no button for the browsed line').toBeTruthy();
    });

    it('selects the browsed line, and shows it as the current one at once', () => {
      aLine(0.00035, 0.00030);
      feeds.get('linesPath')?.({ data: { value: [{ startLineName: 'Race 1' }] } });
      feeds.get('startLineNamePath')?.({ data: { value: 'Race 1' } });
      setMode(1);
      press('Show the next named line');
      press('Use the Default line');
      expect(requestsMock.putRequest).toHaveBeenCalledWith(
        'navigation.racing.setStartLineName', { startLineName: null }, 'racer-line-view-test');
      // Default is a cleared name, not the literal word, and the control is now a label.
      expect(svg()?.querySelector('.name-label')?.textContent?.trim()).toBe('Default');
    });

    /**
     * The plugin only republishes the line when it changes, so a switch it refuses would
     * leave the chosen name showing over the old line for good.
     */
    it('takes the name back when the plugin refuses the switch', () => {
      aLine(0.00035, 0.00030);
      feeds.get('linesPath')?.({ data: { value: [{ startLineName: 'Race 1' }] } });
      feeds.get('startLineNamePath')?.({ data: { value: 'Race 1' } });
      setMode(1);
      press('Show the next named line');
      press('Use the Default line');
      expect(svg()?.querySelector('.name-label')?.textContent?.trim()).toBe('Default');

      requestResults.next({ requestId: 'req-1', state: 'COMPLETED', statusCode: 400,
        widgetUUID: 'racer-line-view-test' });
      fixture.detectChanges();
      expect(control('Use the Default line'), 'the refused line still reads as current').toBeTruthy();
      press('Show the next named line');
      expect(svg()?.querySelector('.name-label')?.textContent?.trim()).toBe('Race 1');
    });

    it('keeps the name when the plugin accepts the switch', () => {
      aLine(0.00035, 0.00030);
      feeds.get('linesPath')?.({ data: { value: [{ startLineName: 'Race 1' }] } });
      feeds.get('startLineNamePath')?.({ data: { value: 'Race 1' } });
      setMode(1);
      press('Show the next named line');
      press('Use the Default line');
      requestResults.next({ requestId: 'req-1', state: 'COMPLETED', statusCode: 200,
        widgetUUID: 'racer-line-view-test' });
      fixture.detectChanges();
      expect(svg()?.querySelector('.name-label')?.textContent?.trim()).toBe('Default');
    });

    it('lets the stream win over a refusal that arrives after it', () => {
      aLine(0.00035, 0.00030);
      feeds.get('linesPath')?.({ data: { value: [{ startLineName: 'Race 1' }, { startLineName: 'Race 2' }] } });
      feeds.get('startLineNamePath')?.({ data: { value: 'Race 1' } });
      setMode(1);
      press('Show the next named line');
      press('Use the Race 2 line');
      // Someone else's switch lands first; the refusal of ours must not undo it.
      feeds.get('startLineNamePath')?.({ data: { value: null } });
      requestResults.next({ requestId: 'req-1', state: 'COMPLETED', statusCode: 400,
        widgetUUID: 'racer-line-view-test' });
      fixture.detectChanges();
      // Browsed round to Default, it reads as the line in use: the stream's, not undone.
      press('Show the next named line');
      expect(svg()?.querySelector('.name-label')?.textContent?.trim()).toBe('Default');
    });

    /**
     * The row is sized for the longest name there is, so the buttons either side of it
     * stay where they are as you step through — otherwise they walk out from under the
     * finger pressing them.
     */
    it('holds the prev and next buttons still while browsing', () => {
      aLine(0.00035, 0.00030);
      feeds.get('linesPath')?.({
        data: { value: [{ startLineName: 'A' }, { startLineName: 'A very long line name indeed' }] }
      });
      setMode(1);
      const at = () => controls()
        .filter(c => (c.getAttribute('aria-label') ?? '').includes('named line'))
        .map(c => c.querySelector('rect')!.getAttribute('x'));
      const before = at();
      expect(before).toHaveLength(2);
      press('Show the next named line');
      expect(at()).toEqual(before);
      press('Show the next named line');
      expect(at()).toEqual(before);
    });

    it('keeps the picker no wider than the line, truncating a name that will not fit', () => {
      aLine(0.00035, 0.00030);
      feeds.get('linesPath')?.({
        data: { value: [{ startLineName: 'An absurdly long start line name that cannot possibly fit' }] }
      });
      setMode(1);
      press('Show the next named line');
      const button = controls().find(c => (c.getAttribute('aria-label') ?? '').startsWith('Use the'))!;
      const lineWidth = Math.abs(
        Number(svg()!.querySelector('.start-line')!.getAttribute('x2'))
        - Number(svg()!.querySelector('.start-line')!.getAttribute('x1')));
      // The picker only — not the screen button down in the corner.
      const rects = controls()
        .filter(c => /named line|^Use the/.test(c.getAttribute('aria-label') ?? ''))
        .map(c => c.querySelector('rect')!);
      expect(rects).toHaveLength(3);
      const left = Math.min(...rects.map(r => Number(r.getAttribute('x'))));
      const right = Math.max(...rects.map(r => Number(r.getAttribute('x')) + Number(r.getAttribute('width'))));
      expect(right - left, 'the picker is wider than the line').toBeLessThanOrEqual(lineWidth + 1);
      // The name is cut, but the label still says which line it is.
      expect(button.querySelector('text')!.textContent).toContain('\u2026');
      expect(button.getAttribute('aria-label')).toBe(
        'Use the An absurdly long start line name that cannot possibly fit line');
    });

    it('wraps both ways through the list', () => {
      aLine(0.00035, 0.00030);
      feeds.get('linesPath')?.({ data: { value: [{ startLineName: 'Race 1' }] } });
      setMode(1);
      press('Show the previous named line');
      expect(control('Use the Race 1 line'), 'did not wrap backwards').toBeTruthy();
    });
  });
});
