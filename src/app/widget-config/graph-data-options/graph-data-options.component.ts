import { MatButtonModule } from '@angular/material/button';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { Component, OnInit, input, inject, signal, computed, DestroyRef } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { DataService } from '../../core/services/data.service';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatInputModule } from '@angular/material/input';
import { IPathMetaData, ISkPathData } from '../../core/interfaces/app-interfaces';
import { debounceTime } from 'rxjs';
import { RouterLink } from '@angular/router';
import { pathRequiredValidator, pathSlotWarning } from '../../core/utils/path-validators.util';

@Component({
  selector: 'config-graph-data-options',
  imports: [MatIconModule, MatAutocompleteModule, MatCheckboxModule, MatFormFieldModule, MatSelectModule, MatInputModule, MatButtonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './graph-data-options.component.html',
  styleUrl: './graph-data-options.component.scss'
})
export class GraphDataOptionsComponent implements OnInit {
  public datachartAngleRange = input<FormControl<'signed' | 'direction' | null> | undefined>(undefined);
  public filterSelfPaths = input.required<FormControl<boolean>>()
  public datachartPath = input.required<FormControl<string | null>>()
  public datachartSource = input.required<FormControl<string | null>>()
  public timeScale = input.required<FormControl<string>>();
  public period = input.required<FormControl<number>>()

  private readonly data = inject(DataService);
  private readonly _destroyRef = inject(DestroyRef);

  protected numericPaths = signal<IPathMetaData[]>([]);
  protected filteredNumericPaths = signal<IPathMetaData[]>([]);
  protected pathSources = signal<string[]>([]);
  /** Why the configured path is not offered for this graph, or null. A caution, never a save-blocking error. */
  protected pathWarning = signal<string | null>(null);
  /** The path `pathSources` was last built for, so re-deriving needs a real path change. */
  private _sourcesForPath: string | null = null;
  protected maxDuration = computed<number>(() => this.timeScale().value === 'day' ? 365 : 60);

  ngOnInit(): void {
    this.refreshNumericPaths();
    this.filteredNumericPaths.set(this.numericPaths());

    this.datachartPath().valueChanges.pipe(debounceTime(300), takeUntilDestroyed(this._destroyRef)).subscribe(value => {
      this.refreshNumericPaths();
      const term = (value || '').toLowerCase().trim();
      if (!term) {
        this.filteredNumericPaths.set(this.numericPaths());
      } else {
        this.filteredNumericPaths.set(this.numericPaths().filter(p => p.path.toLowerCase().includes(term)));
      }
      this.refreshPathWarning(value);
      // An unoffered path never appears in the autocomplete, so typing is the only way to enter one
      // and (optionSelected) never fires. Re-derive here too, or the previous path's concrete source
      // stays pinned to a path that will never fill it.
      if (value !== this._sourcesForPath) {
        this.datachartSource().reset();
        this.setPathSourcesFor(value);
      }
    });

    this.datachartPath().setValidators([pathRequiredValidator]);
    this.datachartPath().updateValueAndValidity({ emitEvent: false });
    const currentPath = this.datachartPath()?.value;
    this.refreshPathWarning(currentPath);
    this.setPathSourcesFor(currentPath);
    this.setInitFormState();
  }

  private refreshNumericPaths(): void {
    this.numericPaths.set(this.getPaths());
  }

  private refreshPathWarning(path: string | null): void {
    this.pathWarning.set(pathSlotWarning(path, path ? this.data.getPathObject(path) : null, {
      pathType: 'number', supportsPutOnly: false, zonesOnly: false, selfOnly: this.filterSelfPaths().value
    }));
  }

  /**
   * Build the Source list for `path`, keeping the select usable when the server is not sending that
   * path: its sources are unknown, so surface the stored one alongside "Any" rather than leaving an
   * enabled, required select with no options and no match for its own value.
   */
  private setPathSourcesFor(path: string | null): void {
    this._sourcesForPath = path;
    const pathObject = path ? this.data.getPathObject(path) : null;
    if (pathObject) {
      this.setPathSources(pathObject);
      return;
    }
    if (!path) {
      this.pathSources.set([]);
      return;
    }
    const storedSource = this.datachartSource().value;
    this.pathSources.set(storedSource && storedSource !== 'default' ? ['default', storedSource] : ['default']);
    if (!storedSource) {
      this.datachartSource().setValue('default');
    }
    this.datachartSource().enable();
  }

  private setInitFormState(reset = false): void {
    if (this.datachartSource().value && !reset) {
      this.datachartSource().enable();
    } else {
      this.datachartSource().reset();
      this.datachartSource().disable();
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
      return;
    }
    // A freshly chosen path must not carry over the previous path's concrete
    // source, which may not exist here. Clear it so setPathSources falls back
    // to "Any"; the ngOnInit load path calls setPathSources directly and keeps
    // the saved selection.
    this.datachartSource().reset();
    this.setPathSources(pathObject);
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
}
