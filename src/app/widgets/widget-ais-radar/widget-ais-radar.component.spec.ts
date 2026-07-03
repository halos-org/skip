import { describe, expect, it, vi, type Mock } from 'vitest';
import { WidgetAisRadarComponent } from './widget-ais-radar.component';

/**
 * Regression tests for the course-up click mapping (#115, upstream Kip #1101).
 *
 * Targets are stored NORTH-UP and the rotation group draws them rotated by
 * rotate(-viewRotation). Hit-testing must therefore map a screen click back
 * into the north-up frame by rotating it by +viewRotation. A sign error (or a
 * dropped rotation) silently selects the wrong target in course-up mode while
 * everything still renders correctly.
 *
 * Expected values are hand-derived from geometry ("a target due east appears
 * at the top of a course-up-east display"), not from the implementation.
 */
interface ClickContext {
  lastRenderSize: { width: number; height: number } | null;
  lastRenderScale: number;
  lastViewRotation: number;
  svgRef: () => { nativeElement: Pick<SVGSVGElement, 'getBoundingClientRect'> };
}

type RadarPoint = { x: number; y: number } | null;

const eventToRadarPoint = WidgetAisRadarComponent.prototype['eventToRadarPoint'] as unknown as
  (this: ClickContext, event: MouseEvent) => RadarPoint;

const makeContext = (overrides: Partial<ClickContext> = {}): ClickContext => ({
  lastRenderSize: { width: 400, height: 400 },
  lastRenderScale: 1,
  lastViewRotation: 0,
  svgRef: () => ({ nativeElement: { getBoundingClientRect: () => new DOMRect(0, 0, 400, 400) } }),
  ...overrides
});

const clickAt = (ctx: ClickContext, clientX: number, clientY: number): RadarPoint =>
  eventToRadarPoint.call(ctx, new MouseEvent('click', { clientX, clientY }));

describe('eventToRadarPoint course-up click mapping', () => {
  it('returns null before the first data render (no lastRenderSize)', () => {
    expect(clickAt(makeContext({ lastRenderSize: null }), 200, 200)).toBeNull();
  });

  it('maps clicks 1:1 in north-up mode (no rotation)', () => {
    // 100px right of the 400x400 svg center.
    expect(clickAt(makeContext(), 300, 200)).toEqual({ x: 100, y: 0 });
  });

  it('divides screen offsets by the render scale', () => {
    // 50px right of center at scale 0.5 -> 100 radar units.
    expect(clickAt(makeContext({ lastRenderScale: 0.5 }), 250, 200)).toEqual({ x: 100, y: 0 });
  });

  it('maps a top-of-screen click back to a due-east target when heading east (rotation 90)', () => {
    // Course-up east: a target due east (north-up (100, 0)) is drawn dead
    // ahead, i.e. at the top of the screen. Clicking there must select it.
    const point = clickAt(makeContext({ lastViewRotation: 90 }), 200, 100);
    expect(point).not.toBeNull();
    expect(point!.x).toBeCloseTo(100, 6);
    expect(point!.y).toBeCloseTo(0, 6);
  });

  it('maps a dead-ahead click to the target on the bow bearing (rotation 30)', () => {
    // Course 030: the target bearing 030 at range 100 (north-up
    // (100*sin30, -100*cos30) = (50, -86.6025)) is drawn dead ahead.
    const point = clickAt(makeContext({ lastViewRotation: 30 }), 200, 100);
    expect(point).not.toBeNull();
    expect(point!.x).toBeCloseTo(50, 4);
    expect(point!.y).toBeCloseTo(-100 * Math.cos(Math.PI / 6), 4);
  });
});

/**
 * Regression tests for own-ship staleness on settled frames (#124).
 *
 * Own-ship heading/COG/SOG are deliberately excluded from the render
 * signature (that is the point of the settled-frame optimization), so the
 * early return must not skip the O(1) own-ship refresh: re-orienting the
 * own-ship icon and re-rendering its motion vector. The O(targets) rebuild
 * (rings, target icons, target vectors) must still be skipped.
 *
 * render() is exercised on a hand-built context whose prototype is the real
 * component prototype: geometry/signature helpers run for real, while the
 * d3 layers and O(targets) render methods are replaced with spies.
 */
type RadarViewMode = 'north-up' | 'course-up';

interface OwnShipState {
  position?: { latitude: number; longitude: number };
  headingTrue?: number;
  courseOverGroundTrue?: number;
  speedOverGround?: number;
}

interface RenderHarness {
  render(): void;
  setViewMode(mode: RadarViewMode): void;
  setOwnShip(ownShip: OwnShipState): void;
  clearSpies(): void;
  ownShipIconAttr: Mock;
  renderOwnShipVector: Mock;
  renderRings: Mock;
  buildTargets: Mock;
  renderTargets: Mock;
  scheduleRender: Mock;
}

const renderFn = WidgetAisRadarComponent.prototype['render'] as unknown as (this: object) => void;

const makeRenderHarness = (viewMode: RadarViewMode, ownShip: OwnShipState): RenderHarness => {
  let currentViewMode = viewMode;
  const ownShipIconAttr = vi.fn();
  const renderOwnShipVector = vi.fn();
  const renderRings = vi.fn();
  const buildTargets = vi.fn(() => []);
  const renderTargets = vi.fn();
  const scheduleRender = vi.fn();

  const renderState = {
    size: { width: 400, height: 400 },
    cfg: {
      color: 'grey',
      ais: {
        rangeRings: [3, 6, 12, 24, 48],
        rangeIndex: '0',
        showSelf: true,
        showCogVectors: true,
        cogVectorsMinutes: 10,
        showLostTargets: true,
        showUnconfirmedTargets: true
      }
    },
    theme: {},
    targets: [],
    ownShip
  };

  const ctx = Object.create(WidgetAisRadarComponent.prototype) as Record<string, unknown>;
  Object.assign(ctx, {
    renderState,
    svg: { attr: vi.fn() },
    root: { attr: vi.fn() },
    rotationGroup: { attr: vi.fn() },
    ownShipLayer: { select: () => ({ attr: ownShipIconAttr }) },
    viewRotationSmoothed: null,
    lastRotationAt: null,
    lastViewRotation: 0,
    hasRenderedOnce: false,
    lastRenderSignature: null,
    ringCache: null,
    effectiveRangeIndex: () => 0,
    localViewMode: () => currentViewMode,
    selectedId: () => null,
    filterState: () => ({
      anchoredMoored: false,
      noCollisionRisk: false,
      allAton: false,
      allButSar: false,
      allVessels: false,
      vesselTypes: new Set<string>()
    }),
    // Headings below are authored in degrees; identity conversion keeps them.
    units: { convertToUnit: (unit: string, value: number) => value },
    renderRings,
    buildTargets,
    renderTargetVectors: vi.fn(),
    renderTargets,
    renderSelected: vi.fn(),
    renderOwnShipVector,
    raiseOwnshipAndVector: vi.fn(),
    scheduleRender
  });

  return {
    render: () => renderFn.call(ctx),
    setViewMode: mode => { currentViewMode = mode; },
    setOwnShip: next => { ctx['renderState'] = { ...renderState, ownShip: next }; },
    clearSpies: () => {
      ownShipIconAttr.mockClear();
      renderOwnShipVector.mockClear();
      renderRings.mockClear();
      buildTargets.mockClear();
      renderTargets.mockClear();
      scheduleRender.mockClear();
    },
    ownShipIconAttr,
    renderOwnShipVector,
    renderRings,
    buildTargets,
    renderTargets,
    scheduleRender
  };
};

const position = { latitude: 60.1, longitude: 24.9 };

describe('render() own-ship refresh on settled frames (#124)', () => {
  it('re-orients own-ship in north-up after a course-up stint left a near-zero smoothed rotation', () => {
    // Course-up stint near north settles the smoothed rotation at 0.3 deg.
    const harness = makeRenderHarness('course-up', { position, headingTrue: 0.3, courseOverGroundTrue: 0.3, speedOverGround: 5 });
    harness.render();

    // Switching to north-up is a data change: a full render, but north-up
    // pins the target rotation to 0 and never updates the smoothed value.
    harness.setViewMode('north-up');
    harness.render();

    // Heading/COG-only change with bit-identical position and targets:
    // the smoothed rotation still reads settled (0.3 deg within 0.5 of 0).
    harness.clearSpies();
    harness.setOwnShip({ position, headingTrue: 90, courseOverGroundTrue: 90, speedOverGround: 5 });
    harness.render();

    expect(harness.ownShipIconAttr).toHaveBeenCalledWith('transform', 'rotate(90)');
    expect(harness.renderOwnShipVector).toHaveBeenCalledTimes(1);
    // Pins that this stays a settled frame: adding heading/COG to the render
    // signature would silently defeat the O(targets) skip for a streaming
    // compass.
    expect(harness.buildTargets).not.toHaveBeenCalled();
  });

  it('re-renders the own-ship vector on a SOG-only change in settled course-up', () => {
    const harness = makeRenderHarness('course-up', { position, headingTrue: 45, courseOverGroundTrue: 45, speedOverGround: 5 });
    harness.render();

    harness.clearSpies();
    harness.setOwnShip({ position, headingTrue: 45, courseOverGroundTrue: 45, speedOverGround: 7.5 });
    harness.render();

    expect(harness.renderOwnShipVector).toHaveBeenCalledTimes(1);
    const [vectorOwnShip, , , viewRotation] = harness.renderOwnShipVector.mock.calls[0];
    expect(vectorOwnShip).toMatchObject({ speedOverGround: 7.5 });
    expect(viewRotation).toBeCloseTo(45, 6);
  });

  it('keeps skipping the O(targets) rebuild and does not reschedule on settled frames', () => {
    const harness = makeRenderHarness('course-up', { position, headingTrue: 45, courseOverGroundTrue: 45, speedOverGround: 5 });
    harness.render();

    harness.clearSpies();
    harness.setOwnShip({ position, headingTrue: 45, courseOverGroundTrue: 45, speedOverGround: 7.5 });
    harness.render();

    expect(harness.renderRings).not.toHaveBeenCalled();
    expect(harness.buildTargets).not.toHaveBeenCalled();
    expect(harness.renderTargets).not.toHaveBeenCalled();
    expect(harness.scheduleRender).not.toHaveBeenCalled();
  });
});
