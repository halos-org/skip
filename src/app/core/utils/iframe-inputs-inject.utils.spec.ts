import { describe, expect, it } from 'vitest';
import { generateSwipeScript } from './iframe-inputs-inject.utils';

describe('generateSwipeScript', () => {
  const script = generateSwipeScript({ instanceId: 'abc-123' });

  it('interpolates the instance id', () => {
    expect(script).toContain("instanceId='abc-123'");
  });

  it('forwards Ctrl+Arrow (no Shift) as page navigation', () => {
    expect(script).toContain("['ArrowLeft','ArrowRight'].includes(event.key)");
    // page-nav arrows must be gated to NOT-shift so they stay distinct from the
    // Ctrl+Shift+E/F/N actions the parent handler disambiguates on Shift.
    expect(script).toContain('!event.shiftKey');
  });

  it('forwards Ctrl+Shift+E/F/N as actions', () => {
    expect(script).toContain("['E','F','N'].includes(event.key)");
    expect(script).toContain('event.ctrlKey && event.shiftKey');
  });

  it('no longer forwards the retired vertical arrow hotkeys', () => {
    expect(script).not.toContain('ArrowUp');
    expect(script).not.toContain('ArrowDown');
  });
});
