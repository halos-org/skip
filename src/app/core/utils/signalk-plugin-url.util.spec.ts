import { describe, it, expect } from 'vitest';
import { resolveSignalKPluginBaseUrl, resolveSignalKV2ApiBaseUrl } from './signalk-plugin-url.util';

describe('resolveSignalKPluginBaseUrl', () => {
  const HTTP_V1 = 'http://host:3000/signalk/v1/api/';

  it('prefers the configured Signal K URL over the discovered endpoint', () => {
    expect(resolveSignalKPluginBaseUrl('sk-video', HTTP_V1, 'http://my.boat:3000'))
      .toBe('http://my.boat:3000/plugins/sk-video/');
  });

  it('strips a trailing slash from the configured URL', () => {
    expect(resolveSignalKPluginBaseUrl('sk-video', null, 'http://my.boat:3000/'))
      .toBe('http://my.boat:3000/plugins/sk-video/');
  });

  it('ignores a blank configured URL and falls back to the endpoint', () => {
    expect(resolveSignalKPluginBaseUrl('sk-video', HTTP_V1, '   '))
      .toBe('http://host:3000/plugins/sk-video/');
  });

  it('derives the root from a v1 api endpoint (with trailing slash)', () => {
    expect(resolveSignalKPluginBaseUrl('sk-video', 'http://host:3000/signalk/v1/api/'))
      .toBe('http://host:3000/plugins/sk-video/');
  });

  it('derives the root from a v2 api endpoint (no trailing slash)', () => {
    expect(resolveSignalKPluginBaseUrl('sk-video', 'http://host:3000/signalk/v2/api'))
      .toBe('http://host:3000/plugins/sk-video/');
  });

  it('derives the root from a bare /signalk endpoint', () => {
    expect(resolveSignalKPluginBaseUrl('sk-video', 'https://boat.local/signalk'))
      .toBe('https://boat.local/plugins/sk-video/');
  });

  it('returns null when neither URL is available', () => {
    expect(resolveSignalKPluginBaseUrl('sk-video', null)).toBeNull();
    expect(resolveSignalKPluginBaseUrl('sk-video', undefined, null)).toBeNull();
  });

  it('uses the supplied plugin id in the path', () => {
    expect(resolveSignalKPluginBaseUrl('kip', HTTP_V1))
      .toBe('http://host:3000/plugins/kip/');
  });

  it('rejects an invalid plugin id (no path injection or empty/uppercase/space)', () => {
    expect(resolveSignalKPluginBaseUrl('', HTTP_V1)).toBeNull();
    expect(resolveSignalKPluginBaseUrl('../evil', HTTP_V1)).toBeNull();
    expect(resolveSignalKPluginBaseUrl('sk video', HTTP_V1)).toBeNull();
    expect(resolveSignalKPluginBaseUrl('SK-Video', HTTP_V1)).toBeNull();
  });

  it('strips a /signalk suffix from the configured URL', () => {
    expect(resolveSignalKPluginBaseUrl('sk-video', null, 'http://my.boat:3000/signalk/'))
      .toBe('http://my.boat:3000/plugins/sk-video/');
  });
});

describe('resolveSignalKV2ApiBaseUrl', () => {
  const HTTP_V1 = 'http://host:3000/signalk/v1/api/';

  it('uses the advertised v2 endpoint when the server publishes one', () => {
    expect(resolveSignalKV2ApiBaseUrl('http://v2.host:3000/signalk/v2/api', HTTP_V1))
      .toBe('http://v2.host:3000/signalk/v2/api');
  });

  it('strips a trailing slash from the advertised v2 endpoint', () => {
    expect(resolveSignalKV2ApiBaseUrl('http://host:3000/signalk/v2/api/', null))
      .toBe('http://host:3000/signalk/v2/api');
  });

  it('derives the URL from the v1 endpoint when v2 is not advertised', () => {
    expect(resolveSignalKV2ApiBaseUrl(undefined, HTTP_V1))
      .toBe('http://host:3000/signalk/v2/api');
  });

  // The endpoint shapes the plugin resolver already accepts must not fall through to a
  // non-v2 URL: every one of them has to yield the v2 API base.
  it('derives the URL from endpoint shapes other than /signalk/v1/api', () => {
    expect(resolveSignalKV2ApiBaseUrl(null, 'https://boat.local/signalk'))
      .toBe('https://boat.local/signalk/v2/api');
    expect(resolveSignalKV2ApiBaseUrl(null, 'https://boat.local/signalk/v1'))
      .toBe('https://boat.local/signalk/v2/api');
    expect(resolveSignalKV2ApiBaseUrl(null, 'https://boat.local/signalk/v2'))
      .toBe('https://boat.local/signalk/v2/api');
  });

  it('preserves a reverse-proxy path prefix', () => {
    expect(resolveSignalKV2ApiBaseUrl(null, 'https://halos.local/sk/signalk/v1/api/'))
      .toBe('https://halos.local/sk/signalk/v2/api');
  });

  it('prefers the configured Signal K URL over the discovered endpoint', () => {
    expect(resolveSignalKV2ApiBaseUrl(null, HTTP_V1, 'http://my.boat:3000'))
      .toBe('http://my.boat:3000/signalk/v2/api');
  });

  it('does not double the /signalk segment of a configured URL', () => {
    expect(resolveSignalKV2ApiBaseUrl(null, null, 'http://my.boat:3000/signalk/'))
      .toBe('http://my.boat:3000/signalk/v2/api');
  });

  it('ignores a blank configured URL and falls back to the endpoint', () => {
    expect(resolveSignalKV2ApiBaseUrl(null, HTTP_V1, '   '))
      .toBe('http://host:3000/signalk/v2/api');
  });

  it('returns null when no URL is available', () => {
    expect(resolveSignalKV2ApiBaseUrl(null, null)).toBeNull();
    expect(resolveSignalKV2ApiBaseUrl(undefined, undefined, null)).toBeNull();
  });
});
