import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { map } from 'rxjs/operators';
import { WidgetHost2Component } from '../widget-host2/widget-host2.component';
import { WidgetService } from '../../services/widget.service';
import { IWidget, IWidgetSvcConfig } from '../../interfaces/widgets-interface';
import { UUID } from '../../utils/uuid.util';

/**
 * Renders a single Skip widget full-bleed, outside any dashboard. This is the target of the
 * plotter-extension widget iframes (`#/widget/<type>` under `?embed=1`): a Freeboard-SK host sizes
 * the iframe into a chart anchor cell, and this host fills it with one widget wired to the app's own
 * live Signal K session. The widget type is the component selector (e.g. `widget-wind-steer`).
 *
 * Read-only by construction: under embed the dashboard is force-locked, so Host2's edit/options/
 * history affordances are inert. There is no per-instance configuration in this version — the widget
 * shows its default paths.
 */
@Component({
  selector: 'app-single-widget-host',
  imports: [WidgetHost2Component],
  templateUrl: './single-widget-host.component.html',
  styleUrl: './single-widget-host.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SingleWidgetHostComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly widgetService = inject(WidgetService);

  // The widget type (component selector) from the route. A param signal keeps it correct even if the
  // component is ever reused across navigations; in practice each iframe loads one fixed URL.
  protected readonly type = toSignal(
    this.route.paramMap.pipe(map(p => p.get('type') ?? '')),
    { initialValue: this.route.snapshot.paramMap.get('type') ?? '' }
  );

  /** True when the requested type is a registered Skip widget. */
  protected readonly known = computed(() => this.widgetService.getWidgetName(this.type()) !== undefined);

  /**
   * The IWidget to host, or null for an unrecognized type. Recomputes only when the type changes, so
   * Host2's plain `@Input` reference stays stable across change detection (its OnPush relies on that).
   */
  protected readonly widget = computed<IWidget | null>(() => {
    const type = this.type();
    if (this.widgetService.getWidgetName(type) === undefined) return null;
    return { uuid: UUID.create(), type, config: {} as IWidgetSvcConfig };
  });
}
