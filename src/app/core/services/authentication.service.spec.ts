import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { AuthenticationService } from './authentication.service';
import { ensureLocalStorage } from '../../../test-helpers/local-storage.test-helper';

function createService(): AuthenticationService {
  // Real AuthenticationService; HttpClient comes from the global test stubs (src/test.ts).
  TestBed.configureTestingModule({ providers: [AuthenticationService] });
  return TestBed.inject(AuthenticationService);
}

describe('AuthenticationService', () => {
  beforeEach(() => ensureLocalStorage());

  it('should be created', () => {
    expect(createService()).toBeTruthy();
  });

  describe('loginStatus session state', () => {
    function expectLoginStatusRequest(httpTesting: HttpTestingController) {
      return httpTesting.expectOne(
        req => req.url.endsWith('/skServer/loginStatus') && !req.url.includes('/signalk/v1')
      );
    }

    it('logged-in writable session: isLoggedIn/isUserSession/canWriteUserData true', async () => {
      const service = createService();
      const httpTesting = TestBed.inject(HttpTestingController);

      const pending = service.refreshLoginStatus();
      const req = expectLoginStatusRequest(httpTesting);
      expect(req.request.method).toBe('GET');
      expect(req.request.withCredentials).toBe(true);
      req.flush({ status: 'loggedIn', readOnlyAccess: false, userLevel: 'admin' });
      await pending;

      expect(await firstValueFrom(service.isLoggedIn$)).toBe(true);
      expect(await firstValueFrom(service.isUserSession$)).toBe(true);
      expect(await firstValueFrom(service.canWriteUserData$)).toBe(true);
      httpTesting.verify();
    });

    it('logged-in read-only user (userLevel readonly): isUserSession true, canWriteUserData false', async () => {
      const service = createService();
      const httpTesting = TestBed.inject(HttpTestingController);

      const pending = service.refreshLoginStatus();
      expectLoginStatusRequest(httpTesting).flush({ status: 'loggedIn', userLevel: 'readonly' });
      await pending;

      expect(await firstValueFrom(service.isLoggedIn$)).toBe(true);
      expect(await firstValueFrom(service.isUserSession$)).toBe(true);
      expect(await firstValueFrom(service.canWriteUserData$)).toBe(false);
      httpTesting.verify();
    });

    it('admin user stays write-capable even when the server allows anonymous read (readOnlyAccess true)', async () => {
      // readOnlyAccess is the server allow_readonly flag, NOT the user's permission. A signed-in
      // admin (userLevel admin) must remain write-capable regardless of it.
      const service = createService();
      const httpTesting = TestBed.inject(HttpTestingController);

      const pending = service.refreshLoginStatus();
      expectLoginStatusRequest(httpTesting).flush({ status: 'loggedIn', userLevel: 'admin', readOnlyAccess: true });
      await pending;

      expect(await firstValueFrom(service.canWriteUserData$)).toBe(true);
      httpTesting.verify();
    });

    it('logged-in readwrite user: canWriteUserData true', async () => {
      const service = createService();
      const httpTesting = TestBed.inject(HttpTestingController);

      const pending = service.refreshLoginStatus();
      expectLoginStatusRequest(httpTesting).flush({ status: 'loggedIn', userLevel: 'readwrite' });
      await pending;

      expect(await firstValueFrom(service.canWriteUserData$)).toBe(true);
      httpTesting.verify();
    });

    it('logged-in with no userLevel: isUserSession true but canWriteUserData false (fail closed)', async () => {
      const service = createService();
      const httpTesting = TestBed.inject(HttpTestingController);

      const pending = service.refreshLoginStatus();
      expectLoginStatusRequest(httpTesting).flush({ status: 'loggedIn' });
      await pending;

      expect(await firstValueFrom(service.isUserSession$)).toBe(true);
      expect(await firstValueFrom(service.canWriteUserData$)).toBe(false);
      httpTesting.verify();
    });

    it('fails closed when loginStatus does not respond within the timeout', async () => {
      vi.useFakeTimers();
      try {
        const service = createService();
        const httpTesting = TestBed.inject(HttpTestingController);

        const pending = service.refreshLoginStatus();
        expectLoginStatusRequest(httpTesting); // request opened, never flushed
        await vi.advanceTimersByTimeAsync(5001);
        const result = await pending;

        expect(result).toBeNull();
        expect(await firstValueFrom(service.isLoggedIn$)).toBe(false);
        httpTesting.verify();
      } finally {
        vi.useRealTimers();
      }
    });

    it('transport failure (no HTTP response) preserves the last known-good session', async () => {
      const service = createService();
      const httpTesting = TestBed.inject(HttpTestingController);

      // Establish a known-good writable session.
      const first = service.refreshLoginStatus();
      expectLoginStatusRequest(httpTesting).flush({ status: 'loggedIn', userLevel: 'admin' });
      await first;

      // A transient network error carries no logout verdict: session state must survive it.
      const second = service.refreshLoginStatus();
      expectLoginStatusRequest(httpTesting).error(new ProgressEvent('network error'));
      const result = await second;

      expect(result).toEqual({ status: 'loggedIn', userLevel: 'admin' });
      expect(await firstValueFrom(service.isLoggedIn$)).toBe(true);
      expect(await firstValueFrom(service.isUserSession$)).toBe(true);
      expect(await firstValueFrom(service.canWriteUserData$)).toBe(true);
      httpTesting.verify();
    });

    it('transport timeout preserves the last known-good session', async () => {
      vi.useFakeTimers();
      try {
        const service = createService();
        const httpTesting = TestBed.inject(HttpTestingController);

        const first = service.refreshLoginStatus();
        expectLoginStatusRequest(httpTesting).flush({ status: 'loggedIn', userLevel: 'admin' });
        await first;

        const second = service.refreshLoginStatus();
        expectLoginStatusRequest(httpTesting); // request opened, never flushed
        await vi.advanceTimersByTimeAsync(5001);
        const result = await second;

        expect(result).toEqual({ status: 'loggedIn', userLevel: 'admin' });
        expect(await firstValueFrom(service.isLoggedIn$)).toBe(true);
        expect(await firstValueFrom(service.canWriteUserData$)).toBe(true);
        httpTesting.verify();
      } finally {
        vi.useRealTimers();
      }
    });

    it('authoritative not-logged-in after a good session still clears it (not a transport blip)', async () => {
      const service = createService();
      const httpTesting = TestBed.inject(HttpTestingController);

      const first = service.refreshLoginStatus();
      expectLoginStatusRequest(httpTesting).flush({ status: 'loggedIn', userLevel: 'admin' });
      await first;
      expect(await firstValueFrom(service.isLoggedIn$)).toBe(true);

      const second = service.refreshLoginStatus();
      expectLoginStatusRequest(httpTesting).flush({ status: 'notLoggedIn' });
      const result = await second;

      expect(result).toEqual({ status: 'notLoggedIn' });
      expect(await firstValueFrom(service.isLoggedIn$)).toBe(false);
      expect(await firstValueFrom(service.isUserSession$)).toBe(false);
      httpTesting.verify();
    });

    it('not-logged-in: all session flags false; OIDC descriptors captured', async () => {
      const service = createService();
      const httpTesting = TestBed.inject(HttpTestingController);

      const pending = service.refreshLoginStatus();
      expectLoginStatusRequest(httpTesting).flush({
        status: 'notLoggedIn',
        authenticationRequired: true,
        oidcEnabled: true,
        oidcAutoLogin: true,
        oidcLoginUrl: '/signalk/v1/auth/oidc/login',
        oidcProviderName: 'HaLOS SSO'
      });
      await pending;

      expect(await firstValueFrom(service.isLoggedIn$)).toBe(false);
      expect(await firstValueFrom(service.isUserSession$)).toBe(false);
      expect(await firstValueFrom(service.canWriteUserData$)).toBe(false);
      const status = await firstValueFrom(service.loginStatus$);
      expect(status?.authenticationRequired).toBe(true);
      expect(status?.oidcEnabled).toBe(true);
      expect(status?.oidcAutoLogin).toBe(true);
      expect(status?.oidcLoginUrl).toBe('/signalk/v1/auth/oidc/login');
      httpTesting.verify();
    });

    it('unreachable server: fails closed (not logged in), returns null, no throw', async () => {
      const service = createService();
      const httpTesting = TestBed.inject(HttpTestingController);

      const pending = service.refreshLoginStatus();
      expectLoginStatusRequest(httpTesting).flush('down', { status: 503, statusText: 'Service Unavailable' });
      const result = await pending;

      expect(result).toBeNull();
      expect(await firstValueFrom(service.isLoggedIn$)).toBe(false);
      expect(await firstValueFrom(service.isUserSession$)).toBe(false);
      expect(await firstValueFrom(service.canWriteUserData$)).toBe(false);
      httpTesting.verify();
    });

    it('unexpected response shape: not logged in, no throw', async () => {
      const service = createService();
      const httpTesting = TestBed.inject(HttpTestingController);

      const pending = service.refreshLoginStatus();
      expectLoginStatusRequest(httpTesting).flush({ unexpected: 'shape' });
      await pending;

      expect(await firstValueFrom(service.isLoggedIn$)).toBe(false);
      expect(await firstValueFrom(service.isUserSession$)).toBe(false);
      httpTesting.verify();
    });

    it('non-object 200 body (e.g. an HTML login page): not logged in, no throw', async () => {
      const service = createService();
      const httpTesting = TestBed.inject(HttpTestingController);

      const pending = service.refreshLoginStatus();
      expectLoginStatusRequest(httpTesting).flush('<!doctype html><html>login</html>');
      const result = await pending;

      expect(result).toBeNull();
      expect(await firstValueFrom(service.isLoggedIn$)).toBe(false);
      expect(await firstValueFrom(service.isUserSession$)).toBe(false);
      expect(await firstValueFrom(service.canWriteUserData$)).toBe(false);
      httpTesting.verify();
    });

    it('mid-session transition: logged-in -> not-logged-in -> failure flips all signals false and clears descriptors', async () => {
      const service = createService();
      const httpTesting = TestBed.inject(HttpTestingController);

      // 1. Logged in, OIDC descriptors present.
      const first = service.refreshLoginStatus();
      expectLoginStatusRequest(httpTesting).flush({
        status: 'loggedIn',
        userLevel: 'admin',
        oidcEnabled: true,
        oidcLoginUrl: '/signalk/v1/auth/oidc/login'
      });
      await first;
      expect(await firstValueFrom(service.isLoggedIn$)).toBe(true);
      expect(await firstValueFrom(service.isUserSession$)).toBe(true);
      expect(await firstValueFrom(service.canWriteUserData$)).toBe(true);
      expect((await firstValueFrom(service.loginStatus$))?.oidcLoginUrl).toBe('/signalk/v1/auth/oidc/login');

      // 2. Session ends server-side: re-check returns notLoggedIn; stale OIDC descriptor cleared.
      const second = service.refreshLoginStatus();
      expectLoginStatusRequest(httpTesting).flush({ status: 'notLoggedIn' });
      await second;
      expect(await firstValueFrom(service.isLoggedIn$)).toBe(false);
      expect(await firstValueFrom(service.isUserSession$)).toBe(false);
      expect(await firstValueFrom(service.canWriteUserData$)).toBe(false);
      expect((await firstValueFrom(service.loginStatus$))?.oidcLoginUrl).toBeUndefined();

      // 3. A later failure re-emits null status (fail-closed) on the already-used instance.
      const third = service.refreshLoginStatus();
      expectLoginStatusRequest(httpTesting).flush('down', { status: 503, statusText: 'Service Unavailable' });
      await third;
      expect(await firstValueFrom(service.isLoggedIn$)).toBe(false);
      expect(await firstValueFrom(service.loginStatus$)).toBeNull();
      httpTesting.verify();
    });
  });
});
