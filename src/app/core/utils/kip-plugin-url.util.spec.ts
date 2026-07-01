import { describe, it, expect } from 'vitest';
import { resolveKipPluginBaseUrl, snapImageWidth, IMAGE_WIDTH_ALLOWLIST } from './kip-plugin-url.util';

describe('resolveKipPluginBaseUrl', () => {
  it('prefers the configured URL', () => {
    expect(resolveKipPluginBaseUrl('http://x/signalk/v1/api/', 'https://boat.local:3443')).toBe('https://boat.local:3443/plugins/kip/');
    expect(resolveKipPluginBaseUrl(null, 'https://boat.local/')).toBe('https://boat.local/plugins/kip/');
  });

  it('derives the plugin base from the v1/v2 API URL by stripping the signalk suffix', () => {
    expect(resolveKipPluginBaseUrl('http://host:3000/signalk/v1/api/')).toBe('http://host:3000/plugins/kip/');
    expect(resolveKipPluginBaseUrl('http://host:3000/signalk/v2/api')).toBe('http://host:3000/plugins/kip/');
    expect(resolveKipPluginBaseUrl('http://host:3000/signalk')).toBe('http://host:3000/plugins/kip/');
  });

  it('returns null when nothing is known', () => {
    expect(resolveKipPluginBaseUrl(null)).toBeNull();
    expect(resolveKipPluginBaseUrl(undefined, '')).toBeNull();
  });
});

describe('snapImageWidth', () => {
  const max = IMAGE_WIDTH_ALLOWLIST[IMAGE_WIDTH_ALLOWLIST.length - 1];

  it('snaps up to the nearest allow-listed width, accounting for DPR', () => {
    expect(snapImageWidth(100)).toBe(160);
    expect(snapImageWidth(320)).toBe(320);
    expect(snapImageWidth(330)).toBe(640);
    expect(snapImageWidth(320, 2)).toBe(640); // 320 css * 2 dpr = 640
  });

  it('snaps an unknown/zero width to the smallest variant (cheap first paint, upgrades on resize)', () => {
    expect(snapImageWidth(undefined)).toBe(IMAGE_WIDTH_ALLOWLIST[0]);
    expect(snapImageWidth(0)).toBe(IMAGE_WIDTH_ALLOWLIST[0]);
  });

  it('caps an oversized width at the canonical max', () => {
    expect(snapImageWidth(99999)).toBe(max);
  });
});
