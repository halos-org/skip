import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, effect, inject, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { map } from 'rxjs/operators';
import { WidgetHost2Component } from '../widget-host2/widget-host2.component';
import { WidgetService } from '../../services/widget.service';
import { IWidget, IWidgetSvcConfig } from '../../interfaces/widgets-interface';
import { UUID } from '../../utils/uuid.util';
import { WidgetHostBridge } from './widget-host-bridge';

/** Apply a saved per-instance config to the mounted host, once both are available. */
export function applySavedConfig(cfg: IWidgetSvcConfig | null, host: Pick<WidgetHost2Component, 'reconfigure'> | undefined): void {
  if (cfg && host) host.reconfigure(cfg);
}

/**
 * Renders a single Skip widget full-bleed, outside any dashboard. This is the target of the
 * plotter-extension widget iframes (`#/widget/<type>` under `?embed=1`): a Freeboard-SK host sizes
 * the iframe into a chart anchor cell, and this host fills it with one widget wired to the app's own
 * live Signal K session. The widget type is the component selector (e.g. `widget-wind-steer`).
 *
 * Read-only chrome: the route is embed-only (`embedRequiredGuard`), and under embed the dashboard is
 * force-locked, so Host2's edit and options affordances never activate. (Host2's history long-press
 * gesture is enabled while locked, but Wind Steer is not history-eligible, so it is a no-op — a
 * future history-eligible widget hosted here would need that gesture suppressed.)
 *
 * Removal + settings: `WidgetHostBridge` relays a long-press to the host (opening the host dialog's
 * Remove button and settings panel — the host offers no other path for a placed widget), and exposes
 * the user's saved per-instance config, which is applied to the live tile via Host2's `reconfigure`.
 */
@Component({
  selector: 'app-single-widget-host',
  imports: [WidgetHost2Component],
  templateUrl: './single-widget-host.component.html',
  styleUrl: './single-widget-host.component.scss',
  providers: [WidgetHostBridge],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SingleWidgetHostComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly widgetService = inject(WidgetService);
  private readonly bridge = inject(WidgetHostBridge);
  private readonly host = viewChild(WidgetHost2Component);

  // The widget type (component selector) from the route. A param signal keeps it correct even if the
  // component is ever reused across navigations; in practice each iframe loads one fixed URL.
  protected readonly type = toSignal(
    this.route.paramMap.pipe(map(p => p.get('type') ?? '')),
    { initialValue: this.route.snapshot.paramMap.get('type') ?? '' }
  );

  /**
   * The IWidget to host, or null for an unrecognized type (which renders the fallback tile). Depends
   * only on the type, so Host2's plain `@Input` reference stays stable (its OnPush relies on that);
   * per-instance config is applied imperatively via `reconfigure`, not by rebuilding this.
   */
  protected readonly widget = computed<IWidget | null>(() => {
    const type = this.type();
    if (this.widgetService.getWidgetName(type) === undefined) return null;
    return { uuid: UUID.create(), type, config: {} as IWidgetSvcConfig };
  });

  constructor() {
    // Apply the user's saved per-instance config (and later edits) to the mounted tile once both the
    // config and the host are available. Host2 renders its defaults first, then adopts the overlay.
    effect(() => applySavedConfig(this.bridge.config(), this.host()));
  }

  ngOnInit(): void {
    // Only a really-hosted widget needs the host bridge; the unknown-type fallback does not.
    if (this.widget()) this.bridge.enable();
  }

  ngOnDestroy(): void {
    this.bridge.disable();
  }
}
