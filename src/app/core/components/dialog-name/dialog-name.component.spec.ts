import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { beforeEach, describe, expect, it } from 'vitest';
import { DialogNameComponent } from './dialog-name.component';
import type { DialogNameData } from '../../interfaces/dialog-data';

describe('DialogNameComponent', () => {
  let component: DialogNameComponent;
  let fixture: ComponentFixture<DialogNameComponent>;

  const createWith = async (data?: Partial<DialogNameData>): Promise<void> => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [DialogNameComponent],
      providers: data ? [{ provide: MAT_DIALOG_DATA, useValue: data }] : []
    }).compileComponents();

    fixture = TestBed.createComponent(DialogNameComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await createWith();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders the description when one is supplied', async () => {
    await createWith({ title: 'New profile', name: '', cancelBtnText: 'Cancel', description: 'Starts from the shipped pages.' });

    const description = fixture.nativeElement.querySelector('.dialog-description');
    expect(description?.textContent?.trim()).toBe('Starts from the shipped pages.');
  });

  it('omits the description element when none is supplied', async () => {
    await createWith({ title: 'Rename profile', name: 'Cockpit', cancelBtnText: 'Cancel' });

    expect(fixture.nativeElement.querySelector('.dialog-description')).toBeNull();
  });
});
