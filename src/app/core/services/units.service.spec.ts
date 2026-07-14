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
});
