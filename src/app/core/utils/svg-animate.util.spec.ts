import { afterEach, describe, expect, it, vi } from 'vitest';
import { animateAngleTransition, animateProgress, animateRotation, animateSectorTransition, effectiveAnimationDuration } from './svg-animate.util';
import { DEFAULT_WIDGET_UPDATE_INTERVAL_MS } from '../interfaces/widgets-interface';

describe('effectiveAnimationDuration', () => {
  it('returns the update interval unchanged when it is below the cap', () => {
    expect(effectiveAnimationDuration(100)).toBe(100);
    expect(effectiveAnimationDuration(500)).toBe(500);
  });

  it('caps the duration at the default update interval', () => {
    expect(effectiveAnimationDuration(DEFAULT_WIDGET_UPDATE_INTERVAL_MS + 1)).toBe(DEFAULT_WIDGET_UPDATE_INTERVAL_MS);
    expect(effectiveAnimationDuration(5000)).toBe(DEFAULT_WIDGET_UPDATE_INTERVAL_MS);
  });

  it('returns the cap at exactly the default interval', () => {
    expect(effectiveAnimationDuration(DEFAULT_WIDGET_UPDATE_INTERVAL_MS)).toBe(DEFAULT_WIDGET_UPDATE_INTERVAL_MS);
  });

  it('never animates longer than one update interval, so a tween completes within the sample period', () => {
    for (const interval of [50, 100, 200, 333, 500, 750, 1000, 1500, 3000]) {
      expect(effectiveAnimationDuration(interval)).toBeLessThanOrEqual(interval);
    }
  });

  it('is monotonic non-decreasing in the update interval (smaller cadence never yields more motion)', () => {
    const intervals = [50, 100, 200, 333, 500, 750, 1000, 1500, 3000];
    let previous = -Infinity;
    for (const interval of intervals) {
      const duration = effectiveAnimationDuration(interval);
      expect(duration).toBeGreaterThanOrEqual(previous);
      previous = duration;
    }
  });

  it('falls back to the default for non-positive or non-finite input', () => {
    expect(effectiveAnimationDuration(0)).toBe(DEFAULT_WIDGET_UPDATE_INTERVAL_MS);
    expect(effectiveAnimationDuration(-100)).toBe(DEFAULT_WIDGET_UPDATE_INTERVAL_MS);
    expect(effectiveAnimationDuration(Number.NaN)).toBe(DEFAULT_WIDGET_UPDATE_INTERVAL_MS);
    expect(effectiveAnimationDuration(Number.POSITIVE_INFINITY)).toBe(DEFAULT_WIDGET_UPDATE_INTERVAL_MS);
  });

  it('coerces string and undefined updateInterval from a persisted config', () => {
    expect(effectiveAnimationDuration(undefined)).toBe(DEFAULT_WIDGET_UPDATE_INTERVAL_MS);
    expect(effectiveAnimationDuration('500' as unknown as number)).toBe(500);
    expect(effectiveAnimationDuration('5000' as unknown as number)).toBe(DEFAULT_WIDGET_UPDATE_INTERVAL_MS);
    expect(effectiveAnimationDuration('abc' as unknown as number)).toBe(DEFAULT_WIDGET_UPDATE_INTERVAL_MS);
  });
});

describe('animateRotation interpolation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('interpolates linearly between angles, not with an ease curve', () => {
    let transform: string | null = null;
    const el = {
      getAttribute: (name: string) => (name === 'transform' ? transform : null),
      setAttribute: (name: string, value: string) => { if (name === 'transform') transform = value; }
    } as unknown as SVGGElement;

    const frames: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(cb => { frames.push(cb); return 1; });
    vi.spyOn(performance, 'now').mockReturnValue(1000);

    animateRotation(el, 0, 100, 1000);
    expect(frames.length).toBeGreaterThan(0);

    frames[0](1250); // 25% through a 1000ms tween

    // Linear: 0 + 100 * 0.25 = 25. An ease-in-out-cubic curve would give 6.25.
    expect(transform).toBe('rotate(25 500 500)');
  });
});

describe('animateProgress', () => {
  afterEach(() => vi.restoreAllMocks());

  const frameQueue = () => {
    const pending = new Map<number, FrameRequestCallback>();
    let nextId = 1;
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(cb => { pending.set(nextId, cb); return nextId++; });
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(id => { pending.delete(id); });
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    return {
      run(now: number) {
        const callbacks = [...pending.values()];
        pending.clear();
        callbacks.forEach(cb => cb(now));
      },
      get size() { return pending.size; }
    };
  };

  it('reports linear progress each frame and stops at 1', () => {
    const frames = frameQueue();
    const seen: number[] = [];
    animateProgress(1000, t => seen.push(t));

    frames.run(1250);
    frames.run(1500);
    frames.run(2400);
    expect(seen).toEqual([0.25, 0.5, 1]);
    expect(frames.size).toBe(0);
  });

  it('cancels whichever frame is pending, not only the first', () => {
    const frames = frameQueue();
    const seen: number[] = [];
    const cancel = animateProgress(1000, t => seen.push(t));

    frames.run(1250);
    cancel();
    frames.run(1500);
    expect(seen).toEqual([0.25]);
    expect(frames.size).toBe(0);
  });
});

describe('angle and sector transitions', () => {
  afterEach(() => vi.restoreAllMocks());

  const frameQueue = () => {
    const pending = new Map<number, FrameRequestCallback>();
    let nextId = 1;
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(cb => { pending.set(nextId, cb); return nextId++; });
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(id => { pending.delete(id); });
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    return {
      run(now: number) {
        const callbacks = [...pending.values()];
        pending.clear();
        callbacks.forEach(cb => cb(now));
      },
      get size() { return pending.size; }
    };
  };

  it('eases an angle along the shorter arc and stops once cancelled, after any number of frames', () => {
    const frames = frameQueue();
    const seen: number[] = [];
    const done = vi.fn();
    const cancel = animateAngleTransition(350, 10, 1000, angle => seen.push(angle), done);

    frames.run(1250);
    frames.run(1500);
    cancel();
    frames.run(1750);
    expect(seen).toEqual([355, 0]);
    expect(frames.size).toBe(0);
    expect(done).not.toHaveBeenCalled();
  });

  it('calls onDone when an angle transition completes', () => {
    const frames = frameQueue();
    const done = vi.fn();
    animateAngleTransition(0, 90, 1000, () => undefined, done);
    frames.run(2500);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('interpolates a sector and stops once cancelled after its first frame', () => {
    const frames = frameQueue();
    const seen: number[] = [];
    const cancel = animateSectorTransition({ min: 0, mid: 10, max: 20 }, { min: 40, mid: 50, max: 60 }, 1000, sector => seen.push(sector.mid));

    frames.run(1500);
    cancel();
    frames.run(2000);
    expect(seen).toEqual([30]);
    expect(frames.size).toBe(0);
  });
});
