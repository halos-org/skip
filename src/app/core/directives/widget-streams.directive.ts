import { Directive, DestroyRef, OnDestroy, inject, signal } from '@angular/core';
import { DataService, IPathUpdate } from '../services/data.service';
import { UnitsService } from '../services/units.service';
import { IWidgetSvcConfig, DEFAULT_WIDGET_UPDATE_INTERVAL_MS } from '../interfaces/widgets-interface';
import { Observable, Observer, Subject, delayWhen, filter, map, retryWhen, sampleTime, tap, throwError, timeout, timer, takeUntil, take, merge, combineLatest, distinctUntilChanged, Subscription } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { formatJsonPointer, type Path } from '@jsonjoy.com/json-pointer';
import { States } from '../interfaces/signalk-interfaces';
import { parsePointer, resolvePointer, splitPointerPath } from '../utils/pointer-path.util';

/** Fixed stale-data TTL (ms) applied to every widget whose enableTimeout is on; not user-configurable. */
const FIXED_DATA_TIMEOUT_MS = 5000;

/** The subset of a path config that decides which reading a subscription delivers. */
interface IPathIdentity {
  path: string | null;
  pathType?: string | null;
  convertUnitTo?: string | null;
  source?: string | null;
  suppressBootstrapNull?: boolean;
  enableTimeout?: boolean;
}

/**
 * Trim a configured path to its canonical form; undefined when it is not a usable path. Only the
 * Signal K path before a `#` is trimmed, because `#/ ` addresses the key `" "`. A malformed pointer
 * or a pointer with no path before it is not usable, so such a slot subscribes to nothing.
 */
export function normalizeWidgetPath(path: unknown): string | undefined {
  if (typeof path !== 'string') return undefined;
  const split = splitPointerPath(path);
  if (!split.valid || !split.basePath) return undefined;
  return split.pointer ? split.basePath + path.slice(path.indexOf('#')) : split.basePath;
}

/**
 * Identity of a configured path as the subscription diff computes it. Two configs that share a
 * signature reuse one subscription; a different signature means the widget is now watching another
 * reading. A widget that holds presentation state derived from the stream — a needle position, a
 * last value, an alarm colour — needs this to tell a re-point apart from an unrelated reconfigure
 * such as a theme change, because a rebuilt subscription may replay nothing at all and leave that
 * state showing the previous path.
 *
 * Returns null for a config with no usable path, which has no identity to compare.
 */
export function widgetPathSignature(pathCfg: IPathIdentity | undefined | null): string | null {
  const normalizedPath = normalizeWidgetPath(pathCfg?.path);
  if (!pathCfg || !normalizedPath) return null;
  const src = (pathCfg.source?.trim() || 'default');
  // All three timeout settings differ: an omitted one defers to the widget-level flag, so
  // omitted and `true` are not the same subscription. Omitted stays '' so the signature of
  // every path that does not set it is unchanged.
  const timeout = pathCfg.enableTimeout === false ? 'nott' : pathCfg.enableTimeout === true ? 'tt' : '';
  return [normalizedPath, pathCfg.pathType, pathCfg.convertUnitTo, src, pathCfg.suppressBootstrapNull ? '1' : '0',
    timeout].join('|');
}

/**
 * A slot's config as it subscribes: a slot with `sourceFromPath` reads with that slot's source,
 * but only while both read the same path; a source pinned for another path may not send this one.
 */
export function effectivePathConfig(paths: IWidgetSvcConfig['paths'], pathName: string) {
  const pathCfg = paths?.[pathName];
  const sourceCfg = pathCfg?.sourceFromPath ? paths?.[pathCfg.sourceFromPath] : undefined;
  const samePath = !!sourceCfg && normalizeWidgetPath(sourceCfg.path) === normalizeWidgetPath(pathCfg?.path);
  return pathCfg && sourceCfg && samePath ? { ...pathCfg, source: sourceCfg.source } : pathCfg;
}

/**
 * Tracks which path a widget's stream-derived presentation state describes across runs of the
 * widget's data effect, and reports when that state has gone stale.
 *
 * Every run rebuilds the subscription — a theme change included — and `suppressBootstrapNull` gives
 * each rebuild a fresh suppression closure. Against a path that reports nothing the replayed
 * leading null is therefore filtered and the stream callback never runs, leaving the previous
 * path's needle and value on screen, presented as a live reading of the new one (#585). Clearing
 * on every run is wrong for the same reason: it would blink the reading off at every theme switch.
 * Comparing signatures tells the two apart.
 *
 * Three states: nothing recorded before the first call (nothing has been shown, so there is nothing
 * to clear), `null` for a config with no usable path, and the signature otherwise. `null` is a real
 * identity rather than a second "not yet" — a cleared path must still compare unequal to the path
 * that follows it.
 *
 * The reading comes back only because the widget passes `observe()` a new closure on every effect
 * run: the directive compares callback identity as well as the signature, so it rebuilds and
 * replays the new path's value. A stable callback reference would early-return instead and leave
 * the gauge blank on a live path until the next delta.
 */
export class WidgetRepointTracker {
  private last: string | null | undefined = undefined;

  /**
   * Record the path the reading now describes. True when it differs from the one recorded before:
   * the widget was re-pointed, and whatever it shows belongs to the old path. Never true on the
   * first call.
   */
  repointed(signature: string | null): boolean {
    const changed = this.last !== undefined && this.last !== signature;
    this.last = signature;
    return changed;
  }
}

@Directive({
  selector: '[widget-streams]',
  exportAs: 'widgetStreams'
})
/**
 * Streams directive manages live data subscriptions for widget Signal K paths.
 *
 * Architecture:
 * - Each widget instance gets its own directive instance (no cross-widget sharing)
 * - One callback per path (subsequent observe() calls replace previous callback)
 * - Per-path base observable cache to avoid redundant DataService subscriptions
 * - Diff-based updates: only rebuilds subscriptions when path signatures change
 *
 * Key Features:
 * - Fast first emission (take(1)) merged with sampled stream for immediate render
 * - Numeric paths delivered in SI, tagged with the measure they present in: the server-resolved
 *   measure for a display slot (the stored `convertUnitTo` until meta resolves), the fixed
 *   `convertUnitTo` for a structural slot. A widget converts only where it formats text, maps to a
 *   scale or sets an SVG attribute, with `UnitsService.convertToUnit(measure, value)`
 * - Optional stale-data timeout (gated by the enableTimeout flag; fixed 5s TTL) + retry handling
 * - Path validation: null/undefined/empty paths, and paths with a malformed `#` pointer, trigger cleanup
 * - Pointer paths (`path#/field`) acquire and time out on the Signal K path and deliver the field
 * - Signature tracking: per-path (path + pathType + convertUnitTo + source + bootstrap null policy); the widget-level update cadence lives in the root signature
 *
 * Usage Pattern:
 * - Call observe(pathKey, callback) once per required path
 * - Multiple paths require multiple observe() calls
 * - Config changes automatically trigger diff-based subscription updates
 * - All subscriptions auto-cleanup on directive destroy
 */
export class WidgetStreamsDirective implements OnDestroy {
  private _streamsConfig = signal<IWidgetSvcConfig | undefined>(undefined);
  private readonly dataService = inject(DataService);
  private readonly unitsService = inject(UnitsService);
  private readonly destroyRef = inject(DestroyRef);
  // Base raw observables per logical path key
  private streams: Map<string, Observable<IPathUpdate>> | undefined;
  private registrations: { pathName: string; next: (value: IPathUpdate) => void; pointer?: string }[] = [];
  // Active subscriptions per path (so we can surgically unsubscribe changed/removed paths)
  private subscriptions = new Map<string, { sub: Subscription; signature: string }>();
  // Track identity of the cached base observable (path + normalized source) per path key
  private baseSignatures = new Map<string, string>();
  // Release handle for each acquired base, held 1:1 with the baseSignatures keyset so every base
  // registration is released exactly when its cached base is dropped (and all of them on destroy).
  private baseReleases = new Map<string, () => void>();
  // Root-level signature (timeout settings) to detect when all paths need pipeline rebuild
  private reset$ = new Subject<void>();
  private rootSignature: string | undefined;

  /** Build a simple Observer wrapper for a given path key. */
  private buildObserver(pathKey: string, next: ((value: IPathUpdate) => void)): Observer<IPathUpdate> {
    return {
      next: v => next(v),
      error: err => console.error('[Widget] Observer got an error: ' + err),
      complete: () => { }
    };
  }

  private computePathSignature(pathCfg: { path: string; pathType: string; convertUnitTo?: string; source?: string; suppressBootstrapNull?: boolean; enableTimeout?: boolean }): string {
    return widgetPathSignature(pathCfg) ?? '';
  }

  private computeBaseKey(path: string, source?: string): string {
    const normalizedPath = this.normalizePath(path) ?? '';
    const src = (source?.trim() || 'default');
    return `${normalizedPath}|${src}`;
  }

  private normalizePath(path: unknown): string | undefined {
    return normalizeWidgetPath(path);
  }

  private computeRootSignature(cfg: IWidgetSvcConfig | undefined): string {
    if (!cfg) return 'none';
    // updateInterval is widget-level, so it lives in the root signature: a cadence change rebuilds
    // every path's pipeline (the base observable is reused; only the sampling stage is rebuilt).
    return `timeout:${cfg.enableTimeout ? '1' : '0'}|update:${cfg.updateInterval ?? ''}`;
  }

  private ensureStreamsMap(): void {
    if (!this.streams) this.streams = new Map<string, Observable<IPathUpdate>>();
  }

  /** Release and forget the base registration held for a path key (idempotent, safe when absent). */
  private releaseBase(pathName: string): void {
    this.baseReleases.get(pathName)?.();
    this.baseReleases.delete(pathName);
  }

  /** Release every held base registration (used on config reset and directive destroy). */
  private releaseAllBases(): void {
    this.baseReleases.forEach(release => release());
    this.baseReleases.clear();
  }

  /**
   * The update for one field of the base path's value. The alarm state is reset: it comes from the
   * base path's notification, and a field does not inherit the base path's zones either.
   */
  private resolveField(update: IPathUpdate, pointer: Path): IPathUpdate {
    return { data: { value: resolvePointer(update.data.value, pointer), timestamp: update.data.timestamp }, state: States.Normal };
  }

  /** Create (or reuse) base observable, assemble pipeline, and subscribe with diff-aware replacement. */
  private buildAndSubscribe(pathName: string, next: (value: IPathUpdate) => void, cfg: IWidgetSvcConfig, pathCfg: { path: string; pathType: string; convertUnitTo?: string; showConvertUnitTo?: boolean; source?: string; suppressBootstrapNull?: boolean; enableTimeout?: boolean }, observePointer?: string): void {
    // The same test normalizeWidgetPath applies, kept as a split for its base path and pointer.
    const split = splitPointerPath(pathCfg.path);
    if (!split.valid || !split.basePath) {
      const existing = this.subscriptions.get(pathName);
      if (existing) existing.sub.unsubscribe();
      this.subscriptions.delete(pathName);
      this.streams?.delete(pathName);
      this.releaseBase(pathName);
      this.baseSignatures.delete(pathName);
      return;
    }

    // Values, sources and timeouts belong to the Signal K path; a field is read out of its value.
    // The configured pointer comes first, so observe()'s pointer addresses into the configured field.
    const basePath = split.basePath;
    const pointer = [...(split.pointer ?? []), ...(observePointer ? parsePointer(observePointer) ?? [] : [])];
    const fieldPath = pointer.length ? `${basePath}#${formatJsonPointer(pointer)}` : basePath;

    // Build base observable if missing, or refresh when path/source changed
    this.ensureStreamsMap();
    const baseKey = this.computeBaseKey(basePath, pathCfg.source);
    const effectiveSource = pathCfg.source?.trim() || 'default';
    const currentBaseKey = this.baseSignatures.get(pathName);
    if (!this.streams!.has(pathName) || currentBaseKey !== baseKey) {
      // Base identity (path+source) changed: release the old registration before overwriting so the
      // superseded (path, source) is not leaked. Never reached on a cadence/unit/timeout change —
      // those keep baseKey identical and only rebuild the RxJS pipeline downstream.
      this.releaseBase(pathName);
      const handle = this.dataService.acquirePath(basePath, effectiveSource);
      this.streams!.set(pathName, handle.data$);
      this.baseReleases.set(pathName, handle.release);
      this.baseSignatures.set(pathName, baseKey);
    }
    const base$ = this.streams!.get(pathName)!;

    // A path may opt in or out of the stale-data TTL on its own, over whatever the widget
    // says. The TTL assumes a path is fed continuously and nulls it when it goes quiet,
    // which is right for a live reading and wrong for state: a start line is published when
    // it changes and then not again, so the TTL erases a perfectly good line five seconds
    // after it arrives.
    //
    // The per-path `true` is what a widget with no widget-level flag uses to keep its live
    // readings honest - `enableTimeout` is not offered in the options dialog, so a widget
    // that does not declare one has none, and a frozen reading would otherwise sit there
    // looking live. Per-path `false` still wins over a widget-level `true`.
    const enableTimeout = pathCfg.enableTimeout !== false
      && (pathCfg.enableTimeout === true || !!cfg.enableTimeout);
    const dataTimeout = FIXED_DATA_TIMEOUT_MS;
    const retryDelay = 5000;
    const timeoutErrorMsg = `[Widget] ${cfg.displayName} - ${dataTimeout / 1000} second data update timeout reached for `;
    const retryErrorMsg = `[Widget] ${cfg.displayName} - Retrying in ${retryDelay / 1000} seconds`;

    const pathType = pathCfg.pathType;
    const suppressBootstrapNull = !!pathCfg.suppressBootstrapNull;
    let sample = Number(cfg.updateInterval);
    if (!Number.isFinite(sample) || sample <= 0) sample = DEFAULT_WIDGET_UPDATE_INTERVAL_MS;
    // Structural paths keep their widget-owned fixed unit; display paths follow the server's
    // resolved measure (which can change when displayUnits meta arrives after first subscribe).
    const isStructural = pathCfg.showConvertUnitTo === false;
    const structuralMeasure = pathCfg.convertUnitTo;

    let data$: Observable<IPathUpdate> = base$;
    if (pointer.length) {
      // Resolve the field first, so bootstrap-null suppression and sampling operate on the field's
      // value.
      data$ = data$.pipe(map(x => this.resolveField(x, pointer)));
    }
    if (suppressBootstrapNull) {
      // Drop only the LEADING (bootstrap) null values. Once a real value has been seen, let
      // everything through - including a later null produced by a TTL timeout. The flag is
      // captured here, outside the operator, so it survives the timeout/retry resubscription
      // below; a plain skipWhile would reset on every retry and swallow the timeout null (#1069).
      let seenNonNull = false;
      data$ = data$.pipe(filter(x => {
        if (x?.data?.value != null) seenNonNull = true;
        return seenNonNull;
      }));
    }
    // Fast first emission, then the latest value per sample interval.
    const initial$ = data$.pipe(take(1));
    const sampled$ = data$.pipe(sampleTime(sample));
    data$ = merge(initial$, sampled$);
    if (pathType === 'number') {
      if (isStructural) {
        data$ = data$.pipe(
          map(x => ({
            data: {
              value: x.data.value,
              timestamp: x.data.timestamp,
              measure: structuralMeasure
            },
            state: x.state
          } as IPathUpdate))
        );
      } else {
        // Display path: the applied measure is reactive. Re-emit the last value whenever the
        // resolved measure changes (e.g. the server's displayUnits meta lands after this
        // subscription was built), so the value and the widget's unit label stay in lock-step.
        // combineLatest tears down with the outer pipeline, so no separate meta-subscription
        // bookkeeping is needed.
        const measure$ = this.dataService.getPathMetaObservable(fieldPath).pipe(
          map(() => {
            const resolved = this.unitsService.resolvePathMeasure(fieldPath);
            // Before any unit meta resolves, resolvePathMeasure returns 'unitless'. Tag the value with
            // the widget's stored unit until a real measure resolves, so its readout and scale are
            // presented in that unit instead of as bare SI.
            const measure = resolved === 'unitless' && structuralMeasure ? structuralMeasure : resolved;
            return { measure, durationFormat: this.unitsService.resolvePathDurationFormat(fieldPath) };
          }),
          distinctUntilChanged((a, b) => a.measure === b.measure && a.durationFormat === b.durationFormat)
        );
        data$ = combineLatest([data$, measure$]).pipe(
          map(([x, { measure, durationFormat }]) => ({
            data: {
              value: x.data.value,
              timestamp: x.data.timestamp,
              measure,
              durationFormat
            },
            state: x.state
          } as IPathUpdate))
        );
      }
    }
    if (enableTimeout) {
      data$ = data$.pipe(
        timeout({
          each: dataTimeout,
          with: () => throwError(() => {
            console.log(timeoutErrorMsg + basePath);
            this.dataService.timeoutPathObservable(basePath, effectiveSource, pathType, dataTimeout);
          })
        }),
        retryWhen(error => error.pipe(
          tap(() => console.log(retryErrorMsg)),
          delayWhen(() => timer(retryDelay))
        ))
      );
    }
    const observer = this.buildObserver(pathName, next);
    const sub = data$
      .pipe(
        takeUntil(this.reset$),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(observer);
    const signature = this.computePathSignature(pathCfg);
    // Replace any existing subscription
    const existing = this.subscriptions.get(pathName);
    if (existing) existing.sub.unsubscribe();
    this.subscriptions.set(pathName, { sub, signature });
  }


  /**
   * Programmatically set widget configuration for the streams directive.
   *
   * This is a manual config injection mechanism primarily used when widgets are
   * embedded and require hardcoded or parent component configuration management.
   *
   * Behavior:
   * - Updates internal config signal immediately
   * - Does NOT trigger automatic subscription updates (unlike applyStreamsConfigDiff)
   * - Widgets must call observe() after setStreamsConfig() to establish subscriptions
   * - Useful for runtime config injection without Host2 dependency
   *
   * Usage Patterns:
   * ```ts
   * // Embedded widget scenario
   * const streams = inject(WidgetStreamsDirective);
   * streams.setStreamsConfig(myWidgetConfig);
   * streams.observe('primaryPath', data => this.handleData(data));
   *
   * // Dynamic config updates
   * streams.setStreamsConfig(newConfig);
   * streams.observe('newPath', callback); // Creates subscription with new config
   * ```
   *
   * Note: For regular widgets, use WidgetRuntimeDirective which automatically
   * handles stream lifecycle management and config changes.
   *
   * @param cfg Widget service config or undefined to clear configuration
   * @public For manual config injection in embedded/hardcoded contexts such the
   * Widget-autopilot widget in route mode.
   */
  public setStreamsConfig(cfg: IWidgetSvcConfig | undefined) {
    this._streamsConfig.set(cfg);
    // Initialize root signature so first applyStreamsConfigDiff doesn't treat it as changed
    this.rootSignature = this.computeRootSignature(cfg);
  }

  /**
   * Apply config changes with diff-based subscription management.
   * Called automatically by Host2 when widget config updates.
   *
   * Behavior:
  * - Compares path signatures (path + pathType + convertUnitTo + source + bootstrap null policy)
   * - Compares root signature (widget-level settings: enableTimeout + updateInterval)
   * - Only rebuilds subscriptions for paths with changed signatures
   * - Removes subscriptions for deleted paths
   * - Preserves unchanged subscriptions for performance
   * - Cleans up invalid paths (null/undefined/empty)
   * - Defers subscription creation until observe() is called if no registrations exist
   *
   * Performance: Avoids unnecessary subscription churn during config edits
   *
   * @param cfg New widget config or undefined to clear all subscriptions
   * @internal Used by Host2 runtime - widgets should not call directly
   */
  public applyStreamsConfigDiff(cfg: IWidgetSvcConfig | undefined): void {
    const prevCfg = this._streamsConfig();
    const prevRootSig = this.rootSignature;
    const newRootSig = this.computeRootSignature(cfg);
    this._streamsConfig.set(cfg);
    this.rootSignature = newRootSig;

    // If no previous config just exit (widget view will call observe and build on demand)
    if (!prevCfg || !prevCfg.paths || !Object.keys(prevCfg.paths).length) return;
    if (!cfg || !cfg.paths) {
      // All removed
      this.subscriptions.forEach(s => s.sub.unsubscribe());
      this.subscriptions.clear();
      this.releaseAllBases();
      this.streams = undefined;
      this.baseSignatures.clear();
      this.registrations = [];
      return;
    }
    const oldPaths = Object.keys(prevCfg.paths);
    const newPaths = Object.keys(cfg.paths);
    const removed = oldPaths.filter(p => !newPaths.includes(p));
    for (const r of removed) {
      const existing = this.subscriptions.get(r);
      if (existing) existing.sub.unsubscribe();
      this.subscriptions.delete(r);
      this.streams?.delete(r);
      this.releaseBase(r);
      this.baseSignatures.delete(r);
      this.registrations = this.registrations.filter(x => x.pathName !== r);
    }
    const rootChanged = prevRootSig !== newRootSig;
    for (const p of newPaths) {
      const pathCfg = effectivePathConfig(cfg.paths, p);
      const normalizedPath = this.normalizePath(pathCfg?.path);
      if (!normalizedPath) {
        const existing = this.subscriptions.get(p);
        if (existing) existing.sub.unsubscribe();
        this.subscriptions.delete(p);
        this.streams?.delete(p);
        this.releaseBase(p);
        this.baseSignatures.delete(p);
        continue;
      }
      const normalizedCfg = { ...pathCfg, path: normalizedPath };
      const sig = this.computePathSignature(normalizedCfg);
      const existing = this.subscriptions.get(p);
      if (!existing || existing.signature !== sig || rootChanged) {
        // Replace existing subscription if present; otherwise wait for observe()
        if (existing) {
          existing.sub.unsubscribe();
          this.subscriptions.delete(p);
        }
        // Defer base observable creation/refresh to buildAndSubscribe(), which
        // will reuse the cached base when base identity (path+source) is unchanged.
        const reg = this.registrations.find(r => r.pathName === p);
        if (reg) this.buildAndSubscribe(p, reg.next, cfg, normalizedCfg, reg.pointer);
      }
    }
  }

  /**
   * Register (idempotent) a consumer callback for a logical path key.
   *
   * DESIGN: Each widget instance gets its own directive instance. Only ONE callback
   * per path is supported - multiple calls with different callbacks will replace
   * the previous one. This simplifies subscription management and avoids callback
   * multiplexing complexity.
   *
   * Behavior:
   * - First call for a path builds subscription pipeline
   * - Subsequent calls with same callback are no-op (idempotent)
   * - Different callback for same path replaces the previous registration
   * - Invalid paths (null/empty) clear any existing subscription
  * - Pipeline rebuilds automatically when the path signature changes (path, pathType, source, convertUnitTo, suppressBootstrapNull) or the widget-level update cadence changes
   *
   * Lifecycle / Cleanup:
   * - Subscriptions auto-cleanup on directive destroy
   * - Config changes trigger diff-based subscription signature tracking
   * - Invalid paths immediately cleanup resources
   *
   * Best Practices:
   * 1. Call once per required path key in component initialization
   * 2. Keep callback stable (avoid recreating functions) to prevent unnecessary rebuilds
   * 3. Delegate heavy processing to signals/computed - keep callback lightweight
   * 4. No manual cleanup needed - directive handles lifecycle
   *
   * Examples:
   * ```ts
   * // Single path numeric widget
   * this.streams.observe('speed', update => {
   *   this.speed.set(update.data.value as number); // SI; update.data.measure names its presentation unit
   * });
   *
   * // Multiple paths - call observe() once per path
   * this.streams.observe('windSpeed', update => this.windSpeed.set(update.data.value));
   * this.streams.observe('windAngle', update => this.windAngle.set(update.data.value));
   * this.streams.observe('boatSpeed', update => {
   *   let myValue: number;
   *   // custom processing
   *   this.boatSpeed.set(myValue);
   * });
   * ```
   *
   * @param pathName Logical path key from widget config (config.paths[pathName])
   * @param next Callback for processed updates (sampled; numbers in SI)
   * @param pointer Optional RFC 6901 pointer (e.g. '/roll') to the field the widget reads out of the
   *   configured path's value (e.g. 'self.navigation.attitude'). A configured path that already
   *   carries a pointer is resolved first, then this one. The field is resolved before sampling; a
   *   value without the field yields null.
   */
  public observe(pathName: string, next: (value: IPathUpdate) => void, pointer?: string): void {
    if (pointer !== undefined && !parsePointer(pointer)) {
      throw new Error(`[WidgetStreamsDirective] observe() pointer '${pointer}' is not an RFC 6901 pointer such as '/roll'`);
    }
    // Capture previous registration before replacing it (callback + pointer)
    const prev = this.registrations.find(r => r.pathName === pathName);
    const prevReg = prev?.next;
    const prevPointer = prev?.pointer;
    // Replace any existing registration for this path (one callback per path)
    this.registrations = this.registrations.filter(r => r.pathName !== pathName);
    this.registrations.push({ pathName, next, pointer });

    const cfg = this._streamsConfig();
    if (!cfg || !cfg.paths?.[pathName]) {
      // Config missing - cleanup existing subscription but keep registration for later
      const existing = this.subscriptions.get(pathName);
      if (existing) {
        existing.sub.unsubscribe();
        this.subscriptions.delete(pathName);
        this.streams?.delete(pathName);
        this.releaseBase(pathName);
        this.baseSignatures.delete(pathName);
      }
      return;
    }

    const pathCfg = effectivePathConfig(cfg.paths, pathName);
    const normalizedPath = this.normalizePath(pathCfg?.path);
    if (!normalizedPath) {
      // Invalid path - cleanup subscription and remove registration
      const existing = this.subscriptions.get(pathName);
      if (existing) {
        existing.sub.unsubscribe();
        this.subscriptions.delete(pathName);
        this.streams?.delete(pathName);
        this.releaseBase(pathName);
        this.baseSignatures.delete(pathName);
      }
      this.registrations = this.registrations.filter(r => r.pathName !== pathName);
      return;
    }

    const normalizedCfg = { ...pathCfg, path: normalizedPath };
    const sig = this.computePathSignature(normalizedCfg);
    const existing = this.subscriptions.get(pathName);
    // If signature unchanged and neither the callback nor the pointer changed, keep as-is;
    // otherwise rebuild to swap the observer / field resolution.
    if (existing && existing.signature === sig && prevReg === next && prevPointer === pointer) return;

    this.buildAndSubscribe(pathName, next, cfg, normalizedCfg, pointer);
  }

  /**
   * Drop a path's registration and release its subscription: the inverse of {@link observe}, for a
   * path a widget reads only while one of its options is on. A no-op for a path never observed.
   */
  public unobserve(pathName: string): void {
    this.registrations = this.registrations.filter(r => r.pathName !== pathName);
    this.subscriptions.get(pathName)?.sub.unsubscribe();
    this.subscriptions.delete(pathName);
    this.streams?.delete(pathName);
    this.releaseBase(pathName);
    this.baseSignatures.delete(pathName);
  }

  /**
   * Release every base registration this directive acquired. The RxJS subscriptions self-clean via
   * takeUntilDestroyed, but the DataService registrations do not — without this, a destroyed widget
   * leaves its (path, source) registrations pinned forever (the primary current leak vector).
   */
  ngOnDestroy(): void {
    this.releaseAllBases();
  }
}
