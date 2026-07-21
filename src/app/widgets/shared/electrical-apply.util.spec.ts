import { States } from '../../core/interfaces/signalk-interfaces';
import type { UnitsService } from '../../core/services/units.service';
import {
  resolveMostSevereState,
  setMetricValue,
  setValue,
  toBoolean,
  toFiniteNumber,
  toNumber,
  toStringValue
} from './electrical-apply.util';

function unitsWith(convert: (unit: string, value: number) => number | null): UnitsService {
  return { convertToUnit: convert } as unknown as UnitsService;
}

interface TestSnapshot {
  voltage: number | null;
  voltageState: States | null;
}

function snapshot(): TestSnapshot {
  return { voltage: null, voltageState: null };
}

describe('electrical-apply.util', () => {
  describe('setValue', () => {
    it('writes and returns true when the value changes', () => {
      const s = snapshot();
      expect(setValue(s, 'voltage', 12.4)).toBe(true);
      expect(s.voltage).toBe(12.4);
    });

    it('returns false and does not write when the value is unchanged (Object.is)', () => {
      const s = snapshot();
      s.voltage = 12.4;
      expect(setValue(s, 'voltage', 12.4)).toBe(false);
    });
  });

  describe('setMetricValue', () => {
    it('writes both fields and returns true when the value changes', () => {
      const s = snapshot();
      expect(setMetricValue(s, 'voltage', 'voltageState', 12.4, States.Normal)).toBe(true);
      expect(s.voltage).toBe(12.4);
      expect(s.voltageState).toBe(States.Normal);
    });

    it('returns true when only the state changes', () => {
      const s = snapshot();
      s.voltage = 12.4;
      s.voltageState = States.Normal;
      expect(setMetricValue(s, 'voltage', 'voltageState', 12.4, States.Alarm)).toBe(true);
      expect(s.voltageState).toBe(States.Alarm);
    });

    it('returns true when only the value changes', () => {
      const s = snapshot();
      s.voltage = 12.4;
      s.voltageState = States.Normal;
      expect(setMetricValue(s, 'voltage', 'voltageState', 15, States.Normal)).toBe(true);
      expect(s.voltage).toBe(15);
      expect(s.voltageState).toBe(States.Normal);
    });

    it('returns false when neither value nor state changes', () => {
      const s = snapshot();
      s.voltage = 12.4;
      s.voltageState = States.Normal;
      expect(setMetricValue(s, 'voltage', 'voltageState', 12.4, States.Normal)).toBe(false);
    });
  });

  describe('toFiniteNumber', () => {
    it('passes finite numbers through', () => {
      expect(toFiniteNumber(12.4)).toBe(12.4);
      expect(toFiniteNumber(0)).toBe(0);
    });

    it('returns null for non-numbers, NaN and infinities (no string coercion)', () => {
      expect(toFiniteNumber('12')).toBeNull();
      expect(toFiniteNumber(NaN)).toBeNull();
      expect(toFiniteNumber(Infinity)).toBeNull();
      expect(toFiniteNumber(true)).toBeNull();
      expect(toFiniteNumber(null)).toBeNull();
      expect(toFiniteNumber(undefined)).toBeNull();
    });
  });

  describe('toNumber', () => {
    it('applies the unit conversion to a finite number', () => {
      const units = unitsWith((unit, value) => (unit === 'K' ? value + 273.15 : value));
      expect(toNumber(units, 300, 'K')).toBe(573.15);
    });

    it('coerces genuine numeric strings before converting', () => {
      const units = unitsWith((unit, value) => (unit === 'K' ? value + 273.15 : value));
      expect(toNumber(units, '300', 'K')).toBe(573.15);
    });

    it('rejects blank/non-numeric strings, booleans, null and NaN without converting', () => {
      let called = false;
      const units = unitsWith(() => {
        called = true;
        return 0;
      });
      expect(toNumber(units, '', 'K')).toBeNull();
      expect(toNumber(units, '   ', 'K')).toBeNull();
      expect(toNumber(units, 'abc', 'K')).toBeNull();
      expect(toNumber(units, true, 'K')).toBeNull();
      expect(toNumber(units, null, 'K')).toBeNull();
      expect(toNumber(units, NaN, 'K')).toBeNull();
      expect(called).toBe(false);
    });

    it('falls back to the raw number when the conversion is non-finite', () => {
      expect(toNumber(unitsWith(() => NaN), 42, 'V')).toBe(42);
      expect(toNumber(unitsWith(() => null), 42, 'V')).toBe(42);
    });
  });

  describe('toStringValue', () => {
    it('passes strings through and drops non-strings to null', () => {
      expect(toStringValue('house')).toBe('house');
      expect(toStringValue(42)).toBeNull();
      expect(toStringValue(true)).toBeNull();
      expect(toStringValue(null)).toBeNull();
    });
  });

  describe('toBoolean', () => {
    it('passes booleans through', () => {
      expect(toBoolean(true)).toBe(true);
      expect(toBoolean(false)).toBe(false);
    });

    it('maps 1/0 numbers', () => {
      expect(toBoolean(1)).toBe(true);
      expect(toBoolean(0)).toBe(false);
      expect(toBoolean(2)).toBeNull();
    });

    it('maps truthy/falsy string tokens case- and whitespace-insensitively', () => {
      expect(toBoolean(' TRUE ')).toBe(true);
      expect(toBoolean('on')).toBe(true);
      expect(toBoolean('1')).toBe(true);
      expect(toBoolean('off')).toBe(false);
      expect(toBoolean('0')).toBe(false);
      expect(toBoolean('maybe')).toBeNull();
    });

    it('returns null for unmappable values', () => {
      expect(toBoolean(null)).toBeNull();
      expect(toBoolean({})).toBeNull();
    });
  });

  describe('resolveMostSevereState', () => {
    it('returns the highest-ranked state by Signal K severity order', () => {
      // normal < nominal < alert < warn < alarm < emergency
      expect(resolveMostSevereState(States.Normal, States.Alarm, States.Alert)).toBe(States.Alarm);
      expect(resolveMostSevereState(States.Alert, States.Warn)).toBe(States.Warn);
      expect(resolveMostSevereState(States.Normal, States.Alarm)).toBe(States.Alarm);
      expect(resolveMostSevereState(States.Warn, States.Normal)).toBe(States.Warn);
      expect(resolveMostSevereState(States.Nominal, States.Normal)).toBe(States.Nominal);
      expect(resolveMostSevereState(States.Alarm, States.Emergency)).toBe(States.Emergency);
      expect(resolveMostSevereState(States.Normal, null)).toBe(States.Normal);
    });

    it('ignores null/undefined and returns null when no known state is present', () => {
      expect(resolveMostSevereState(null, undefined)).toBeNull();
    });
  });
});
