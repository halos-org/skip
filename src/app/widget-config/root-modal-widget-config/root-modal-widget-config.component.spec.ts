import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { UntypedFormArray, UntypedFormControl, UntypedFormGroup, Validators } from '@angular/forms';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RootModalWidgetConfigComponent } from './root-modal-widget-config.component';
import { IConversionPathList, UnitsService } from '../../core/services/units.service';
import { AppService } from '../../core/services/app-service';
import { ensureTestIconsReady } from '../../../test-helpers/icon-test-utils';
import type { IWidgetSvcConfig } from '../../core/interfaces/widgets-interface';

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
        convertUnitTo: null,
        sampleTime: 500
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

  it('builds each paths-array entry with source/sampleTime required and other keys plain', () => {
    const component = buildForm(multiControlConfig);
    const pathsArray = component.formMaster.get('paths') as UntypedFormArray;
    expect(pathsArray.length).toBe(1);

    const pathGroup = pathsArray.at(0) as UntypedFormGroup;
    ['description', 'path', 'source', 'pathType', 'zonesOnlyPaths', 'supportsPut', 'isPathConfigurable', 'showPathSkUnitsFilter', 'pathSkUnitsFilter', 'convertUnitTo', 'sampleTime'].forEach(key => {
      expect(pathGroup.get(key)).not.toBeNull();
    });

    const source = pathGroup.get('source') as UntypedFormControl;
    const sampleTime = pathGroup.get('sampleTime') as UntypedFormControl;
    const path = pathGroup.get('path') as UntypedFormControl;

    expect(source.hasValidator(Validators.required)).toBe(true);
    expect(sampleTime.hasValidator(Validators.required)).toBe(true);
    expect(path.hasValidator(Validators.required)).toBe(false);

    source.setValue(null);
    sampleTime.setValue(null);
    path.setValue(null);
    expect(source.hasError('required')).toBe(true);
    expect(sampleTime.hasError('required')).toBe(true);
    expect(path.hasError('required')).toBe(false);
  });
});
