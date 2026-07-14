import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SsoRedirectService } from './sso-redirect.service';
import { AuthenticationService, ILoginStatus } from './authentication.service';
import { ensureLocalStorage, ensureSessionStorage } from '../../../test-helpers/local-storage.test-helper';

class AuthStub {
  loginStatusValue: ILoginStatus | null = null;
}

const OIDC_STATUS: ILoginStatus = {
  status: 'notLoggedIn',
  authenticationRequired: true,
  oidcEnabled: true,
  oidcAutoLogin: true,
  oidcLoginUrl: '/signalk/v1/auth/oidc/login'
};

function setup(authStub: AuthStub = new AuthStub()) {
  ensureLocalStorage();
  ensureSessionStorage();
  TestBed.configureTestingModule({
    providers: [SsoRedirectService, { provide: AuthenticationService, useValue: authStub }]
  });
  const service = TestBed.inject(SsoRedirectService);
  const navSpy = vi
    .spyOn(service as unknown as { navigate: (u: string) => void }, 'navigate')
    .mockImplementation(() => undefined);
  return { service, navSpy, authStub };
}

describe('SsoRedirectService', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('redirects to the OIDC login and records one budget attempt', () => {
    const { service, navSpy } = setup();

    expect(service.attemptAutoRedirect(OIDC_STATUS)).toBe('redirected');

    expect(navSpy).toHaveBeenCalledTimes(1);
    expect(navSpy.mock.calls[0][0]).toContain('/signalk/v1/auth/oidc/login');
    expect(service.attempts()).toBe(1);
  });

  it('stops redirecting once the budget is exhausted (kiosk auto-login loop guard)', () => {
    const { service, navSpy } = setup();

    expect(service.attemptAutoRedirect(OIDC_STATUS)).toBe('redirected');
    expect(service.attemptAutoRedirect(OIDC_STATUS)).toBe('redirected');
    expect(service.attemptAutoRedirect(OIDC_STATUS)).toBe('redirected');
    navSpy.mockClear();

    expect(service.attemptAutoRedirect(OIDC_STATUS)).toBe('budget-exhausted');
    expect(navSpy).not.toHaveBeenCalled();
  });

  it('resetBudget clears the attempt count', () => {
    const { service } = setup();
    service.attemptAutoRedirect(OIDC_STATUS);
    expect(service.attempts()).toBe(1);

    service.resetBudget();

    expect(service.attempts()).toBe(0);
    expect(service.isBudgetExhausted()).toBe(false);
  });

  it('manualSignIn resets the budget and disables auto-login', () => {
    const authStub = new AuthStub();
    authStub.loginStatusValue = OIDC_STATUS;
    const { service, navSpy } = setup(authStub);
    service.attemptAutoRedirect(OIDC_STATUS);
    service.attemptAutoRedirect(OIDC_STATUS);
    navSpy.mockClear();

    service.manualSignIn();

    expect(service.attempts()).toBe(0);
    expect(navSpy).toHaveBeenCalledTimes(1);
    expect(navSpy.mock.calls[0][0]).toContain('/signalk/v1/auth/oidc/login');
    expect(navSpy.mock.calls[0][0]).toContain('noAutoLogin=true');
  });

  it('does not auto-redirect when framed; surfaces recovery instead (frame-ancestors blocks the login)', () => {
    const { service, navSpy } = setup();
    vi.spyOn(service as unknown as { isFramed: () => boolean }, 'isFramed').mockReturnValue(true);

    expect(service.attemptAutoRedirect(OIDC_STATUS)).toBe('framed');
    expect(navSpy).not.toHaveBeenCalled();
    expect(service.attempts()).toBe(0);
  });

  it('manualSignIn breaks out to the top window when framed', () => {
    const authStub = new AuthStub();
    authStub.loginStatusValue = OIDC_STATUS;
    ensureLocalStorage();
    ensureSessionStorage();
    TestBed.configureTestingModule({
      providers: [SsoRedirectService, { provide: AuthenticationService, useValue: authStub }]
    });
    const service = TestBed.inject(SsoRedirectService);
    vi.spyOn(service as unknown as { isFramed: () => boolean }, 'isFramed').mockReturnValue(true);
    const replace = vi.fn();
    const originalTop = window.top;
    Object.defineProperty(window, 'top', { configurable: true, value: { location: { replace } } });

    try {
      service.manualSignIn();
      expect(replace).toHaveBeenCalledTimes(1);
      expect(replace.mock.calls[0][0]).toContain('/signalk/v1/auth/oidc/login');
    } finally {
      Object.defineProperty(window, 'top', { configurable: true, value: originalTop });
    }
  });

  it('detects a framed context for real (no isFramed mock) and returns framed without navigating', () => {
    const { service, navSpy } = setup();
    const originalTop = window.top;
    Object.defineProperty(window, 'top', { configurable: true, value: { name: 'host' } });

    try {
      expect(service.attemptAutoRedirect(OIDC_STATUS)).toBe('framed');
      expect(navSpy).not.toHaveBeenCalled();
      expect(service.attempts()).toBe(0);
    } finally {
      Object.defineProperty(window, 'top', { configurable: true, value: originalTop });
    }
  });

  it('navigate does not throw when framed with a null window.top (detached iframe)', () => {
    const authStub = new AuthStub();
    authStub.loginStatusValue = OIDC_STATUS;
    ensureLocalStorage();
    ensureSessionStorage();
    TestBed.configureTestingModule({
      providers: [SsoRedirectService, { provide: AuthenticationService, useValue: authStub }]
    });
    const service = TestBed.inject(SsoRedirectService);
    vi.spyOn(service as unknown as { isFramed: () => boolean }, 'isFramed').mockReturnValue(true);
    const originalTop = window.top;
    Object.defineProperty(window, 'top', { configurable: true, value: null });

    try {
      expect(() => service.manualSignIn()).not.toThrow();
    } finally {
      Object.defineProperty(window, 'top', { configurable: true, value: originalTop });
    }
  });

  it('falls back to the admin login when OIDC is not enabled', () => {
    const { service, navSpy } = setup();

    service.attemptAutoRedirect({ status: 'notLoggedIn', authenticationRequired: true, oidcEnabled: false });

    expect(navSpy.mock.calls[0][0]).toContain('/admin/#/login');
  });

  it('fails closed (does not auto-redirect) when sessionStorage is unavailable', () => {
    const { service, navSpy } = setup();
    const original = window.sessionStorage;
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() { throw new Error('storage blocked'); }
    });

    try {
      expect(service.attemptAutoRedirect(OIDC_STATUS)).toBe('budget-exhausted');
      expect(navSpy).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'sessionStorage', { configurable: true, value: original });
    }
  });

  it('fails closed when sessionStorage silently discards writes (probe read-back mismatch)', () => {
    const { service, navSpy } = setup();
    const original = window.sessionStorage;
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      value: { setItem() { /* accepted but discarded */ }, getItem() { return null; }, removeItem() { /* noop */ } }
    });

    try {
      expect(service.attemptAutoRedirect(OIDC_STATUS)).toBe('budget-exhausted');
      expect(navSpy).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'sessionStorage', { configurable: true, value: original });
    }
  });
});
