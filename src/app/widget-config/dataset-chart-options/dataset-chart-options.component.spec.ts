import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UntypedFormControl } from '@angular/forms';
import { DatasetChartOptionsComponent } from './dataset-chart-options.component';
import { DataService } from '../../core/services/data.service';
import { UnitsService } from '../../core/services/units.service';
import { ISkPathData } from '../../core/interfaces/app-interfaces';

const src = (...keys: string[]): ISkPathData['sources'] =>
  Object.fromEntries(keys.map(k => [k, { sourceTimestamp: '', sourceValue: 0 }]));

describe('DatasetChartOptionsComponent', () => {
  let component: DatasetChartOptionsComponent;
  let fixture: ComponentFixture<DatasetChartOptionsComponent>;
  let pathObject: Partial<ISkPathData> | null;

  beforeEach(async () => {
    pathObject = null;
    await TestBed.configureTestingModule({
      imports: [DatasetChartOptionsComponent],
      providers: [
        {
          provide: DataService,
          useValue: {
            getPathsAndMetaByType: () => [],
            getPathObject: () => pathObject,
          },
        },
        {
          provide: UnitsService,
          useValue: {
            getConversionsForPath: () => ({ default: undefined, conversions: [] }),
          },
        },
      ],
    })
    .compileComponents();

    fixture = TestBed.createComponent(DatasetChartOptionsComponent);
    component = fixture.componentInstance;
    const set = fixture.componentRef.setInput.bind(fixture.componentRef) as (k: string, v: unknown) => void;
    set('filterSelfPaths', new UntypedFormControl(false));
    set('datachartPath', new UntypedFormControl(''));
    set('datachartSource', new UntypedFormControl({ value: '', disabled: true }));
    set('timeScale', new UntypedFormControl(''));
    set('period', new UntypedFormControl(''));
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('does not crash on init when a configured path has no resolvable data (#329)', () => {
    // A saved config references a path whose data has not (yet) arrived in _skData,
    // so getPathObject returns null. ngOnInit must skip setPathSources, not deref null.
    pathObject = null;
    const fx = TestBed.createComponent(DatasetChartOptionsComponent);
    const set = fx.componentRef.setInput.bind(fx.componentRef) as (k: string, v: unknown) => void;
    set('filterSelfPaths', new UntypedFormControl(false));
    set('datachartPath', new UntypedFormControl('self.navigation.speedOverGround'));
    set('datachartSource', new UntypedFormControl({ value: '', disabled: true }));
    set('timeScale', new UntypedFormControl(''));
    set('period', new UntypedFormControl(''));
    expect(() => fx.detectChanges()).not.toThrow();
    expect(fx.componentInstance).toBeTruthy();
  });

  const setPathSources = (obj: Pick<ISkPathData, 'sources'>) =>
    (component as unknown as { setPathSources: (p: unknown) => void }).setPathSources(obj);
  const changePath = (path: string) =>
    (component as unknown as { changePath: (e: unknown) => void }).changePath({ option: { value: path } });
  const sources = () => (component as unknown as { pathSources: () => string[] }).pathSources();

  it('offers "Any" (default) plus the concrete source for a single-source path', () => {
    setPathSources({ sources: src('gps.0') });
    expect(sources()).toEqual(['default', 'gps.0']);
    expect(component.datachartSource().value).toBe('default');
  });

  it('keeps "Any" (default) at the top and preserves the selection with multiple sources', () => {
    component.datachartSource().setValue('gps.1');
    setPathSources({ sources: src('gps.1', 'gps.0') });
    expect(sources()).toEqual(['default', 'gps.0', 'gps.1']);
    expect(component.datachartSource().value).toBe('gps.1');
  });

  it('defaults to "Any" (default) when no source was selected', () => {
    component.datachartSource().setValue('');
    setPathSources({ sources: src('gps.1', 'gps.0') });
    expect(component.datachartSource().value).toBe('default');
  });

  it('resets a stale source to "Any" when switching to a path that lacks it', () => {
    component.datachartSource().setValue('gps.9');
    pathObject = { path: 'navigation.speedThroughWater', sources: src('gps.0', 'gps.1') };
    changePath(pathObject.path as string);
    expect(component.datachartSource().value).toBe('default');
  });

  // The published list is empty in this suite, so any configured path reads as unpublished (#501).
  const mountWithPath = (path: string) => {
    const fx = TestBed.createComponent(DatasetChartOptionsComponent);
    const set = fx.componentRef.setInput.bind(fx.componentRef) as (k: string, v: unknown) => void;
    const pathControl = new UntypedFormControl(path);
    set('filterSelfPaths', new UntypedFormControl(false));
    set('datachartPath', pathControl);
    set('datachartSource', new UntypedFormControl({ value: '', disabled: true }));
    set('timeScale', new UntypedFormControl(''));
    set('period', new UntypedFormControl(''));
    fx.detectChanges();
    return { fixture: fx, pathControl };
  };

  const pathWarning = (fx: ComponentFixture<DatasetChartOptionsComponent>) =>
    (fx.componentInstance as unknown as { pathWarning: () => string | null }).pathWarning();

  it('leaves an unsent path valid, so Save stays available', () => {
    const { fixture: fx, pathControl } = mountWithPath('self.steering.rudderAngle');
    expect(pathControl.valid).toBe(true);
    expect(pathWarning(fx)).toContain('not sending this path');
  });

  it('still invalidates an empty path', () => {
    const { fixture: fx, pathControl } = mountWithPath('');
    expect(pathControl.valid).toBe(false);
    expect(pathControl.errors).toEqual({ required: true });
    expect(pathWarning(fx)).toBeNull();
  });

  it('offers the stored source alongside "Any" when the server is not sending the path', () => {
    // Otherwise the Source select renders enabled and required with no options at all, in exactly
    // the case this change makes reachable.
    pathObject = null;
    const fx = TestBed.createComponent(DatasetChartOptionsComponent);
    const set = fx.componentRef.setInput.bind(fx.componentRef) as (k: string, v: unknown) => void;
    const sourceControl = new UntypedFormControl('gps.7');
    set('filterSelfPaths', new UntypedFormControl(false));
    set('datachartPath', new UntypedFormControl('self.steering.rudderAngle'));
    set('datachartSource', sourceControl);
    set('timeScale', new UntypedFormControl(''));
    set('period', new UntypedFormControl(''));
    fx.detectChanges();
    const sourceList = (fx.componentInstance as unknown as { pathSources: () => string[] }).pathSources();
    expect(sourceList).toEqual(['default', 'gps.7']);
    expect(sourceControl.value).toBe('gps.7');
    expect(sourceControl.enabled).toBe(true);
  });

  it('drops the previous path\'s source when a new path is typed rather than picked', async () => {
    // An unsent path never appears in the autocomplete, so (optionSelected) never fires and
    // changePath() never runs; the stale concrete source would otherwise be saved against it.
    vi.useFakeTimers();
    try {
      pathObject = null;
      const fx = TestBed.createComponent(DatasetChartOptionsComponent);
      const set = fx.componentRef.setInput.bind(fx.componentRef) as (k: string, v: unknown) => void;
      const pathControl = new UntypedFormControl('self.environment.wind.speedApparent');
      const sourceControl = new UntypedFormControl('wind-sensor-1');
      set('filterSelfPaths', new UntypedFormControl(false));
      set('datachartPath', pathControl);
      set('datachartSource', sourceControl);
      set('timeScale', new UntypedFormControl(''));
      set('period', new UntypedFormControl(''));
      fx.detectChanges();
      expect(sourceControl.value).toBe('wind-sensor-1');

      pathControl.setValue('self.propulsion.port.temperature');
      await vi.advanceTimersByTimeAsync(400);
      expect(sourceControl.value).toBe('default');
    } finally {
      vi.useRealTimers();
    }
  });
});
