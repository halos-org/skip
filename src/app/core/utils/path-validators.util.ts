import type { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import type { ISkPathData } from '../interfaces/app-interfaces';

/**
 * Validator for a widget's Signal K path control.
 *
 * An empty value fails only when the slot is required — `pathRequired: false` on the sibling form
 * group marks a slot the user may leave blank. A non-empty value the server does not currently
 * publish is deliberately accepted: Signal K publishes a path only once some source has sent it, so
 * switching off the instrument behind an otherwise correct path makes it read as unknown, and
 * rejecting it would lock the widget's whole configuration until that gear comes back. Components
 * warn about such a path through {@link pathSlotWarning} instead of blocking Save.
 */
export const pathRequiredValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const required = control.parent?.value?.pathRequired !== false;
  const value = control.value;
  return required && (value === null || value === '') ? { required: true } : null;
};

/** What a widget slot demands of a path, mirroring the filters `DataService.getPathsAndMetaByType` applies. */
export interface IPathSlotRequirements {
  pathType: string;
  supportsPutOnly: boolean;
  zonesOnly: boolean;
  selfOnly: boolean;
}

// `getPathsAndMetaByType` matches these against the runtime type of the last received value, and
// anything else against `meta.type`.
const RUNTIME_TYPES = ['string', 'number', 'boolean', 'object', 'undefined', 'function', 'symbol', 'bigint', 'Date'];

const TYPE_WORDS: Record<string, { sends: string; needs: string; pick: string }> = {
  number: { sends: 'numeric', needs: 'a number', pick: 'numeric' },
  string: { sends: 'text', needs: 'text', pick: 'text' },
  boolean: { sends: 'true/false', needs: 'a true/false value', pick: 'true/false' },
  object: { sends: 'structured', needs: 'a structured value', pick: 'structured' },
  Date: { sends: 'date', needs: 'a date', pick: 'date' }
};

const typeWords = (type: string) => TYPE_WORDS[type] ?? { sends: type, needs: `a ${type} value`, pick: type };

/**
 * Why a configured path is not among the ones this slot offers, phrased for the user, or null when
 * the path is fine. A path missing from the slot's list has several quite different causes, and the
 * remedy differs for each — since an unrecognized path no longer blocks Save, this hint is the only
 * feedback the user gets. Resolve `pathObject` from the *unfiltered* store, so a path that exists
 * but fails one of the slot's filters can be told apart from one the server never sent.
 */
export function pathSlotWarning(
  path: string | null | undefined,
  pathObject: ISkPathData | null,
  requirements: IPathSlotRequirements
): string | null {
  if (!path) { return null; }

  if (!pathObject) {
    return 'Signal K is not sending this path. Check the spelling and the leading "self.", or keep it as-is if the instrument that sends it is switched off.';
  }

  if (requirements.selfOnly && !path.startsWith('self')) {
    return 'This path belongs to another vessel, and "Restrict to own vessel" is on for this widget. Turn that off, or use a path starting with "self.".';
  }

  const wantsRuntimeType = RUNTIME_TYPES.includes(requirements.pathType);
  const actualType = wantsRuntimeType ? pathObject.type : pathObject.meta?.type;

  if (wantsRuntimeType && pathObject.type === undefined) {
    return 'Signal K knows this path but has not sent a value yet, so its type cannot be checked. It should start working once data arrives.';
  }

  if (actualType !== requirements.pathType) {
    const sends = typeWords(actualType ?? 'unknown').sends;
    const wanted = typeWords(requirements.pathType);
    return `This path sends ${sends} values, but this setting needs ${wanted.needs}. The widget will show nothing until you pick a ${wanted.pick} path.`;
  }

  if (requirements.supportsPutOnly && pathObject.meta?.supportsPut !== true) {
    return 'This path is read-only. Signal K reports no PUT support for it, so this control cannot send commands to it.';
  }

  if (requirements.zonesOnly && !(pathObject.meta?.zones?.length)) {
    return 'This path has no alarm zones in its Signal K metadata, and this widget only offers paths that have them.';
  }

  return null;
}
