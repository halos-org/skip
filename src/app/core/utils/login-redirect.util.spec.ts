import { describe, expect, it } from 'vitest';
import { isSafeReturnTo, buildLoginRedirectUrl } from './login-redirect.util';

describe('isSafeReturnTo', () => {
  it('accepts a site-relative path', () => {
    expect(isSafeReturnTo('/page')).toBe(true);
    expect(isSafeReturnTo('/page/2?foo=bar')).toBe(true);
  });

  it('rejects empty / non-string', () => {
    expect(isSafeReturnTo('')).toBe(false);
    expect(isSafeReturnTo(null)).toBe(false);
    expect(isSafeReturnTo(undefined)).toBe(false);
  });

  it('rejects protocol-relative and absolute URLs', () => {
    expect(isSafeReturnTo('//evil.example')).toBe(false);
    expect(isSafeReturnTo('https://evil.example/x')).toBe(false);
    expect(isSafeReturnTo('http://evil.example')).toBe(false);
  });

  it('rejects a backslash (browsers normalize it to /)', () => {
    expect(isSafeReturnTo('/\\evil.example')).toBe(false);
    expect(isSafeReturnTo('/\\/evil.example')).toBe(false);
  });

  it('rejects a dot-segment path that normalizes to a protocol-relative path', () => {
    expect(isSafeReturnTo('/a/..//evil.example')).toBe(false);
    expect(isSafeReturnTo('/foo/../..//evil.example')).toBe(false);
  });

  it('rejects control characters', () => {
    expect(isSafeReturnTo('/path\x00')).toBe(false);
    expect(isSafeReturnTo('/path\nmore')).toBe(false);
    expect(isSafeReturnTo('/path\x7f')).toBe(false);
  });

  it('rejects a non-relative target (no leading slash)', () => {
    expect(isSafeReturnTo('dashboard')).toBe(false);
    expect(isSafeReturnTo('javascript:alert(1)')).toBe(false);
  });

  it('rejects the login self-route (avoids a redirect loop)', () => {
    expect(isSafeReturnTo('/login')).toBe(false);
  });

  it('rejects the hash-routed login self-route (hash routing puts /login in the fragment)', () => {
    expect(isSafeReturnTo('/#/login')).toBe(false);
    expect(isSafeReturnTo('/#/login?redirect=%2Fpage')).toBe(false);
  });

  it('accepts a non-login hash route', () => {
    expect(isSafeReturnTo('/#/page/0')).toBe(true);
  });
});

describe('buildLoginRedirectUrl', () => {
  // The param is named `redirect` because that is what both Signal K login endpoints read
  // (req.query.redirect on the OIDC endpoint, the hash query on /admin/#/login).
  it('appends a validated return target as redirect on a query-style (OIDC) login URL', () => {
    const url = buildLoginRedirectUrl({ loginUrl: '/signalk/v1/auth/oidc/login', returnTo: '/page' });
    expect(url).toBe('/signalk/v1/auth/oidc/login?redirect=%2Fpage');
  });

  it('drops an unsafe returnTo but still returns the login URL', () => {
    const url = buildLoginRedirectUrl({ loginUrl: '/signalk/v1/auth/oidc/login', returnTo: '//evil.example' });
    expect(url).toBe('/signalk/v1/auth/oidc/login');
  });

  it('adds noAutoLogin for a recovery (manual) sign-in', () => {
    const url = buildLoginRedirectUrl({ loginUrl: '/signalk/v1/auth/oidc/login', returnTo: '/x', noAutoLogin: true });
    expect(url).toBe('/signalk/v1/auth/oidc/login?redirect=%2Fx&noAutoLogin=true');
  });

  it('places params in the hash fragment for an admin hash-route login URL', () => {
    const url = buildLoginRedirectUrl({ loginUrl: '/admin/#/login', noAutoLogin: true });
    expect(url).toBe('/admin/#/login?noAutoLogin=true');
  });

  it('puts redirect in the hash query for the admin login route, where that page reads it', () => {
    const url = buildLoginRedirectUrl({ loginUrl: '/admin/#/login', returnTo: '/@halos-org/skip/#/page/0' });
    expect(url).toBe('/admin/#/login?redirect=%2F%40halos-org%2Fskip%2F%23%2Fpage%2F0');
  });

  // What manualSignIn() emits on a server without OIDC: both params, in the hash query.
  it('carries redirect and noAutoLogin together on the admin login route', () => {
    const url = buildLoginRedirectUrl({ loginUrl: '/admin/#/login', returnTo: '/page/0', noAutoLogin: true });
    expect(url).toBe('/admin/#/login?redirect=%2Fpage%2F0&noAutoLogin=true');
  });

  // A return target of Skip's own carries a pre-hash query (?profile=, and ?embed= when framed).
  // Its '?' and '&' must be encoded, or the server reads a truncated target.
  it('encodes a return target that carries its own query string', () => {
    const url = buildLoginRedirectUrl({
      loginUrl: '/signalk/v1/auth/oidc/login',
      returnTo: '/@halos-org/skip/?profile=helm&x=1#/page/0'
    });
    expect(url).toBe(
      '/signalk/v1/auth/oidc/login?redirect=%2F%40halos-org%2Fskip%2F%3Fprofile%3Dhelm%26x%3D1%23%2Fpage%2F0'
    );
  });

  it('returns the login URL unchanged when there are no params', () => {
    expect(buildLoginRedirectUrl({ loginUrl: '/signalk/v1/auth/oidc/login' })).toBe('/signalk/v1/auth/oidc/login');
  });
});
