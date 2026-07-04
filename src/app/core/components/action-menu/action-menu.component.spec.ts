import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { BreakpointObserver } from '@angular/cdk/layout';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { ActionMenuComponent } from './action-menu.component';

describe('ActionMenuComponent', () => {
  let fixture: ComponentFixture<ActionMenuComponent>;
  let component: ActionMenuComponent;
  let breakpoint: { isMatched: ReturnType<typeof vi.fn> };
  let bottomSheet: { open: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    breakpoint = { isMatched: vi.fn().mockReturnValue(false) };
    bottomSheet = { open: vi.fn().mockReturnValue({ afterDismissed: () => of(undefined) }) };

    await TestBed.configureTestingModule({
      imports: [ActionMenuComponent],
      providers: [
        { provide: BreakpointObserver, useValue: breakpoint },
        { provide: MatBottomSheet, useValue: bottomSheet },
      ],
    })
      .overrideProvider(MatBottomSheet, { useValue: bottomSheet })
      .compileComponents();

    fixture = TestBed.createComponent(ActionMenuComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('items', [{ id: 'add', label: 'Add', icon: 'add' }]);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('opens the bottom drawer on phone-width screens', () => {
    breakpoint.isMatched.mockReturnValue(true);

    component.open(10, 20);

    expect(bottomSheet.open).toHaveBeenCalledTimes(1);
  });

  it('emits the chosen item id from the drawer (ignoring Cancel)', () => {
    breakpoint.isMatched.mockReturnValue(true);
    bottomSheet.open.mockReturnValue({ afterDismissed: () => of('add') });
    const selected = vi.fn();
    component.selected.subscribe(selected);

    component.open(10, 20);

    expect(selected).toHaveBeenCalledWith('add');
  });
});
