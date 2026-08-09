import { WritableSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { WidgetNumericComponent } from './widget-numeric.component';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective } from '../../core/directives/widget-streams.directive';
import { UnitsService } from '../../core/services/units.service';
import { CanvasService } from '../../core/services/canvas.service';
import { IPathUpdate } from '../../core/services/data.service';
import { IWidgetSvcConfig } from '../../core/interfaces/widgets-interface';

const unitsServiceStub = {
  getUnitDisplaySymbol: (measure: string | null | undefined) => measure ?? '',
  // Mirrors the real rule: nothing to render for the boot placeholder, 'unitless', or a blank symbol.
  getRenderableUnitSymbol: (measure: string | null | undefined) =>
    (!measure || measure === 'unitless') ? '' : measure.trim()
};

interface NumericInternals {
  onNumericValue: (u: IPathUpdate) => void;
  getValueText: () => string;
}

/**
 * Regression tests for the crash-fix in ddfb377c.
 *
 * getValueText/applyDecorations now key on the tagged effectiveUnit() — the measure the value was
 * actually converted to — rather than the stored convertUnitTo. Two things had to change together:
 *  - a position/duration FORMAT measure ('latitudeSec', 'D HH:MM:SS', ...) arrives as a pre-formatted
 *    STRING; the old code called toFixed() on it and threw, so it must be returned as-is via toString().
 *  - a percent measure ('percent'/'percentraw') must still get a '%' appended, and a normal numeric
 *    measure must be toFixed'd with no '%'.
 *
 * The component is driven headless: onNumericValue (the stream callback that sets dataValue +
 * effectiveUnit) is invoked directly, and getValueText (the smallest seam producing the drawn text)
 * is read back. onNumericValue calls drawWidget(), which now reads the required `theme()` input (for
 * the halo card color) — but drawWidget bails at its `if (!canvasCtx) return` guard here, because the
 * component is constructed via `new` without ngOnInit so the canvas context is never set and theme()
 * is never reached. ignoreZones:true likewise keeps onNumericValue out of the zone branch that reads
 * theme(). Adding ngOnInit/detectChanges to this spec would make drawWidget reach this.theme() and
 * throw NG0950 (required input not set).
 */
describe('WidgetNumericComponent value text (crash-fix ddfb377c)', () => {
  let component: WidgetNumericComponent;
  let internals: NumericInternals;
  let options: WritableSignal<IWidgetSvcConfig | undefined>;

  const makeConfig = (numDecimal = 1): IWidgetSvcConfig => ({
    ...WidgetNumericComponent.DEFAULT_CONFIG,
    numDecimal,
    ignoreZones: true
  });

  const update = (value: unknown, measure?: string): IPathUpdate =>
    ({ data: { value, timestamp: null, measure }, state: 'normal' });

  beforeEach(() => {
    options = signal<IWidgetSvcConfig | undefined>(makeConfig());
    const streamsMock = { observe: () => undefined };
    TestBed.configureTestingModule({
      providers: [
        { provide: WidgetRuntimeDirective, useValue: { options } },
        { provide: WidgetStreamsDirective, useValue: streamsMock },
        { provide: UnitsService, useValue: unitsServiceStub }
      ]
    });
    component = TestBed.runInInjectionContext(() => new WidgetNumericComponent());
    internals = component as unknown as NumericInternals;
  });

  it('returns a latitudeSec format-measure value as its pre-formatted string, not toFixed', () => {
    // Pre-formatted position string tagged with a format measure: the old code called
    // ("12° 34.5' N").toFixed() and threw a TypeError. Returning the string proves the fix.
    internals.onNumericValue(update("12° 34.5' N", 'latitudeSec'));
    expect(internals.getValueText()).toBe("12° 34.5' N");
  });

  it('returns a D HH:MM:SS duration format-measure value as its string form without crashing', () => {
    internals.onNumericValue(update('1 12:00:00', 'D HH:MM:SS'));
    expect(internals.getValueText()).toBe('1 12:00:00');
  });

  it("appends '%' to a value tagged 'percent'", () => {
    internals.onNumericValue(update(55.5, 'percent'));
    expect(internals.getValueText()).toBe('55.5%');
  });

  it("appends '%' to a value tagged 'percentraw'", () => {
    internals.onNumericValue(update(80, 'percentraw'));
    expect(internals.getValueText()).toBe('80.0%');
  });

  it("toFixes a normal numeric measure with no '%' appended", () => {
    internals.onNumericValue(update(12.345, 'm/s'));
    const text = internals.getValueText();
    expect(text).toBe('12.3');
    expect(text).not.toContain('%');
  });

  it('renders the placeholder before any value arrives', () => {
    expect(internals.getValueText()).toBe('--');
  });
});

interface DrawnText {
  text: string;
  x: number;
  y: number;
  maxWidth: number;
  maxHeight: number;
  weight: string;
  color: string;
  align: CanvasTextAlign;
  baseline: CanvasTextBaseline;
  floorPx: number;
}

interface LayoutInternals {
  cssWidth: number;
  cssHeight: number;
  maxValueTextWidth: number;
  maxValueTextHeight: number;
  maxMinMaxTextHeight: number;
  labelBaselineY: () => number;
  calculateMaxMinTextDimensions: () => void;
  drawLabelRow: (ctx: CanvasRenderingContext2D, displayName: string, unit: string, haloColor: string | undefined) => void;
  drawValue: (ctx: CanvasRenderingContext2D) => void;
}

/** A glyph is 0.6em wide, 0.65em when bold, so a width is a character count times the font size. */
const fontSizeOf = (font: string): number => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 0);
const glyphEm = (weight: string): number => weight === 'bold' ? 0.65 : 0.6;
const widthOf = (text: string, size: number, weight: string): number => text.length * glyphEm(weight) * size;

/**
 * Stands in for CanvasService with the two behaviours the label row is laid out against: text width
 * scales with the font size and weight (so a width reserved at one size is wrong at another), and
 * the fitted size is raised to the caller's floor — the case where CanvasService drops its own width
 * cap and lets floored text overflow, which is the whole reason the label is truncated.
 */
const canvasFake = {
  EDGE_BUFFER: 10,
  MIN_LABEL_PX: 16,
  MIN_UNIT_PX: 12,
  DEFAULT_FONT: 'Roboto',
  scaleFactor: 1,
  drawn: [] as DrawnText[],
  measureTextWidth: (text: string, font: string) =>
    widthOf(text, fontSizeOf(font), font.startsWith('bold') ? 'bold' : 'normal'),
  calculateOptimalFontSize: (
    ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxHeight: number,
    weight = 'normal', floorPx = 0
  ) => {
    void ctx;
    let size = Math.max(1, Math.floor(maxHeight));
    while (size > 1 && widthOf(text, size, weight) > maxWidth) size--;
    return floorPx > 0 ? Math.max(size, Math.round(floorPx)) : size;
  },
  drawText: (
    ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number,
    maxHeight: number, weight = 'normal', color = '', align: CanvasTextAlign = 'center',
    baseline: CanvasTextBaseline = 'middle', halo?: string, floorPx = 0
  ) => {
    void ctx; void halo;
    canvasFake.drawn.push({ text, x, y, maxWidth, maxHeight, weight, color, align, baseline, floorPx });
  },
  whenFontsReady: () => Promise.resolve()
};

/** Horizontal extent of a recorded draw at the size CanvasService would actually paint it. */
const inkBounds = (d: DrawnText): { left: number; right: number } => {
  const size = canvasFake.calculateOptimalFontSize(
    {} as CanvasRenderingContext2D, d.text, d.maxWidth, d.maxHeight, d.weight, d.floorPx);
  const width = widthOf(d.text, size, d.weight);
  return d.align === 'right' ? { left: d.x - width, right: d.x } : { left: d.x, right: d.x + width };
};

/**
 * Layout of the top row: the label and the unit occupy one band together — label in the left
 * corner, unit in the right — leaving the rest of the tile to the value.
 */
describe('WidgetNumericComponent label row layout', () => {
  const ctx = {} as CanvasRenderingContext2D;
  let component: WidgetNumericComponent;
  let internals: LayoutInternals;
  let options: WritableSignal<IWidgetSvcConfig | undefined>;

  const makeComponent = (width: number, height: number): void => {
    canvasFake.drawn = [];
    TestBed.resetTestingModule();
    options = signal<IWidgetSvcConfig | undefined>({ ...WidgetNumericComponent.DEFAULT_CONFIG, ignoreZones: true });
    TestBed.configureTestingModule({
      providers: [
        { provide: WidgetRuntimeDirective, useValue: { options } },
        { provide: WidgetStreamsDirective, useValue: { observe: () => undefined } },
        { provide: UnitsService, useValue: unitsServiceStub },
        { provide: CanvasService, useValue: canvasFake }
      ]
    });
    component = TestBed.runInInjectionContext(() => new WidgetNumericComponent());
    internals = component as unknown as LayoutInternals;
    internals.cssWidth = width;
    internals.cssHeight = height;
  };

  beforeEach(() => makeComponent(400, 200));

  it('draws the unit in the top-right corner, on the label’s baseline', () => {
    internals.drawLabelRow(ctx, 'SOG', 'knots', undefined);

    const label = canvasFake.drawn.find(d => d.text === 'SOG');
    const unit = canvasFake.drawn.find(d => d.text === 'knots');
    expect(label?.x).toBe(10);
    expect(label?.align).toBe('left');
    expect(unit?.x).toBe(400 - 10);
    expect(unit?.align).toBe('right');
    expect(unit?.y).toBe(label?.y);
    expect(label?.y).toBe(30); // EDGE_BUFFER + 10% of a 200px tile
    // One shared baseline is what makes the two read as a single row despite their different sizes.
    expect(label?.baseline).toBe('alphabetic');
    expect(unit?.baseline).toBe('alphabetic');
  });

  it('keeps the label clear of the unit at every tile width', () => {
    // The invariant the row exists to hold: whatever each is truncated or floored to, the painted
    // label never reaches the painted unit.
    for (const width of [33, 43, 60, 90, 150, 320, 700]) {
      makeComponent(width, 120);
      internals.drawLabelRow(ctx, 'Port Engine Coolant Temperature', 'nm/kWh', undefined);

      const unit = canvasFake.drawn.find(d => d.align === 'right');
      const label = canvasFake.drawn.find(d => d.align === 'left');
      expect(unit, `unit dropped at width ${width}`).toBeDefined();
      if (label) {
        expect(inkBounds(label).right, `overlap at width ${width}`)
          .toBeLessThanOrEqual(inkBounds(unit as DrawnText).left);
      }
    }
  });

  it('narrows the label by the width the unit will actually take', () => {
    internals.drawLabelRow(ctx, 'SOG', 'knots', undefined);

    const unit = canvasFake.drawn.find(d => d.align === 'right') as DrawnText;
    const label = canvasFake.drawn.find(d => d.align === 'left');
    const unitWidth = inkBounds(unit).right - inkBounds(unit).left;
    expect(label?.maxWidth).toBe(400 - 20 - unitWidth - 10);
  });

  it('ellipsises a name too long for its share of the row', () => {
    makeComponent(150, 200);
    internals.drawLabelRow(ctx, 'Speed Over Ground', 'knots', undefined);

    const label = canvasFake.drawn.find(d => d.align === 'left');
    expect(label?.text).toMatch(/…$/);
    expect(label?.text.length ?? 0).toBeLessThan('Speed Over Ground'.length);
  });

  it('drops the label rather than overprint the unit when the row has no room left', () => {
    makeComponent(40, 120);
    internals.drawLabelRow(ctx, 'Speed Over Ground', 'knots', undefined);

    expect(canvasFake.drawn.map(d => d.align)).toEqual(['right']);
  });

  it('keeps an emoji in the name whole when it ellipsises', () => {
    makeComponent(150, 200);
    internals.drawLabelRow(ctx, 'Engine 🔧🔧🔧 Temp', 'knots', undefined);

    const label = canvasFake.drawn.find(d => d.align === 'left');
    expect(label?.text ?? '').not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it('omits the unit for a measure that carries no symbol', () => {
    internals.drawLabelRow(ctx, 'Ratio', 'unitless', undefined);

    expect(canvasFake.drawn).toHaveLength(1);
    expect(canvasFake.drawn[0].text).toBe('Ratio');
    expect(canvasFake.drawn[0].maxWidth).toBe(400 - 20);
  });

  it('omits the unit for a measure whose symbol is blank', () => {
    // 'No unit label' is a whitespace measure — reserving row width for it would cost the name
    // space and paint nothing.
    internals.drawLabelRow(ctx, 'Rudder', ' ', undefined);

    expect(canvasFake.drawn).toHaveLength(1);
    expect(canvasFake.drawn[0].maxWidth).toBe(400 - 20);
  });

  it('gives the value the card between the label row and the bottom edge', () => {
    internals.calculateMaxMinTextDimensions();
    internals.drawValue(ctx);

    expect(internals.labelBaselineY()).toBe(30);
    expect(internals.maxValueTextHeight).toBe(170);
    expect(internals.maxValueTextWidth).toBe(360);
    const value = canvasFake.drawn.find(d => d.align === undefined || d.align === 'center');
    expect(value?.x).toBe(200);
    expect(value?.y).toBe(115); // centred between the label baseline and the card bottom
  });

  it('holds the value box off the min/max row when one is shown', () => {
    options.update(cfg => ({ ...cfg, showMin: true, showMax: true }));
    internals.calculateMaxMinTextDimensions();
    internals.drawValue(ctx);

    expect(internals.maxValueTextHeight + internals.labelBaselineY() + internals.maxMinMaxTextHeight)
      .toBe(internals.cssHeight);
    const value = canvasFake.drawn.find(d => d.align === undefined || d.align === 'center');
    expect(value?.y).toBe(105); // recentred above the min/max row
  });
});
