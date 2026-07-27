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

  // B1: fixed/choice paths keep an editable, valid, saveable Data Source, driven off the resolved
  // stored path (not path.valid). This is the decoupling the Effort-A review traced.
  const setupSourceFor = (path: string | null) =>
    (component as unknown as { setupSourceFor: (p: string | null) => void }).setupSourceFor(path);

  it('populates and enables Data Source from the resolved path for a fixed/choice path', () => {
    pathObject.sources = src('gps.0', 'gps.1');
    pathForm.controls['source'].setValue('');
    setupSourceFor('self.navigation.headingTrue');
    expect(component.availableSources).toEqual(['default', 'gps.0', 'gps.1']);
    expect(pathForm.controls['source'].value).toBe('default');
    expect(pathForm.controls['source'].enabled).toBe(true);
  });

  it('keeps Data Source valid and saveable when the fixed path has no live data (offline)', () => {
    pathObject = null as unknown as Partial<ISkPathData>; // getPathObject resolves to null
    pathForm.controls['source'].setValue('');
    setupSourceFor('self.some.offline.path');
    expect(component.availableSources).toEqual(['default']); // only "Any"
    expect(pathForm.controls['source'].value).toBe('default'); // valid, not empty+required+invalid
    expect(pathForm.controls['source'].enabled).toBe(true);
  });

  it('resets a pinned Data Source to "Any" when the newly chosen path no longer offers it', () => {
    pathForm.controls['source'].setValue('gps.9');
    pathObject.sources = src('gps.0');
    setupSourceFor('self.navigation.headingMagnetic');
    expect(pathForm.controls['source'].value).toBe('default');
  });

  it('preserves a still-valid pinned Data Source across a choice change', () => {
    pathForm.controls['source'].setValue('gps.0');
    pathObject.sources = src('gps.0', 'gps.1');
    setupSourceFor('self.navigation.headingTrue');
    expect(pathForm.controls['source'].value).toBe('gps.0');
  });

  it('keeps a pinned Data Source when the path is offline, rather than clobbering it to "Any"', () => {
    pathObject = null as unknown as Partial<ISkPathData>; // path has no live data yet
    pathForm.controls['source'].setValue('gps.7');
    setupSourceFor('self.some.offline.path');
    // A valid pin must survive a transient-offline dialog open (else Save persists the loss).
    expect(pathForm.controls['source'].value).toBe('gps.7');
    expect(component.availableSources).toContain('gps.7'); // surfaced so the select can display it
    expect(pathForm.controls['source'].enabled).toBe(true);
  });

  it('routes a choice slot to Data Source setup on init and recomputes sources when the choice flips', () => {
    pathObject.sources = src('gps.0');
    const choiceForm = new UntypedFormGroup({
      description: new UntypedFormControl('Heading'),
      path: new UntypedFormControl('self.navigation.headingTrue'),
      pathID: new UntypedFormControl('uuid-2'),
      source: new UntypedFormControl('default'),
      pathType: new UntypedFormControl('number'),
      supportsPut: new UntypedFormControl(false),
      isPathConfigurable: new UntypedFormControl(true),
      pathOptions: new UntypedFormControl([
        { label: 'True', path: 'self.navigation.headingTrue' },
        { label: 'Magnetic', path: 'self.navigation.headingMagnetic' }
      ]),
      showPathSkUnitsFilter: new UntypedFormControl(false),
      pathSkUnitsFilter: new UntypedFormControl(null),
      convertUnitTo: new UntypedFormControl('deg'),
      pathRequired: new UntypedFormControl(true)
    });
    const choiceFixture = TestBed.createComponent(PathControlConfigComponent);
    choiceFixture.componentRef.setInput('pathFormGroup', choiceForm);
    choiceFixture.componentRef.setInput('multiCTRLArray', [] as IDynamicControl[]);
    choiceFixture.componentRef.setInput('filterSelfPaths', false);
    choiceFixture.detectChanges(); // ngOnInit takes the choice branch -> setupSourceFor(headingTrue)
    const choiceComponent = choiceFixture.componentInstance;
    expect(choiceComponent.availableSources).toEqual(['default', 'gps.0']);

    // The mat-select writes the newly chosen path, then (selectionChange) fires onPathChoiceChange.
    choiceForm.controls['path'].setValue('self.navigation.headingMagnetic');
    pathObject.sources = src('gps.0', 'wmm.0');
    (choiceComponent as unknown as { onPathChoiceChange: () => void }).onPathChoiceChange();
    expect(choiceComponent.availableSources).toEqual(['default', 'gps.0', 'wmm.0']);
  });
});
