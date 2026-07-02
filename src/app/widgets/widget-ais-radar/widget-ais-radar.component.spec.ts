import { describe, expect, it } from 'vitest';
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
