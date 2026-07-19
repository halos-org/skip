import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { signal, WritableSignal } from '@angular/core';
import { UnitsService, IUnitDefaults } from './units.service';
import { SettingsService } from './settings.service';
import { DataService } from './data.service';

describe('UnitsService', () => {
  let unitDefaults: WritableSignal<IUnitDefaults>;

  function setup(initial: IUnitDefaults): UnitsService {
    unitDefaults = signal<IUnitDefaults>(initial);
    const settingsStub: Partial<SettingsService> = { unitDefaults };
    TestBed.configureTestingModule({
      providers: [
        UnitsService,
        { provide: SettingsService, useValue: settingsStub },
        { provide: DataService, useValue: {} },
      ],
    });
    return TestBed.inject(UnitsService);
  }

  it('seeds the default units synchronously at construction', () => {
    const service = setup({ Speed: 'knots' });
    expect(service.getDefaults()).toEqual({ Speed: 'knots' });
  });

  it('tracks a runtime change to the default units through the effect', () => {
    const service = setup({ Speed: 'knots' });

    unitDefaults.set({ Speed: 'kph' });
    TestBed.tick();

    expect(service.getDefaults()).toEqual({ Speed: 'kph' });
  });

  describe('getUnitDisplaySymbol', () => {
    it('returns the dedicated display symbol for a measure', () => {
      const service = setup({});
      expect(service.getUnitDisplaySymbol('knots')).toBe('kn');
      expect(service.getUnitDisplaySymbol('celsius')).toBe('°C');
      expect(service.getUnitDisplaySymbol('kph')).toBe('km/h');
      expect(service.getUnitDisplaySymbol('percent')).toBe('%');
      expect(service.getUnitDisplaySymbol('latitudeMin')).toBe('lat ′');
    });

    it('falls back to the raw measure when it has no dedicated symbol', () => {
      const service = setup({});
      expect(service.getUnitDisplaySymbol('mph')).toBe('mph');
      expect(service.getUnitDisplaySymbol('m/s')).toBe('m/s');
    });

    it('returns an unknown measure unchanged, and empty string for null/undefined/empty', () => {
      const service = setup({});
      expect(service.getUnitDisplaySymbol('not-a-unit')).toBe('not-a-unit');
      expect(service.getUnitDisplaySymbol(null)).toBe('');
      expect(service.getUnitDisplaySymbol(undefined)).toBe('');
      expect(service.getUnitDisplaySymbol('')).toBe('');
    });
  });

  describe('getConversionsForPath server displayUnits (#246 Phase 1)', () => {
    // Build a UnitsService whose DataService reports a path's SI unit + optional server displayUnits.
    function setupWithData(
      defaults: IUnitDefaults,
      pathUnitType: string | null,
      displayUnits?: { targetUnit?: string },
    ): UnitsService {
      TestBed.resetTestingModule();
      unitDefaults = signal<IUnitDefaults>(defaults);
      const settingsStub: Partial<SettingsService> = { unitDefaults };
      const dataStub: Partial<DataService> = {
        getPathUnitType: () => pathUnitType,
        getPathDisplayUnits: () => displayUnits,
      };
      TestBed.configureTestingModule({
        providers: [
          UnitsService,
          { provide: SettingsService, useValue: settingsStub },
          { provide: DataService, useValue: dataStub },
        ],
      });
      return TestBed.inject(UnitsService);
    }

    it("prefers the server targetUnit (aliased to a Skip measure) over the group default", () => {
      const service = setupWithData({ Speed: 'mph' }, 'm/s', { targetUnit: 'kn' });
      // Server 'kn' maps to Skip 'knots' and wins over the user's per-group default 'mph'.
      expect(service.getConversionsForPath('self.navigation.speedOverGround').base).toBe('knots');
    });

    it('uses a server targetUnit that already equals a Skip measure directly (mbar)', () => {
      const service = setupWithData({ Pressure: 'psi' }, 'Pa', { targetUnit: 'mbar' });
      expect(service.getConversionsForPath('self.environment.outside.pressure').base).toBe('mbar');
    });

    it('falls back to the group default when the path has no server displayUnits', () => {
      const service = setupWithData({ Speed: 'mph' }, 'm/s', undefined);
      expect(service.getConversionsForPath('self.navigation.speedOverGround').base).toBe('mph');
    });

    it('falls back to the group default when the server targetUnit is not honourable for the group', () => {
      const service = setupWithData({ Speed: 'mph' }, 'm/s', { targetUnit: 'furlong-per-fortnight' });
      expect(service.getConversionsForPath('self.navigation.speedOverGround').base).toBe('mph');
    });

    it('resolves the ambiguous C alias to celsius for a temperature path (not Charge Coulomb)', () => {
      const service = setupWithData({ Temperature: 'K' }, 'K', { targetUnit: 'C' });
      expect(service.getConversionsForPath('self.environment.water.temperature').base).toBe('celsius');
    });

    it('does not mis-apply the C->celsius alias on a Charge path (celsius not in group -> fall back)', () => {
      // A charge path's SI unit is 'C' (Coulomb); a stray targetUnit 'C' must not become celsius.
      const service = setupWithData({ Charge: 'Ah' }, 'C', { targetUnit: 'C' });
      expect(service.getConversionsForPath('self.electrical.batteries.house.capacity').base).toBe('Ah');
    });

    it('maps every non-identity server target through to a valid group measure', () => {
      // The exact aliased VALUES are load-bearing (the group guard matches them literally).
      expect(setupWithData({}, 'm', { targetUnit: 'naut-mile' }).getConversionsForPath('self.navigation.trip.log').base).toBe('nm');
      expect(setupWithData({}, 'rad', { targetUnit: 'degree' }).getConversionsForPath('self.navigation.headingTrue').base).toBe('deg');
      expect(setupWithData({}, 's', { targetUnit: 'hour' }).getConversionsForPath('self.navigation.trip.timeElapsed').base).toBe('Hours');
    });

    it('keeps the label-matches-conversion invariant for every aliased category (symbol + working conversion)', () => {
      // Empty defaults, so the server value is the SOLE base source — proves the invariant holds
      // across the alias set, not just for one measure.
      const cases: { unit: string; target: string; measure: string }[] = [
        { unit: 'm/s', target: 'kn', measure: 'knots' },
        { unit: 'K', target: 'C', measure: 'celsius' },
        { unit: 'm', target: 'naut-mile', measure: 'nm' },
        { unit: 'rad', target: 'degree', measure: 'deg' },
        { unit: 's', target: 'hour', measure: 'Hours' },
        { unit: 'Pa', target: 'mbar', measure: 'mbar' },
      ];
      for (const c of cases) {
        const service = setupWithData({}, c.unit, { targetUnit: c.target });
        const base = service.getConversionsForPath('self.some.path').base;
        expect(base, `target ${c.target}`).toBe(c.measure);
        // The one base drives BOTH a non-empty symbol AND a finite conversion.
        expect(service.getUnitDisplaySymbol(base), `symbol for ${base}`).not.toBe('');
        expect(Number.isFinite(service.convertToUnit(base, 1) as number), `conversion for ${base}`).toBe(true);
      }
    });

    it('every conversion-list measure drives BOTH a working conversion and a non-empty symbol (label-matches-conversion, comprehensively)', () => {
      // Underpins the whole Phase-2 resolver: because every group-valid measure both converts and
      // labels, resolving a server target (or the client default) to any group-valid measure yields a
      // real value AND a matching symbol from one source. Fails loudly if a future measure is added to
      // the table without a conversion function or a resolvable symbol.
      const service = setup({});
      for (const group of service.getConversions()) {
        for (const unit of group.units) {
          expect(service.convertToUnit(unit.measure, 1), `conversion ${unit.measure}`).not.toBeNull();
          expect(service.getUnitDisplaySymbol(unit.measure), `symbol ${unit.measure}`).not.toBe('');
        }
      }
    });

    // --- Phase 2 (#347): the public per-path measure resolver ---
    it('resolvePathMeasure returns the honourable server preference over the group default', () => {
      const service = setupWithData({ Speed: 'mph' }, 'm/s', { targetUnit: 'kn' });
      expect(service.resolvePathMeasure('self.navigation.speedOverGround')).toBe('knots');
    });

    it('resolvePathMeasure falls back to the group default when there is no server preference', () => {
      const service = setupWithData({ Speed: 'mph' }, 'm/s', undefined);
      expect(service.resolvePathMeasure('self.navigation.speedOverGround')).toBe('mph');
    });

    it('resolvePathMeasure returns unitless for a path with no SI unit', () => {
      const service = setupWithData({}, null, undefined);
      expect(service.resolvePathMeasure('self.some.stringPath')).toBe('unitless');
    });

    it('resolvePathMeasure never drifts from getConversionsForPath().base', () => {
      const service = setupWithData({ Temperature: 'K' }, 'K', { targetUnit: 'C' });
      const path = 'self.environment.water.temperature';
      expect(service.resolvePathMeasure(path)).toBe(service.getConversionsForPath(path).base);
    });
  });
});
