import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { WidgetLoginComponent } from './widget-login.component';

describe('WidgetLoginComponent', () => {
  let component: WidgetLoginComponent;
  let fixture: ComponentFixture<WidgetLoginComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
    imports: [WidgetLoginComponent],
    providers: [
      { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(undefined) }) } }
    ]
})
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(WidgetLoginComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
