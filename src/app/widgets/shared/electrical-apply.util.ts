import { States, type TState } from '../../core/interfaces/signalk-interfaces';

/**
 * Shared value-apply helpers for the electrical widget family: the dirty-check
 * snapshot writers, the raw-value coercers, and the severity fold used when a
 * parsed Signal K value is written onto a widget's snapshot. Extracted from the
 * verbatim copies the charger/alternator/inverter/ac widgets carried.
 *
 * `resolveMostSevereState` is the family's canonical severity fold: it ranks
 * TState by the Signal K severity order (normal < nominal < alert < warn <
 * alarm < emergency) and returns the highest present. solar-charger keeps its
 * own `toStringValue` (which stringifies non-strings); bms uses a different
 * write path entirely.
 */

export function setValue<T, K extends keyof T>(target: T, key: K, nextValue: T[K]): boolean {
  if (Object.is(target[key], nextValue)) {
    return false;
  }

  target[key] = nextValue;
  return true;
}

export function setMetricValue<T, K extends keyof T, S extends keyof T>(
  target: T,
  key: K,
  stateKey: S,
  nextValue: T[K],
  state: TState | null
): boolean {
  const valueChanged = !Object.is(target[key], nextValue);
  const stateChanged = !Object.is(target[stateKey], state);
  if (!valueChanged && !stateChanged) {
    return false;
  }

  target[key] = nextValue;
  target[stateKey] = state as T[S];
  return true;
}

export function toStringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'on') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'off') return false;
  }

  return null;
}

export function resolveMostSevereState(...states: (TState | null | undefined)[]): TState | null {
  const rank: Record<TState, number> = {
    [States.Normal]: 0,
    [States.Nominal]: 1,
    [States.Alert]: 2,
    [States.Warn]: 3,
    [States.Alarm]: 4,
    [States.Emergency]: 5
  };

  let current: TState | null = null;
  for (const state of states) {
    if (!state) continue;
    if (!current || rank[state] > rank[current]) {
      current = state;
    }
  }

  return current;
}
