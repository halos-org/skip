import { normalizeAnglePathKey } from './angle-domain.util';
import { normalizeRadians } from './polar-overlay.util';

export type NorthReference = 'true' | 'magnetic';

const MAGNETIC_PATHS: ReadonlySet<string> = new Set<string>([
  'navigation.headingMagnetic',
  'navigation.courseOverGroundMagnetic'
]);

/**
 * The north a Signal K heading or course path is referenced to. Any path not known to be magnetic
 * is taken as true, the reference the dials drew on before they converted between the two.
 */
export function northReferenceOfPath(path: string | undefined): NorthReference {
  return path != null && MAGNETIC_PATHS.has(normalizeAnglePathKey(path)) ? 'magnetic' : 'true';
}

/**
 * An angle (rad) moved from one north to another with the magnetic variation (rad, east positive:
 * magnetic = true − variation). Undefined without an angle, or when the norths differ and the
 * variation is unknown.
 */
export function toNorthReference(angle: number | undefined, from: NorthReference, to: NorthReference, variation: number | null): number | undefined {
  if (angle == null || from === to) return angle;
  if (variation == null) return undefined;
  return normalizeRadians(from === 'true' ? angle - variation : angle + variation);
}
