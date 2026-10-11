import { Component, OnInit, inject, signal, computed, DestroyRef } from '@angular/core';
import { AbstractControl, UntypedFormGroup, UntypedFormControl, FormControl, FormGroup, Validators, UntypedFormBuilder, UntypedFormArray, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter, merge, take } from 'rxjs';
import { cloneDeep, get, has, set } from 'lodash-es';

import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';

import { BooleanMultiControlOptionsComponent, IAddNewPathObject } from '../boolean-multicontrol-options/boolean-multicontrol-options.component';
import { GraphDisplayOptionsComponent } from '../graph-display-options/graph-display-options.component';
import { GraphDataOptionsComponent } from '../graph-data-options/graph-data-options.component';
import { AppService } from '../../core/services/app-service';
import type { ElectricalTrackedDevice, IDynamicControl, IDynamicControlGroup, IWidgetPath, IWidgetSvcConfig } from '../../core/interfaces/widgets-interface';
import { effectivePathConfig } from '../../core/directives/widget-streams.directive';
import { MIN_UPDATE_INTERVAL_MS } from '../../core/interfaces/widgets-interface';
import { PathsOptionsComponent } from '../paths-options/paths-options.component';
import { IDeleteEventObj } from '../boolean-control-config/boolean-control-config.component';
import { DisplayDatetimeComponent } from '../display-datetime/display-datetime.component';
import { SelectAutopilotComponent } from '../select-autopilot/select-autopilot.component';
import { BmsBankSetupComponent } from '../bms-bank-setup/bms-bank-setup.component';
import { AisTargetOptionsComponent } from '../ais-target-options/ais-target-options.component';
import { SolarChargerSetupComponent } from '../solar-charger-setup/solar-charger-setup.component';
import { ElectricalFamilySetupComponent } from '../electrical-family-setup/electrical-family-setup.component';
import { VideoCameraSetupComponent } from '../video-camera-setup/video-camera-setup.component';
import { MatTabsModule } from '@angular/material/tabs';
import { ActivePolarService } from '../../core/services/active-polar.service';
import { DataService } from '../../core/services/data.service';
import { POLAR_PATH_KEYS } from '../../core/utils/polar-overlay.util';
import { UnitsService } from '../../core/services/units.service';
import { pathOptionMeasure, presentationValue, presentedOption } from '../../core/utils/si-presentation.util';

/** An option stored in SI and shown in the form in a presentation unit. */
interface SiOption {
  /** Where the option sits in the widget config. */
  path: readonly string[];
  /** The measure the form shows it in. */
  unit: string;
}

/** Where the path an option follows is: a path slot, or a config key holding a path. */
type SiUnitSource = { slot: string } | { pathKey: 'datachartPath' };

/** Options of the listed widget types stored in SI and shown in the unit the widget presents a path in. */
interface PathSiOptions {
  types: readonly string[];
  source: SiUnitSource;
  paths: readonly (readonly string[])[];
}

/**
 * An SI option in the form: the stored value, what the form showed for it, and the unit the form's
 * value is in now. `null` is a bound left unset.
 */
interface SiField extends SiOption {
  si: number | null;
  shown: number | null;
  /** For an option that follows a path: where the path is, and the path and slot unit `unit` was resolved for. */
  follows?: { source: SiUnitSource; resolvedFor: string };
}

/** Typed reactive-form control map for an array-mode {@link IWidgetPath}: one control per field. */
type IWidgetPathControls = {
  [K in keyof IWidgetPath]: FormControl<IWidgetPath[K] | null>;
};

@Component({
  selector: 'modal-widget-config',
  templateUrl: './root-modal-widget-config.component.html',
  styleUrls: ['./root-modal-widget-config.component.scss'],
  imports: [FormsModule, ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatTabsModule, MatCheckboxModule, MatSelectModule, MatDividerModule, MatButtonModule, DisplayDatetimeComponent, GraphDisplayOptionsComponent, GraphDataOptionsComponent, BooleanMultiControlOptionsComponent, PathsOptionsComponent, SelectAutopilotComponent, AisTargetOptionsComponent, BmsBankSetupComponent, SolarChargerSetupComponent, ElectricalFamilySetupComponent, VideoCameraSetupComponent]
})
export class RootModalWidgetConfigComponent implements OnInit {
  // Property name constants to avoid magic strings
  private static readonly KEY_MULTI_CHILD_CTRLS = 'multiChildCtrls';
  private static readonly KEY_DISPLAY_SCALE = 'displayScale';
  private static readonly KEY_GAUGE = 'gauge';
  private static readonly KEY_AUTOPILOT = 'autopilot';
  private static readonly KEY_PATHS = 'paths';
  private static readonly KEY_AIS = 'ais';
  private static readonly KEY_CONVERT_UNIT_TO = 'convertUnitTo';
  /** Options stored in SI; the form shows and accepts them in the listed unit. */
  private static readonly SI_OPTIONS: readonly SiOption[] = [
    { path: ['closeHauledLineAngle'], unit: 'deg' },
    { path: ['gauge', 'heelCautionAngle'], unit: 'deg' },
    { path: ['gauge', 'heelAlarmAngle'], unit: 'deg' },
    { path: ['ais', 'cogVectorsSeconds'], unit: 'Minutes' }
  ];
  private static readonly PATH_SI_OPTIONS: readonly PathSiOptions[] = [
    {
      types: ['widget-gauge-ng-radial', 'widget-gauge-ng-linear', 'widget-gauge-steel', 'widget-simple-linear'],
      source: { slot: 'gaugePath' },
      paths: [['displayScale', 'lower'], ['displayScale', 'upper']]
    },
    { types: ['widget-numeric'], source: { slot: 'numericPath' }, paths: [['yScaleMin'], ['yScaleMax']] },
    {
      types: ['widget-data-chart'],
      source: { pathKey: 'datachartPath' },
      paths: [['yScaleMin'], ['yScaleMax'], ['yScaleSuggestedMin'], ['yScaleSuggestedMax']]
    }
  ];
  private dialogRef = inject<MatDialogRef<RootModalWidgetConfigComponent>>(MatDialogRef);
  private fb = inject(UntypedFormBuilder);
  private app = inject(AppService);
  private readonly destroyRef = inject(DestroyRef);
  protected widgetConfig = inject<IWidgetSvcConfig & { widgetName?: string; widgetType?: string }>(MAT_DIALOG_DATA);

  public titleDialog = this.widgetConfig?.widgetName
    ? `${this.widgetConfig.widgetName} — Widget Settings`
    : "Widget Settings";
  public formMaster: UntypedFormGroup;
  public isPathArray = false;
  public addPathEvent: IAddNewPathObject;
  public delPathEvent: string;
  public updatePathEvent: IDynamicControl[];
  public colors: { label: string; value: string }[] = [];
  protected readonly saveDisabled = signal(true);

  private readonly activePolar = inject(ActivePolarService);
  private readonly data = inject(DataService);
  private readonly units = inject(UnitsService);
  private siFields: SiField[] = [];
  /** The unit symbol of each option that follows a path, by its dotted config path. */
  private readonly siUnitSymbols = signal<ReadonlyMap<string, string>>(new Map());
  /** The Wind Steer polar overlay's SI input paths, and those the server has sent at least once. */
  private polarOverlayPaths: string[] = [];
  private readonly receivedPolarOverlayPaths = signal<ReadonlySet<string>>(new Set());
  /**
   * Why the polar overlay cannot draw: the service's fixed message, or once the polar is ready, the
   * inputs never received. A stale input only hides the overlay and gets no message.
   */
  protected readonly polarOverlayHint = computed<string | null>(() => {
    const message = this.activePolar.message();
    if (message) return message;
    if (this.activePolar.status().kind !== 'ready') return null;
    const received = this.receivedPolarOverlayPaths();
    const missing = this.polarOverlayPaths.filter(path => !received.has(path)).map(path => path.replace(/^self\./, ''));
    if (!missing.length) return null;
    const list = missing.length > 1 ? `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}` : missing[0];
    return `The Signal K server has not sent ${list}, so the overlay stays hidden.`;
  });

  ngOnInit() {
    // Defensive guard: if dialog opened without required data, close early to avoid runtime errors.
    if (!this.widgetConfig) {
      console.error("Widget configuration data is missing. Closing dialog.");
      this.dialogRef.close();
      return;
    }
    // widgetName and widgetType are dialog hints carried on the data payload, not persisted config fields.
    const formConfig = cloneDeep(this.widgetConfig);
    delete formConfig.widgetName;
    delete formConfig.widgetType;
    this.showSiOptionsInPresentationUnits(formConfig, this.widgetConfig.widgetType);
    this.formMaster = this.generateFormGroups(formConfig);
    this.followSiUnitSources();
    this.setupWindsteerControlState();
    if (this.widgetConfig.polarOverlayEnable !== undefined) this.watchPolarOverlay();
    this.formMaster.statusChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.saveDisabled.set(this.formMaster.invalid));
    queueMicrotask(() => this.saveDisabled.set(this.formMaster.invalid));
    this.colors = this.app.configurableThemeColors;
  }

  /**
   * Access a formMaster control by an IWidgetSvcConfig key. The `K extends keyof IWidgetSvcConfig`
   * bound makes renaming a config field a compile error at every call site — the form layer's
   * compile-time link to the config interface (#25). The value type stays the caller's cast, since
   * formMaster is an UntypedFormGroup built reflectively.
   */
  private configControl<K extends keyof IWidgetSvcConfig>(key: K): AbstractControl | null {
    return this.formMaster.get(key);
  }

  private setupWindsteerControlState(): void {
    const compassModeControl = this.configControl('compassModeEnabled') as UntypedFormControl | null;
    const courseOverGroundControl = this.configControl('courseOverGroundEnable') as UntypedFormControl | null;
    const waypointEnableControl = this.configControl('waypointEnable') as UntypedFormControl | null;
    const driftEnableControl = this.configControl('driftEnable') as UntypedFormControl | null;

    if (!compassModeControl || !courseOverGroundControl || !waypointEnableControl || !driftEnableControl) {
      return;
    }

    const syncWindsteerControlsEnabledState = (isCompassModeEnabled: unknown): void => {
      if (isCompassModeEnabled === true) {
        courseOverGroundControl.enable({ emitEvent: false });
        waypointEnableControl.enable({ emitEvent: false });
        driftEnableControl.enable({ emitEvent: false });
        return;
      }
      courseOverGroundControl.disable({ emitEvent: false });
      waypointEnableControl.disable({ emitEvent: false });
      driftEnableControl.disable({ emitEvent: false });
    };

    syncWindsteerControlsEnabledState(compassModeControl.value);
    compassModeControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(value => syncWindsteerControlsEnabledState(value));
  }

  /**
   * Starts (or retries) the active polar so the dialog can say why the overlay cannot draw before the
   * user turns it on, and watches the overlay's inputs while the dialog is open. The first replayed
   * value is the path's cached one, so an input that was received and has since gone stale counts.
   */
  private watchPolarOverlay(): void {
    this.activePolar.refreshIfFailed();
    const slots = POLAR_PATH_KEYS
      .map(key => effectivePathConfig(this.widgetConfig.paths, key))
      .filter((slot): slot is IWidgetPath & { path: string } => typeof slot?.path === 'string' && slot.path !== '');
    this.polarOverlayPaths = slots.map(slot => slot.path);
    for (const { path, source } of slots) {
      const { data$, release } = this.data.acquirePath(path, source?.trim() || 'default');
      this.destroyRef.onDestroy(release);
      data$
        .pipe(filter(update => update.data.value != null), take(1), takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.receivedPolarOverlayPaths.update(received => new Set(received).add(path)));
    }
  }

  // Helper to ensure we only treat plain object literals as nested groups and not arrays, dates, etc.
  private isPlainObject(val: unknown): val is Record<string, unknown> {
    return Object.prototype.toString.call(val) === '[object Object]';
  }

  private generateFormGroups(formData: object, parent?: string): UntypedFormGroup {
    const groups = this.fb.group({});

    Object.keys(formData).forEach(key => {
      const value = (formData as Record<string, unknown>)[key];
      // handle Objects (plain objects or arrays explicitly handled below)
      if (value !== null && (Array.isArray(value) || this.isPlainObject(value))) {
        if (key === RootModalWidgetConfigComponent.KEY_MULTI_CHILD_CTRLS) {
          groups.addControl(key, this.fb.array([]));
          const fa = groups.get(key) as UntypedFormArray;
          (value as IDynamicControl[]).forEach((ctrl: IDynamicControl) => {
            fa.push(this.generateCtrlArray(ctrl));
          });
        } else if (key === RootModalWidgetConfigComponent.KEY_DISPLAY_SCALE) {
          groups.addControl(key, this.generateFormGroups(value, key));
        } else if (key === RootModalWidgetConfigComponent.KEY_GAUGE) {
          groups.addControl(key, this.generateFormGroups(value, key));
        } else if (key === RootModalWidgetConfigComponent.KEY_AUTOPILOT) {
          groups.addControl(key, this.generateFormGroups(value, key));
        } else if (key === RootModalWidgetConfigComponent.KEY_AIS) {
          groups.addControl(key, this.generateFormGroups(value, key));
        } else if (key === RootModalWidgetConfigComponent.KEY_PATHS) {
          const pathsValue = value as Record<string, unknown>;
          if (this.widgetConfig.multiChildCtrls !== undefined) {
            this.isPathArray = true;
            groups.addControl(key, this.fb.array([]));
            const fa = groups.get(key) as UntypedFormArray;
            Object.keys(pathsValue).forEach(pathKey => {
              const pathObj = pathsValue[pathKey] as IWidgetPath;
              if (pathObj) {
                const pathGroup = this.generatePathArray(pathKey, pathObj);
                if (pathObj.isPathConfigurable === false) {
                  pathGroup.disable(); // disables validation, but value is kept in getRawValue()
                }
                fa.push(pathGroup);
              }
            });
          } else {
            const pathsGroup = this.fb.group({});
            Object.keys(pathsValue).forEach(pathKey => {
              const pathObj = pathsValue[pathKey] as IWidgetPath;
              if (pathObj) {
                const pathGroup = this.generateFormGroups(pathObj, pathKey);
                const hasChoices = (pathObj.pathOptions?.length ?? 0) > 0;
                if (pathObj.isPathConfigurable === false && !hasChoices) {
                  // Fix the path but keep the Data Source (and other per-path controls) editable —
                  // disabling only the path control, not the whole group.
                  pathGroup.get('path')?.disable();
                }
                pathsGroup.addControl(pathKey, pathGroup);
              }
            });
            groups.addControl(key, pathsGroup);
          }
        } else if (Array.isArray(value)) {
          groups.addControl(key, new UntypedFormControl(value));
        } else {
          groups.addControl(key, this.generateFormGroups(value, key));
        }

      } else {
        // Handle Primitives - property values
        if (parent === RootModalWidgetConfigComponent.KEY_CONVERT_UNIT_TO) {
          // If we are building units list
          const unitConfig = (formData as Record<string, unknown>)[key] as IWidgetPath;
          if (unitConfig && (unitConfig as IWidgetPath).pathType == "number") {
            groups.addControl(key, new UntypedFormControl(value)); //only add control if it's a number. Strings and booleans don't have units and conversions yet...
          }
        } else {
          // not building Units list
          // Use switch in case we will need more Required form validator at some point.
          switch (key) {
            case "path": groups.addControl(key, new UntypedFormControl(value));
              break;

            case "updateInterval": groups.addControl(key, new UntypedFormControl(value, [Validators.required, Validators.min(MIN_UPDATE_INTERVAL_MS)]));
              break;

            default: groups.addControl(key, new UntypedFormControl(value));
              break;
          }
        }
      }
    });
    return groups;
  }

  private generatePathArray(pathKey: string, formData: IWidgetPath): FormGroup<IWidgetPathControls> {
    // use addControl for formGroup and addControl for formControl
    const fg = new UntypedFormGroup({});
    (Object.keys(formData) as (keyof IWidgetPath)[]).forEach(key => {
      fg.addControl(key, this.generatePathFields(key, formData[key]));
    });
    return fg as FormGroup<IWidgetPathControls>;
  }

  private generatePathFields(key: keyof IWidgetPath, value: IWidgetPath[keyof IWidgetPath]): FormControl<IWidgetPath[keyof IWidgetPath] | null> {
    switch (key) {
      case "path": return new FormControl(value);

      case "source": return new FormControl(value, Validators.required);

      default: return new FormControl(value);
    }
  }

  private generateCtrlArray(formData: IDynamicControl): FormGroup<IDynamicControlGroup> {
    const fg = this.fb.group(formData) as FormGroup<IDynamicControlGroup>;
    fg.controls.ctrlLabel.addValidators(Validators.required);
    return fg;
  }

  public addPathGroup(e: IAddNewPathObject): void {
    this.addPathEvent = e;
  }

  public updatePath(ctrlUpdates: IDynamicControl[]): void {
    ctrlUpdates.forEach(ctrl => {
      const pathsFormArray = this.configControl('paths') as UntypedFormArray;

      pathsFormArray.controls.forEach((fg: UntypedFormGroup) => {
        const pathIDCtrl = fg.get('pathID') as UntypedFormControl;
        if (pathIDCtrl.value == ctrl.pathID) {
          fg.controls['description'].setValue(ctrl.ctrlLabel);
          fg.controls['pathType'].setValue(ctrl.isNumeric ? 'number' : 'boolean');
          this.updatePathEvent = ctrlUpdates;
        }
      });
    });
  }

  public deletePath(e: IDeleteEventObj): void {
    const pathsFormArray = this.configControl('paths') as UntypedFormArray;
    let i = 0;
    pathsFormArray.controls.forEach((fg: UntypedFormGroup) => {
      const pathIDCtrl = fg.get('pathID') as UntypedFormControl;
      if (pathIDCtrl.value == e.pathID) {
        pathsFormArray.removeAt(i);
      } else {
        i++
      }
    });

    const multiCtrlFormArray = this.configControl('multiChildCtrls') as UntypedFormArray;
    multiCtrlFormArray.removeAt(e.ctrlIndex);

    this.delPathEvent = e.pathID;

    // Explicitly update the form's value object
    this.formMaster.updateValueAndValidity();
  }

  get datachartPathControl(): FormControl<string | null> {
    return this.configControl('datachartPath') as FormControl<string | null>;
  }

  get datachartSourceControl(): FormControl<string | null> {
    return this.configControl('datachartSource') as FormControl<string | null>;
  }

  get datachartAngleRangeControl(): FormControl<'signed' | 'direction' | null> {
    return this.configControl('datachartAngleRange') as FormControl<'signed' | 'direction' | null>;
  }

  get timeScaleControl(): FormControl<string> {
    return this.configControl('timeScale') as FormControl<string>;
  }

  get periodControl(): FormControl<number> {
    return this.configControl('period') as FormControl<number>;
  }

  get filterSelfPathsToControl(): FormControl<boolean> {
    return this.configControl('filterSelfPaths') as FormControl<boolean>;
  }

  /** True when the Paths tab has something to configure. Array-form widgets (multiChildCtrls) build
   * their paths through that tab, so it must stay even while their path collection is empty. A
   * non-array widget surfaces the tab when at least one path is editable in some way — a free-path
   * picker (isPathConfigurable !== false) or a choice control (pathOptions). A widget whose every
   * path is fixed with no choice alternatives has no path-related control to show, so the tab is
   * suppressed (its per-path Data Source is then not user-editable, matching the pre-#417 behaviour). */
  get hasConfigurablePaths(): boolean {
    if (this.widgetConfig?.multiChildCtrls !== undefined) return true;
    const entries = Object.values((this.widgetConfig?.paths ?? {}) as Record<string, { isPathConfigurable?: boolean; pathOptions?: unknown[] }>);
    if (entries.length === 0) return false;
    return entries.some(p => p?.isPathConfigurable !== false || (p?.pathOptions?.length ?? 0) > 0);
  }

  get updateIntervalToControl(): UntypedFormControl {
    return this.configControl('updateInterval') as UntypedFormControl;
  }

  get enableTimeoutToControl(): UntypedFormControl {
    return this.configControl('enableTimeout') as UntypedFormControl;
  }

  get dateTimezoneToControl(): FormControl<string> {
    return this.configControl('dateTimezone') as FormControl<string>;
  }

  get yScaleSuggestedMaxToControl(): FormControl<number> {
    return this.configControl('yScaleSuggestedMax') as FormControl<number>;
  }

  get enableMinMaxScaleLimitToControl(): FormControl<boolean> {
    return this.configControl('enableMinMaxScaleLimit') as FormControl<boolean>;
  }

  get showDatasetMinimumValueLineToControl(): FormControl<boolean> {
    return this.configControl('showDatasetMinimumValueLine') as FormControl<boolean>;
  }

  get showDatasetMaximumValueLineToControl(): FormControl<boolean> {
    return this.configControl('showDatasetMaximumValueLine') as FormControl<boolean>;
  }

  get showDatasetAverageValueLineToControl(): FormControl<boolean> {
    return this.configControl('showDatasetAverageValueLine') as FormControl<boolean>;
  }

  get showDatasetAngleAverageValueLineToControl(): FormControl<boolean> {
    return this.configControl('showDatasetAngleAverageValueLine') as FormControl<boolean>;
  }

  get startScaleAtZeroToControl(): FormControl<boolean> {
    return this.configControl('startScaleAtZero') as FormControl<boolean>;
  }

  get showTimeScaleToControl(): FormControl<boolean> {
    return this.configControl('showTimeScale') as FormControl<boolean>;
  }

  get showYScaleToControl(): FormControl<boolean> {
    return this.configControl('showYScale') as FormControl<boolean>;
  }

  get yScaleSuggestedMinToControl(): FormControl<number> {
    return this.configControl('yScaleSuggestedMin') as FormControl<number>;
  }

  get yScaleMinToControl(): FormControl<number> {
    return this.configControl('yScaleMin') as FormControl<number>;
  }

  get yScaleMaxToControl(): FormControl<number> {
    return this.configControl('yScaleMax') as FormControl<number>;
  }

  get datasetAverageArrayToControl(): FormControl<string> {
    return this.configControl('datasetAverageArray') as FormControl<string>;
  }

  get trackAgainstAverageToControl(): FormControl<boolean> {
    return this.configControl('trackAgainstAverage') as FormControl<boolean>;
  }

  get showDataPointsToControl(): FormControl<boolean> {
    return this.configControl('showDataPoints') as FormControl<boolean>;
  }

  get showAverageDataToControl(): FormControl<boolean> {
    return this.configControl('showAverageData') as FormControl<boolean>;
  }

  get numDecimalToControl(): FormControl<number> {
    return this.configControl('numDecimal') as FormControl<number>;
  }

  get verticalChartToControl(): FormControl<boolean> {
    return this.configControl('verticalChart') as FormControl<boolean>;
  }

  get inverseYAxisToControl(): FormControl<boolean> {
    return this.configControl('inverseYAxis') as FormControl<boolean>;
  }

  get colorToControl(): FormControl<string> {
    return this.configControl('color') as FormControl<string>;
  }

  get dateFormatToControl(): FormControl<string> {
    return this.configControl('dateFormat') as FormControl<string>;
  }

  get multiChildCtrlsToControl(): UntypedFormArray {
    return this.configControl('multiChildCtrls') as UntypedFormArray;
  }

  submitConfig() {
    const nextConfig = this.formMaster.getRawValue() as IWidgetSvcConfig;
    this.storeSiOptionsInSi(nextConfig);
    this.normalizeElectricalTrackedDevices(nextConfig);
    this.dialogRef.close(nextConfig);
  }

  /**
   * The unit symbol an SI option that follows a path is shown with, by its dotted config path, or
   * null for a field that is not such an option.
   */
  protected siUnitSymbol(key: string): string | null {
    return this.siUnitSymbols().get(key) ?? null;
  }

  /** Replaces each SI option in the form's copy of the config with its value in the form's unit. */
  private showSiOptionsInPresentationUnits(formConfig: object, widgetType: string | undefined): void {
    this.siFields = [];
    for (const option of RootModalWidgetConfigComponent.SI_OPTIONS) {
      const si: unknown = get(formConfig, option.path);
      if (typeof si !== 'number' || !Number.isFinite(si)) continue;
      const shown = presentedOption(presentationValue(this.units, option.unit, si));
      set(formConfig, option.path, shown);
      this.siFields.push({ ...option, si, shown });
    }
    for (const group of RootModalWidgetConfigComponent.PATH_SI_OPTIONS) {
      if (!widgetType || !group.types.includes(widgetType)) continue;
      const { path, stored } = this.siUnitSourceIn(group.source, keys => get(formConfig, keys));
      const unit = pathOptionMeasure(this.units, path, stored);
      for (const optionPath of group.paths) {
        if (!has(formConfig, optionPath)) continue;
        const value: unknown = get(formConfig, optionPath);
        const si = typeof value === 'number' && Number.isFinite(value) ? value : null;
        const shown = this.presented(unit, si);
        set(formConfig, optionPath, shown);
        this.siFields.push({ path: optionPath, unit, si, shown, follows: { source: group.source, resolvedFor: this.resolutionKey(path, stored) } });
      }
    }
  }

  private presented(unit: string, si: number | null): number | null {
    return si == null ? null : presentedOption(presentationValue(this.units, unit, si));
  }

  /** The path an option follows and the unit stored with its slot, read through `read`. */
  private siUnitSourceIn(source: SiUnitSource, read: (keys: string[]) => unknown): { path: string | null; stored: string | null } {
    const text = (value: unknown): string | null => typeof value === 'string' && value !== '' ? value : null;
    if ('pathKey' in source) return { path: text(read([source.pathKey])), stored: null };
    return { path: text(read(['paths', source.slot, 'path'])), stored: text(read(['paths', source.slot, RootModalWidgetConfigComponent.KEY_CONVERT_UNIT_TO])) };
  }

  private resolutionKey(path: string | null, stored: string | null): string {
    return JSON.stringify([path, stored]);
  }

  private siUnitSourceInForm(source: SiUnitSource): { path: string | null; stored: string | null } {
    return this.siUnitSourceIn(source, keys => this.formMaster.get(keys)?.value);
  }

  /**
   * Keeps each option that follows a path in that path's unit. A re-point (a new path or slot unit)
   * switches the fields to the new unit and leaves their numbers, which path-control-config has
   * already set; save then converts them from the new unit. A path whose meta has not arrived when
   * the form is built resolves once more when it does, for the fields the user has not edited.
   */
  private followSiUnitSources(): void {
    const sources = new Set(this.siFields.flatMap(field => field.follows ? [field.follows.source] : []));
    this.refreshSiUnitSymbols();
    for (const source of sources) {
      const controls = ('pathKey' in source ? [[source.pathKey]] : [['paths', source.slot, 'path'], ['paths', source.slot, RootModalWidgetConfigComponent.KEY_CONVERT_UNIT_TO]])
        .map(keys => this.formMaster.get(keys))
        .filter((control): control is AbstractControl => control != null);
      merge(...controls.map(control => control.valueChanges))
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.followRepoint(source));

      const { path, stored } = this.siUnitSourceInForm(source);
      if (path && this.units.resolvePathMeasure(path) === 'unitless' && this.data.getPathMeta(path) == null) {
        const builtFor = this.resolutionKey(path, stored);
        this.data.getPathMetaObservable(path)
          .pipe(filter(meta => meta != null), take(1), takeUntilDestroyed(this.destroyRef))
          .subscribe(() => this.resolveOnMetaArrival(source, builtFor));
      }
    }
  }

  private fieldsFollowing(source: SiUnitSource): SiField[] {
    return this.siFields.filter(field => field.follows?.source === source);
  }

  private followRepoint(source: SiUnitSource): void {
    const { path, stored } = this.siUnitSourceInForm(source);
    const key = this.resolutionKey(path, stored);
    const unit = pathOptionMeasure(this.units, path, stored);
    for (const field of this.fieldsFollowing(source)) {
      if (field.follows?.resolvedFor === key) continue;
      field.unit = unit;
      field.follows = { source, resolvedFor: key };
    }
    this.refreshSiUnitSymbols();
  }

  private resolveOnMetaArrival(source: SiUnitSource, builtFor: string): void {
    const { path, stored } = this.siUnitSourceInForm(source);
    const unit = pathOptionMeasure(this.units, path, stored);
    for (const field of this.fieldsFollowing(source)) {
      const control = this.formMaster.get(field.path as string[]);
      if (field.follows?.resolvedFor !== builtFor || !control || control.value !== field.shown || unit === field.unit) continue;
      field.unit = unit;
      field.shown = this.presented(unit, field.si);
      control.setValue(field.shown);
    }
    this.refreshSiUnitSymbols();
  }

  private refreshSiUnitSymbols(): void {
    const symbols = new Map<string, string>();
    for (const field of this.siFields) {
      if (!field.follows) continue;
      // SI is shown with the path's own unit.
      const measure = field.unit === 'unitless'
        ? this.data.getPathUnitType(this.siUnitSourceInForm(field.follows.source).path ?? '')
        : field.unit;
      symbols.set(field.path.join('.'), this.units.getRenderableUnitSymbol(measure));
    }
    this.siUnitSymbols.set(symbols);
  }

  /**
   * Converts each SI option back from the form's unit. An option that follows a path and is left
   * empty is stored unset.
   */
  private storeSiOptionsInSi(config: IWidgetSvcConfig): void {
    for (const field of this.siFields) {
      const value: unknown = get(config, field.path);
      if (typeof value === 'number' && Number.isFinite(value)) {
        set(config, field.path, this.fromPresentation(field.unit, value));
      } else if (field.follows) {
        set(config, field.path, null);
      }
    }
  }

  /**
   * The SI value of a number shown in `unit`. The conversions are affine, so two forward
   * conversions recover the inverse without a table of its own.
   */
  private fromPresentation(unit: string, value: number): number {
    const f0 = presentationValue(this.units, unit, 0);
    const f1 = presentationValue(this.units, unit, 1);
    return (value - f0) / (f1 - f0);
  }

  private normalizeElectricalTrackedDevices(cfg: IWidgetSvcConfig): void {
    const families = [cfg.charger, cfg.inverter, cfg.alternator, cfg.ac, cfg.solarCharger, cfg.bms];

    families.forEach(family => {
      if (!family) {
        return;
      }

      const trackedDevices = Array.isArray(family.trackedDevices) ? family.trackedDevices : [];
      const normalized = new Map<string, ElectricalTrackedDevice>();

      trackedDevices.forEach(item => {
        if (!item || typeof item !== 'object') {
          return;
        }

        const candidate = item as { id?: unknown; source?: unknown; key?: unknown };
        const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
        const source = typeof candidate.source === 'string' ? candidate.source.trim() : 'default';
        if (!id || !source) {
          return;
        }

        const key = typeof candidate.key === 'string' && candidate.key.trim().length > 0
          ? candidate.key.trim()
          : `${id}||${source}`;
        normalized.set(key, { id, source, key });
      });

      family.trackedDevices = [...normalized.values()].sort((left, right) => left.key.localeCompare(right.key));
    });
  }
}
