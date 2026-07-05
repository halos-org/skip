import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
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
    set('convertUnitTo', new UntypedFormControl(''));
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
});
