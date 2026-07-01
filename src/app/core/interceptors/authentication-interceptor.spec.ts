import { HTTP_INTERCEPTORS, HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, afterEach } from 'vitest';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { AuthenticationInterceptor } from './authentication-interceptor';

describe('AuthenticationInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        { provide: HTTP_INTERCEPTORS, useClass: AuthenticationInterceptor, multi: true }
      ]
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('same-origin request: sends credentials (session cookie) and no Authorization header', () => {
    http.get('/api/test').subscribe();
    const req = httpMock.expectOne('/api/test');
    expect(req.request.withCredentials).toBe(true);
    expect(req.request.headers.has('authorization')).toBe(false);
    req.flush({ ok: true });
  });

  it('cross-origin request: sends neither credentials nor an Authorization header', () => {
    http.get('https://boat.example:3443/signalk/').subscribe();
    const req = httpMock.expectOne('https://boat.example:3443/signalk/');
    expect(req.request.withCredentials).toBe(false);
    expect(req.request.headers.has('authorization')).toBe(false);
    req.flush({ ok: true });
  });

  // The same-origin guard must not be fooled into attaching the session cookie to another origin.
  it.each([
    ['//evil.example/x', 'protocol-relative'],
    ['https://app@evil.example/x', 'userinfo-prefixed'],
  ])('does not send credentials to a %s cross-origin URL (%s)', (url) => {
    http.get(url).subscribe();
    const req = httpMock.expectOne(url);
    expect(req.request.withCredentials).toBe(false);
    req.flush({ ok: true });
  });
});
