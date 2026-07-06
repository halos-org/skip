import { describe, it, expect } from 'vitest';
import { resolveBrowserTabTitle } from './browser-tab-title.util';

describe('resolveBrowserTabTitle (#1055)', () => {
  it('defaults to Skip when the value is missing or blank', () => {
    expect(resolveBrowserTabTitle(undefined)).toBe('Skip');
    expect(resolveBrowserTabTitle(null)).toBe('Skip');
    expect(resolveBrowserTabTitle('')).toBe('Skip');
    expect(resolveBrowserTabTitle('   ')).toBe('Skip');
  });

  it('uses the trimmed configured value when set', () => {
    expect(resolveBrowserTabTitle('Mast-Skip')).toBe('Mast-Skip');
    expect(resolveBrowserTabTitle('  Port Engine  ')).toBe('Port Engine');
  });
});
