import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { UntypedFormControl, UntypedFormGroup } from '@angular/forms';
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
