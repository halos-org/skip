import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetLoginComponent } from './widget-login.component';
import { SsoRedirectService } from '../../core/services/sso-redirect.service';

describe('WidgetLoginComponent', () => {
  let component: WidgetLoginComponent;
  let fixture: ComponentFixture<WidgetLoginComponent>;
  const manualSignIn = vi.fn();

  beforeEach(async () => {
    manualSignIn.mockClear();
    await TestBed.configureTestingModule({
      imports: [WidgetLoginComponent],
      providers: [
        { provide: SsoRedirectService, useValue: { manualSignIn } }
      ]
    })
      .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(WidgetLoginComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create and redirect to the SK/SSO login', () => {
    expect(component).toBeTruthy();
    expect(component.redirecting).toBe(true);
    expect(manualSignIn).toHaveBeenCalledOnce();
  });
});
