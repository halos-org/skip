import { Directive, computed, effect, input, signal, untracked } from '@angular/core';
import { cloneDeep, merge } from 'lodash-es';
import type { IWidgetSvcConfig } from '../interfaces/widgets-interface';

@Directive({
  selector: '[widget-runtime]',
  exportAs: 'widgetRuntime'
})
/**
 * Runtime directive merges a widget's default configuration with the (possibly user-edited)
 * saved configuration. It memoizes the merged object to provide a stable reference unless
 * either source reference changes, reducing downstream signal churn.
 */
export class WidgetRuntimeDirective {
  // Manual config input (optional override, typically for embedded hardcoded widgets. See widget-autopilot)
  public config = input<IWidgetSvcConfig | undefined>();

  // Default config input (typically from widget manifest DEFAULT_CONFIG)
  protected defaultConfig = signal<IWidgetSvcConfig | undefined>(undefined);

  // Internal runtime config
  private _runtimeConfig = signal<IWidgetSvcConfig | undefined>(undefined);
  private lastBaseRef: IWidgetSvcConfig | undefined;
  private lastUserRef: IWidgetSvcConfig | undefined;
  private lastMergedRef: IWidgetSvcConfig | undefined;

  /**
   * Merged runtime options (default + user). Returns identical object instance when
   * neither underlying reference changed, enabling efficient consumers.
   */
  public options = computed<IWidgetSvcConfig | undefined>(() => {
    const base = this.defaultConfig();
    const user = this._runtimeConfig();
    // Fast path reuse if references unchanged
    if (this.lastMergedRef && base === this.lastBaseRef && user === this.lastUserRef) {
      return this.lastMergedRef;
    }
    let merged: IWidgetSvcConfig | undefined;
    if (base && user) {
      merged = merge(cloneDeep(base), cloneDeep(user));
      restoreFixedPaths(merged, base);
      dropRetiredWiring(merged, base);
    } else if (base && !user) {
      merged = cloneDeep(base);
    } else if (!base && user) {
      merged = cloneDeep(user);
    } else {
      merged = undefined;
    }
    this.lastBaseRef = base;
    this.lastUserRef = user;
    this.lastMergedRef = merged;
    return merged;
  });

  /** Convenience: first configured path key (widgets needing only a single path can use this). */
  public firstPathKey = computed<string | undefined>(() => {
    const cfg = this.options();
    if (!cfg?.paths) return undefined;
    const keys = Object.keys(cfg.paths);
    return keys.length ? keys[0] : undefined;
  });

  constructor() {
    effect(() => {
      const conf = this.config();
      untracked(() => {
        if (conf) this.setRuntimeConfig(conf);
      });
    });
  }

  /** Retrieve a single path config safely from current merged options. */
  public getPathCfg(pathKey: string): string | undefined {
    const cfg = this.options();
    return cfg?.paths?.[pathKey];
  }

  /** Set (replace) the user runtime portion of the configuration. */
  public setRuntimeConfig(cfg: IWidgetSvcConfig | undefined): void {
    this._runtimeConfig.set(cfg);
  }

  /** Seed both default and saved configs (called once by Host2 before child creation). */
  public initialize(defaultCfg: IWidgetSvcConfig | undefined, savedCfg: IWidgetSvcConfig | undefined): void {
    if (defaultCfg) this.defaultConfig.set(defaultCfg);
    if (savedCfg) this._runtimeConfig.set(savedCfg);
  }
}

/**
 * Take every fixed path's wiring back from the widget's own defaults.
 *
 * A widget's saved config is a snapshot of the merged config at the moment it was placed
 * on a dashboard, so it carries the Signal K path and value type of whatever release that
 * was. For a path the user can edit, that snapshot is their choice and wins. For a path
 * marked `isPathConfigurable: false` it is not a choice at all - it is the widget's
 * wiring, frozen - and it pins the widget to that path forever: correcting a wrong path in
 * the widget's defaults then reaches new widgets only, while every dashboard already using
 * it stays broken with no way for the user to see why, since a fixed path is not shown in
 * the options dialog.
 *
 * A path that offers `pathOptions` is excluded: those are not configurable free-form, but
 * the stored value is still a choice the user made from the list.
 *
 * Only the wiring is restored. `source` is left as stored because the data source stays
 * editable on a fixed path. `showConvertUnitTo` IS restored: it is not a user setting but
 * the widget's decision about whether the path follows the server's unit preference or
 * keeps the widget's own unit, and a widget that gets that wrong ships a value in the wrong
 * scale.
 *
 * `convertUnitTo` follows that same decision. Where the widget exposes the unit
 * (`showConvertUnitTo` not false) the stored one is the user's choice and stays. Where it
 * does not, the path is structural - WidgetStreamsDirective reads exactly this flag to
 * decide, and converts a structural path with the widget's own fixed unit rather than the
 * server's preference - so the stored unit is not a choice either, just as stale a snapshot
 * as the path itself, and restoring the flag without it would leave the widget converting
 * to a unit it no longer declares.
 */
function restoreFixedPaths(merged: IWidgetSvcConfig, base: IWidgetSvcConfig): void {
  if (!merged.paths || !base.paths) return;
  for (const [key, basePath] of Object.entries(base.paths)) {
    if (!basePath || basePath.isPathConfigurable !== false || basePath.pathOptions) continue;
    const mergedPath = merged.paths[key];
    if (!mergedPath) continue;
    mergedPath.path = basePath.path;
    mergedPath.pathType = basePath.pathType;
    mergedPath.enableTimeout = basePath.enableTimeout;
    mergedPath.showConvertUnitTo = basePath.showConvertUnitTo;
    if (basePath.showConvertUnitTo === false) mergedPath.convertUnitTo = basePath.convertUnitTo;
  }
}

/**
 * Widget-level settings that are the widget's own wiring rather than a user preference.
 *
 * A saved config is a snapshot of the merged config when the widget was placed, so it
 * carries whatever these were then - and because the merge lets the saved value win, a
 * widget that later drops one is stuck with it, still behaving as it did and still
 * offering the setting in its options dialog. Dropping them when the widget's defaults
 * no longer declare them is what lets a widget retire one.
 */
const RETIRED_WIRING_KEYS = ['enableTimeout', 'dataTimeout'] as const;

function dropRetiredWiring(merged: IWidgetSvcConfig, base: IWidgetSvcConfig): void {
  for (const key of RETIRED_WIRING_KEYS) {
    if (base[key] === undefined) delete merged[key];
  }
}
