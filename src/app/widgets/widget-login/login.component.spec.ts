import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetLoginComponent } from './widget-login.component';
import { SsoRedirectService } from '../../core/services/sso-redirect.service';
import { AuthenticationService, ILoginStatus } from '../../core/services/authentication.service';

describe('WidgetLoginComponent', () => {
  let fixture: ComponentFixture<WidgetLoginComponent>;
  const manualSignIn = vi.fn();

  async function createComponent(loginStatusValue: ILoginStatus | null = null) {
    await TestBed.configureTestingModule({
      imports: [WidgetLoginComponent],
      providers: [
        { provide: SsoRedirectService, useValue: { manualSignIn } },
        { provide: AuthenticationService, useValue: { loginStatusValue } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(WidgetLoginComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  beforeEach(() => {
    manualSignIn.mockClear();
    TestBed.resetTestingModule();
  });

  it('redirects to the SK/SSO login when not authenticated', async () => {
    const component = await createComponent();

    expect(component).toBeTruthy();
    expect(component.redirecting).toBe(true);
    expect(manualSignIn).toHaveBeenCalledOnce();
  });

  it('skips the sign-in redirect when already logged in (breaks the /#/login loop)', async () => {
    const component = await createComponent({ status: 'loggedIn' });

    expect(component.redirecting).toBe(false);
    expect(manualSignIn).not.toHaveBeenCalled();
  });

  it('does not auto-redirect (frame-bust) when embedded in an iframe (#217)', async () => {
    const originalTop = window.top;
    Object.defineProperty(window, 'top', { configurable: true, value: { name: 'host' } });

    try {
      const component = await createComponent();

      expect(component.redirecting).toBe(false);
      expect(manualSignIn).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'top', { configurable: true, value: originalTop });
    }
  });
});
