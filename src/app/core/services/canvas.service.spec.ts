import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasService } from './canvas.service';

describe('CanvasService', () => {
  let service: CanvasService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CanvasService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('memoizes calculateOptimalFontSize and skips the measureText search on repeat calls', () => {
    let measureCalls = 0;
    const ctx = {
      font: '',
      measureText(text: string): TextMetrics {
        measureCalls++;
        const px = parseInt(this.font, 10) || 10;
        return { width: text.length * px * 0.5 } as TextMetrics;
      }
    } as unknown as CanvasRenderingContext2D;

    const first = service.calculateOptimalFontSize(ctx, '12.3', 100, 40, 'normal');
    const callsAfterFirst = measureCalls;
    expect(callsAfterFirst).toBeGreaterThan(0); // binary search ran the first time

    const second = service.calculateOptimalFontSize(ctx, '12.3', 100, 40, 'normal');
    expect(second).toBe(first);                 // identical result
    expect(measureCalls).toBe(callsAfterFirst); // cache hit: no extra measureText calls

    // A different geometry/text is a cache miss and runs the search again.
    service.calculateOptimalFontSize(ctx, '12.3', 120, 40, 'normal');
    expect(measureCalls).toBeGreaterThan(callsAfterFirst);
  });
});

/**
 * The shared ResizeObserver used to reallocate every canvas's backing store and
 * redraw it synchronously in one callback — a single long task on a fullscreen/
 * grid-relayout storm that blocks input (incl. the exit-fullscreen gesture).
 * These pin the two mitigations: skip the realloc when the size is unchanged,
 * and time-slice the batch across animation frames.
 */
describe('CanvasService resize handling (freeze-audit)', () => {
  let service: CanvasService;
  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CanvasService);
    service.scaleFactor = 1;
  });

  function fakeCanvas() {
    const c: { style: Record<string, string>; getContext: () => null; _w: number; _h: number; writes: number; width: number; height: number } =
      { style: {}, getContext: () => null, _w: 0, _h: 0, writes: 0 } as never;
    Object.defineProperty(c, 'width', { get() { return c._w; }, set(v: number) { c._w = v; c.writes++; } });
    Object.defineProperty(c, 'height', { get() { return c._h; }, set(v: number) { c._h = v; } });
    return c;
  }

  it('setHighDPISize skips the backing-store realloc when the device-pixel size is unchanged', () => {
    const c = fakeCanvas();
    const rect = { width: 100, height: 80 } as DOMRectReadOnly;
    service.setHighDPISize(c as unknown as HTMLCanvasElement, rect);
    expect(c.writes).toBe(1);
    service.setHighDPISize(c as unknown as HTMLCanvasElement, rect);
    expect(c.writes).toBe(1); // unchanged size -> no second realloc
    service.setHighDPISize(c as unknown as HTMLCanvasElement, { width: 120, height: 80 } as DOMRectReadOnly);
    expect(c.writes).toBe(2); // genuine change still reallocates
  });

  it('flushResizes time-slices: it defers the remainder to the next frame when the budget is exceeded', () => {
    const a = fakeCanvas(), b = fakeCanvas();
    const internals = service as unknown as {
      pendingResize: Map<HTMLCanvasElement, DOMRectReadOnly>;
      flushResizes: () => void;
    };
    const rect = { width: 100, height: 80 } as DOMRectReadOnly;
    internals.pendingResize.set(a as unknown as HTMLCanvasElement, rect);
    internals.pendingResize.set(b as unknown as HTMLCanvasElement, rect);

    const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 1 as unknown as number);
    let t = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (t += 100)); // each call jumps 100ms past the 8ms budget

    internals.flushResizes();

    expect(internals.pendingResize.size).toBe(1); // one processed, remainder deferred
    expect(rafSpy).toHaveBeenCalled();            // rescheduled to a later frame
    rafSpy.mockRestore();
    vi.restoreAllMocks();
  });
});

describe('CanvasService text measurement (#321 font-race)', () => {
  let service: CanvasService;
  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CanvasService);
  });

  it('measureTextWidth measures against the shorthand font and scales with text length', () => {
    // jsdom canvas shim (src/test.ts) reports measureText width = text.length * 8
    expect(service.measureTextWidth('abc', '700 14px Roboto')).toBe(24);
    expect(service.measureTextWidth('abcdef', '700 14px Roboto')).toBe(48);
  });

  it('measureTextWidth lazily creates and reuses a single offscreen context', () => {
    const createSpy = vi.spyOn(document, 'createElement');
    service.measureTextWidth('a', '14px Roboto');
    service.measureTextWidth('bb', '14px Roboto');
    const canvasCreations = createSpy.mock.calls.filter(([tag]) => tag === 'canvas').length;
    expect(canvasCreations).toBe(1); // created once on first use, reused thereafter
    createSpy.mockRestore();
  });

  it('whenFontsReady resolves', async () => {
    await expect(service.whenFontsReady()).resolves.toBeUndefined();
  });
});

/**
 * Auxiliary text (widget labels and unit symbols) is sized as a fraction of the
 * tile height and shrinks below legibility on small tiles. A pixel floor keeps it
 * readable; the fit is capped only from below, and the floor is applied on read so
 * floored and unfloored callers share one memo entry.
 */
describe('CanvasService font-size floor (label/unit legibility)', () => {
  let service: CanvasService;
  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CanvasService);
  });

  // measured width scales with font px and text length, so the binary search is deterministic.
  function fakeCtx(onMeasure?: () => void) {
    return {
      font: '',
      measureText(text: string): TextMetrics {
        onMeasure?.();
        const px = parseInt(this.font, 10) || 10;
        return { width: text.length * px * 0.5 } as TextMetrics;
      }
    } as unknown as CanvasRenderingContext2D;
  }

  it('floors the result at floorPx when the box would force a smaller size', () => {
    const ctx = fakeCtx();
    const unfloored = service.calculateOptimalFontSize(ctx, 'Label', 200, 6, 'normal');
    expect(unfloored).toBeLessThanOrEqual(6);            // height-bound to the tiny box
    const floored = service.calculateOptimalFontSize(ctx, 'Label', 200, 6, 'normal', 12);
    expect(floored).toBe(12);                            // never below the floor
  });

  it('leaves the size unchanged when the fitted size already clears the floor', () => {
    const ctx = fakeCtx();
    const fitted = service.calculateOptimalFontSize(ctx, 'X', 200, 40, 'normal');
    expect(fitted).toBeGreaterThan(12);
    expect(service.calculateOptimalFontSize(ctx, 'X', 200, 40, 'normal', 12)).toBe(fitted);
  });

  it('applies the floor on read without re-running the search (shared memo entry)', () => {
    let measureCalls = 0;
    const ctx = fakeCtx(() => { measureCalls++; });
    const unfloored = service.calculateOptimalFontSize(ctx, 'Label', 200, 6, 'normal');
    const afterSearch = measureCalls;
    const floored = service.calculateOptimalFontSize(ctx, 'Label', 200, 6, 'normal', 12);
    expect(measureCalls).toBe(afterSearch);              // cache hit: no new search
    expect(unfloored).toBeLessThan(12);
    expect(floored).toBe(12);                            // floor applied on the cached value
  });
});
