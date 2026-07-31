import { ChangeDetectionStrategy, Component, DestroyRef, OnDestroy, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import type { ExtensionClient } from 'signalk-plotterext-bus/extension';
import { DialogService } from '../../services/dialog.service';
import { WidgetService } from '../../services/widget.service';
import { IWidgetSvcConfig } from '../../interfaces/widgets-interface';
import { WIDGET_CONFIG_STATE_KEY } from '../single-widget-host/widget-host-bridge';

/**
 * Build the widget-options dialog's close handler: Save (a result config) persists it to host state;
 * Save or Cancel both close the host panel afterwards.
 */
export function makeConfigResultHandler(
  save: (cfg: IWidgetSvcConfig) => void,
  closePanel: () => void
): (result?: IWidgetSvcConfig) => void {
  return (result) => {
    if (result) save(result);
    closePanel();
  };
}

/**
 * The plotter-extension widget's configuration panel iframe (`#/widget-config/<type>` under
 * `?embed=1`). Freeboard-SK opens it from the widget's long-press dialog with the widget instance as
 * the state target.
 *
 * It reuses Skip's real widget-settings dialog (`DialogService.openWidgetOptions` →
 * `RootModalWidgetConfigComponent`) rather than a bespoke form: seeded with the widget's current
 * config from host `state`, and on Save it writes the edited config back to `state` (which the widget
 * iframe follows via `state.changed`). Because it drives the actual options dialog with the passed
 * config, this panel is generic across any widget exposed as a plotter-extension widget.
 */
@Component({
  selector: 'app-widget-config-panel',
  imports: [],
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WidgetConfigPanelComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly widgetService = inject(WidgetService);
  private readonly dialog = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);
  private client: ExtensionClient | null = null;
  private disposed = false;

  async ngOnInit(): Promise<void> {
    const type = this.route.snapshot.paramMap.get('type') ?? '';
    const widgetName = this.widgetService.getWidgetName(type);
    if (widgetName === undefined) return;

    const saved = await this.connectAndLoad();
    if (this.disposed) return;

    const current = saved ?? this.widgetService.getDefaultConfig(type) ?? {} as IWidgetSvcConfig;
    const ref = this.dialog.openWidgetOptions({
      title: 'Widget Settings',
      config: { ...current, widgetName },
      confirmBtnText: 'Save',
      cancelBtnText: 'Cancel'
    });
    const onClosed = makeConfigResultHandler(
      (cfg) => { void this.client?.state.set({ [WIDGET_CONFIG_STATE_KEY]: cfg }); },
      () => { void this.client?.call('ui.closePanel').catch(() => { /* no host */ }); }
    );
    ref.afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result?: IWidgetSvcConfig) => onClosed(result));
  }

  ngOnDestroy(): void {
    this.disposed = true;
    this.client?.close();
    this.client = null;
  }

  /** Connect to the host and read the widget's saved config, or null when none / no host. */
  private async connectAndLoad(): Promise<IWidgetSvcConfig | null> {
    try {
      const { connectExtension } = await import('signalk-plotterext-bus/extension');
      const client = await connectExtension({ onError: () => { /* transport noise */ } });
      if (this.disposed) { client.close(); return null; }
      this.client = client;
      const values = await client.state.get([WIDGET_CONFIG_STATE_KEY]);
      const cfg = values[WIDGET_CONFIG_STATE_KEY];
      return cfg && typeof cfg === 'object' ? (cfg as IWidgetSvcConfig) : null;
    } catch {
      // No host (direct-URL open) or handshake timeout: fall back to defaults; Save is inert.
      return null;
    }
  }
}
