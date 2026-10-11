import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { UntypedFormArray, UntypedFormControl, UntypedFormGroup, Validators } from '@angular/forms';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RootModalWidgetConfigComponent } from './root-modal-widget-config.component';
import { IConversionPathList, UnitsService } from '../../core/services/units.service';
import { AppService } from '../../core/services/app-service';
import { ensureTestIconsReady } from '../../../test-helpers/icon-test-utils';
import type { IWidgetPath, IWidgetSvcConfig } from '../../core/interfaces/widgets-interface';
import { MIN_UPDATE_INTERVAL_MS } from '../../core/interfaces/widgets-interface';
import { WidgetBooleanSwitchComponent } from '../../widgets/widget-boolean-switch/widget-boolean-switch.component';
import { WidgetZonesStatePanelComponent } from '../../widgets/widget-zones-state-panel/widget-zones-state-panel.component';
import { WidgetAutopilotComponent } from '../../widgets/widget-autopilot/widget-autopilot.component';
import { WidgetSteelCompassComponent } from '../../widgets/widget-gauge-steel-compass/widget-gauge-steel-compass.component';
import { WidgetSeaHorizonComponent } from '../../widgets/widget-sea-horizon/widget-sea-horizon.component';
import { WidgetWindComponent } from '../../widgets/widget-windsteer/widget-windsteer.component';
import { WidgetRacesteerComponent } from '../../widgets/widget-racesteer/widget-racesteer.component';
import { WidgetAisRadarComponent } from '../../widgets/widget-ais-radar/widget-ais-radar.component';
import { WidgetGaugeNgRadialComponent } from '../../widgets/widget-gauge-ng-radial/widget-gauge-ng-radial.component';
import { WidgetNumericComponent } from '../../widgets/widget-numeric/widget-numeric.component';
import { WidgetDataGraphComponent } from '../../widgets/widget-data-graph/widget-data-graph.component';
import { WidgetSliderComponent } from '../../widgets/widget-slider/widget-slider.component';
import type { ISkMetadata } from '../../core/interfaces/signalk-interfaces';
import { ActivePolarService, ActivePolarStatus } from '../../core/services/active-polar.service';
import { DataService, IPathUpdate } from '../../core/services/data.service';
import { WidgetService } from '../../core/services/widget.service';
import { signal } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

describe('ModalWidgetComponent', () => {
  let component: RootModalWidgetConfigComponent;
  let fixture: ComponentFixture<RootModalWidgetConfigComponent>;
  const dialogRefSpy = { close: vi.fn() };
  const widgetConfig: IWidgetSvcConfig = {
    charger: { trackedDevices: [], optionsById: {} },
    inverter: { trackedDevices: [], optionsById: {} },
    alternator: { trackedDevices: [], optionsById: {} },
    ac: { trackedDevices: [], optionsById: {} }
  };
  const unitsServiceStub: Pick<UnitsService, 'getConversionsForPath'> = {
    getConversionsForPath: (): IConversionPathList => ({ base: 'unitless', conversions: [] }),
  };
  const appServiceStub: Pick<AppService, 'configurableThemeColors'> = {
    configurableThemeColors: []
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RootModalWidgetConfigComponent],
      providers: [
        { provide: UnitsService, useValue: unitsServiceStub },
        { provide: AppService, useValue: appServiceStub },
        { provide: MAT_DIALOG_DATA, useValue: widgetConfig },
        { provide: MatDialogRef, useValue: dialogRefSpy },
      ],
    })
      .compileComponents();
  });

  beforeEach(() => {
    dialogRefSpy.close.mockReset();
    ensureTestIconsReady();
    fixture = TestBed.createComponent(RootModalWidgetConfigComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should be created', () => {
    expect(component).toBeTruthy();
  });

  it('normalizes tracked devices for charger, inverter, alternator, and ac on submit', () => {
    component.formMaster = new UntypedFormGroup({
      charger: new UntypedFormGroup({
        trackedDevices: new UntypedFormControl([
          { id: 'c1', source: 'venus.1', key: 'c1||venus.1' },
          { id: 'c1', source: 'venus.1', key: 'c1||venus.1' }
        ]),
        optionsById: new UntypedFormControl({})
      }),
      inverter: new UntypedFormGroup({
        trackedDevices: new UntypedFormControl([
          { id: 'i1', source: 'venus.1', key: 'i1||venus.1' },
          { id: 'i1', source: 'n2k.42', key: 'i1||n2k.42' }
        ]),
        optionsById: new UntypedFormControl({})
      }),
      alternator: new UntypedFormGroup({
        trackedDevices: new UntypedFormControl([
          { id: 'a1', source: 'smartshunt.1' }
        ]),
        optionsById: new UntypedFormControl({})
      }),
      ac: new UntypedFormGroup({
        trackedDevices: new UntypedFormControl([
          { id: 'grid', source: 'venus.1', key: 'grid||venus.1' },
          { id: 'grid', source: 'venus.1', key: 'grid||venus.1' }
        ]),
        optionsById: new UntypedFormControl({})
      })
    });

    component.submitConfig();

    expect(dialogRefSpy.close).toHaveBeenCalledTimes(1);
    const submitted = dialogRefSpy.close.mock.calls[0][0] as IWidgetSvcConfig;
    expect(submitted.charger?.trackedDevices).toEqual([
      { id: 'c1', source: 'venus.1', key: 'c1||venus.1' }
    ]);
    expect(submitted.inverter?.trackedDevices).toEqual([
      { id: 'i1', source: 'n2k.42', key: 'i1||n2k.42' },
      { id: 'i1', source: 'venus.1', key: 'i1||venus.1' }
    ]);
    expect(submitted.alternator?.trackedDevices).toEqual([
      { id: 'a1', source: 'smartshunt.1', key: 'a1||smartshunt.1' }
    ]);
    expect(submitted.ac?.trackedDevices).toEqual([
      { id: 'grid', source: 'venus.1', key: 'grid||venus.1' }
    ]);
  });

  function windsteerForm(compassMode: boolean) {
    const compassModeEnabled = new UntypedFormControl(compassMode);
    const courseOverGroundEnable = new UntypedFormControl(true);
    const waypointEnable = new UntypedFormControl(true);
    const driftEnable = new UntypedFormControl(true);
    component.formMaster = new UntypedFormGroup({ compassModeEnabled, courseOverGroundEnable, waypointEnable, driftEnable });
    (component as unknown as { setupWindsteerControlState: () => void }).setupWindsteerControlState();
    return { compassModeEnabled, courseOverGroundEnable, waypointEnable, driftEnable };
  }

  it('enables the COG/waypoint/drift controls when compass mode is on and re-syncs on toggle', () => {
    const f = windsteerForm(true);
    expect([f.courseOverGroundEnable.disabled, f.waypointEnable.disabled, f.driftEnable.disabled]).toEqual([false, false, false]);

    f.compassModeEnabled.setValue(false);
    expect([f.courseOverGroundEnable.disabled, f.waypointEnable.disabled, f.driftEnable.disabled]).toEqual([true, true, true]);

    f.compassModeEnabled.setValue(true);
    expect([f.courseOverGroundEnable.disabled, f.waypointEnable.disabled, f.driftEnable.disabled]).toEqual([false, false, false]);
  });

  it('starts with the COG/waypoint/drift controls disabled when compass mode is initially off', () => {
    const f = windsteerForm(false);
    expect([f.courseOverGroundEnable.disabled, f.waypointEnable.disabled, f.driftEnable.disabled]).toEqual([true, true, true]);
  });
});

describe('ModalWidgetComponent title composition (#180)', () => {
  const unitsServiceStub: Pick<UnitsService, 'getConversionsForPath'> = {
    getConversionsForPath: (): IConversionPathList => ({ base: 'unitless', conversions: [] }),
  };
  const appServiceStub: Pick<AppService, 'configurableThemeColors'> = {
    configurableThemeColors: []
  };

  beforeEach(() => TestBed.resetTestingModule());

  function createComponentWithData(data: object): RootModalWidgetConfigComponent {
    TestBed.configureTestingModule({
      imports: [RootModalWidgetConfigComponent],
      providers: [
        { provide: UnitsService, useValue: unitsServiceStub },
        { provide: AppService, useValue: appServiceStub },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
      ],
    });
    ensureTestIconsReady();
    return TestBed.createComponent(RootModalWidgetConfigComponent).componentInstance;
  }

  it('composes the widget name in front of the base dialog title', () => {
    const component = createComponentWithData({ widgetName: 'Numeric' });
    expect(component.titleDialog).toBe('Numeric — Widget Settings');
  });

  it('falls back to the base title when no widget name is provided', () => {
    const component = createComponentWithData({});
    expect(component.titleDialog).toBe('Widget Settings');
  });
});

// The Paths tab is suppressed when a widget has no user-configurable path (#416): all-fixed-path
// widgets (heel-gauge/horizon) would otherwise show an empty/irrelevant tab.
describe('ModalWidgetComponent Paths tab visibility (#416)', () => {
  const unitsServiceStub: Pick<UnitsService, 'getConversionsForPath'> = {
    getConversionsForPath: (): IConversionPathList => ({ base: 'unitless', conversions: [] }),
  };
  const appServiceStub: Pick<AppService, 'configurableThemeColors'> = { configurableThemeColors: [] };

  beforeEach(() => TestBed.resetTestingModule());

  function createComponentWithData(data: object): RootModalWidgetConfigComponent {
    TestBed.configureTestingModule({
      imports: [RootModalWidgetConfigComponent],
      providers: [
        { provide: UnitsService, useValue: unitsServiceStub },
        { provide: AppService, useValue: appServiceStub },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
      ],
    });
    ensureTestIconsReady();
    return TestBed.createComponent(RootModalWidgetConfigComponent).componentInstance;
  }

  it('suppresses the Paths tab when every path is fixed (isPathConfigurable:false)', () => {
    const component = createComponentWithData({ paths: {
      angle: { path: 'self.navigation.attitude', pathType: 'number', isPathConfigurable: false }
    } });
    expect(component.hasConfigurablePaths).toBe(false);
  });

  it('shows the Paths tab when at least one path is user-configurable', () => {
    const component = createComponentWithData({ paths: {
      a: { path: 'self.foo', pathType: 'number', isPathConfigurable: false },
      b: { path: 'self.bar', pathType: 'number', isPathConfigurable: true }
    } });
    expect(component.hasConfigurablePaths).toBe(true);
  });

  it('treats a path with no explicit isPathConfigurable flag as configurable', () => {
    const component = createComponentWithData({ paths: { p: { path: 'self.foo', pathType: 'number' } } });
    expect(component.hasConfigurablePaths).toBe(true);
  });

  it('keeps the tab for an array-form (multiChildCtrls) widget even with empty paths', () => {
    // widget-boolean-switch / widget-zones-state-panel ship paths:[] and add paths via this tab.
    const component = createComponentWithData({ paths: [], multiChildCtrls: [] });
    expect(component.hasConfigurablePaths).toBe(true);
  });
});

// The gauge settings tabs bind formControlName straight at the keys a widget ships in its
// gauge group, so a key dropped from a DEFAULT_CONFIG breaks the dialog at runtime rather than at
// build time. Locks the steel compass card controls against that.
describe('ModalWidgetComponent steel compass gauge controls', () => {
  const unitsServiceStub: Pick<UnitsService, 'getConversionsForPath'> = {
    getConversionsForPath: (): IConversionPathList => ({ base: 'unitless', conversions: [] }),
  };
  const appServiceStub: Pick<AppService, 'configurableThemeColors'> = { configurableThemeColors: [] };

  beforeEach(() => TestBed.resetTestingModule());

  it('builds a control for every card option the Settings tab binds', () => {
    TestBed.configureTestingModule({
      imports: [RootModalWidgetConfigComponent],
      providers: [
        { provide: UnitsService, useValue: unitsServiceStub },
        { provide: AppService, useValue: appServiceStub },
        { provide: MAT_DIALOG_DATA, useValue: WidgetSteelCompassComponent.DEFAULT_CONFIG },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
      ],
    });
    ensureTestIconsReady();
    const component = TestBed.createComponent(RootModalWidgetConfigComponent).componentInstance;
    component.ngOnInit();

    const gauge = component.formMaster.get('gauge') as UntypedFormGroup;
    expect(gauge).toBeTruthy();
    // Every key the compass Settings tab binds by name.
    expect(gauge.get('degreeScale')?.value).toBe(true);
    // The Classic Steel material keys, bound by the pickers the two widgets share.
    expect(gauge.get('backgroundColor')?.value).toBe('carbon');
    expect(gauge.get('faceColor')?.value).toBe('anthracite');
  });
});

// The Sea Horizon heel-band pair is validated only by the template: each number input's [min]/[max]
// follows the other field's live value, so the rule exists only once the Display tab has rendered.
// Renders the dialog for real and drives both fields across each other so a dropped binding or a
// dropped validator directive fails here instead of letting a crossed pair reach the widget.
describe('ModalWidgetComponent sea horizon gauge controls', () => {
  // The heel angles are stored in rad and shown in degrees.
  const unitsServiceStub: Pick<UnitsService, 'getConversionsForPath' | 'convertToUnit' | 'getRenderableUnitSymbol'> = {
    getConversionsForPath: (): IConversionPathList => ({ base: 'unitless', conversions: [] }),
    convertToUnit: (unit: string, value: number) => unit === 'deg' ? value * 180 / Math.PI : value,
    getRenderableUnitSymbol: (unit: string | null | undefined) => unit ?? '',
  };
  const appServiceStub: Pick<AppService, 'configurableThemeColors'> = { configurableThemeColors: [] };

  beforeEach(() => TestBed.resetTestingModule());

  async function renderSeaHorizonDialog(): Promise<{ component: RootModalWidgetConfigComponent; gauge: UntypedFormGroup }> {
    TestBed.configureTestingModule({
      imports: [RootModalWidgetConfigComponent],
      providers: [
        { provide: UnitsService, useValue: unitsServiceStub },
        { provide: AppService, useValue: appServiceStub },
        { provide: MAT_DIALOG_DATA, useValue: { ...structuredClone(WidgetSeaHorizonComponent.DEFAULT_CONFIG), widgetType: 'widget-sea-horizon' } },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
      ],
    });
    ensureTestIconsReady();
    await TestBed.inject(WidgetService).getComponentType('widget-sea-horizon');
    const fixture = TestBed.createComponent(RootModalWidgetConfigComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    return { component, gauge: component.formMaster.get('gauge') as UntypedFormGroup };
  }

  it('builds a control for every gauge option the Display tab binds', async () => {
    const { gauge } = await renderSeaHorizonDialog();
    expect(gauge).toBeTruthy();
    expect(gauge.get('invertPitch')?.value).toBe(false);
    expect(gauge.get('invertRoll')?.value).toBe(false);
    expect(gauge.get('noFrameVisible')?.value).toBe(true);
    expect(gauge.get('heelCautionAngle')?.value).toBe(20);
    expect(gauge.get('heelAlarmAngle')?.value).toBe(30);
    expect(gauge.get('damping')?.value).toBe(0);
    // The Classic Steel material keys, bound by the pickers the steel family shares.
    expect(gauge.get('backgroundColor')?.value).toBe('carbon');
    expect(gauge.get('faceColor')?.value).toBe('anthracite');
  });

  it('rejects a caution angle raised to or above the alarm angle', async () => {
    const { component, gauge } = await renderSeaHorizonDialog();
    const caution = gauge.get('heelCautionAngle');
    expect(caution?.valid).toBe(true);

    caution?.setValue(30);
    expect(caution?.hasError('max')).toBe(true);
    expect(component.formMaster.invalid).toBe(true);

    caution?.setValue(29);
    expect(caution?.valid).toBe(true);
    expect(component.formMaster.valid).toBe(true);
  });

  it('rejects an alarm angle lowered to or below the caution angle', async () => {
    const { component, gauge } = await renderSeaHorizonDialog();
    const alarm = gauge.get('heelAlarmAngle');
    expect(alarm?.valid).toBe(true);

    alarm?.setValue(20);
    expect(alarm?.hasError('min')).toBe(true);
    expect(component.formMaster.invalid).toBe(true);

    alarm?.setValue(21);
    expect(alarm?.valid).toBe(true);
    expect(component.formMaster.valid).toBe(true);
  });
});

// Characterization of the two closed leaf shapes built reflectively by the widget-config
// form generator: the multiChildCtrls control group and the array-mode path group. Locks the
// exact control tree + required validators so the typed-factory refactor cannot drift them.
describe('ModalWidgetComponent leaf control/path shapes (#25 Phase 2a)', () => {
  const unitsServiceStub: Pick<UnitsService, 'getConversionsForPath'> = {
    getConversionsForPath: (): IConversionPathList => ({ base: 'unitless', conversions: [] }),
  };
  const appServiceStub: Pick<AppService, 'configurableThemeColors'> = {
    configurableThemeColors: []
  };

  // A realistic boolean/switch multi-control config: one IDynamicControl plus a matching
  // IWidgetPath array entry (mirrors the shape BooleanMultiControlOptions.addCtrlGroup emits).
  const multiControlConfig: IWidgetSvcConfig = {
    displayName: 'Switch Panel Label',
    multiChildCtrls: [
      { ctrlLabel: 'Nav Lights', type: '1', pathID: 'ctrl-uuid-1', color: 'contrast', isNumeric: false, value: null }
    ],
    paths: [
      {
        description: null,
        path: null,
        pathID: 'ctrl-uuid-1',
        source: 'default',
        pathType: 'boolean',
        zonesOnlyPaths: false,
        supportsPut: true,
        isPathConfigurable: true,
        showPathSkUnitsFilter: false,
        pathSkUnitsFilter: null,
        convertUnitTo: null
      }
    ]
  };

  beforeEach(() => TestBed.resetTestingModule());

  function buildForm(data: IWidgetSvcConfig): RootModalWidgetConfigComponent {
    TestBed.configureTestingModule({
      imports: [RootModalWidgetConfigComponent],
      providers: [
        { provide: UnitsService, useValue: unitsServiceStub },
        { provide: AppService, useValue: appServiceStub },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
      ],
    });
    ensureTestIconsReady();
    const component = TestBed.createComponent(RootModalWidgetConfigComponent).componentInstance;
    component.ngOnInit();
    return component;
  }

  it('builds each multiChildCtrls entry as a group with a required ctrlLabel and the other control keys', () => {
    const component = buildForm(multiControlConfig);
    const multiArray = component.formMaster.get('multiChildCtrls') as UntypedFormArray;
    expect(multiArray.length).toBe(1);

    const ctrlGroup = multiArray.at(0) as UntypedFormGroup;
    const ctrlLabel = ctrlGroup.get('ctrlLabel') as UntypedFormControl;
    expect(ctrlLabel.hasValidator(Validators.required)).toBe(true);
    ctrlLabel.setValue('');
    expect(ctrlLabel.hasError('required')).toBe(true);

    ['type', 'pathID', 'color', 'isNumeric', 'value'].forEach(key => {
      expect(ctrlGroup.get(key)).not.toBeNull();
    });
  });

  it('builds each paths-array entry with source required and other keys plain', () => {
    const component = buildForm(multiControlConfig);
    const pathsArray = component.formMaster.get('paths') as UntypedFormArray;
    expect(pathsArray.length).toBe(1);

    const pathGroup = pathsArray.at(0) as UntypedFormGroup;
    ['description', 'path', 'source', 'pathType', 'zonesOnlyPaths', 'supportsPut', 'isPathConfigurable', 'showPathSkUnitsFilter', 'pathSkUnitsFilter', 'convertUnitTo'].forEach(key => {
      expect(pathGroup.get(key)).not.toBeNull();
    });

    const source = pathGroup.get('source') as UntypedFormControl;
    const path = pathGroup.get('path') as UntypedFormControl;

    expect(source.hasValidator(Validators.required)).toBe(true);
    expect(path.hasValidator(Validators.required)).toBe(false);

    source.setValue(null);
    path.setValue(null);
    expect(source.hasError('required')).toBe(true);
    expect(path.hasError('required')).toBe(false);
  });

  it('builds the widget-level updateInterval control as required and floored at MIN_UPDATE_INTERVAL_MS', () => {
    const component = buildForm({ ...multiControlConfig, updateInterval: 1000 } as IWidgetSvcConfig);
    const ctrl = component.updateIntervalToControl;
    expect(ctrl).toBeTruthy();
    expect(ctrl.hasValidator(Validators.required)).toBe(true);
    ctrl.setValue(MIN_UPDATE_INTERVAL_MS - 1);
    expect(ctrl.hasError('min')).toBe(true);
    ctrl.setValue(1000);
    expect(ctrl.valid).toBe(true);
  });

  // updateInterval lives on the always-shown Display tab, so it must be reachable even for a widget
  // with no configurable paths (its Paths tab is suppressed via hasConfigurablePaths). The control
  // must exist independent of path configurability.
  it('exposes updateIntervalToControl for an all-fixed-path widget whose Paths tab is suppressed', () => {
    const cfg = { updateInterval: 500, paths: {
      p: { description: 'X', path: 'self.x', source: 'default', pathType: 'number', isPathConfigurable: false }
    } } as unknown as IWidgetSvcConfig;
    const component = buildForm(cfg);
    expect(component.hasConfigurablePaths).toBe(false); // Paths tab is gone
    expect(component.updateIntervalToControl).toBeTruthy(); // yet the cadence control survives
    expect(component.updateIntervalToControl.value).toBe(500);
  });

  // Regression (#430): the Paths tab renders for any multiChildCtrls widget and binds a REQUIRED
  // updateInterval control; a widget whose DEFAULT_CONFIG omits updateInterval yields a null control
  // and paths-options binds [formControl]=null, throwing on render. Prove the shipped array-form
  // widgets carry it, exercised through the real form-builder.
  it('array-form widget DEFAULT_CONFIGs carry updateInterval so the Paths tab never binds a null control', () => {
    for (const cfg of [WidgetBooleanSwitchComponent.DEFAULT_CONFIG, WidgetZonesStatePanelComponent.DEFAULT_CONFIG]) {
      expect(typeof cfg.updateInterval).toBe('number');
      expect(cfg.updateInterval as number).toBeGreaterThan(0);
    }
    // Exercise the real form-builder for one array-form widget: the control must resolve non-null
    // (buildForm instantiates TestBed, so only one build per test).
    const component = buildForm(WidgetBooleanSwitchComponent.DEFAULT_CONFIG);
    expect(component.updateIntervalToControl).not.toBeNull();
  });

  // B1: decouple path-editability from Source. A fixed path disables only its `path` control, so its
  // Data Source stays editable; a choice (pathOptions) path keeps `path` enabled for the select.
  it('disables only the path control (not Data Source) for a fixed record-form path', () => {
    const cfg = { paths: { p: { description: 'X', path: 'self.x', source: 'default', pathType: 'number', isPathConfigurable: false } } } as unknown as IWidgetSvcConfig;
    const pathGroup = (buildForm(cfg).formMaster.get('paths') as UntypedFormGroup).get('p') as UntypedFormGroup;
    expect(pathGroup.get('path')!.disabled).toBe(true);
    expect(pathGroup.get('source')!.disabled).toBe(false);
  });

  // The whole fixed-path design rests on submitConfig reading getRawValue() (not .value): a disabled
  // path control is dropped by .value, so a fixed path would vanish from the saved config. Guard it.
  it('retains a disabled fixed path value through submitConfig (getRawValue, not .value)', () => {
    const cfg = { paths: { p: { description: 'X', path: 'self.fixed.path', source: 'default', pathType: 'number', isPathConfigurable: false } } } as unknown as IWidgetSvcConfig;
    const raw = buildForm(cfg).formMaster.getRawValue() as { paths: { p: { path: string } } };
    expect(raw.paths.p.path).toBe('self.fixed.path');
  });

  it('keeps the path control enabled for a choice (pathOptions) path so the select can write it', () => {
    const cfg = { paths: { p: { description: 'X', path: 'self.x', source: 'default', pathType: 'number', isPathConfigurable: false, pathOptions: [{ label: 'A', path: 'self.x' }, { label: 'B', path: 'self.y' }] } } } as unknown as IWidgetSvcConfig;
    const pathGroup = (buildForm(cfg).formMaster.get('paths') as UntypedFormGroup).get('p') as UntypedFormGroup;
    expect(pathGroup.get('path')!.disabled).toBe(false);
  });

  it('leaves the path control editable for a generic configurable path (autocomplete non-regression)', () => {
    const cfg = { paths: { numericPath: { description: 'N', path: null, source: 'default', pathType: 'number', isPathConfigurable: true } } } as unknown as IWidgetSvcConfig;
    const pathGroup = (buildForm(cfg).formMaster.get('paths') as UntypedFormGroup).get('numericPath') as UntypedFormGroup;
    expect(pathGroup.get('path')!.disabled).toBe(false);
  });

  it('hasConfigurablePaths is true when a path has choices even if the rest are fixed', () => {
    const cfg = { paths: {
      a: { description: 'A', path: 'self.a', source: 'default', pathType: 'number', isPathConfigurable: false },
      b: { description: 'B', path: 'self.b', source: 'default', pathType: 'number', isPathConfigurable: false, pathOptions: [{ label: 'X', path: 'self.b' }, { label: 'Y', path: 'self.c' }] }
    } } as unknown as IWidgetSvcConfig;
    expect(buildForm(cfg).hasConfigurablePaths).toBe(true);
  });

  it('hasConfigurablePaths is false when every path is fixed with no choices (tab stays suppressed)', () => {
    const cfg = { paths: {
      a: { description: 'A', path: 'self.a', source: 'default', pathType: 'number', isPathConfigurable: false },
      b: { description: 'B', path: 'self.b', source: 'default', pathType: 'number', isPathConfigurable: false }
    } } as unknown as IWidgetSvcConfig;
    expect(buildForm(cfg).hasConfigurablePaths).toBe(false);
  });

  // Effort C: autopilot's redundant top-level pickers were fixed, leaving every path fixed with no
  // choice, so hasConfigurablePaths is false and the Paths tab is suppressed (#417) — autopilot joins
  // heel-gauge/horizon as a no-Paths-tab widget, config living on its dedicated select-autopilot tab.
  it('autopilot: every path is fixed after Effort C, so the Paths tab is suppressed (#417)', () => {
    const component = buildForm(WidgetAutopilotComponent.DEFAULT_CONFIG);
    expect(component.hasConfigurablePaths).toBe(false);
    // Sanity: it genuinely has paths (not the empty-paths edge), they are just all fixed.
    const pathGroups = Object.values((component.formMaster.get('paths') as UntypedFormGroup).controls) as UntypedFormGroup[];
    expect(pathGroups.length).toBeGreaterThan(0);
    expect(pathGroups.every(g => g.get('isPathConfigurable')!.value === false)).toBe(true);
  });
});

describe('ModalWidgetComponent updateInterval Display-tab placement', () => {
  const dialogRefSpy = { close: vi.fn() };
  // An all-fixed-path widget: hasConfigurablePaths is false, so the Paths tab (where the cadence
  // control used to live) is suppressed and no path-control-config is rendered. displayName routes it
  // to the general Display body. This is the exact case the relocation fixes.
  const allFixedConfig = { displayName: 'X', updateInterval: 500, enableTimeout: false, paths: {
    p: { description: 'X', path: 'self.x', source: 'default', pathType: 'number', isPathConfigurable: false }
  } } as unknown as IWidgetSvcConfig;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RootModalWidgetConfigComponent],
      providers: [
        { provide: UnitsService, useValue: { getConversionsForPath: (): IConversionPathList => ({ base: 'unitless', conversions: [] }) } },
        { provide: AppService, useValue: { configurableThemeColors: [] } },
        { provide: MAT_DIALOG_DATA, useValue: allFixedConfig },
        { provide: MatDialogRef, useValue: dialogRefSpy },
      ],
    }).compileComponents();
    ensureTestIconsReady();
  });

  // The cadence input and the stale-data-timeout toggle must render on the always-shown Display tab
  // even when the Paths tab is gone — pre-relocation both lived in paths-options and vanished with the
  // suppressed tab.
  it('renders the updateInterval input and enableTimeout toggle on the Display tab when the Paths tab is suppressed', () => {
    const fixture = TestBed.createComponent(RootModalWidgetConfigComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.hasConfigurablePaths).toBe(false);
    expect(fixture.nativeElement.querySelector('input[name="updateInterval"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('mat-checkbox[name="enableTimeout"]')).toBeTruthy();
  });
});

/** The unit suffix shown beside the `name` input, or null without one. */
const suffix = (fixture: ComponentFixture<RootModalWidgetConfigComponent>, name: string): string | null => {
  fixture.detectChanges();
  const field = (fixture.nativeElement.querySelector(`input[name="${name}"]`) as HTMLElement | null)?.closest('mat-form-field');
  return field?.querySelector('[matTextSuffix]')?.textContent?.trim() ?? null;
};

describe('ModalWidgetComponent options stored in SI', () => {
  /** The options dialog for a `type` widget, which reads the widget's OPTION_UNITS once it has loaded. */
  async function open(type: string, config: IWidgetSvcConfig, optionUnits?: Record<string, string>): Promise<ComponentFixture<RootModalWidgetConfigComponent>> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [RootModalWidgetConfigComponent],
      providers: [
        UnitsService,
        { provide: AppService, useValue: { configurableThemeColors: [] } },
        { provide: MAT_DIALOG_DATA, useValue: { ...config, widgetType: type } },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: ActivePolarService, useValue: { status: signal({ kind: 'loading' }), message: signal(null), refreshIfFailed: () => undefined } }
      ]
    });
    ensureTestIconsReady();
    const widgets = TestBed.inject(WidgetService);
    await widgets.getComponentType(type);
    if (optionUnits) vi.spyOn(widgets, 'getOptionUnits').mockReturnValue(optionUnits);
    vi.spyOn(TestBed.inject(DataService), 'acquirePath').mockImplementation(() =>
      ({ data$: new BehaviorSubject<IPathUpdate>({ data: { value: null, timestamp: null }, state: 'normal' } as IPathUpdate), release: () => undefined }));
    const fixture = TestBed.createComponent(RootModalWidgetConfigComponent);
    fixture.detectChanges();
    return fixture;
  }
  const windsteer = (closeHauledLineAngle: number): IWidgetSvcConfig =>
    ({ ...structuredClone(WidgetWindComponent.DEFAULT_CONFIG), closeHauledLineAngle, widgetName: 'Wind Steer' } as IWidgetSvcConfig);
  const saved = (): IWidgetSvcConfig =>
    ((TestBed.inject(MatDialogRef).close as ReturnType<typeof vi.fn>).mock.calls[0][0]) as IWidgetSvcConfig;

  it('shows the close-hauled angle stored in rad in degrees', async () => {
    const fixture = await open('widget-wind-steer', windsteer(Math.PI / 4));
    expect(fixture.componentInstance.formMaster.get('closeHauledLineAngle')?.value).toBe(45);
    const input = fixture.nativeElement.querySelector('input[name="closeHauledLineAngle"]') as HTMLInputElement;
    expect(Number(input.value)).toBe(45);
    expect(suffix(fixture, 'closeHauledLineAngle')).toBe('deg');
  });

  it("converts exactly the options the widget's OPTION_UNITS lists", async () => {
    const config = { ...windsteer(Math.PI / 4), gauge: { tilt: Math.PI / 6 } } as unknown as IWidgetSvcConfig;
    const fixture = await open('widget-wind-steer', config, { 'gauge.tilt': 'rad' });
    const form = fixture.componentInstance.formMaster;
    expect(form.get(['gauge', 'tilt'])?.value).toBe(30);
    // No longer listed, the close-hauled angle is shown as stored.
    expect(form.get('closeHauledLineAngle')?.value).toBe(Math.PI / 4);

    form.get(['gauge', 'tilt'])?.setValue(45);
    fixture.componentInstance.submitConfig();
    expect((saved() as unknown as { gauge: { tilt: number } }).gauge.tilt).toBeCloseTo(Math.PI / 4, 12);
    expect(saved().closeHauledLineAngle).toBe(Math.PI / 4);
  });

  it('stores an entered angle in rad', async () => {
    const fixture = await open('widget-wind-steer', windsteer(Math.PI / 4));
    fixture.componentInstance.formMaster.get('closeHauledLineAngle')?.setValue(50);
    fixture.componentInstance.submitConfig();
    expect(saved().closeHauledLineAngle).toBeCloseTo(50 * Math.PI / 180, 6);
  });

  const seaHorizon = (heelCautionAngle: number, heelAlarmAngle: number): IWidgetSvcConfig => {
    const config = structuredClone(WidgetSeaHorizonComponent.DEFAULT_CONFIG);
    config.gauge = { ...config.gauge!, heelCautionAngle, heelAlarmAngle };
    return { ...config, widgetName: 'Sea Horizon' } as IWidgetSvcConfig;
  };

  it('shows the heel angles stored in rad in degrees, and stores an edit in rad', async () => {
    const caution = 20 * Math.PI / 180;
    const fixture = await open('widget-sea-horizon', seaHorizon(caution, 30 * Math.PI / 180));
    const gauge = fixture.componentInstance.formMaster.get('gauge') as UntypedFormGroup;
    expect(gauge.get('heelCautionAngle')?.value).toBe(20);
    expect(gauge.get('heelAlarmAngle')?.value).toBe(30);
    expect(suffix(fixture, 'heelCautionAngle')).toBe('deg');
    expect(suffix(fixture, 'heelAlarmAngle')).toBe('deg');

    gauge.get('heelAlarmAngle')?.setValue(35);
    fixture.componentInstance.submitConfig();
    expect(saved().gauge?.heelAlarmAngle).toBeCloseTo(35 * Math.PI / 180, 12);
    expect(saved().gauge?.heelCautionAngle).toBeCloseTo(caution, 12);
  });

  it('shows the AIS COG vector time stored in seconds in minutes, and stores an edit in seconds', async () => {
    const config = { ...structuredClone(WidgetAisRadarComponent.DEFAULT_CONFIG), widgetName: 'AIS Radar' } as IWidgetSvcConfig;
    config.ais = { ...config.ais!, cogVectorsSeconds: 600 };
    const fixture = await open('widget-ais-radar', config);
    const ais = fixture.componentInstance.formMaster.get('ais') as UntypedFormGroup;
    expect(ais.get('cogVectorsSeconds')?.value).toBe(10);
    const input = fixture.nativeElement.querySelector('input[name="cogVectorsSeconds"]') as HTMLInputElement;
    expect(Number(input.value)).toBe(10);
    expect(suffix(fixture, 'cogVectorsSeconds')).toBe('min');

    fixture.componentInstance.submitConfig();
    expect(saved().ais?.cogVectorsSeconds).toBe(600);
    // The range rings have no field; the dialog passes them through as stored.
    expect(saved().ais?.rangeRings).toEqual([1852, 5556, 11112, 22224, 44448, 88896]);

    ais.get('cogVectorsSeconds')?.setValue(15);
    fixture.componentInstance.submitConfig();
    const edited = (TestBed.inject(MatDialogRef).close as ReturnType<typeof vi.fn>).mock.calls[1][0] as IWidgetSvcConfig;
    expect(edited.ais?.cogVectorsSeconds).toBeCloseTo(900, 9);
  });

  it('offers the polar close-hauled angle and the run lines, and saves their switches', async () => {
    const fixture = await open('widget-wind-steer', windsteer(Math.PI / 4));
    expect(fixture.nativeElement.querySelector('mat-checkbox[name="closeHauledAngleFromPolar"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('mat-checkbox[name="runLineEnable"]')).not.toBeNull();

    fixture.componentInstance.formMaster.get('closeHauledAngleFromPolar')?.setValue(false);
    fixture.componentInstance.formMaster.get('runLineEnable')?.setValue(true);
    fixture.componentInstance.submitConfig();
    expect(saved().closeHauledAngleFromPolar).toBe(false);
    expect(saved().runLineEnable).toBe(true);
  });

  it('shows no close-hauled section for a widget without the option', async () => {
    const fixture = await open('widget-racesteer', { ...structuredClone(WidgetRacesteerComponent.DEFAULT_CONFIG), widgetName: 'Race Steer' } as IWidgetSvcConfig);
    expect(fixture.nativeElement.querySelector('input[name="closeHauledLineAngle"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('mat-checkbox[name="closeHauledLineEnable"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('mat-checkbox[name="closeHauledAngleFromPolar"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('mat-checkbox[name="runLineEnable"]')).toBeNull();
  });
});

describe('ModalWidgetComponent polar overlay status', () => {
  const TWS = 'self.environment.wind.speedTrue';
  const WATER_TWA = 'self.environment.wind.angleTrueWater';
  const STW = 'self.navigation.speedThroughWater';

  class FakeActivePolarService {
    public readonly status = signal<ActivePolarStatus>({ kind: 'loading' });
    public readonly message = signal<string | null>(null);
    public refreshes = 0;
    public refreshIfFailed(): void { this.refreshes += 1; }
  }

  let polar: FakeActivePolarService;
  let streams: Map<string, BehaviorSubject<IPathUpdate>>;
  let acquired: string[];
  let acquiredSources: Map<string, string>;
  let released: string[];

  const update = (value: number | null, timestamp: Date | null = value === null ? null : new Date()): IPathUpdate =>
    ({ data: { value, timestamp }, state: 'normal' } as IPathUpdate);
  const stream = (path: string): BehaviorSubject<IPathUpdate> => {
    let subject = streams.get(path);
    if (!subject) {
      subject = new BehaviorSubject<IPathUpdate>(update(null));
      streams.set(path, subject);
    }
    return subject;
  };

  function open(config: IWidgetSvcConfig): ComponentFixture<RootModalWidgetConfigComponent> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [RootModalWidgetConfigComponent],
      providers: [
        { provide: UnitsService, useValue: { getConversionsForPath: (): IConversionPathList => ({ base: 'unitless', conversions: [] }), skBaseUnits: [], convertToUnit: (unit: string, value: number) => unit === 'deg' ? value * 180 / Math.PI : value } },
        { provide: AppService, useValue: { configurableThemeColors: [] } },
        { provide: MAT_DIALOG_DATA, useValue: config },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: ActivePolarService, useValue: polar }
      ]
    });
    ensureTestIconsReady();
    vi.spyOn(TestBed.inject(DataService), 'acquirePath').mockImplementation((path: string, source: string): { data$: Observable<IPathUpdate>; release: () => void } => {
      acquired.push(path);
      acquiredSources.set(path, source);
      return { data$: stream(path), release: () => released.push(path) };
    });
    const fixture = TestBed.createComponent(RootModalWidgetConfigComponent);
    fixture.detectChanges();
    return fixture;
  }
  const windsteer = (): IWidgetSvcConfig => ({ ...structuredClone(WidgetWindComponent.DEFAULT_CONFIG), widgetName: 'Wind Steer' } as IWidgetSvcConfig);
  const hint = (fixture: ComponentFixture<RootModalWidgetConfigComponent>): string | null => {
    fixture.detectChanges();
    return (fixture.nativeElement.querySelector('.polar-overlay-hint') as HTMLElement | null)?.textContent?.trim() ?? null;
  };

  beforeEach(() => {
    polar = new FakeActivePolarService();
    streams = new Map();
    acquired = [];
    acquiredSources = new Map();
    released = [];
  });

  it('shows the overlay option for Wind Steer and starts or retries the polar service on open', () => {
    const fixture = open(windsteer());
    expect(fixture.nativeElement.querySelector('mat-checkbox[name="polarOverlayEnable"]')).toBeTruthy();
    expect(polar.refreshes).toBe(1);
  });

  it('neither starts the service nor watches the overlay paths for another widget', () => {
    const fixture = open({ displayName: 'Numeric', updateInterval: 500, paths: {} } as IWidgetSvcConfig);
    expect(fixture.nativeElement.querySelector('mat-checkbox[name="polarOverlayEnable"]')).toBeNull();
    expect(polar.refreshes).toBe(0);
    expect(acquired).toEqual([]);
  });

  it('saves the option with the rest of the config', () => {
    const fixture = open(windsteer());
    fixture.componentInstance.formMaster.get('polarOverlayEnable')?.setValue(true);
    fixture.componentInstance.submitConfig();
    const close = TestBed.inject(MatDialogRef).close as ReturnType<typeof vi.fn>;
    expect((close.mock.calls[0][0] as IWidgetSvcConfig).polarOverlayEnable).toBe(true);
  });

  it('shows the service message as a hint when the polar cannot be used', () => {
    polar.status.set({ kind: 'fetch-failed', cause: 401 });
    polar.message.set('Sign in to read the active polar.');
    const fixture = open(windsteer());
    expect(hint(fixture)).toBe('Sign in to read the active polar.');
  });

  it('shows no hint while the service is still loading', () => {
    const fixture = open(windsteer());
    expect(hint(fixture)).toBeNull();
  });

  it('names an overlay input the server has never sent once the polar is ready', () => {
    polar.status.set({ kind: 'ready' });
    stream(TWS).next(update(5));
    stream(STW).next(update(3));
    const fixture = open(windsteer());
    expect(acquired.sort()).toEqual([TWS, WATER_TWA, STW].sort());
    expect(hint(fixture)).toBe('The Signal K server has not sent environment.wind.angleTrueWater, so the overlay stays hidden.');
  });

  it('watches each overlay input on the source the widget reads it from', () => {
    const config = windsteer();
    const paths = config.paths as Record<string, IWidgetPath>;
    paths['trueWindSpeed'].source = 'n2k.115';
    paths['trueWindAngle'].source = 'n2k.200';
    open(config);
    expect(acquiredSources.get(TWS)).toBe('n2k.115');
    expect(acquiredSources.get(WATER_TWA)).toBe('n2k.200');
    expect(acquiredSources.get(STW)).toBe('default');
  });

  it('watches the water TWA on the default source when the displayed TWA is the Ground path', () => {
    const config = windsteer();
    const paths = config.paths as Record<string, IWidgetPath>;
    paths['trueWindSpeed'].source = 'n2k.115';
    paths['trueWindAngle'] = { ...paths['trueWindAngle'], path: 'self.environment.wind.angleTrueGround', source: 'n2k.200' };
    open(config);
    expect(acquiredSources.get(WATER_TWA)).toBe('default');
    expect(acquiredSources.get(TWS)).toBe('n2k.115');
  });

  it('names every missing input', () => {
    polar.status.set({ kind: 'ready' });
    stream(TWS).next(update(5));
    const fixture = open(windsteer());
    expect(hint(fixture)).toBe('The Signal K server has not sent environment.wind.angleTrueWater and navigation.speedThroughWater, so the overlay stays hidden.');
  });

  it('gives no message for an input that was received and has gone stale', () => {
    polar.status.set({ kind: 'ready' });
    stream(TWS).next(update(5));
    stream(STW).next(update(3));
    stream(WATER_TWA).next(update(0.7, new Date(Date.now() - 3_600_000)));
    const fixture = open(windsteer());
    expect(hint(fixture)).toBeNull();
  });

  it('clears the missing-input hint when the input arrives while the dialog is open', () => {
    polar.status.set({ kind: 'ready' });
    stream(TWS).next(update(5));
    stream(STW).next(update(3));
    const fixture = open(windsteer());
    expect(hint(fixture)).not.toBeNull();

    stream(WATER_TWA).next(update(0.7));
    expect(hint(fixture)).toBeNull();
  });

  it('releases the watched paths when the dialog closes', () => {
    const fixture = open(windsteer());
    fixture.destroy();
    expect(released.sort()).toEqual([TWS, WATER_TWA, STW].sort());
  });
});

describe('ModalWidgetComponent scale bounds stored in SI', () => {
  const TEMPERATURE = 'self.propulsion.main.temperature';
  const RPM = 'self.propulsion.main.revolutions';
  const SPEED = 'self.navigation.speedThroughWater';
  const DEPTH = 'self.environment.depth.belowTransducer';
  const meta = (units: string, targetUnit?: string, displayScale?: ISkMetadata['displayScale']): ISkMetadata =>
    ({ description: '', properties: {}, units, ...(targetUnit ? { displayUnits: { targetUnit } } : {}), ...(displayScale ? { displayScale } : {}) });

  let metas: Map<string, BehaviorSubject<ISkMetadata | null>>;
  const metaOf = (path: string): BehaviorSubject<ISkMetadata | null> => {
    let subject = metas.get(path);
    if (!subject) {
      subject = new BehaviorSubject<ISkMetadata | null>(null);
      metas.set(path, subject);
    }
    return subject;
  };

  async function open(type: string, config: IWidgetSvcConfig): Promise<ComponentFixture<RootModalWidgetConfigComponent>> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [RootModalWidgetConfigComponent],
      providers: [
        UnitsService,
        { provide: AppService, useValue: { configurableThemeColors: [] } },
        { provide: MAT_DIALOG_DATA, useValue: { ...config, widgetName: 'Widget', widgetType: type } },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: ActivePolarService, useValue: { status: signal({ kind: 'loading' }), message: signal(null), refreshIfFailed: () => undefined } }
      ]
    });
    ensureTestIconsReady();
    await TestBed.inject(WidgetService).getComponentType(type);
    const data = TestBed.inject(DataService);
    vi.spyOn(data, 'getPathUnitType').mockImplementation(path => metaOf(path).value?.units ?? null);
    vi.spyOn(data, 'getPathDisplayUnits').mockImplementation(path => metaOf(path).value?.displayUnits);
    vi.spyOn(data, 'getPathMeta').mockImplementation(path => metaOf(path).value);
    vi.spyOn(data, 'getPathMetaObservable').mockImplementation(path => metaOf(path).asObservable());
    vi.spyOn(data, 'getPathObject').mockImplementation(path =>
      metaOf(path).value ? { path, pathValue: null, pathTimestamp: '', type: 'number', state: 'normal', sources: {}, meta: metaOf(path).value! } as ReturnType<DataService['getPathObject']> : null);
    const fixture = TestBed.createComponent(RootModalWidgetConfigComponent);
    fixture.detectChanges();
    return fixture;
  }
  const lastSaved = (): IWidgetSvcConfig => {
    const calls = (TestBed.inject(MatDialogRef).close as ReturnType<typeof vi.fn>).mock.calls;
    return calls[calls.length - 1][0] as IWidgetSvcConfig;
  };

  /** A slider on `path`; its slot is structural and has no convertUnitTo, as the slider's defaults. */
  const slider = (path: string): IWidgetSvcConfig => {
    const config = structuredClone(WidgetSliderComponent.DEFAULT_CONFIG);
    config.paths = { gaugePath: { ...(config.paths as Record<string, IWidgetPath>)['gaugePath'], path } };
    return config;
  };

  const gauge = (path: string | null, convertUnitTo: string, lower: number | null, upper: number | null): IWidgetSvcConfig => {
    const config = structuredClone(WidgetGaugeNgRadialComponent.DEFAULT_CONFIG);
    config.paths = { gaugePath: { ...(config.paths as Record<string, IWidgetPath>)['gaugePath'], path, convertUnitTo } };
    config.displayScale = { ...config.displayScale!, lower, upper } as IWidgetSvcConfig['displayScale'];
    return config;
  };
  const numeric = (path: string | null, convertUnitTo: string, yScaleMin: number | null, yScaleMax: number | null): IWidgetSvcConfig => {
    const config = structuredClone(WidgetNumericComponent.DEFAULT_CONFIG);
    config.paths = { numericPath: { ...(config.paths as Record<string, IWidgetPath>)['numericPath'], path, convertUnitTo } };
    return { ...config, yScaleMin, yScaleMax } as IWidgetSvcConfig;
  };
  const scale = (fixture: ComponentFixture<RootModalWidgetConfigComponent>) =>
    fixture.componentInstance.formMaster.get('displayScale') as UntypedFormGroup;
  const slot = (fixture: ComponentFixture<RootModalWidgetConfigComponent>, name: string) =>
    fixture.componentInstance.formMaster.get(['paths', name]) as UntypedFormGroup;

  beforeEach(() => {
    metas = new Map();
  });

  it('shows gauge bounds stored in K in the unit the server shows the path in', async () => {
    metaOf(TEMPERATURE).next(meta('K', 'celsius'));
    const fixture = await open('widget-gauge-ng-radial', gauge(TEMPERATURE, 'unitless', 273.15, 393.15));
    expect(scale(fixture).get('lower')?.value).toBe(0);
    expect(scale(fixture).get('upper')?.value).toBe(120);
    expect(suffix(fixture, 'lower')).toBe('°C');
    expect(suffix(fixture, 'upper')).toBe('°C');
  });

  it('shows the bounds in the stored unit when the server sets none, and in SI without either', async () => {
    metaOf(TEMPERATURE).next(meta('K'));
    const stored = await open('widget-gauge-ng-radial', gauge(TEMPERATURE, 'fahrenheit', 273.15, 393.15));
    expect(scale(stored).get('lower')?.value).toBe(32);
    expect(scale(stored).get('upper')?.value).toBe(248);

    const si = await open('widget-gauge-ng-radial', gauge(TEMPERATURE, 'unitless', 273.15, 393.15));
    expect(scale(si).get('upper')?.value).toBe(393.15);
    expect(suffix(si, 'upper')).toBe('K');
  });

  it('stores numeric bounds entered in knots in m/s', async () => {
    metaOf(SPEED).next(meta('m/s', 'knots'));
    const fixture = await open('widget-numeric', numeric(SPEED, 'knots', null, null));
    const form = fixture.componentInstance.formMaster;
    form.get('yScaleMin')?.setValue(0);
    form.get('yScaleMax')?.setValue(20);
    fixture.componentInstance.submitConfig();
    expect(lastSaved().yScaleMin).toBe(0);
    expect(lastSaved().yScaleMax).toBeCloseTo(10.2889, 3);
    expect(suffix(fixture, 'yScaleMax')).toBe('kn');
  });

  it('shows an unset bound as an empty field and saves it unset, and does not require one', async () => {
    metaOf(SPEED).next(meta('m/s', 'knots'));
    const fixture = await open('widget-numeric', numeric(SPEED, 'knots', null, 5.144));
    const form = fixture.componentInstance.formMaster;
    const input = fixture.nativeElement.querySelector('input[name="yScaleMin"]') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(form.get('yScaleMin')?.valid).toBe(true);

    form.get('yScaleMax')?.setValue(null);
    expect(form.valid).toBe(true);
    fixture.componentInstance.submitConfig();
    expect(lastSaved().yScaleMin).toBeNull();
    expect(lastSaved().yScaleMax).toBeNull();
  });

  it("hints that an empty scale field uses the path's own scale", async () => {
    metaOf(TEMPERATURE).next(meta('K', 'celsius'));
    const fixture = await open('widget-gauge-ng-radial', gauge(TEMPERATURE, 'unitless', null, null));
    const field = (fixture.nativeElement.querySelector('input[name="lower"]') as HTMLElement).closest('mat-form-field') as HTMLElement;
    expect(field.querySelector('mat-hint')?.textContent).toMatch(/empty.*path's own scale/i);
  });

  it("does not hint the path's own scale on a slider, whose empty scale falls back to 0 to 1", async () => {
    metaOf(RPM).next(meta('Hz', 'rpm'));
    const fixture = await open('widget-slider', slider(RPM));
    const field = (fixture.nativeElement.querySelector('input[name="lower"]') as HTMLElement).closest('mat-form-field') as HTMLElement;
    expect(field.querySelector('mat-hint')).toBeNull();
  });

  it('re-resolves the unit once when the meta arrives, for a field the user has not edited', async () => {
    const fixture = await open('widget-gauge-ng-radial', gauge(TEMPERATURE, 'unitless', 273.15, 393.15));
    expect(scale(fixture).get('lower')?.value).toBe(273.15);
    scale(fixture).get('upper')?.setValue(400);

    metaOf(TEMPERATURE).next(meta('K', 'celsius'));
    expect(scale(fixture).get('lower')?.value).toBe(0);
    expect(suffix(fixture, 'lower')).toBe('°C');
    // The edited field keeps the unit it was entered in.
    expect(scale(fixture).get('upper')?.value).toBe(400);

    metaOf(TEMPERATURE).next(meta('K', 'fahrenheit'));
    expect(scale(fixture).get('lower')?.value).toBe(0);

    fixture.componentInstance.submitConfig();
    expect(lastSaved().displayScale?.lower).toBe(273.15);
    expect(lastSaved().displayScale?.upper).toBe(400);
  });

  describe('with the path picker', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const pick = async (fixture: ComponentFixture<RootModalWidgetConfigComponent>, slotName: string, path: string) => {
      const control = slot(fixture, slotName).get('path')!;
      control.markAsDirty();
      control.setValue(path);
      await vi.advanceTimersByTimeAsync(400);
    };

    it('re-points a gauge from a celsius path to an rpm path: meta scale in rpm, saved in Hz', async () => {
      metaOf(TEMPERATURE).next(meta('K', 'celsius'));
      metaOf(RPM).next(meta('Hz', 'rpm', { lower: 0, upper: 60, type: 'linear' }));
      const fixture = await open('widget-gauge-ng-radial', gauge(TEMPERATURE, 'celsius', 273.15, 393.15));
      await pick(fixture, 'gaugePath', RPM);
      expect(scale(fixture).get('lower')?.value).toBe(0);
      expect(scale(fixture).get('upper')?.value).toBe(3600);
      expect(suffix(fixture, 'upper')).toBe('rpm');

      fixture.componentInstance.submitConfig();
      // 0 °C was 273.15 K; the new lower bound is 0 rpm.
      expect(lastSaved().displayScale?.lower).toBe(0);
      expect(lastSaved().displayScale?.upper).toBeCloseTo(60, 9);
    });

    it("fills a re-pointed slider's scale in SI, the unit the slider works in", async () => {
      metaOf(TEMPERATURE).next(meta('K', 'celsius'));
      metaOf(RPM).next(meta('Hz', 'rpm', { lower: 0, upper: 60, type: 'linear' }));
      const fixture = await open('widget-slider', slider(TEMPERATURE));
      await pick(fixture, 'gaugePath', RPM);
      expect(scale(fixture).get('upper')?.value).toBe(60);

      fixture.componentInstance.submitConfig();
      expect(lastSaved().displayScale?.lower).toBe(0);
      expect(lastSaved().displayScale?.upper).toBe(60);
    });

    it('re-points a numeric to a path without meta scale: same numbers, new unit', async () => {
      metaOf(SPEED).next(meta('m/s', 'knots'));
      metaOf(DEPTH).next(meta('m', 'feet'));
      const fixture = await open('widget-numeric', numeric(SPEED, 'knots', 0, 5.144));
      const shown = fixture.componentInstance.formMaster.get('yScaleMax')?.value as number;
      await pick(fixture, 'numericPath', DEPTH);
      expect(fixture.componentInstance.formMaster.get('yScaleMax')?.value).toBe(shown);
      expect(suffix(fixture, 'yScaleMax')).toBe('ft');

      fixture.componentInstance.submitConfig();
      expect(lastSaved().yScaleMax).toBeCloseTo(shown * 0.3048, 6);
    });
  });

  it("converts a data graph's y bounds with the unit of its path, also after a path change", async () => {
    metaOf(SPEED).next(meta('m/s', 'knots'));
    metaOf(TEMPERATURE).next(meta('K', 'celsius'));
    const config = { ...structuredClone(WidgetDataGraphComponent.DEFAULT_CONFIG), datachartPath: SPEED,
      yScaleMin: 0, yScaleMax: 5.144, yScaleSuggestedMin: null, yScaleSuggestedMax: 2.572 } as unknown as IWidgetSvcConfig;
    const fixture = await open('widget-data-chart', config);
    const form = fixture.componentInstance.formMaster;
    expect(form.get('yScaleMax')?.value).toBeCloseTo(10, 2);
    expect(form.get('yScaleSuggestedMax')?.value).toBeCloseTo(5, 2);
    expect(form.get('yScaleSuggestedMin')?.value).toBeNull();
    expect(suffix(fixture, 'yScaleSuggestedMax')).toBe('kn');

    form.get('datachartPath')?.setValue(TEMPERATURE);
    expect(suffix(fixture, 'yScaleMin')).toBe('°C');
    form.get('yScaleMax')?.setValue(100);
    fixture.componentInstance.submitConfig();
    expect(lastSaved().yScaleMin).toBeCloseTo(273.15, 9);
    expect(lastSaved().yScaleMax).toBeCloseTo(373.15, 9);
    expect(lastSaved().yScaleSuggestedMin).toBeNull();
  });

  it("shows a slider's scale in SI, the unit the slider works in", async () => {
    metaOf(RPM).next(meta('Hz', 'rpm'));
    const fixture = await open('widget-slider', slider(RPM));
    expect(scale(fixture).get('upper')?.value).toBe(1);
    expect(suffix(fixture, 'upper')).toBe('Hz');

    scale(fixture).get('upper')?.setValue(50);
    fixture.componentInstance.submitConfig();
    expect(lastSaved().displayScale?.upper).toBe(50);
  });
});
