import { describe, expect, it } from 'vitest';
import { GAUGE_ANIMATION_MS, gaugeAnimationDurationMs, gaugeAnimationOptions } from './gauge-animation.util';

describe('gaugeAnimationDurationMs', () => {
  it('uses a short fixed window instead of ~the whole sample interval', () => {
    // Old behavior would have been ~475ms (500 - 25); the gauge should now idle
    // for most of the interval.
    expect(gaugeAnimationDurationMs(500)).toBe(GAUGE_ANIMATION_MS);
    expect(gaugeAnimationDurationMs(500)).toBeLessThan(500);
  });

  it('never exceeds the sample interval (avoids a full duty cycle at fast rates)', () => {
    expect(gaugeAnimationDurationMs(100)).toBe(100);
  });

  it('falls back to the fixed window for invalid sample times', () => {
    expect(gaugeAnimationDurationMs(0)).toBe(GAUGE_ANIMATION_MS);
    expect(gaugeAnimationDurationMs(Number.NaN)).toBe(GAUGE_ANIMATION_MS);
  });
});

describe('gaugeAnimationOptions', () => {
  // Both the initial gauge options and the post-bootstrap gauge.update() flow
  // through this factory, so pinning it here pins the value box on every path
  // (including the post-bootstrap re-enable that previously turned it back on).
  it('never animates the value box, even once animation is enabled', () => {
    expect(gaugeAnimationOptions(true).animatedValue).toBe(false);
    expect(gaugeAnimationOptions(false).animatedValue).toBe(false);
  });

  it('gates the needle animation on the enabled flag', () => {
    expect(gaugeAnimationOptions(true).animation).toBe(true);
    expect(gaugeAnimationOptions(false).animation).toBe(false);
  });

  it('never animates on init', () => {
    expect(gaugeAnimationOptions(true).animateOnInit).toBe(false);
    expect(gaugeAnimationOptions(false).animateOnInit).toBe(false);
  });
});
