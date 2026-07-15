import { MatButtonModule } from '@angular/material/button';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { UnitsService } from './../../core/services/units.service';
import { Component, OnInit, input, inject, signal, computed, DestroyRef } from '@angular/core';
import { AbstractControl, FormControl, ReactiveFormsModule, ValidationErrors, ValidatorFn } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { DataService } from '../../core/services/data.service';
import { IUnitGroup } from '../../core/services/units.service';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatInputModule } from '@angular/material/input';
import { IPathMetaData, ISkPathData } from '../../core/interfaces/app-interfaces';
import { debounceTime } from 'rxjs';
import { RouterLink } from '@angular/router';

function pathRequiredOrValidMatch(getPaths: () => IPathMetaData[]): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    // If pathRequired is undefined or true, path is required and must be valid
    const required = control.parent?.value?.pathRequired !== false;
    const value = control.value;
    if (required) {
      // Required: must not be empty and must match a valid path
      if (value === null || value === '') {
        return { requireMatch: true };
      }
      const allPathsAndMeta = getPaths();
      const pathFound = allPathsAndMeta.some(array => array.path === value);
      return pathFound ? null : { requireMatch: true };
    } else {
      // Not required: valid if empty, or if matches a valid path
      if (value === null || value === '') {
        return null;
      }
      const allPathsAndMeta = getPaths();
      const pathFound = allPathsAndMeta.some(array => array.path === value);
      return pathFound ? null : { requireMatch: true };
    }
  };
}
@Component({
  selector: 'config-dataset-chart-options',
  imports: [MatIconModule, MatAutocompleteModule, MatCheckboxModule, MatFormFieldModule, MatSelectModule, MatInputModule, MatButtonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './dataset-chart-options.component.html',
  styleUrl: './dataset-chart-options.component.scss'
})
export class DatasetChartOptionsComponent implements OnInit {
  public convertUnitTo = input.required<FormControl<string | null>>();
  public datachartAngleRange = input<FormControl<'signed' | 'direction' | null> | undefined>(undefined);
  public filterSelfPaths = input.required<FormControl<boolean>>()
  public datachartPath = input.required<FormControl<string | null>>()
  public datachartSource = input.required<FormControl<string | null>>()
  public timeScale = input.required<FormControl<string>>();
  public period = input.required<FormControl<number>>()

  private readonly data = inject(DataService);
  private readonly units = inject(UnitsService);
  private readonly _destroyRef = inject(DestroyRef);

  protected numericPaths = signal<IPathMetaData[]>([]);
  protected filteredNumericPaths = signal<IPathMetaData[]>([]);
  protected unitList = signal<{default?: string, conversions?: IUnitGroup[] }>({});
  protected pathSources = signal<string[]>([]);
  protected maxDuration = computed<number>(() => this.timeScale().value === 'day' ? 365 : 60);

  ngOnInit(): void {
    this.numericPaths.set(this.data.getPathsAndMetaByType('number', false, false, this.filterSelfPaths().value).sort());
    this.filteredNumericPaths.set(this.numericPaths());

    this.datachartPath().valueChanges.pipe(debounceTime(300), takeUntilDestroyed(this._destroyRef)).subscribe(value => {
      const term = (value || '').toLowerCase().trim();
      if (!term) {
        this.filteredNumericPaths.set(this.numericPaths());
      } else {
        this.filteredNumericPaths.set(this.numericPaths().filter(p => p.path.toLowerCase().includes(term)));
      }
    });

    this.datachartPath().setValidators([pathRequiredOrValidMatch(() => this.getPaths())]);
    const currentPath = this.datachartPath()?.value;
    if (currentPath) {
      const pathObject = this.data.getPathObject(currentPath);
      this.setPathSources(pathObject);
      this.unitList.set(this.units.getConversionsForPath(currentPath));
    }
    this.setInitFormState();
  }

  private setInitFormState(reset = false): void {
    if (this.datachartSource().value && !reset) {
      this.datachartSource().enable();
    } else {
      this.datachartSource().reset();
      this.datachartSource().disable();
    }

    if ((this.convertUnitTo().value)  && !reset) {
      this.convertUnitTo().enable();
    } else {
      this.convertUnitTo().reset();
      this.convertUnitTo().disable();
    }

    if (this.timeScale().value) {
      this.timeScale().enable();
    } else {
      this.timeScale().disable();
    }

    if (this.period().value) {
      this.period().enable();
    } else {
      this.period().disable();
    }
  }

  private getPaths(): IPathMetaData[] {
    return this.data.getPathsAndMetaByType('number', false, false, this.filterSelfPaths().value).sort();
  }

  protected clearPathInputField(): void {
    this.datachartPath().setValue('');
    this.setInitFormState(true);
  }

  public changePath(e: MatAutocompleteSelectedEvent) { // called when we choose a new path. Resets the form old value with default info of this path
    const pathObject = this.data.getPathObject(e.option.value);
    if (pathObject === null) {
      this.pathSources.set([]);
      this.datachartSource().reset();
      this.datachartSource().disable();
      this.convertUnitTo().reset();
      this.convertUnitTo().disable();
      this.setPathUnits();
      return;
    }
    // A freshly chosen path must not carry over the previous path's concrete
    // source, which may not exist here. Clear it so setPathSources falls back
    // to "Any"; the ngOnInit load path calls setPathSources directly and keeps
    // the saved selection.
    this.datachartSource().reset();
    this.setPathSources(pathObject);
    this.setPathUnits(pathObject.path);
  }

  private setPathSources(pathObject: ISkPathData): void {
    // 'default' (shown as "Any") always leads the list: it reads the server's
    // merged, priority-selected value and follows source failover. Concrete
    // sources follow. An existing selection is preserved; otherwise default to "Any".
    this.pathSources.set(['default', ...Object.keys(pathObject.sources).sort()]);
    if (!this.datachartSource().value) {
      this.datachartSource().setValue('default');
    }
    this.datachartSource().enable();
  }

  private setPathUnits(path?: string): void {
    if (path) {
      this.unitList.set(this.units.getConversionsForPath(path));
      this.convertUnitTo().reset();
      this.convertUnitTo()?.enable();
    } else {
      this.unitList.set(this.units.getConversionsForPath(''));
      this.convertUnitTo().reset();
      this.convertUnitTo()?.disable();
    }
  }
}
