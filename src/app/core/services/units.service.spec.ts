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
});
