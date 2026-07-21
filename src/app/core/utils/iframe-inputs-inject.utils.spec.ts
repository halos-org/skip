import { describe, expect, it } from 'vitest';
import { generateSwipeScript } from './iframe-inputs-inject.utils';

describe('generateSwipeScript', () => {
  const script = generateSwipeScript({ instanceId: 'abc-123' });

  it('interpolates the instance id', () => {
    expect(script).toContain("instanceId='abc-123'");
  });

  it('detects swipes and forwards them to the parent', () => {
    expect(script).toContain('window.parent.postMessage');
    expect(script).toContain('swipeleft');
    expect(script).toContain('swiperight');
  });

  it('does not forward keyboard events — embeds own their keyboard', () => {
    expect(script).not.toContain('keydown');
    expect(script).not.toContain('keyEventData');
  });
});
