import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { SvgSimpleLinearGaugeComponent } from './svg-simple-linear-gauge.component';
import { ISkipResizeEvent } from '../../core/directives/skip-resize-observer.directive';

interface GaugeInternals {
  onResize: (event: ISkipResizeEvent) => void;
  viewBox: () => string;
  viewBoxWidth: () => number;
  barInset: () => number;
  barLength: () => number;
  textRightX: () => number;
}

/**
 * The drawing takes the tile's own proportions instead of being fitted inside them. At the fixed
 * 205x50 the browser letterboxed it, so a wide tile showed the bar floating in the middle of a
 * mostly empty card — and beside a Linear gauge, which runs the full width, the two did not line up.
 *
 * Constructed with `new` rather than rendered: the geometry needs no inputs, and rendering would run
 * the value effect into SMIL's beginElement, which jsdom does not implement.
 */
describe('SvgSimpleLinearGaugeComponent viewBox', () => {
  let internals: GaugeInternals;

  const resize = (width: number, height: number): ISkipResizeEvent =>
    ({ width, height, entry: {} as ResizeObserverEntry });

  beforeEach(() => {
    TestBed.configureTestingModule({});
    internals = TestBed.runInInjectionContext(
      () => new SvgSimpleLinearGaugeComponent()) as unknown as GaugeInternals;
  });

  it('starts at the aspect the artwork was drawn at', () => {
    expect(internals.viewBox()).toBe('0 0 205 50');
  });

  it('widens the viewBox to the tile’s aspect so nothing is letterboxed', () => {
    internals.onResize(resize(1235, 215));

    // 50 user units tall x the tile's own 5.744:1 — the drawing now fills the card exactly.
    expect(internals.viewBoxWidth()).toBeCloseTo(287.2, 1);
    expect(internals.viewBox()).toBe(`0 0 ${internals.viewBoxWidth()} 50`);
  });

  it('never goes narrower than the drawn width, letterboxing a tall tile instead', () => {
    // Below 4.1:1 a narrower viewBox would crush the name and the value together.
    internals.onResize(resize(200, 300));

    expect(internals.viewBoxWidth()).toBe(205);
  });

  it('insets the bar a twentieth of the width at each end, matching the Linear gauge', () => {
    internals.onResize(resize(1235, 215));

    const width = internals.viewBoxWidth();
    expect(internals.barInset()).toBeCloseTo(width * 0.05, 4);
    expect(internals.barLength()).toBeCloseTo(width * 0.9, 4);
    // The value reads to the bar's right end, as the name reads from its left.
    expect(internals.textRightX()).toBeCloseTo(width - internals.barInset(), 4);
  });

  it('ignores a zero-sized measurement', () => {
    internals.onResize(resize(1235, 215));
    const before = internals.viewBoxWidth();
    internals.onResize(resize(0, 0));

    expect(internals.viewBoxWidth()).toBe(before);
  });
});
