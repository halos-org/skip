import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { map } from 'rxjs/operators';
import { WidgetHost2Component } from '../widget-host2/widget-host2.component';
import { WidgetService } from '../../services/widget.service';
import { IWidget, IWidgetSvcConfig } from '../../interfaces/widgets-interface';
import { UUID } from '../../utils/uuid.util';
import { WidgetRemovalBridge } from './widget-removal-bridge';

/**
 * Renders a single Skip widget full-bleed, outside any dashboard. This is the target of the
 * plotter-extension widget iframes (`#/widget/<type>` under `?embed=1`): a Freeboard-SK host sizes
 * the iframe into a chart anchor cell, and this host fills it with one widget wired to the app's own
 * live Signal K session. The widget type is the component selector (e.g. `widget-wind-steer`).
 *
 * Read-only: the route is embed-only (`embedRequiredGuard`), and under embed the dashboard is
 * force-locked, so Host2's edit and options affordances never activate. (Host2's history long-press
 * gesture is enabled while locked, but Wind Steer is not history-eligible, so it is a no-op — a
 * future history-eligible widget hosted here would need that gesture suppressed.) There is no
 * per-instance configuration in this version — the widget shows its default paths.
 *
 * The widget is removable: `WidgetRemovalBridge` relays a long-press to the host so Freeboard-SK can
 * open its remove dialog (the host offers no other remove path for a placed widget).
 */
@Component({
  selector: 'app-single-widget-host',
  imports: [WidgetHost2Component],
  templateUrl: './single-widget-host.component.html',
  styleUrl: './single-widget-host.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SingleWidgetHostComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly widgetService = inject(WidgetService);
  private readonly removalBridge = inject(WidgetRemovalBridge);

  // The widget type (component selector) from the route. A param signal keeps it correct even if the
  // component is ever reused across navigations; in practice each iframe loads one fixed URL.
  protected readonly type = toSignal(
    this.route.paramMap.pipe(map(p => p.get('type') ?? '')),
    { initialValue: this.route.snapshot.paramMap.get('type') ?? '' }
  );

  /**
   * The IWidget to host, or null for an unrecognized type (which renders the fallback tile).
   * Recomputes only when the type changes, so Host2's plain `@Input` reference stays stable across
   * change detection (its OnPush relies on that).
   */
  protected readonly widget = computed<IWidget | null>(() => {
    const type = this.type();
    if (this.widgetService.getWidgetName(type) === undefined) return null;
    return { uuid: UUID.create(), type, config: {} as IWidgetSvcConfig };
  });

  ngOnInit(): void {
    // Only a really-hosted widget needs the remove affordance; the unknown-type fallback does not.
    if (this.widget()) this.removalBridge.enable();
  }

  ngOnDestroy(): void {
    this.removalBridge.disable();
  }
}
