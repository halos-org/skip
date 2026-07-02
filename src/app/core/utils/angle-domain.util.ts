import { ChartStatsDomain } from './chart-stats.util';

/**
 * Signal K paths interpreted as signed angles (-π, π]. Every other radian path defaults to the
 * direction domain [0, 2π). A per-chart override still wins over this allowlist.
 */
const SIGNED_ANGLE_PATHS: ReadonlySet<string> = new Set<string>([
  'self.navigation.attitude.roll',
  'self.navigation.attitude.pitch',
  'self.navigation.attitude.yaw',
  'self.environment.wind.angleApparent',
  'self.environment.wind.angleTrueGround',
  'self.environment.wind.angleTrueWater',
  'self.steering.rudderAngle'
]);

/** Strip the `vessels.self.` / `self.` prefix so allowlist matching is context-independent. */
export function normalizeAnglePathKey(path: string): string {
  return path.replace(/^vessels\.self\./, '').replace(/^self\./, '');
}

/**
 * Resolve how a path's radian values should be interpreted. Non-radian paths are `scalar`; a
 * `signed`/`direction` override wins for any radian path; otherwise the allowlist selects `signed`
 * and everything else is `direction`. Single source of truth for both chart engines.
 */
export function resolveAngleDomain(
  path: string,
  baseUnit: string | null | undefined,
  override?: 'signed' | 'direction'
): ChartStatsDomain {
  // A positively non-radian unit is scalar even if a stale override lingers on the config.
  if (baseUnit != null && baseUnit !== '' && baseUnit !== 'rad') return 'scalar';
  // Radian, or an unknown unit (metadata not yet published — common when viewing history while the
  // producing instrument is idle): an explicit override wins, so angular charts aren't silently
  // reverted to linear stats when the base unit can't be read.
  if (override === 'signed' || override === 'direction') return override;
  // Unknown unit and no override: we can't tell it's angular, so stay scalar.
  if (baseUnit !== 'rad') return 'scalar';
  const incoming = normalizeAnglePathKey(path);
  for (const candidate of SIGNED_ANGLE_PATHS) {
    if (incoming === normalizeAnglePathKey(candidate)) {
      return 'signed';
    }
  }
  return 'direction';
}
