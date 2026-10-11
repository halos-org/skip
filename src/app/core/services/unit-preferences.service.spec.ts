import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { BehaviorSubject } from 'rxjs';
import { displayUnitsBySiUnit, UnitPreferencesService } from './unit-preferences.service';
import { SignalKConnectionService } from './signalk-connection.service';

const CATEGORIES = {
  categoryToBaseUnit: { angle: 'rad', speed: 'm/s', distance: 'm', depth: 'm', time: 's', temperature: 'K' },
};

// The shape of `GET /signalk/v1/unitpreferences/active` for the built-in "Nautical (Metric)" preset.
const ACTIVE = {
  name: 'Nautical (Metric)',
  categories: {
    angle: { baseUnit: 'rad', targetUnit: 'degree', displayFormat: '0.0', formula: 'value * 57.29577951308231', inverseFormula: 'value / 57.29577951308231', symbol: '°' },
    speed: { baseUnit: 'm/s', targetUnit: 'kn', displayFormat: '0.0', formula: 'value * 1.94384', inverseFormula: 'value * 0.514444', symbol: 'kn' },
    distance: { baseUnit: 'm', targetUnit: 'naut-mile', displayFormat: '0.0', symbol: 'nmi' },
    depth: { baseUnit: 'm', targetUnit: 'm', displayFormat: '0.0' },
  },
};

describe('displayUnitsBySiUnit', () => {
  it('maps an SI unit with one category to the preset target for that category', () => {
    expect(displayUnitsBySiUnit(CATEGORIES, ACTIVE).get('rad')).toEqual({
      category: 'angle',
      targetUnit: 'degree',
      displayFormat: '0.0',
      formula: 'value * 57.29577951308231',
      inverseFormula: 'value / 57.29577951308231',
      symbol: '°',
    });
  });

  it('leaves out an SI unit that several categories share', () => {
    expect(displayUnitsBySiUnit(CATEGORIES, ACTIVE).has('m')).toBe(false);
  });

  it('leaves out a category the preset gives no target', () => {
    const units = displayUnitsBySiUnit(CATEGORIES, ACTIVE);

    expect(units.has('K')).toBe(false);
    expect(units.has('s')).toBe(false);
  });
});

describe('UnitPreferencesService', () => {
  const API = 'http://boat.local:3000/signalk/v1/api/';
  let endpoint$: BehaviorSubject<{ httpServiceUrl: string | null }>;
  let http: HttpTestingController;
  let service: UnitPreferencesService;

  beforeEach(() => {
    endpoint$ = new BehaviorSubject<{ httpServiceUrl: string | null }>({ httpServiceUrl: null });
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: SignalKConnectionService,
          useValue: { serverServiceEndpoint$: endpoint$, serverVersion$: new BehaviorSubject<string | null>(null) },
        },
      ],
    });
    service = TestBed.inject(UnitPreferencesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function answer(categories: object, active: object, root = 'http://boat.local:3000'): void {
    http.expectOne(`${root}/signalk/v1/unitpreferences/categories`).flush(categories);
    http.expectOne(`${root}/signalk/v1/unitpreferences/active`).flush(active);
  }

  it('loads the preferences once the server endpoint is known', () => {
    expect(service.displayUnits$.value).toBeNull();

    endpoint$.next({ httpServiceUrl: API });
    answer(CATEGORIES, ACTIVE);

    expect(service.displayUnits$.value?.get('rad')?.targetUnit).toBe('degree');
  });

  it('does not refetch when the endpoint re-emits the same server', () => {
    endpoint$.next({ httpServiceUrl: API });
    answer(CATEGORIES, ACTIVE);

    endpoint$.next({ httpServiceUrl: API });

    http.expectNone(() => true);
  });

  it('drops the previous server\'s preferences while another server\'s load is pending', () => {
    endpoint$.next({ httpServiceUrl: API });
    answer(CATEGORIES, ACTIVE);

    endpoint$.next({ httpServiceUrl: 'http://other.local:3000/signalk/v1/api/' });

    expect(service.displayUnits$.value).toBeNull();
    answer(CATEGORIES, { categories: { speed: ACTIVE.categories.speed } }, 'http://other.local:3000');
    expect(service.displayUnits$.value?.has('rad')).toBe(false);
    expect(service.displayUnits$.value?.get('m/s')?.targetUnit).toBe('kn');
  });

  it('drops the preferences when the connection loses its endpoint', () => {
    endpoint$.next({ httpServiceUrl: API });
    answer(CATEGORIES, ACTIVE);

    endpoint$.next({ httpServiceUrl: null });

    expect(service.displayUnits$.value).toBeNull();
  });
});
