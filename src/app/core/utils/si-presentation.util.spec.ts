import { describe, expect, it } from 'vitest';
import { gaugeScaleMeasure, pathOptionMeasure, presentationValue, presentedBound, presentedOption, presentedScaleBounds, toDegrees } from './si-presentation.util';

describe('toDegrees', () => {
  it('converts rad to degrees and passes null and undefined through', () => {
    expect(toDegrees(Math.PI)).toBe(180);
    expect(toDegrees(null)).toBeNull();
    expect(toDegrees(undefined)).toBeUndefined();
  });
});

describe('presentationValue', () => {
  const units = { convertToUnit: (unit: string, value: number) => unit === 'knots' ? value * 1.94384 : null };

  it('converts an SI value to its presentation measure', () => {
    expect(presentationValue(units, 'knots', 5)).toBeCloseTo(9.7192, 6);
  });

  it('leaves the SI value for an empty, unitless or unknown measure', () => {
    expect(presentationValue(units, '', 5)).toBe(5);
    expect(presentationValue(units, 'unitless', 5)).toBe(5);
    expect(presentationValue(units, 'no-such-measure', 5)).toBe(5);
  });
});

describe('presentedOption', () => {
  it('drops the float noise of a unit round trip', () => {
    expect(30 * Math.PI / 180 * 180 / Math.PI).not.toBe(30);
    expect(presentedOption(30 * Math.PI / 180 * 180 / Math.PI)).toBe(30);
    expect(presentedOption(119.99999999999997)).toBe(120);
  });

  it('keeps a value that has ten significant digits of its own', () => {
    expect(presentedOption(12.34567891)).toBe(12.34567891);
  });

  it('shows the noise left of a zero that went through an offset conversion as zero', () => {
    const zeroFahrenheit = (0 + 459.67) * 5 / 9;
    expect(zeroFahrenheit * 9 / 5 - 459.67).not.toBe(0);
    expect(presentedOption(zeroFahrenheit * 9 / 5 - 459.67)).toBe(0);
  });

  it('keeps a small value an SI option can hold', () => {
    expect(presentedOption(5.555555556e-6)).toBe(5.555555556e-6);
  });
});

describe('presentedBound', () => {
  const units = {
    convertToUnit: (unit: string, value: number): number | null => {
      switch (unit) {
        case 'rpm': return value * 60;
        case 'fahrenheit': return value * 9 / 5 - 459.67;
        // The real converter returns text for the position formats, typed as a number.
        case 'latitudeMin': return '60° 30.000\' N' as unknown as number;
        default: return null;
      }
    }
  };

  it('converts an SI bound to the presentation measure without float noise', () => {
    expect(393.15 * 9 / 5 - 459.67).not.toBe(248);
    expect(presentedBound(units, 'fahrenheit', 393.15)).toBe(248);
    expect(presentedBound(units, 'rpm', 60)).toBe(3600);
  });

  it('leaves the bound in SI for a measure whose conversion is not a number', () => {
    expect(presentedBound(units, 'latitudeMin', 60.5)).toBe(60.5);
  });
});

describe('presentedScaleBounds', () => {
  const units = { convertToUnit: (unit: string, value: number) => unit === 'rpm' ? value * 60 : null };
  const fallback = { lower: 0, upper: 100 };

  it('presents the bounds set in the config', () => {
    expect(presentedScaleBounds(units, 'rpm', { lower: 0, upper: 60 }, { lower: 10, upper: 20 }, fallback))
      .toEqual({ lower: 0, upper: 3600 });
  });

  it("takes the path's meta scale for a bound that is not set", () => {
    expect(presentedScaleBounds(units, 'rpm', { lower: null, upper: null }, { lower: 5, upper: 50 }, fallback))
      .toEqual({ lower: 300, upper: 3000 });
    expect(presentedScaleBounds(units, 'rpm', { lower: 10 }, { lower: 5, upper: 50 }, fallback))
      .toEqual({ lower: 600, upper: 3000 });
  });

  it('uses the fallback, already in the presentation measure, when neither sets a bound', () => {
    expect(presentedScaleBounds(units, 'rpm', undefined, undefined, fallback)).toEqual(fallback);
    expect(presentedScaleBounds(units, 'rpm', { lower: null, upper: 1 }, { upper: 2 }, fallback))
      .toEqual({ lower: 0, upper: 60 });
  });
});

describe('pathOptionMeasure', () => {
  const conversions: Record<string, (v: number) => number | string> = {
    unitless: v => v,
    knots: v => v * 1.94384,
    kph: v => v * 3.6,
    celsius: v => v - 273.15,
    latitudeMin: v => `${v}°`
  };
  const serverMeasures: Record<string, string> = { 'self.navigation.speedOverGround': 'kph' };
  const units = {
    resolvePathMeasure: (path: string) => serverMeasures[path] ?? 'unitless',
    convertToUnit: (unit: string, value: number) => (conversions[unit]?.(value) ?? null) as number | null
  };

  it('takes the measure the server sets for the path', () => {
    expect(pathOptionMeasure(units, 'self.navigation.speedOverGround', 'knots')).toBe('kph');
  });

  it('falls back to the unit stored with the slot', () => {
    expect(pathOptionMeasure(units, 'self.propulsion.main.temperature', 'celsius')).toBe('celsius');
    expect(pathOptionMeasure(units, null, 'knots')).toBe('knots');
  });

  it('is SI when neither gives a measure that converts numbers', () => {
    expect(pathOptionMeasure(units, 'self.propulsion.main.temperature', 'unitless')).toBe('unitless');
    expect(pathOptionMeasure(units, 'self.propulsion.main.temperature', '')).toBe('unitless');
    expect(pathOptionMeasure(units, null, undefined)).toBe('unitless');
    expect(pathOptionMeasure(units, 'self.navigation.position.latitude', 'latitudeMin')).toBe('unitless');
    expect(pathOptionMeasure(units, 'self.propulsion.main.temperature', 'no-such-measure')).toBe('unitless');
  });
});

describe('gaugeScaleMeasure', () => {
  it('takes the tagged measure, else the stored unit, else SI', () => {
    expect(gaugeScaleMeasure('fahrenheit', 'celsius')).toBe('fahrenheit');
    expect(gaugeScaleMeasure('', 'celsius')).toBe('celsius');
    expect(gaugeScaleMeasure('', undefined)).toBe('unitless');
  });
});
