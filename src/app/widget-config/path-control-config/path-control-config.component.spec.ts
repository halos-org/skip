import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { EMPTY } from 'rxjs';
import { UntypedFormControl, UntypedFormGroup } from '@angular/forms';
import { IDynamicControl } from '../../core/interfaces/widgets-interface';
import { ISkPathData } from '../../core/interfaces/app-interfaces';

import { PathControlConfigComponent } from './path-control-config.component';
import { SignalKConnectionService } from '../../core/services/signalk-connection.service';
import { DataService } from '../../core/services/data.service';
import { UnitsService } from '../../core/services/units.service';

const src = (...keys: string[]): ISkPathData['sources'] =>
  Object.fromEntries(keys.map(k => [k, { sourceTimestamp: '', sourceValue: 0 }]));

describe('PathControlConfigComponent', () => {
  let component: PathControlConfigComponent;
  let fixture: ComponentFixture<PathControlConfigComponent>;
  let pathForm: UntypedFormGroup;
  let pathObject: Partial<ISkPathData>;

  beforeEach(async () => {
    pathObject = { sources: src('gps.0') };
    await TestBed.configureTestingModule({
      imports: [PathControlConfigComponent],
      providers: [
        { provide: SignalKConnectionService, useValue: { skServerVersion: '2.14.0', serverServiceEndpoint$: EMPTY, serverVersion$: EMPTY } },
        {
          provide: DataService,
          useValue: {
            getPathObject: () => pathObject,
            getPathsAndMetaByType: () => ([])
          }
        },
        { provide: UnitsService, useValue: { skBaseUnits: [], getConversions: () => [], getConversionsForPath: () => ({ base: '', conversions: [] }) } }
      ]
    })
      .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(PathControlConfigComponent);
    component = fixture.componentInstance;
    // Provide required inputs before first detectChanges
    pathForm = new UntypedFormGroup({
      description: new UntypedFormControl('Speed'),
      path: new UntypedFormControl('navigation.speedThroughWater'),
      pathID: new UntypedFormControl('uuid-1'),
      source: new UntypedFormControl('default'),
      pathType: new UntypedFormControl('number'),
      supportsPut: new UntypedFormControl(true),
      isPathConfigurable: new UntypedFormControl(true),
      showPathSkUnitsFilter: new UntypedFormControl(false),
      pathSkUnitsFilter: new UntypedFormControl(null),
      convertUnitTo: new UntypedFormControl('knots'),
      sampleTime: new UntypedFormControl(500),
      pathRequired: new UntypedFormControl(true)
    });
    fixture.componentRef.setInput('pathFormGroup', pathForm);
    fixture.componentRef.setInput('multiCTRLArray', [] as IDynamicControl[]);
    fixture.componentRef.setInput('filterSelfPaths', false);
    fixture.detectChanges();
  });

  it('should be created', () => {
    expect(component).toBeTruthy();
  });

  const enableFormFields = (setValues: boolean) =>
    (component as unknown as { enableFormFields: (v: boolean) => void }).enableFormFields(setValues);

  it('offers "Any" (default) as the only leading option for a single-source path', () => {
    pathObject.sources = src('gps.0');
    pathForm.controls['source'].setValue('default');
    enableFormFields(false);
    expect(component.availableSources).toEqual(['default', 'gps.0']);
    expect(pathForm.controls['source'].value).toBe('default');
  });

  it('keeps "Any" (default) available when a path gains a second source', () => {
    pathObject.sources = src('gps.0', 'gps.1');
    pathForm.controls['source'].setValue('default');
    enableFormFields(false);
    expect(component.availableSources).toEqual(['default', 'gps.0', 'gps.1']);
    // Regression: a saved "Any" selection must not be reset when sources multiply.
    expect(pathForm.controls['source'].value).toBe('default');
  });

  it('preserves a concrete saved source on load', () => {
    pathObject.sources = src('gps.0', 'gps.1');
    pathForm.controls['source'].setValue('gps.1');
    enableFormFields(false);
    expect(pathForm.controls['source'].value).toBe('gps.1');
  });

  it('defaults an empty saved source to "Any" on load', () => {
    pathObject.sources = src('gps.0', 'gps.1');
    pathForm.controls['source'].setValue('');
    enableFormFields(false);
    expect(pathForm.controls['source'].value).toBe('default');
  });

  it('defaults a freshly selected path to "Any" (default)', () => {
    pathObject.sources = src('gps.0', 'gps.1');
    pathForm.controls['source'].setValue('gps.1');
    enableFormFields(true);
    expect(pathForm.controls['source'].value).toBe('default');
  });
});
