import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { DialogDashboardPageEditorComponent } from './dialog-dashboard-page-editor.component';
import { DataService } from '../../services/data.service';
import { DialogDashboardPageEditorData } from '../../interfaces/dialog-data';
import { ISkMetadata } from '../../interfaces/signalk-interfaces';

interface Testable {
  triggerEnabled: boolean;
  triggerPath: string;
  triggerValue: string;
  filteredPaths: string[];
  filteredValueOptions: { value: string; label: string }[];
  onPathChange(): void;
  save(): void;
}

describe('DialogDashboardPageEditorComponent', () => {
  let fixture: ComponentFixture<DialogDashboardPageEditorComponent>;
  let dialogRef: { close: ReturnType<typeof vi.fn> };
  let data: Partial<DialogDashboardPageEditorData>;

  function setup(
    dialogData: Partial<DialogDashboardPageEditorData>,
    meta: ISkMetadata | null = null,
    cachedPaths: string[] = []
  ): Testable {
    data = dialogData;
    dialogRef = { close: vi.fn() };
    const dataService = { getCachedPaths: () => cachedPaths, getPathMeta: () => meta };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [DialogDashboardPageEditorComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: DataService, useValue: dataService }
      ]
    });
    fixture = TestBed.createComponent(DialogDashboardPageEditorComponent);
    fixture.detectChanges();
    return fixture.componentInstance as unknown as Testable;
  }

  const meta = (values: { value: string | number | boolean; title?: string }[]): ISkMetadata =>
    ({ possibleValues: values } as ISkMetadata);

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates with the trigger editor hidden in the plain (New Page) flow', () => {
    setup({ title: 'New Page', name: 'Page 1', cancelBtnText: 'Cancel' });
    expect(fixture.componentInstance).toBeTruthy();
    expect((fixture.nativeElement as HTMLElement).querySelector('.trigger-section')).toBeNull();
  });

  it('prefills the trigger fields from an existing trigger', () => {
    const c = setup({
      title: 'Page Options', name: 'Sailing', cancelBtnText: 'Cancel',
      enableTrigger: true, trigger: { path: 'self.navigation.state', value: 'sailing' }
    });
    expect(c.triggerEnabled).toBe(true);
    expect(c.triggerPath).toBe('self.navigation.state');
    expect(c.triggerValue).toBe('sailing');
    expect((fixture.nativeElement as HTMLElement).querySelector('.trigger-section')).not.toBeNull();
  });

  it('maps possibleValues to option value (String) + label, storing the value not the title', () => {
    const c = setup(
      { title: 'Page Options', name: 'x', cancelBtnText: 'Cancel', enableTrigger: true, trigger: { path: 'self.navigation.state', value: '' } },
      meta([{ value: 'sailing', title: 'Sailing' }, { value: 'motoring' }])
    );
    expect(c.filteredValueOptions).toEqual([
      { value: 'sailing', label: 'Sailing' },
      { value: 'motoring', label: 'motoring' }
    ]);
  });

  it('coerces non-string possibleValues to strings', () => {
    const c = setup(
      { title: 'Page Options', name: 'x', cancelBtnText: 'Cancel', enableTrigger: true, trigger: { path: 'self.some.flag', value: '' } },
      meta([{ value: true }, { value: 0 }])
    );
    expect(c.filteredValueOptions).toEqual([
      { value: 'true', label: 'true' },
      { value: '0', label: '0' }
    ]);
  });

  it('keeps the entered value when the path changes', () => {
    const c = setup(
      { title: 'Page Options', name: 'x', cancelBtnText: 'Cancel', enableTrigger: true, trigger: { path: 'self.navigation.state', value: 'sailing' } },
      meta([{ value: 'sailing' }])
    );
    c.triggerPath = 'self.some.other.path';
    c.onPathChange();
    expect(c.triggerValue).toBe('sailing');
  });

  it('closes with the entered trigger on save', () => {
    const c = setup({
      title: 'Page Options', name: 'Sailing', cancelBtnText: 'Cancel',
      enableTrigger: true, trigger: { path: 'self.navigation.state', value: 'sailing' }
    });
    c.save();
    expect(dialogRef.close).toHaveBeenCalledOnce();
    expect(data.trigger).toEqual({ path: 'self.navigation.state', value: 'sailing' });
  });

  it('closes with a null trigger when the section is disabled', () => {
    const c = setup({
      title: 'Page Options', name: 'x', cancelBtnText: 'Cancel',
      enableTrigger: true, trigger: { path: 'self.navigation.state', value: 'sailing' }
    });
    c.triggerEnabled = false;
    c.save();
    expect(data.trigger).toBeNull();
  });

  it('clears the trigger when path or value is left empty', () => {
    const c = setup({
      title: 'Page Options', name: 'x', cancelBtnText: 'Cancel',
      enableTrigger: true, trigger: { path: 'self.navigation.state', value: 'sailing' }
    });
    c.triggerValue = '   ';
    c.save();
    expect(data.trigger).toBeNull();
  });

  it('does not touch the trigger in the New Page flow (enableTrigger off)', () => {
    const c = setup({ title: 'New Page', name: 'Page 1', cancelBtnText: 'Cancel' });
    c.save();
    expect(data.trigger).toBeUndefined();
  });

  it('sorts the path suggestions alphabetically', () => {
    const c = setup(
      { title: 'Page Options', name: 'x', cancelBtnText: 'Cancel', enableTrigger: true, trigger: { path: '', value: '' } },
      null, ['self.navigation.state', 'self.environment.depth', 'self.electrical.batteries.house.voltage']
    );
    expect(c.filteredPaths).toEqual([
      'self.electrical.batteries.house.voltage',
      'self.environment.depth',
      'self.navigation.state'
    ]);
  });

  it('filters and caps path suggestions to the typed substring', () => {
    const paths = Array.from({ length: 60 }, (_, i) => `self.navigation.item${i}`);
    paths.push('self.environment.depth');
    const c = setup(
      { title: 'Page Options', name: 'x', cancelBtnText: 'Cancel', enableTrigger: true, trigger: { path: 'environment', value: '' } },
      null, paths
    );
    expect(c.filteredPaths).toEqual(['self.environment.depth']);
  });
});
