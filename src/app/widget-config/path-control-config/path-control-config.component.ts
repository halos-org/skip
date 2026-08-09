import { Component, OnInit, OnChanges, SimpleChange, input, inject, signal, DestroyRef } from '@angular/core';
import { DataService } from '../../core/services/data.service';
import { IPathMetaData } from "../../core/interfaces/app-interfaces";
import { IConversionPathList, ISkBaseUnit, UnitsService } from '../../core/services/units.service';
import { UntypedFormGroup, AbstractControl, FormsModule, ReactiveFormsModule, FormControl, FormGroup } from '@angular/forms';
import { debounce, map, startWith } from 'rxjs/operators';
import { BehaviorSubject, timer } from 'rxjs'
import { MatSelect } from '@angular/material/select';
import { MatOption } from '@angular/material/core';
import { MatIconButton } from '@angular/material/button';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatInput } from '@angular/material/input';
import { MatFormField, MatLabel, MatSuffix, MatError, MatHint } from '@angular/material/form-field';
import { AsyncPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { compare } from 'compare-versions';
import { SignalKConnectionService } from '../../core/services/signalk-connection.service';
import { IDynamicControl } from '../../core/interfaces/widgets-interface';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { IPathSlotRequirements, pathRequiredValidator, pathSlotWarning } from '../../core/utils/path-validators.util';

@Component({
    selector: 'path-control-config',
    templateUrl: './path-control-config.component.html',
    styleUrls: ['./path-control-config.component.scss'],
    imports: [FormsModule, ReactiveFormsModule, MatFormField, MatLabel, MatInput, MatAutocompleteModule, MatIconButton, MatSuffix, MatOption, MatError, MatSelect, AsyncPipe, MatIconModule, MatHint]
})
export class PathControlConfigComponent implements OnInit, OnChanges {
  private readonly _data = inject(DataService);
  private readonly _units = inject(UnitsService);
  private readonly _connection = inject(SignalKConnectionService);
  private readonly _destroyRef = inject(DestroyRef);

  readonly pathFormGroup = input.required<UntypedFormGroup>();
  readonly multiCTRLArray = input.required<IDynamicControl[]>();
  readonly filterSelfPaths = input.required<boolean>();

  public availablePaths: IPathMetaData[] = [];
  public filteredPaths = new BehaviorSubject<IPathMetaData[] | null>(null);
  /** Why the configured path is not offered for this slot, or null. A caution, never a save-blocking error. */
  public readonly pathWarning = signal<string | null>(null);
  /** The path `source` and `convertUnitTo` were last derived for, so re-deriving needs a real path change. */
  private _derivedForPath: string | null = null;

  // Sources control
  public availableSources: string[] = [];

  // Units control
  public unitList: IConversionPathList = {base: '', conversions: []};
  public showPathSkUnitsFilter = false;
  public pathSkUnitsFilterControl = new FormControl<ISkBaseUnit | null>(null);
  public pathSkUnitsFiltersList: ISkBaseUnit[] = [];
  public readonly unitlessUnit: ISkBaseUnit = {unit: 'unitless', properties: {display: '(null)', quantity: 'Unitless', quantityDisplay: '(null)', description: '', }};

  ngOnInit() {
    const pathFormGroup = this.pathFormGroup();
    const hasChoices = (pathFormGroup.value.pathOptions?.length ?? 0) > 0;
    // A fixed (disabled-path) or choice path keeps an editable Data Source but skips the free-path
    // autocomplete machinery (unit filter, live-list validation, autocomplete filtering). Its Source
    // is driven off the resolved stored path, so it stays valid and saveable without live data.
    if (hasChoices || pathFormGroup.controls['path'].disabled) {
      this.setupSourceFor(pathFormGroup.controls['path'].value);
      return;
    }
    // Path Unit filter setup
    this.pathSkUnitsFiltersList = this._units.skBaseUnits.sort((a, b) => {
      return a.properties.quantity > b.properties.quantity ? 1 : -1;
    });
    this.pathSkUnitsFiltersList.unshift(this.unitlessUnit);

    if (pathFormGroup.value.pathSkUnitsFilter) {
      this.pathSkUnitsFilterControl.setValue(this.pathSkUnitsFiltersList.find(item => item.unit === this.pathFormGroup().value.pathSkUnitsFilter) ?? null, { onlySelf: true });
    }

    if (pathFormGroup.value.showPathSkUnitsFilter) {
      this.showPathSkUnitsFilter = pathFormGroup.value.showPathSkUnitsFilter;
    }

    pathFormGroup.controls['path'].setValidators([pathRequiredValidator]);
    pathFormGroup.controls['path'].updateValueAndValidity({onlySelf: true, emitEvent: false});
    this.refreshPathWarning();
    // Subscribe to pathRequired changes to re-validate path
    if (pathFormGroup.controls['pathRequired']) {
      pathFormGroup.controls['pathRequired'].valueChanges.pipe(takeUntilDestroyed(this._destroyRef)).subscribe(() => {
        this.pathFormGroup().controls['path'].updateValueAndValidity();
      });
    }
    if (pathFormGroup.controls['path'].valid) {
      this.enableFormFields(false);
    } else {
      this.disablePathFields();
    }

    // subscribe to path formControl changes
    pathFormGroup.controls['path'].valueChanges.pipe(
      debounce(value => value === '' ? timer(0) : timer(350)),
      startWith(''),
      map(value => this.filterPaths(value || '')))
      .pipe(takeUntilDestroyed(this._destroyRef)).subscribe(() => {
        const pathFormGroupValue = this.pathFormGroup();
        this.refreshPathWarning();
        if (pathFormGroupValue.controls['path'].pristine) {
          return;
        } else {
          const path = pathFormGroupValue.controls['path'].value;
          if (pathFormGroupValue.controls['path'].valid){
            // Any keystroke marks the control dirty, including one that lands back on the value we
            // started from. Re-derive the dependent fields only when the path itself moved, or
            // editing and undoing an edit would clear the source and unit this slot already had.
            this.enableFormFields(path !== this._derivedForPath);
            this.updatePathMetaBoundDisplayName(path);
            this.updatePathMetaBoundDisplayScale(path);
          } else {
            this.disablePathFields();
          }
        }
      }
    );

    pathFormGroup.controls['pathType'].valueChanges.pipe(takeUntilDestroyed(this._destroyRef)).subscribe(() => {
      const pathFormGroupValue = this.pathFormGroup();
      if (pathFormGroupValue.value.showPathSkUnitsFilter) {
        this.pathSkUnitsFilterControl.setValue(this.unitlessUnit);
      } else {
        this.pathSkUnitsFilterControl.setValue(null);
      }
      pathFormGroupValue.controls['path'].updateValueAndValidity();
      this.refreshPathWarning();
    });
  }

  ngOnChanges(changes: Record<string, SimpleChange>) {
    //subscribe to filterSelfPaths parent formControl changes
    if (changes['filterSelfPaths'] && !changes['filterSelfPaths'].firstChange) {
      this.pathFormGroup().controls['path'].updateValueAndValidity();
      this.refreshPathWarning();
    }
  }

  /** Both the offered list and the path can move; recompute after either changes. */
  private refreshPathWarning(): void {
    const path = this.pathFormGroup().controls['path'].value;
    this.pathWarning.set(pathSlotWarning(path, this._data.getPathObject(path), this.slotRequirements()));
  }

  /** What this slot demands of a path — the filters behind both the offered list and the warning. */
  private slotRequirements(): IPathSlotRequirements {
    const pathFormGroup = this.pathFormGroup();
    let supportsPUT = false;
    if (pathFormGroup.value.supportsPut) {
      let isMultiCTRLTypeLight = false;
      if (this.multiCTRLArray().length > 0) {
        isMultiCTRLTypeLight = this.multiCTRLArray().some((ctrlItem: IDynamicControl) =>
            ctrlItem.pathID === this.pathFormGroup().value.pathID && ctrlItem.type === '3' // type 3 = light
          );
      }

      if (isMultiCTRLTypeLight) {
        supportsPUT = false;
      } else {
        supportsPUT = this._connection.skServerVersion != null && compare(this._connection.skServerVersion, '2.12.0', ">=") ? pathFormGroup.value.supportsPut : false;
      }
    }

    return {
      pathType: pathFormGroup.controls['pathType'].value,
      supportsPutOnly: supportsPUT,
      zonesOnly: pathFormGroup.value.zonesOnlyPaths ?? false,
      selfOnly: this.filterSelfPaths()
    };
  }

  private getPaths(): IPathMetaData[] {
    const req = this.slotRequirements();
    return this._data.getPathsAndMetaByType(req.pathType, req.supportsPutOnly, req.zonesOnly, req.selfOnly).sort();
  }

  public filterPaths(searchString: string) {
    const filterString = searchString.toLowerCase();
    let filteredPaths = this.getPaths();

    // If a unit filter is set, apply it first
    if (this.pathSkUnitsFilterControl.value) {
      const selectedUnit = this.pathSkUnitsFilterControl.value.unit;
      filteredPaths = filteredPaths.filter(item => {
        const hasUnits = !!item.meta && !!item.meta.units;
        const isUnitless = selectedUnit === 'unitless';
        const matchesUnit = hasUnits && item.meta?.units === selectedUnit;
        const isActuallyUnitless = !hasUnits && isUnitless;
        return matchesUnit || isActuallyUnitless;
      });
    }

    // Then filter based on the path
    filteredPaths = filteredPaths.filter(item => item.path.toLowerCase().includes(filterString));
    this.filteredPaths.next(filteredPaths);
  }

  /**
   * Populate and enable the Data Source control for a fixed or choice path, off the RESOLVED stored
   * path rather than `path.valid` (a fixed path's control is disabled and reports invalid, which would
   * otherwise disable the Source). 'Any' (default) always leads and is a valid value, so the form is
   * saveable even before the path has reported live data; a pinned source the current path no longer
   * offers falls back to 'Any'.
   */
  private setupSourceFor(path: string | null): void {
    const pathObject = path ? this._data.getPathObject(path) : null;
    const sourceControl = this.pathFormGroup().controls['source'];
    const storedSource = sourceControl.value;
    if (pathObject != null) {
      this.availableSources = ['default', ...Object.keys(pathObject.sources).sort()];
      if (!storedSource || !this.availableSources.includes(storedSource)) {
        sourceControl.setValue('default', { onlySelf: true });
      }
    } else {
      // Path has no live data yet (instrument off / boat at dock): we can't tell whether a pinned
      // source is still offered, so keep it rather than clobbering it to 'Any', and surface it so
      // the select can display it. Only a genuinely empty source falls back to a valid default.
      this.availableSources = storedSource && storedSource !== 'default'
        ? ['default', storedSource]
        : ['default'];
      if (!storedSource) {
        sourceControl.setValue('default', { onlySelf: true });
      }
    }
    sourceControl.enable({ onlySelf: false });
  }

  /** A choice select changed the bound `path`: recompute the sources the newly selected path offers. */
  protected onPathChoiceChange(): void {
    this.setupSourceFor(this.pathFormGroup().controls['path'].value);
  }

  private enableFormFields(setValues?: boolean): void {
    const path = this.pathFormGroup().controls['path'].value;
    this._derivedForPath = path;
    const pathObject = this._data.getPathObject(path);
    if (pathObject != null) {
      const pathFormGroup = this.pathFormGroup();
      if (pathFormGroup.controls['pathType'].value == 'number') { // convertUnitTo control not present unless pathType is number
        this.unitList = this._units.getConversionsForPath(pathFormGroup.controls['path'].value); // array of Group or Groups: "angle", "speed", etc...
        if (setValues) {
          pathFormGroup.controls['convertUnitTo'].setValue(this.unitList.base, {onlySelf: true});
        }
        pathFormGroup.controls['convertUnitTo'].enable({onlySelf: false});
      }

      // 'default' (shown as "Any") always leads the list: it reads the server's
      // merged, priority-selected value and follows source failover. Concrete
      // sources follow, letting the user pin to one. A fresh path defaults to
      // "Any"; an existing selection is preserved.
      this.availableSources = ['default', ...Object.keys(pathObject.sources).sort()];
      const sourceControl = pathFormGroup.controls['source'];
      if (setValues || !sourceControl.value) {
        sourceControl.setValue('default', {onlySelf: true});
      }
      sourceControl.enable({onlySelf: false});
    } else if (path) {
      // The server does not publish this path right now (instrument off / boat at dock). The stored
      // source and unit conversion are still the right ones, and the dialog saves with getRawValue(),
      // so clearing them here would be persisted the moment the user hits Save. A path the user just
      // changed carries nothing worth keeping, so re-derive both: "Any" source, no conversion.
      const pathFormGroup = this.pathFormGroup();
      if (pathFormGroup.controls['pathType'].value == 'number') {
        if (setValues) {
          pathFormGroup.controls['convertUnitTo'].setValue('', {onlySelf: true});
        }
        // Enable regardless, so the control's state depends only on whether a path is configured —
        // an earlier disablePathFields() would otherwise leave it disabled for this path alone.
        pathFormGroup.controls['convertUnitTo'].enable({onlySelf: false});
      }
      if (setValues) {
        pathFormGroup.controls['source'].setValue('default', {onlySelf: true});
      }
      this.setupSourceFor(path);
    } else {
      // No path configured at all — an optional slot left blank has nothing to source or convert.
      this.disablePathFields();
    }
  }

  private disablePathFields(): void {
    this.pathFormGroup().controls['source'].reset('', {onlySelf: true});
    this.pathFormGroup().controls['source'].disable({onlySelf: false});
    const pathFormGroup = this.pathFormGroup();
    if (pathFormGroup.controls['pathType'].value == 'number') { // convertUnitTo control not present unless pathType is number
      pathFormGroup.controls['convertUnitTo'].reset('', {onlySelf: true});
      pathFormGroup.controls['convertUnitTo'].disable({onlySelf: false});
    }
  }

  private updatePathMetaBoundDisplayName(path: string) {
    const pathFormGroup = this.pathFormGroup();
    if (!pathFormGroup.parent?.parent?.value || !Object.prototype.hasOwnProperty.call(pathFormGroup.parent.parent.value, 'displayName')) { return; }
    const meta = this._data.getPathMeta(path);
    if (meta?.displayName && 'displayName' in pathFormGroup.parent.parent.controls) {
      (pathFormGroup.parent.parent.get('displayName') as AbstractControl | null)?.setValue(meta.displayName);
    }
  }

  private updatePathMetaBoundDisplayScale(path: string) {
    const pathFormGroup = this.pathFormGroup();
    if (!pathFormGroup.parent?.parent?.value || !Object.prototype.hasOwnProperty.call(pathFormGroup.parent.parent.value, 'displayScale')) { return; }

    const meta = this._data.getPathMeta(path);
    if (meta?.displayScale) {
      const displayScale = pathFormGroup.parent.parent.get('displayScale') as FormGroup | null;
      if (!displayScale) { return; }
      const unit = pathFormGroup.controls['convertUnitTo'].value;

      if (meta.displayScale.lower !== null && meta.displayScale.lower !== undefined) {
        displayScale.controls['lower'].setValue(this._units.convertToUnit(unit, meta.displayScale.lower));
      }
      if (meta.displayScale.upper !== null && meta.displayScale.upper !== undefined) {
        displayScale.controls['upper'].setValue(this._units.convertToUnit(unit, meta.displayScale.upper));
      }
      if (meta.displayScale.type !== null && meta.displayScale.type !== undefined){
        displayScale.controls['type'].setValue(meta.displayScale.type);
      }
      if (meta.displayScale.power !== null && meta.displayScale.power !== undefined){
        displayScale.controls['power'].setValue(meta.displayScale.power);
      }
    }
  }
}
