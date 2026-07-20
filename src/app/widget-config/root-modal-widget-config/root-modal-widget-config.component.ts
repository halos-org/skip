import { Component, OnInit, inject, signal, DestroyRef } from '@angular/core';
import { AbstractControl, UntypedFormGroup, UntypedFormControl, FormControl, FormGroup, Validators, UntypedFormBuilder, UntypedFormArray, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';

import { BooleanMultiControlOptionsComponent, IAddNewPathObject } from '../boolean-multicontrol-options/boolean-multicontrol-options.component';
import { DisplayChartOptionsComponent } from '../display-chart-options/display-chart-options.component';
import { DatasetChartOptionsComponent } from '../dataset-chart-options/dataset-chart-options.component';
import { AppService } from '../../core/services/app-service';
import type { ElectricalTrackedDevice, IDynamicControl, IDynamicControlGroup, IWidgetPath, IWidgetSvcConfig } from '../../core/interfaces/widgets-interface';
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

/** Typed reactive-form control map for an array-mode {@link IWidgetPath}: one control per field. */
type IWidgetPathControls = {
  [K in keyof IWidgetPath]: FormControl<IWidgetPath[K] | null>;
};

@Component({
  selector: 'modal-widget-config',
  templateUrl: './root-modal-widget-config.component.html',
  styleUrls: ['./root-modal-widget-config.component.scss'],
  imports: [FormsModule, ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatTabsModule, MatCheckboxModule, MatSelectModule, MatDividerModule, MatButtonModule, DisplayDatetimeComponent, DisplayChartOptionsComponent, DatasetChartOptionsComponent, BooleanMultiControlOptionsComponent, PathsOptionsComponent, SelectAutopilotComponent, AisTargetOptionsComponent, BmsBankSetupComponent, SolarChargerSetupComponent, ElectricalFamilySetupComponent, VideoCameraSetupComponent]
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
  private dialogRef = inject<MatDialogRef<RootModalWidgetConfigComponent>>(MatDialogRef);
  private fb = inject(UntypedFormBuilder);
  private app = inject(AppService);
  private readonly destroyRef = inject(DestroyRef);
  protected widgetConfig = inject<IWidgetSvcConfig & { widgetName?: string }>(MAT_DIALOG_DATA);

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

  ngOnInit() {
    // Defensive guard: if dialog opened without required data, close early to avoid runtime errors.
    if (!this.widgetConfig) {
      console.error("Widget configuration data is missing. Closing dialog.");
      this.dialogRef.close();
      return;
    }
    // widgetName is a dialog-title hint carried on the data payload, not a persisted config field.
    const formConfig = { ...this.widgetConfig };
    delete formConfig.widgetName;
    this.formMaster = this.generateFormGroups(formConfig);
    this.setupWindsteerControlState();
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
                if (pathObj.isPathConfigurable === false) {
                  pathGroup.disable(); // disables validation,
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

            case "dataTimeout": groups.addControl(key, new UntypedFormControl(value, Validators.required));
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

      case "sampleTime": return new FormControl(value, Validators.required);

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

  get dataTimeoutToControl(): UntypedFormControl {
    return this.configControl('dataTimeout') as UntypedFormControl;
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
    this.normalizeElectricalTrackedDevices(nextConfig);
    this.dialogRef.close(nextConfig);
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
