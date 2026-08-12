import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { UnitsService } from './units.service';
import { DataService } from './data.service';

describe('UnitsService', () => {
  function setup(): UnitsService {
    TestBed.configureTestingModule({
      providers: [
        UnitsService,
        { provide: DataService, useValue: {} },
      ],
    });
    return TestBed.inject(UnitsService);
  }

  describe('getUnitDisplaySymbol', () => {
    it('returns the dedicated display symbol for a measure', () => {
      const service = setup();
      expect(service.getUnitDisplaySymbol('knots')).toBe('kn');
      expect(service.getUnitDisplaySymbol('celsius')).toBe('°C');
      expect(service.getUnitDisplaySymbol('kph')).toBe('km/h');
      expect(service.getUnitDisplaySymbol('percent')).toBe('%');
      expect(service.getUnitDisplaySymbol('latitudeMin')).toBe('lat ′');
    });

    it('falls back to the raw measure when it has no dedicated symbol', () => {
      const service = setup();
      expect(service.getUnitDisplaySymbol('mph')).toBe('mph');
      expect(service.getUnitDisplaySymbol('m/s')).toBe('m/s');
    });

    it('returns an unknown measure unchanged, and empty string for null/undefined/empty', () => {
      const service = setup();
      expect(service.getUnitDisplaySymbol('not-a-unit')).toBe('not-a-unit');
      expect(service.getUnitDisplaySymbol(null)).toBe('');
      expect(service.getUnitDisplaySymbol(undefined)).toBe('');
      expect(service.getUnitDisplaySymbol('')).toBe('');
    });

    it('renders no symbol for the Unitless measures, so no gauge prints the word "unitless"', () => {
      // The steel gauge, the linear and radial gauges, the data chart title and the history dialog's
      // axis all label themselves from this seam with a resolved measure, which is 'unitless' whenever
      // the server states no preference for the path (#536).
      const service = setup();
      expect(service.getUnitDisplaySymbol('unitless')).toBe('');
      expect(service.getUnitDisplaySymbol(' ')).toBe('');
    });
  });

  describe('getRenderableUnitSymbol', () => {
    it('returns the display symbol for a measure that has one to show', () => {
      const service = setup();
      expect(service.getRenderableUnitSymbol('knots')).toBe('kn');
      expect(service.getRenderableUnitSymbol('celsius')).toBe('°C');
      expect(service.getRenderableUnitSymbol('mph')).toBe('mph');
    });

    it('returns nothing for the measures that must not print a symbol', () => {
      const service = setup();
      // A render site reserves room from this, so 'unitless' must not come back as its own key and
      // the whitespace 'No unit label' measure must not come back as a blank that occupies space.
      expect(service.getRenderableUnitSymbol('unitless')).toBe('');
      expect(service.getRenderableUnitSymbol(' ')).toBe('');
      expect(service.getRenderableUnitSymbol(null)).toBe('');
      expect(service.getRenderableUnitSymbol('')).toBe('');
    });
  });

  describe('convertBetweenMeasures (affine round-trip)', () => {
    it('returns the value unchanged when from === to', () => {
      const s = setup();
      expect(s.convertBetweenMeasures('m', 'm', 42)).toBe(42);
    });

    it('converts within the Length group (m -> feet) and back exactly', () => {
      const s = setup();
      const feet = s.convertBetweenMeasures('m', 'feet', 10);
      expect(feet).toBeCloseTo(32.8084, 3);
      expect(s.convertBetweenMeasures('feet', 'm', feet)).toBeCloseTo(10, 9);
    });

    it('converts an offset (Temperature) measure: 293.15 K <-> 20 C', () => {
      const s = setup();
      expect(s.convertBetweenMeasures('K', 'celsius', 293.15)).toBeCloseTo(20, 9);
      expect(s.convertBetweenMeasures('celsius', 'K', 20)).toBeCloseTo(293.15, 9);
    });

    it('converts a scaled Ratio measure: ratio 0.5 -> 50 percent', () => {
      const s = setup();
      expect(s.convertBetweenMeasures('ratio', 'percent', 0.5)).toBeCloseTo(50, 9);
    });

    it('is identity across different groups (never fabricates a cross-dimension value)', () => {
      const s = setup();
      expect(s.convertBetweenMeasures('knots', 'celsius', 7)).toBe(7);
      expect(s.convertBetweenMeasures('m', 'V', 3)).toBe(3);
    });

    it('is identity when either same-group endpoint is a string-format measure', () => {
      const s = setup();
      // Time group mixes numeric ('s') with a string-format measure ('D HH:MM:SS').
      expect(s.convertBetweenMeasures('D HH:MM:SS', 's', 5)).toBe(5);
      expect(s.convertBetweenMeasures('s', 'D HH:MM:SS', 5)).toBe(5);
    });

    it('is identity for an unknown measure or a unitless endpoint', () => {
      const s = setup();
      expect(s.convertBetweenMeasures('not-a-unit', 'm', 5)).toBe(5);
      expect(s.convertBetweenMeasures('unitless', 'knots', 5)).toBe(5);
    });

    it('passes a non-finite value through unchanged', () => {
      const s = setup();
      expect(s.convertBetweenMeasures('m', 'feet', NaN)).toBeNaN();
      expect(s.convertBetweenMeasures('m', 'feet', Infinity)).toBe(Infinity);
    });
  });

  describe('getConversionsForPath server displayUnits (#246 Phase 1)', () => {
    // Build a UnitsService whose DataService reports a path's SI unit + optional server displayUnits.
    function setupWithData(
      pathUnitType: string | null,
      displayUnits?: { targetUnit?: string },
    ): UnitsService {
      TestBed.resetTestingModule();
      const dataStub: Partial<DataService> = {
        getPathUnitType: () => pathUnitType,
        getPathDisplayUnits: () => displayUnits,
      };
      TestBed.configureTestingModule({
        providers: [
          UnitsService,
          { provide: DataService, useValue: dataStub },
        ],
      });
      return TestBed.inject(UnitsService);
    }

    it('prefers the server targetUnit (aliased to a Skip measure)', () => {
      const service = setupWithData('m/s', { targetUnit: 'kn' });
      // Server 'kn' maps to Skip 'knots'.
      expect(service.getConversionsForPath('self.navigation.speedOverGround').base).toBe('knots');
    });

    it('uses a server targetUnit that already equals a Skip measure directly (mbar)', () => {
      const service = setupWithData('Pa', { targetUnit: 'mbar' });
      expect(service.getConversionsForPath('self.environment.outside.pressure').base).toBe('mbar');
    });

    it('falls back to unitless when the path has no server displayUnits', () => {
      const service = setupWithData('m/s', undefined);
      expect(service.getConversionsForPath('self.navigation.speedOverGround').base).toBe('unitless');
    });

    it('falls back to unitless when the server targetUnit is not honourable for the group', () => {
      const service = setupWithData('m/s', { targetUnit: 'furlong-per-fortnight' });
      expect(service.getConversionsForPath('self.navigation.speedOverGround').base).toBe('unitless');
    });

    it('resolves the ambiguous C alias to celsius for a temperature path (not Charge Coulomb)', () => {
      const service = setupWithData('K', { targetUnit: 'C' });
      expect(service.getConversionsForPath('self.environment.water.temperature').base).toBe('celsius');
    });

    it('does not mis-apply the C->celsius alias on a Charge path (celsius not in group -> unitless)', () => {
      // A charge path's SI unit is 'C' (Coulomb); a stray targetUnit 'C' must not become celsius.
      const service = setupWithData('C', { targetUnit: 'C' });
      expect(service.getConversionsForPath('self.electrical.batteries.house.capacity').base).toBe('unitless');
    });

    it('maps every non-identity server target through to a valid group measure', () => {
      // The exact aliased VALUES are load-bearing (the group guard matches them literally).
      expect(setupWithData('m', { targetUnit: 'naut-mile' }).getConversionsForPath('self.navigation.trip.log').base).toBe('nm');
      expect(setupWithData('rad', { targetUnit: 'degree' }).getConversionsForPath('self.navigation.headingTrue').base).toBe('deg');
      expect(setupWithData('s', { targetUnit: 'hour' }).getConversionsForPath('self.navigation.trip.timeElapsed').base).toBe('Hours');
    });

    // Every (baseUnit, targetUnit) pair the Signal K server's six built-in unit-preference presets can
    // emit, read from signalk-server `unitpreferences/presets/*.json` (verified at master 2495b860,
    // server 2.30.0). A pair Skip cannot map degrades the path to 'unitless' — silently, since the resolver
    // logs nothing for an unmappable target — which is what #536 reported for fuel rate: the metric
    // presets emit volumeRate 'L/h' and Skip's Flow measure is 'l/h'.
    //
    // Categories deliberately absent: mass (kg) and area (m2) have no Skip conversion group at all, so
    // even their identity target fails (tracked separately); dataSize, dateTime and boolean are not
    // Signal K numeric units.
    const PRESET_TARGET_VOCABULARY: { category: string; unit: string; target: string; measure: string }[] = [
      { category: 'angle', unit: 'rad', target: 'degree', measure: 'deg' },
      { category: 'angleDegrees', unit: 'deg', target: 'deg', measure: 'deg' },
      { category: 'angularVelocity', unit: 'rad/s', target: 'deg/s', measure: 'deg/s' },
      { category: 'charge', unit: 'C', target: 'Ah', measure: 'Ah' },
      { category: 'current', unit: 'A', target: 'A', measure: 'A' },
      { category: 'depth', unit: 'm', target: 'm', measure: 'm' },
      { category: 'depth', unit: 'm', target: 'foot', measure: 'feet' },
      { category: 'distance', unit: 'm', target: 'kilometer', measure: 'km' },
      { category: 'distance', unit: 'm', target: 'mile', measure: 'mi' },
      { category: 'distance', unit: 'm', target: 'naut-mile', measure: 'nm' },
      { category: 'energy', unit: 'J', target: 'J', measure: 'J' },
      { category: 'energy', unit: 'J', target: 'btu', measure: 'btu' },
      { category: 'frequency', unit: 'Hz', target: 'rpm', measure: 'rpm' },
      { category: 'length', unit: 'm', target: 'm', measure: 'm' },
      { category: 'length', unit: 'm', target: 'foot', measure: 'feet' },
      { category: 'percentage', unit: 'ratio', target: 'percent', measure: 'percent' },
      { category: 'power', unit: 'W', target: 'W', measure: 'W' },
      { category: 'pressure', unit: 'Pa', target: 'mbar', measure: 'mbar' },
      { category: 'pressure', unit: 'Pa', target: 'psi', measure: 'psi' },
      { category: 'pressure', unit: 'Pa', target: 'inHg', measure: 'inHg' },
      { category: 'speed', unit: 'm/s', target: 'kn', measure: 'knots' },
      { category: 'speed', unit: 'm/s', target: 'km/h', measure: 'kph' },
      { category: 'speed', unit: 'm/s', target: 'mph', measure: 'mph' },
      { category: 'temperature', unit: 'K', target: 'C', measure: 'celsius' },
      { category: 'temperature', unit: 'K', target: 'F', measure: 'fahrenheit' },
      { category: 'time', unit: 's', target: 'hour', measure: 'Hours' },
      { category: 'voltage', unit: 'V', target: 'V', measure: 'V' },
      { category: 'volume', unit: 'm3', target: 'liter', measure: 'liter' },
      { category: 'volume', unit: 'm3', target: 'gallon', measure: 'gallon' },
      { category: 'volume', unit: 'm3', target: 'gallon-imp', measure: 'gallon-imp' },
      { category: 'volumeRate', unit: 'm3/s', target: 'L/h', measure: 'l/h' },
      { category: 'volumeRate', unit: 'm3/s', target: 'gal/h', measure: 'g/h' },
      { category: 'volumeRate', unit: 'm3/s', target: 'gal-imp/h', measure: 'gal-imp/h' },
    ];

    it('honours every target unit the built-in server presets emit (#536)', () => {
      for (const c of PRESET_TARGET_VOCABULARY) {
        const service = setupWithData(c.unit, { targetUnit: c.target });
        const base = service.getConversionsForPath('self.some.path').base;
        expect(base, `${c.category} ${c.unit} -> ${c.target}`).toBe(c.measure);
        expect(service.getUnitDisplaySymbol(base), `symbol for ${base}`).not.toBe('');
        expect(Number.isFinite(service.convertToUnit(base, 1) as number), `conversion for ${base}`).toBe(true);
      }
    });

    it('converts fuel rate to the metric preset target (m3/s -> L/h)', () => {
      const service = setupWithData('m3/s', { targetUnit: 'L/h' });
      const path = 'self.propulsion.0.fuel.rate';
      expect(service.resolvePathMeasure(path)).toBe('l/h');
      // 1 m³/s is 3 600 000 L/h; a fuel rate of 2 L/h is what the gauge must read.
      expect(service.convertToUnit('l/h', 2 / 3_600_000) as number).toBeCloseTo(2, 6);
      expect(service.getUnitDisplaySymbol('l/h')).toBe('l/h');
    });

    it('converts the imperial volume and flow targets Skip previously had no measure for', () => {
      const service = setup();
      expect(service.convertToUnit('g/h', 1) as number).toBeCloseTo(951019.3845, 3);
      expect(service.convertToUnit('gal-imp/h', 1) as number).toBeCloseTo(791889.2939, 3);
      expect(service.convertToUnit('gallon-imp', 1) as number).toBeCloseTo(219.9692483, 6);
      expect(service.convertToUnit('btu', 1) as number).toBeCloseTo(0.000947817, 9);
    });

    it('keeps the label-matches-conversion invariant for every aliased category (symbol + working conversion)', () => {
      // The server value is the SOLE base source — proves the invariant holds across the alias set,
      // not just for one measure.
      const cases: { unit: string; target: string; measure: string }[] = [
        { unit: 'm/s', target: 'kn', measure: 'knots' },
        { unit: 'K', target: 'C', measure: 'celsius' },
        { unit: 'm', target: 'naut-mile', measure: 'nm' },
        { unit: 'rad', target: 'degree', measure: 'deg' },
        { unit: 's', target: 'hour', measure: 'Hours' },
        { unit: 'Pa', target: 'mbar', measure: 'mbar' },
      ];
      for (const c of cases) {
        const service = setupWithData(c.unit, { targetUnit: c.target });
        const base = service.getConversionsForPath('self.some.path').base;
        expect(base, `target ${c.target}`).toBe(c.measure);
        // The one base drives BOTH a non-empty symbol AND a finite conversion.
        expect(service.getUnitDisplaySymbol(base), `symbol for ${base}`).not.toBe('');
        expect(Number.isFinite(service.convertToUnit(base, 1) as number), `conversion for ${base}`).toBe(true);
      }
    });

    it('every conversion-list measure drives BOTH a working conversion and a non-empty symbol (label-matches-conversion, comprehensively)', () => {
      // Underpins the whole Phase-2 resolver: because every group-valid measure both converts and
      // labels, resolving a server target to any group-valid measure yields a real value AND a matching
      // symbol from one source. Fails loudly if a future measure is added to the table without a
      // conversion function or a resolvable symbol.
      const service = setup();
      for (const group of service.getConversions()) {
        // The Unitless group is the one exception, and deliberately so: its members exist to carry the
        // as-is value with nothing rendered beside it, so their symbol is empty by design.
        if (group.group === 'Unitless') { continue; }
        for (const unit of group.units) {
          expect(service.convertToUnit(unit.measure, 1), `conversion ${unit.measure}`).not.toBeNull();
          expect(service.getUnitDisplaySymbol(unit.measure), `symbol ${unit.measure}`).not.toBe('');
        }
      }
    });

    // --- Phase 2 (#347): the public per-path measure resolver ---
    it('resolvePathMeasure returns the honourable server preference', () => {
      const service = setupWithData('m/s', { targetUnit: 'kn' });
      expect(service.resolvePathMeasure('self.navigation.speedOverGround')).toBe('knots');
    });

    it('resolvePathMeasure falls back to unitless when there is no server preference', () => {
      const service = setupWithData('m/s', undefined);
      expect(service.resolvePathMeasure('self.navigation.speedOverGround')).toBe('unitless');
    });

    it('resolvePathMeasure returns unitless for a path with no SI unit', () => {
      const service = setupWithData(null, undefined);
      expect(service.resolvePathMeasure('self.some.stringPath')).toBe('unitless');
    });

    it('resolvePathMeasure never drifts from getConversionsForPath().base', () => {
      const service = setupWithData('K', { targetUnit: 'C' });
      const path = 'self.environment.water.temperature';
      expect(service.resolvePathMeasure(path)).toBe(service.getConversionsForPath(path).base);
    });
  });
});
