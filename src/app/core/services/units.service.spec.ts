import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { TDurationFormat, UnitsService } from './units.service';
import { DataService } from './data.service';
import { CONSOLE_MIGRATION_SINK, migrateWidgetConfig } from '../utils/config-migration.util';
import { IWidgetPath, IWidgetSvcConfig } from '../interfaces/widgets-interface';
import { ISkDisplayUnits } from '../interfaces/signalk-interfaces';
import { IMeta } from '../interfaces/app-interfaces';
import { BehaviorSubject, EMPTY, Subject } from 'rxjs';
import { SignalKDeltaService } from './signalk-delta.service';
import { displayUnitsBySiUnit, UnitPreferencesService } from './unit-preferences.service';

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
      // The steel gauge, the linear and radial gauges, the data graph title and the history dialog's
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

    // #570: getConversionsForPath filters _conversionList for a group holding the path's SI unit, so
    // a unit in no group came back empty and the path degraded to 'unitless' — a displacement or a
    // sail area rendered as a raw number with no label, on every preset including metric.
    it('resolves a mass path to its own group rather than degrading it to unitless', () => {
      const service = setupWithData('kg', { targetUnit: 'kg' });
      const resolved = service.getConversionsForPath('self.design.displacement');
      expect(resolved.base).toBe('kg');
      expect(resolved.conversions.some(g => g.group === 'Mass')).toBe(true);
    });

    it('resolves an area path to its own group rather than degrading it to unitless', () => {
      const service = setupWithData('m2', { targetUnit: 'm2' });
      const resolved = service.getConversionsForPath('self.sails.inventory.main.area');
      expect(resolved.base).toBe('m2');
      expect(resolved.conversions.some(g => g.group === 'Area')).toBe(true);
    });

    it('honours the imperial mass and area targets the server presets ask for', () => {
      expect(setupWithData('kg', { targetUnit: 'pound' }).getConversionsForPath('self.design.displacement').base).toBe('lbs');
      expect(setupWithData('m2', { targetUnit: 'sqft' }).getConversionsForPath('self.sails.inventory.main.area').base).toBe('sqft');
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

    it('resolves C to Coulomb on a Charge path — a target that is itself a measure beats the alias', () => {
      // A charge path's SI unit is 'C' (Coulomb), and 'C' is the identity target the server offers
      // for it under the `base` category. Matching the group before the alias table is what keeps
      // that from being rewritten to Celsius and dropped.
      const service = setupWithData('C', { targetUnit: 'C' });
      expect(service.getConversionsForPath('self.electrical.batteries.house.capacity').base).toBe('C');
    });

    it('resolves the identity target of every group Skip supports (the server`s `base` category)', () => {
      // `base` is always-valid on the server and emits targetUnit === the path's own SI unit, so it
      // reaches Skip for any path — a second route into the resolver that no preset exercises.
      for (const unit of ['m/s', 'K', 'Pa', 'm', 'rad', 'rad/s', 'm3', 'V', 'A', 'W', 'ratio', 'Hz', 's', 'C', 'm3/s', 'J', 'kg', 'm2']) {
        const service = setupWithData(unit, { targetUnit: unit });
        expect(service.getConversionsForPath('self.some.path').base, `base target ${unit}`).toBe(unit);
      }
    });

    it('honours the spelled-out and case-variant targets a per-path override can select', () => {
      // Only the six built-in presets' targets are pinned below; an override or custom preset can
      // select any conversion key the server defines. These are the ones naming a unit Skip has.
      const cases: [string, string, string][] = [
        ['m3/s', 'L/min', 'l/min'], ['m', 'meter', 'm'], ['rad', 'radian', 'rad'],
        ['rad', 'gradian', 'grad'], ['Hz', 'hertz', 'Hz'], ['W', 'watt', 'W'],
        ['s', 'second', 's'], ['s', 'minute', 'Minutes'], ['s', 'day', 'Days'],
        // The definitions file has no `kg` conversion key, so `kilogram` is the metric mass option
        // the admin Data Browser actually offers — the preset path reaches `kg` only through the
        // server's targetUnit === siUnit shortcut.
        ['kg', 'kilogram', 'kg'],
      ];
      for (const [unit, target, measure] of cases) {
        const service = setupWithData(unit, { targetUnit: target });
        expect(service.getConversionsForPath('self.some.path').base, `${unit} -> ${target}`).toBe(measure);
      }
    });

    it('names the target it could not honour instead of degrading silently', () => {
      // The silent degrade is what made #536 present as "the gauge reads 0.00" with nothing to go on.
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const service = setupWithData('W', { targetUnit: 'horsepower' });
        expect(service.getConversionsForPath('self.electrical.solar.panelPower').base).toBe('unitless');
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain('horsepower');
        expect(warn.mock.calls[0][0]).toContain('self.electrical.solar.panelPower');
        // Once per target: the resolver runs on every meta emission.
        service.getConversionsForPath('self.electrical.solar.panelPower');
        expect(warn).toHaveBeenCalledTimes(1);
      } finally {
        warn.mockRestore();
      }
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
    // Categories deliberately absent: dataSize, dateTime and boolean are not Signal K numeric units;
    // and angleDegrees (baseUnit 'deg') is left out because Skip's only 'deg' measure converts FROM
    // radians, so honouring it would scale an already-degrees value by 57.3 (#574).
    const PRESET_TARGET_VOCABULARY: { category: string; unit: string; target: string; measure: string }[] = [
      { category: 'angle', unit: 'rad', target: 'degree', measure: 'deg' },
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
      { category: 'area', unit: 'm2', target: 'm2', measure: 'm2' },
      { category: 'area', unit: 'm2', target: 'sqft', measure: 'sqft' },
      { category: 'mass', unit: 'kg', target: 'kg', measure: 'kg' },
      { category: 'mass', unit: 'kg', target: 'pound', measure: 'lbs' },
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

    it('converts energy distance from the m/J that Signal K delivers', () => {
      const service = setup();
      // Neighbouring units are a factor of 1000 away; three decimals catch a wrong scale, not rounding.
      expect(service.convertToUnit('km/J', 1500) as number).toBeCloseTo(1.5, 3);
      expect(service.convertToUnit('nm/J', 1852) as number).toBeCloseTo(1, 3);
    });

    it('converts and labels the imperial gallon, imperial gallons per hour and BTU targets', () => {
      const service = setup();
      // Tolerances are physical, not library-exact: they catch a wrong unit (the nearest neighbour
      // is a factor of 60 away) without pinning js-quantities' rounding of the US gallon.
      expect(service.convertToUnit('g/h', 1) as number).toBeCloseTo(951019.39, 0);
      expect(service.convertToUnit('gal-imp/h', 1) as number).toBeCloseTo(791889.29, 0);
      expect(service.convertToUnit('gallon-imp', 1) as number).toBeCloseTo(219.96925, 4);
      expect(service.convertToUnit('btu', 1) as number).toBeCloseTo(0.000947817, 9);
      expect(service.getUnitDisplaySymbol('gal-imp/h')).toBe('imp gal/h');
      expect(service.getUnitDisplaySymbol('gallon-imp')).toBe('imp gal');
      expect(service.getUnitDisplaySymbol('btu')).toBe('BTU');
    });

    it('converts and labels the mass and area targets', () => {
      const service = setup();
      // js-quantities accepts `sqft` as a unit name of its own, so `swiftConverter('m^2','sqft')`
      // is the identity rather than an error — the plausible spelling would ship every area 10.76x
      // too small with nothing failing. Same shape for a mass unit one row away in the library.
      expect(service.convertToUnit('lbs', 1) as number).toBeCloseTo(2.2046226, 5);
      expect(service.convertToUnit('sqft', 1) as number).toBeCloseTo(10.7639104, 5);
      expect(service.convertToUnit('kg', 1) as number).toBe(1);
      expect(service.convertToUnit('m2', 1) as number).toBe(1);
      expect(service.getUnitDisplaySymbol('lbs')).toBe('lb');
      expect(service.getUnitDisplaySymbol('sqft')).toBe('ft²');
      expect(service.getUnitDisplaySymbol('m2')).toBe('m²');
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
        for (const unit of group.units) {
          expect(service.convertToUnit(unit.measure, 1), `conversion ${unit.measure}`).not.toBeNull();
          // The Unitless group is the one exception on the symbol half, and deliberately so: its
          // members carry the as-is value with nothing rendered beside it. Pinned positively rather
          // than skipped, so a member added there without an empty symbol still fails.
          const symbol = service.getUnitDisplaySymbol(unit.measure);
          if (group.group === 'Unitless') {
            expect(symbol, `symbol ${unit.measure}`).toBe('');
          } else {
            expect(symbol, `symbol ${unit.measure}`).not.toBe('');
          }
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

    // --- Duration formats (#627): the server's clock-style time targets ---
    const DURATION_TARGETS = ['HH:MM:SS', 'DD:HH:MM:SS', 'MM:SS', 'HH:MM:SS.mmm', 'MM:SS.mmm', 'duration-compact', 'duration-verbose'];

    it('keeps a duration-format path in seconds and names the format separately', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        for (const target of DURATION_TARGETS) {
          const service = setupWithData('s', { targetUnit: target });
          const path = 'self.navigation.racing.timeToStart';
          expect(service.resolvePathMeasure(path), target).toBe('s');
          expect(service.resolvePathDurationFormat(path), target).toBe(target);
        }
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it('names no duration format for a numeric time target or no server preference', () => {
      expect(setupWithData('s', { targetUnit: 'hour' }).resolvePathDurationFormat('self.navigation.racing.timeToStart')).toBeUndefined();
      expect(setupWithData('s', undefined).resolvePathDurationFormat('self.navigation.racing.timeToStart')).toBeUndefined();
    });

    it('does not honour a duration format on a path that is not in seconds', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const service = setupWithData('m', { targetUnit: 'HH:MM:SS' });
        expect(service.resolvePathMeasure('self.navigation.trip.log')).toBe('unitless');
        expect(service.resolvePathDurationFormat('self.navigation.trip.log')).toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(1);
      } finally {
        warn.mockRestore();
      }
    });
  });

  describe('formatDuration', () => {
    const CASES: [TDurationFormat, number, string][] = [
      ['HH:MM:SS', 0, '0:00'],
      ['HH:MM:SS', 45, '0:45'],
      ['HH:MM:SS', 1800, '30:00'],
      ['HH:MM:SS', 1799.9, '29:59'],
      ['HH:MM:SS', 3725, '1:02:05'],
      ['HH:MM:SS', 90000, '25:00:00'],
      ['HH:MM:SS', -1800, '-30:00'],
      ['HH:MM:SS', -0.4, '0:00'],
      ['MM:SS', 45, '0:45'],
      ['MM:SS', 3725, '62:05'],
      ['DD:HH:MM:SS', 1800, '30:00'],
      ['DD:HH:MM:SS', 90061, '1d 1:01:01'],
      ['DD:HH:MM:SS', -90061, '-1d 1:01:01'],
      ['HH:MM:SS.mmm', 0.57, '0:00.570'],
      ['HH:MM:SS.mmm', 1800.25, '30:00.250'],
      ['HH:MM:SS.mmm', 3725.04, '1:02:05.040'],
      ['MM:SS.mmm', 3725.5, '62:05.500'],
      ['duration-compact', 0, '0s'],
      ['duration-compact', 45, '45s'],
      ['duration-compact', 1799, '29m 59s'],
      ['duration-compact', 1800, '30m'],
      ['duration-compact', 3600, '1h'],
      ['duration-compact', 9045, '2h 30m'],
      ['duration-compact', 90061, '1d 1h'],
      ['duration-compact', -1800, '-30m'],
      ['duration-verbose', 0, '0 seconds'],
      ['duration-verbose', 1, '1 second'],
      ['duration-verbose', 3601, '1 hour 1 second'],
      ['duration-verbose', 9045, '2 hours 30 minutes 45 seconds'],
      ['duration-verbose', 86400, '1 day'],
      ['duration-verbose', -61, '-1 minute 1 second'],
    ];

    it.each(CASES)('formats %s %d s as %s', (format, seconds, expected) => {
      expect(setup().formatDuration(format, seconds)).toBe(expected);
    });
  });

  describe('getConversionsForPath for position coordinates and pointer paths', () => {
    // SI units as DataService reports them: a pointer path answers with its field's units.
    const UNITS: Record<string, string> = {
      'self.navigation.position#/latitude': 'deg',
      'self.navigation.position#/longitude': 'deg',
      'self.navigation.position#/altitude': 'm',
      'self.navigation.courseGreatCircle.nextPoint.position#/latitude': 'deg',
      'self.navigation.attitude#/roll': 'rad',
      'self.navigation.headingTrue': 'rad',
      'self.environment.sunlight.position#/elevation': 'deg',
    };

    function setupWithUnits(displayUnits: Record<string, ISkDisplayUnits> = {}): UnitsService {
      TestBed.resetTestingModule();
      const dataStub: Partial<DataService> = {
        getPathUnitType: path => UNITS[path] ?? null,
        getPathDisplayUnits: path => displayUnits[path],
      };
      TestBed.configureTestingModule({
        providers: [UnitsService, { provide: DataService, useValue: dataStub }],
      });
      return TestBed.inject(UnitsService);
    }

    const groups = (service: UnitsService, path: string) => service.getConversionsForPath(path).conversions.map(g => g.group);

    it.each([
      'self.navigation.position#/latitude',
      'self.navigation.position#/longitude',
      'self.navigation.courseGreatCircle.nextPoint.position#/latitude',
    ])('offers only the Position group for %s', path => {
      expect(groups(setupWithUnits(), path)).toEqual(['Position']);
    });

    it('offers the Length group for #/altitude, from the field\'s own unit', () => {
      expect(groups(setupWithUnits(), 'self.navigation.position#/altitude')).toEqual(['Length']);
    });

    it('offers the Angle group for a degree field that is not a coordinate', () => {
      expect(groups(setupWithUnits(), 'self.environment.sunlight.position#/elevation')).toEqual(['Angle']);
      expect(groups(setupWithUnits(), 'self.navigation.attitude#/roll')).toEqual(['Angle']);
    });

    it('still offers the Position-group unit a migrated v20 latitude slot stores', () => {
      const v20 = { paths: { numericPath: { path: 'self.navigation.position.latitude', convertUnitTo: 'latitudeMin' } } } as unknown as IWidgetSvcConfig;
      const slot = (migrateWidgetConfig('widget-numeric', v20, 20, CONSOLE_MIGRATION_SINK).paths as Record<string, IWidgetPath>)['numericPath'];

      expect(slot.path).toBe('self.navigation.position#/latitude');
      expect(slot.convertUnitTo).toBe('latitudeMin');
      const offered = setupWithUnits().getConversionsForPath(slot.path as string).conversions.flatMap(g => g.units.map(u => u.measure));
      expect(offered).toContain('latitudeMin');
    });

    it('resolves a field without a server preference to unitless, so the slot\'s stored unit applies', () => {
      expect(setupWithUnits().resolvePathMeasure('self.navigation.attitude#/roll')).toBe('unitless');
    });

    it('resolves a field to the display unit the server preferences give its SI unit', () => {
      const service = setupWithUnits({ 'self.navigation.attitude#/roll': { category: 'angle', targetUnit: 'degree' } });

      const measure = service.resolvePathMeasure('self.navigation.attitude#/roll');

      expect(measure).toBe('deg');
      expect(service.convertToUnit(measure, -0.0384)?.toFixed(1)).toBe('-2.2');
    });

    it('keeps a coordinate out of the angle preference its degrees would otherwise take', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const service = setupWithUnits({ 'self.navigation.position#/latitude': { category: 'angleDegrees', targetUnit: 'deg' } });

      expect(service.getConversionsForPath('self.navigation.position#/latitude')).toMatchObject({ base: 'unitless' });
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe('object fields with server unit preferences', () => {
    function setup(): { service: UnitsService; meta$: Subject<IMeta> } {
      TestBed.resetTestingModule();
      const meta$ = new Subject<IMeta>();
      const units = displayUnitsBySiUnit(
        { categoryToBaseUnit: { angle: 'rad', angleDegrees: 'deg', distance: 'm', depth: 'm' } },
        { categories: {
          angle: { baseUnit: 'rad', targetUnit: 'degree', symbol: '°' },
          angleDegrees: { baseUnit: 'deg', targetUnit: 'deg' },
          distance: { baseUnit: 'm', targetUnit: 'naut-mile' },
        } },
      );
      TestBed.configureTestingModule({
        providers: [
          UnitsService,
          DataService,
          {
            provide: SignalKDeltaService,
            useValue: {
              subscribeDataPathsUpdates: () => EMPTY,
              subscribeMetadataUpdates: () => meta$.asObservable(),
              subscribeNotificationsUpdates: () => EMPTY,
              subscribeSelfUpdates: () => EMPTY,
            },
          },
          { provide: UnitPreferencesService, useValue: { displayUnits$: new BehaviorSubject(units) } },
        ],
      });
      return { service: TestBed.inject(UnitsService), meta$ };
    }

    it('seeds the same resolved unit for each attitude field a slot is re-pointed to', () => {
      const { service, meta$ } = setup();
      meta$.next({ context: 'self', path: 'navigation.attitude', meta: { description: 'Attitude', properties: {
        roll: { type: 'number', units: 'rad' },
        pitch: { type: 'number', units: 'rad' },
      } } });

      expect(service.getConversionsForPath('self.navigation.attitude#/roll').base).toBe('deg');
      expect(service.getConversionsForPath('self.navigation.attitude#/pitch').base).toBe('deg');
    });

    it('keeps a field in SI when several categories share its SI unit', () => {
      const { service, meta$ } = setup();
      meta$.next({ context: 'self', path: 'navigation.position', meta: { description: 'Position', properties: {
        latitude: { type: 'number', units: 'deg' },
        altitude: { type: 'number', units: 'm' },
      } } });

      expect(service.resolvePathMeasure('self.navigation.position#/altitude')).toBe('unitless');
      expect(service.getConversionsForPath('self.navigation.position#/latitude')).toMatchObject({ base: 'unitless' });
      expect(service.getConversionsForPath('self.navigation.position#/latitude').conversions.map(g => g.group)).toEqual(['Position']);
    });
  });
});
