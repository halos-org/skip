import { describe, expect, it } from 'vitest';
import { normalizeAnglePathKey, resolveAngleDomain } from './angle-domain.util';

describe('angle-domain.util', () => {
  it('treats a positively non-radian unit as scalar, even with a lingering override', () => {
    expect(resolveAngleDomain('navigation.speedOverGround', 'm/s')).toBe('scalar');
    expect(resolveAngleDomain('self.steering.rudderAngle', 'K')).toBe('scalar');
    expect(resolveAngleDomain('self.environment.wind.angleApparent', 'm/s', 'signed')).toBe('scalar');
  });

  it('honors an explicit override when the base unit is unknown (metadata not yet published)', () => {
    // A history chart commonly views past data while the producing instrument is idle, so
    // getPathUnitType returns null; an explicit signed/direction override must still drive circular
    // stats instead of silently reverting the chart to linear math.
    expect(resolveAngleDomain('environment.wind.angleApparent', null, 'signed')).toBe('signed');
    expect(resolveAngleDomain('some.plugin.windShift', undefined, 'direction')).toBe('direction');
  });

  it('defaults an unknown-unit path with no override to scalar', () => {
    expect(resolveAngleDomain('some.unknown.path', null)).toBe('scalar');
  });

  it('defaults a non-allowlisted radian path to the direction domain', () => {
    expect(resolveAngleDomain('self.navigation.headingTrue', 'rad')).toBe('direction');
    expect(resolveAngleDomain('navigation.courseOverGroundTrue', 'rad')).toBe('direction');
  });

  it('resolves an allowlisted radian path to the signed domain', () => {
    expect(resolveAngleDomain('self.steering.rudderAngle', 'rad')).toBe('signed');
    expect(resolveAngleDomain('self.environment.wind.angleApparent', 'rad')).toBe('signed');
  });

  it('lets a per-chart override win over the allowlist for any radian path', () => {
    // Allowlisted (signed) path forced to direction.
    expect(resolveAngleDomain('self.steering.rudderAngle', 'rad', 'direction')).toBe('direction');
    // Non-allowlisted (direction) path forced to signed.
    expect(resolveAngleDomain('self.navigation.headingTrue', 'rad', 'signed')).toBe('signed');
  });

  it('honors an explicit override for a non-allowlisted custom rad path (#1070)', () => {
    // A custom angular path (e.g. advancedwind wind shift, published in -π..π) is not on the signed
    // allowlist, so it defaults to direction; an explicit override keeps its native signed range.
    expect(resolveAngleDomain('environment.wind.shift', 'rad')).toBe('direction');
    expect(resolveAngleDomain('environment.wind.shift', 'rad', 'signed')).toBe('signed');
  });

  it('resolves vessels.self. / self. / bare paths identically', () => {
    expect(resolveAngleDomain('vessels.self.steering.rudderAngle', 'rad')).toBe('signed');
    expect(resolveAngleDomain('self.steering.rudderAngle', 'rad')).toBe('signed');
    expect(resolveAngleDomain('steering.rudderAngle', 'rad')).toBe('signed');
  });

  it('normalizes path keys by stripping the vessels.self. / self. prefix', () => {
    expect(normalizeAnglePathKey('vessels.self.steering.rudderAngle')).toBe('steering.rudderAngle');
    expect(normalizeAnglePathKey('self.steering.rudderAngle')).toBe('steering.rudderAngle');
    expect(normalizeAnglePathKey('steering.rudderAngle')).toBe('steering.rudderAngle');
  });
});
