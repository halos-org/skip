import { WritableSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { WidgetNumericComponent } from './widget-numeric.component';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective } from '../../core/directives/widget-streams.directive';
import { UnitsService } from '../../core/services/units.service';
import { IPathUpdate } from '../../core/services/data.service';
import { IWidgetSvcConfig } from '../../core/interfaces/widgets-interface';

const unitsServiceStub = { getUnitDisplaySymbol: (measure: string | null | undefined) => measure ?? '' };

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
 * is read back. Effects are never flushed (no TestBed.tick()) so the required `theme` input is never
 * read, and ignoreZones:true keeps onNumericValue out of the zone branch that also reads theme().
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
