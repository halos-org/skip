import { DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { skip } from 'rxjs';
import type { DataService, IPathUpdateWithPath } from '../../core/services/data.service';

/**
 * Universal ingest/render scheduler shared by the electrical widget family.
 *
 * Owns the timing machinery that every electrical widget duplicated verbatim:
 * the de-duping pending-update buffer, the coalescing batch timer with the
 * initial-paint synchronous drain and first-live-immediate-flush fast path,
 * the single-flight requestAnimationFrame scheduler, the path-tree subscription
 * lifecycle, and teardown. It owns *when* work happens, never *what* — parsing,
 * store mutation, snapshot resolution, and drawing are injected seams, so the
 * scheduler is behaviorally indifferent to the widget's snapshot shape.
 */
export interface ElectricalIngestConfig<TEntry, TRender> {
  data: DataService;
  destroyRef: DestroyRef;
  /** Path prefix passed to subscribePathTreeWithInitial. */
  rootPattern: string;
  /** Source bucket for the subscription (default 'default'). */
  source?: string;
  /** Coalescing window in milliseconds. */
  batchWindowMs: number;
  /** Parse an update into a de-dup buffer key + entry, or null to drop it. */
  parseUpdate: (update: IPathUpdateWithPath) => { key: string; entry: TEntry } | null;
  /** Process a drained batch of buffered entries (the store layer). */
  onFlush: (entries: TEntry[]) => void;
  /**
   * Predicate selecting which incoming paths carry a display unit sourced from the
   * server's per-path `displayUnits` meta (e.g. the family's temperature paths). The
   * value stream never re-emits on a meta-only change, so the scheduler subscribes to
   * each selected path's meta and calls {@link onMetaChange} when it lands late or
   * changes at runtime — mirroring how the streams directive folds resolvePathMeasure
   * through getPathMetaObservable. Requires {@link onMetaChange} to take effect.
   */
  watchMeta?: (update: IPathUpdateWithPath) => boolean;
  /** Invoked when a {@link watchMeta}-selected path's meta changes after subscription. */
  onMetaChange?: () => void;
  /**
   * Resolve the snapshot to draw for a render request: apply the widget's
   * readiness guard and return the explicit snapshot, a freshly built default,
   * or null when the widget is not ready to render.
   */
  resolveRenderSnapshot: (explicit?: TRender) => TRender | null;
  /** Draw a resolved snapshot. */
  draw: (snapshot: TRender) => void;
}

export class ElectricalIngestScheduler<TEntry, TRender> {
  private readonly pending = new Map<string, TEntry>();
  private readonly metaWatched = new Set<string>();
  private batchTimerId: number | null = null;
  private initialPaintDone = false;
  private frameId: number | null = null;
  private pendingRender: TRender | null = null;

  constructor(private readonly cfg: ElectricalIngestConfig<TEntry, TRender>) {
    const tree = cfg.source !== undefined
      ? cfg.data.subscribePathTreeWithInitial(cfg.rootPattern, cfg.source)
      : cfg.data.subscribePathTreeWithInitial(cfg.rootPattern);

    if (tree.initial.length) {
      for (const update of tree.initial) {
        this.enqueue(update, true);
      }
      this.flush();
      this.initialPaintDone = true;
    }

    tree.live$
      .pipe(takeUntilDestroyed(cfg.destroyRef))
      .subscribe(update => this.enqueue(update, false));

    cfg.destroyRef.onDestroy(() => this.teardown());
  }

  /** Schedule a coalesced render frame; last snapshot wins, one frame in flight. */
  requestRender(explicit?: TRender): void {
    const snapshot = this.cfg.resolveRenderSnapshot(explicit);
    if (snapshot == null) {
      return;
    }

    this.pendingRender = snapshot;
    if (this.frameId !== null) {
      return;
    }

    this.frameId = requestAnimationFrame(() => {
      this.frameId = null;
      const next = this.pendingRender;
      this.pendingRender = null;
      if (next == null) {
        return;
      }
      this.cfg.draw(next);
    });
  }

  private enqueue(update: IPathUpdateWithPath, fromInitial: boolean): void {
    this.watchMeta(update);

    const parsed = this.cfg.parseUpdate(update);
    if (!parsed) {
      return;
    }

    this.pending.set(parsed.key, parsed.entry);

    if (fromInitial) {
      return;
    }

    if (!this.initialPaintDone) {
      this.initialPaintDone = true;
      this.flush();
      return;
    }

    if (this.batchTimerId !== null) {
      return;
    }

    this.batchTimerId = window.setTimeout(() => {
      this.batchTimerId = null;
      this.flush();
    }, this.cfg.batchWindowMs);
  }

  /**
   * Subscribe once to a selected path's meta so a late/changed server displayUnits
   * preference triggers a re-resolve+repaint. The initial replay is skipped: the
   * current meta is already reflected by the render that reads it.
   */
  private watchMeta(update: IPathUpdateWithPath): void {
    if (!this.cfg.watchMeta || !this.cfg.onMetaChange) {
      return;
    }
    if (this.metaWatched.has(update.path) || !this.cfg.watchMeta(update)) {
      return;
    }
    this.metaWatched.add(update.path);
    this.cfg.data.getPathMetaObservable(update.path)
      .pipe(skip(1), takeUntilDestroyed(this.cfg.destroyRef))
      .subscribe(() => this.cfg.onMetaChange?.());
  }

  private flush(): void {
    if (!this.pending.size) {
      return;
    }

    const entries = Array.from(this.pending.values());
    this.pending.clear();
    this.cfg.onFlush(entries);
  }

  private teardown(): void {
    if (this.batchTimerId !== null) {
      clearTimeout(this.batchTimerId);
      this.batchTimerId = null;
    }
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    this.pendingRender = null;
  }
}
