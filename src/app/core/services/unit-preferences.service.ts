import { HttpClient } from '@angular/common/http';
import { DestroyRef, inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject, distinctUntilChanged, forkJoin, map, Observable, of, startWith, switchMap } from 'rxjs';
import { ISkDisplayUnits } from '../interfaces/signalk-interfaces';
import { resolveSignalKServerRoot } from '../utils/signalk-plugin-url.util';
import { SignalKConnectionService } from './signalk-connection.service';

/** `GET /signalk/v1/unitpreferences/categories`, reduced to what Skip reads. */
interface IUnitCategories {
  categoryToBaseUnit: Record<string, string>;
}

/** `GET /signalk/v1/unitpreferences/active`, reduced to what Skip reads. */
interface IActivePreset {
  categories: Record<string, ISkDisplayUnits & { baseUnit?: string }>;
}

/**
 * The display units the active preset gives each SI unit, keyed by that SI unit. An SI unit is
 * included only when exactly one category has it as its base unit and the preset sets a target for
 * that category: `m` belongs to distance, depth and length, and the server's tie-break between them
 * is not reproduced.
 */
export function displayUnitsBySiUnit(categories: IUnitCategories, preset: IActivePreset): Map<string, ISkDisplayUnits> {
  const categoriesBySiUnit = new Map<string, string[]>();
  for (const [category, siUnit] of Object.entries(categories.categoryToBaseUnit)) {
    categoriesBySiUnit.set(siUnit, [...(categoriesBySiUnit.get(siUnit) ?? []), category]);
  }
  const result = new Map<string, ISkDisplayUnits>();
  for (const [siUnit, [category, ...others]] of categoriesBySiUnit) {
    const target = preset.categories[category];
    if (others.length > 0 || !target?.targetUnit) continue;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { baseUnit, ...displayUnits } = target;
    result.set(siUnit, { category, ...displayUnits });
  }
  return result;
}

/**
 * The server's unit preferences, for values the server cannot attach `displayUnits` to: the fields
 * of an object path. Loaded from the unit-preferences API whenever
 * the connection reaches a new server. `/active` is the server-wide preset, not a user's own.
 */
@Injectable({ providedIn: 'root' })
export class UnitPreferencesService {
  private readonly http = inject(HttpClient);
  private readonly connection = inject(SignalKConnectionService);

  /** Display units by SI unit (see {@link displayUnitsBySiUnit}); null until the current server's preferences have loaded. */
  public readonly displayUnits$ = new BehaviorSubject<ReadonlyMap<string, ISkDisplayUnits> | null>(null);

  constructor() {
    this.connection.serverServiceEndpoint$.pipe(
      map(endpoint => resolveSignalKServerRoot(endpoint?.httpServiceUrl)),
      distinctUntilChanged(),
      // A new server starts empty, so no field takes the previous server's units while its own loads.
      switchMap(root => root ? this.load(`${root}/signalk/v1/unitpreferences`).pipe(startWith(null)) : of(null)),
      takeUntilDestroyed(inject(DestroyRef)),
    ).subscribe(units => this.displayUnits$.next(units));
  }

  private load(baseUrl: string): Observable<Map<string, ISkDisplayUnits>> {
    return forkJoin([
      this.http.get<IUnitCategories>(`${baseUrl}/categories`),
      this.http.get<IActivePreset>(`${baseUrl}/active`),
    ]).pipe(
      map(([categories, preset]) => displayUnitsBySiUnit(categories, preset)),
    );
  }
}
