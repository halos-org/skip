import { describe, expect, it } from 'vitest';
import { northReferenceOfPath, toNorthReference } from './north-reference.util';

const DEG = Math.PI / 180;

describe('northReferenceOfPath', () => {
  it('reads the magnetic heading and course paths as magnetic', () => {
    expect(northReferenceOfPath('self.navigation.headingMagnetic')).toBe('magnetic');
    expect(northReferenceOfPath('self.navigation.courseOverGroundMagnetic')).toBe('magnetic');
    expect(northReferenceOfPath('vessels.self.navigation.headingMagnetic')).toBe('magnetic');
  });

  it('reads the true heading and course paths as true', () => {
    expect(northReferenceOfPath('self.navigation.headingTrue')).toBe('true');
    expect(northReferenceOfPath('self.navigation.courseOverGroundTrue')).toBe('true');
  });

  it('takes any other path, or none, as true', () => {
    expect(northReferenceOfPath('self.navigation.attitude#/yaw')).toBe('true');
    expect(northReferenceOfPath('')).toBe('true');
    expect(northReferenceOfPath(undefined)).toBe('true');
  });
});

describe('toNorthReference', () => {
  it('passes an angle through unchanged when the references match, whatever the variation', () => {
    expect(toNorthReference(120 * DEG, 'true', 'true', null)).toBe(120 * DEG);
    expect(toNorthReference(120 * DEG, 'magnetic', 'magnetic', null)).toBe(120 * DEG);
  });

  it('subtracts an east variation going true to magnetic and adds it going back', () => {
    expect(toNorthReference(120 * DEG, 'true', 'magnetic', 10 * DEG)).toBeCloseTo(110 * DEG, 12);
    expect(toNorthReference(110 * DEG, 'magnetic', 'true', 10 * DEG)).toBeCloseTo(120 * DEG, 12);
    expect(toNorthReference(120 * DEG, 'true', 'magnetic', -5 * DEG)).toBeCloseTo(125 * DEG, 12);
  });

  it('wraps across north', () => {
    expect(toNorthReference(5 * DEG, 'true', 'magnetic', 10 * DEG)).toBeCloseTo(355 * DEG, 12);
    expect(toNorthReference(355 * DEG, 'magnetic', 'true', 10 * DEG)).toBeCloseTo(5 * DEG, 12);
  });

  it('has no angle when the references differ and the variation is unknown, or without an angle', () => {
    expect(toNorthReference(120 * DEG, 'true', 'magnetic', null)).toBeUndefined();
    expect(toNorthReference(120 * DEG, 'magnetic', 'true', null)).toBeUndefined();
    expect(toNorthReference(undefined, 'true', 'true', 10 * DEG)).toBeUndefined();
  });
});
