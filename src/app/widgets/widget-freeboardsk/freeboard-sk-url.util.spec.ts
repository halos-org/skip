import { describe, expect, it } from 'vitest';
import { buildFreeboardSkUrl } from './freeboard-sk-url.util';

describe('buildFreeboardSkUrl', () => {
  it('uses the served app origin and no token', () => {
    expect(buildFreeboardSkUrl('https://boat.hal:4430')).toBe('https://boat.hal:4430/@signalk/freeboard-sk/');
  });
});
