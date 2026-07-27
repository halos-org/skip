import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { UntypedFormArray, UntypedFormControl, UntypedFormGroup, Validators } from '@angular/forms';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RootModalWidgetConfigComponent } from './root-modal-widget-config.component';
import { IConversionPathList, UnitsService } from '../../core/services/units.service';
import { AppService } from '../../core/services/app-service';
import { ensureTestIconsReady } from '../../../test-helpers/icon-test-utils';
import type { IWidgetSvcConfig } from '../../core/interfaces/widgets-interface';
import { MIN_UPDATE_INTERVAL_MS } from '../../core/interfaces/widgets-interface';
import { WidgetBooleanSwitchComponent } from '../../widgets/widget-boolean-switch/widget-boolean-switch.component';
import { WidgetZonesStatePanelComponent } from '../../widgets/widget-zones-state-panel/widget-zones-state-panel.component';
import { WidgetAutopilotComponent } from '../../widgets/widget-autopilot/widget-autopilot.component';

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

  // The decoupling is general, not wind-only (accepted): a non-wind mixed-path widget (autopilot has
  // configurable heading paths alongside fixed internal state/mode/rudder paths) now exposes an
  // editable Data Source on its fixed paths too, with only the `path` control disabled. Pin that so
  // Effort C revisits it deliberately rather than a regression flipping it back.
  it('autopilot (non-wind mixed-path): every path keeps an editable Source; fixed paths disable only path', () => {
    const component = buildForm(WidgetAutopilotComponent.DEFAULT_CONFIG);
    expect(component.hasConfigurablePaths).toBe(true);
    const pathGroups = Object.values((component.formMaster.get('paths') as UntypedFormGroup).controls) as UntypedFormGroup[];
    expect(pathGroups.length).toBeGreaterThan(0);
    let sawFixed = false;
    for (const g of pathGroups) {
      expect(g.get('source')!.enabled).toBe(true);
      if (g.get('isPathConfigurable')!.value === false) {
        sawFixed = true;
        expect(g.get('path')!.disabled).toBe(true);
      }
    }
    expect(sawFixed).toBe(true); // autopilot does carry fixed internal paths
  });
});
