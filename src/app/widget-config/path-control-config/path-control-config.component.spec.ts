import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY } from 'rxjs';
import { UntypedFormControl, UntypedFormGroup } from '@angular/forms';
import { IDynamicControl } from '../../core/interfaces/widgets-interface';
import { IPathMetaData, ISkPathData } from '../../core/interfaces/app-interfaces';

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
  let publishedPaths: IPathMetaData[];

  beforeEach(async () => {
    pathObject = { sources: src('gps.0'), type: 'number' };
    publishedPaths = [];
    await TestBed.configureTestingModule({
      imports: [PathControlConfigComponent],
      providers: [
        { provide: SignalKConnectionService, useValue: { skServerVersion: '2.14.0', serverServiceEndpoint$: EMPTY, serverVersion$: EMPTY } },
        {
          provide: DataService,
          useValue: {
            getPathObject: () => pathObject,
            getPathsAndMetaByType: () => publishedPaths,
            getPathMeta: () => undefined
          }
        },
        { provide: UnitsService, useValue: { skBaseUnits: [], getConversions: () => [], getConversionsForPath: () => ({ base: '', conversions: [] }) } }
      ]
    })
      .compileComponents();
  });

  beforeEach(() => {
    vi.useFakeTimers();
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

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should be created', () => {
    expect(component).toBeTruthy();
  });

  it('renders the path card by default (no hideFromConfig)', () => {
    expect(fixture.nativeElement.querySelector('.flex-container')).not.toBeNull();
  });

  it('renders no card at all when hideFromConfig is set (internal/system path)', () => {
    pathForm.addControl('hideFromConfig', new UntypedFormControl(true));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.flex-container')).toBeNull();
  });

  const enableFormFields = (setValues: boolean) =>
    (component as unknown as { enableFormFields: (v: boolean) => void }).enableFormFields(setValues);

  it('offers "Any" (default) as the only leading option for a single-source path', () => {
    pathObject = { sources: src('gps.0'), type: 'number' };
    pathForm.controls['source'].setValue('default');
    enableFormFields(false);
    expect(component.availableSources).toEqual(['default', 'gps.0']);
    expect(pathForm.controls['source'].value).toBe('default');
  });

  it('keeps "Any" (default) available when a path gains a second source', () => {
    pathObject = { sources: src('gps.0', 'gps.1'), type: 'number' };
    pathForm.controls['source'].setValue('default');
    enableFormFields(false);
    expect(component.availableSources).toEqual(['default', 'gps.0', 'gps.1']);
    // Regression: a saved "Any" selection must not be reset when sources multiply.
    expect(pathForm.controls['source'].value).toBe('default');
  });

  it('preserves a concrete saved source on load', () => {
    pathObject = { sources: src('gps.0', 'gps.1'), type: 'number' };
    pathForm.controls['source'].setValue('gps.1');
    enableFormFields(false);
    expect(pathForm.controls['source'].value).toBe('gps.1');
  });

  it('defaults an empty saved source to "Any" on load', () => {
    pathObject = { sources: src('gps.0', 'gps.1'), type: 'number' };
    pathForm.controls['source'].setValue('');
    enableFormFields(false);
    expect(pathForm.controls['source'].value).toBe('default');
  });

  it('defaults a freshly selected path to "Any" (default)', () => {
    pathObject = { sources: src('gps.0', 'gps.1'), type: 'number' };
    pathForm.controls['source'].setValue('gps.1');
    enableFormFields(true);
    expect(pathForm.controls['source'].value).toBe('default');
  });

  // B1: fixed/choice paths keep an editable, valid, saveable Data Source, driven off the resolved
  // stored path (not path.valid). This is the decoupling the Effort-A review traced.
  const setupSourceFor = (path: string | null) =>
    (component as unknown as { setupSourceFor: (p: string | null) => void }).setupSourceFor(path);

  it('populates and enables Data Source from the resolved path for a fixed/choice path', () => {
    pathObject = { sources: src('gps.0', 'gps.1'), type: 'number' };
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
    pathObject = { sources: src('gps.0'), type: 'number' };
    setupSourceFor('self.navigation.headingMagnetic');
    expect(pathForm.controls['source'].value).toBe('default');
  });

  it('preserves a still-valid pinned Data Source across a choice change', () => {
    pathForm.controls['source'].setValue('gps.0');
    pathObject = { sources: src('gps.0', 'gps.1'), type: 'number' };
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

  // An unpublished path is not a wrong path: Signal K publishes a path only once a source has sent
  // it, so an instrument switched off makes a correct path read as unknown. Blocking Save there
  // strands every other setting in the widget (#501).
  describe('a configured path the server does not publish', () => {
    const freePathForm = (overrides: Record<string, unknown> = {}): UntypedFormGroup =>
      new UntypedFormGroup({
        description: new UntypedFormControl('Rudder'),
        path: new UntypedFormControl('self.steering.rudderAngle'),
        pathID: new UntypedFormControl('uuid-3'),
        source: new UntypedFormControl('gps.7'),
        pathType: new UntypedFormControl('number'),
        supportsPut: new UntypedFormControl(false),
        isPathConfigurable: new UntypedFormControl(true),
        showPathSkUnitsFilter: new UntypedFormControl(false),
        pathSkUnitsFilter: new UntypedFormControl(null),
        convertUnitTo: new UntypedFormControl('deg'),
        pathRequired: new UntypedFormControl(true),
        ...Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k, new UntypedFormControl(v)]))
      });

    const mount = (form: UntypedFormGroup) => {
      const f = TestBed.createComponent(PathControlConfigComponent);
      f.componentRef.setInput('pathFormGroup', form);
      f.componentRef.setInput('multiCTRLArray', [] as IDynamicControl[]);
      f.componentRef.setInput('filterSelfPaths', false);
      f.detectChanges();
      return f;
    };

    it('leaves the path control valid, so Save stays available', () => {
      pathObject = null as unknown as Partial<ISkPathData>;
      const form = freePathForm();
      mount(form);
      expect(form.controls['path'].valid).toBe(true);
      expect(form.valid).toBe(true);
    });

    it('preserves the stored source and unit conversion instead of clearing them', () => {
      // submitConfig() saves with getRawValue(), so a reset here would be persisted on Save.
      pathObject = null as unknown as Partial<ISkPathData>;
      const form = freePathForm();
      mount(form);
      expect(form.controls['source'].value).toBe('gps.7');
      expect(form.controls['source'].enabled).toBe(true);
      expect(form.controls['convertUnitTo'].value).toBe('deg');
    });

    it('warns that the server is not sending the path', () => {
      pathObject = null as unknown as Partial<ISkPathData>;
      const f = mount(freePathForm());
      expect(f.componentInstance.pathWarning()).toContain('not sending this path');
    });

    it('renders the warning as a hint, not a save-blocking error', () => {
      pathObject = null as unknown as Partial<ISkPathData>;
      const f = mount(freePathForm());
      expect(f.nativeElement.querySelector('.pathWarningHint')).not.toBeNull();
      expect(f.nativeElement.querySelector('mat-error')).toBeNull();
    });

    it('does not warn about a path that satisfies the slot', () => {
      publishedPaths = [{ path: 'self.steering.rudderAngle' }];
      const f = mount(freePathForm());
      expect(f.componentInstance.pathWarning()).toBeNull();
      expect(f.nativeElement.querySelector('.pathWarningHint')).toBeNull();
    });

    it('names the mismatch when the path carries the wrong value type', () => {
      pathObject = { sources: src('gps.0'), type: 'string' } as Partial<ISkPathData>;
      const f = mount(freePathForm());
      expect(f.componentInstance.pathWarning()).toContain('sends text values');
    });

    it('still invalidates an empty required path', () => {
      const form = freePathForm({ path: '' });
      mount(form);
      expect(form.controls['path'].valid).toBe(false);
      expect(form.controls['path'].errors).toEqual({ required: true });
    });

    it('accepts an empty path in an optional slot', () => {
      const form = freePathForm({ path: '', pathRequired: false });
      mount(form);
      expect(form.controls['path'].valid).toBe(true);
    });

    it('re-derives source and unit conversion when the user types a different path', async () => {
      // Nothing about the previous path carries over to a path the user just typed.
      pathObject = null as unknown as Partial<ISkPathData>;
      const form = freePathForm();
      mount(form);
      form.controls['path'].markAsDirty();
      form.controls['path'].setValue('self.environment.wind.speedApparent');
      await vi.advanceTimersByTimeAsync(400);
      expect(form.controls['source'].value).toBe('default');
      expect(form.controls['convertUnitTo'].value).toBe('');
      expect(form.controls['convertUnitTo'].enabled).toBe(true);
    });

    it('keeps source and unit when an edit lands back on the same path', async () => {
      // Any keystroke marks the control dirty, so re-deriving on dirty alone would clear the very
      // values this change exists to preserve — and Save would now persist that loss.
      pathObject = null as unknown as Partial<ISkPathData>;
      const form = freePathForm();
      mount(form);
      form.controls['path'].markAsDirty();
      form.controls['path'].setValue('self.steering.rudderAngl');
      form.controls['path'].setValue('self.steering.rudderAngle');
      await vi.advanceTimersByTimeAsync(400);
      expect(form.controls['source'].value).toBe('gps.7');
      expect(form.controls['convertUnitTo'].value).toBe('deg');
    });

    it('clears the warning once the edited path becomes one the slot offers', async () => {
      pathObject = null as unknown as Partial<ISkPathData>;
      const form = freePathForm();
      const f = mount(form);
      expect(f.componentInstance.pathWarning()).toContain('not sending this path');
      pathObject = { sources: src('gps.0'), type: 'number' };
      form.controls['path'].markAsDirty();
      form.controls['path'].setValue('self.environment.wind.speedApparent');
      await vi.advanceTimersByTimeAsync(400);
      expect(f.componentInstance.pathWarning()).toBeNull();
    });

    it('clears source and unit conversion when an optional path is left blank', () => {
      pathObject = null as unknown as Partial<ISkPathData>; // getPathObject('') resolves to null
      const form = freePathForm({ path: '', pathRequired: false });
      mount(form);
      expect(form.controls['source'].value).toBe('');
      expect(form.controls['source'].disabled).toBe(true);
      expect(form.controls['convertUnitTo'].value).toBe('');
    });
  });

  it('routes a choice slot to Data Source setup on init and recomputes sources when the choice flips', () => {
    pathObject = { sources: src('gps.0'), type: 'number' };
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
