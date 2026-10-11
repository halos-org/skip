import { ChangeDetectionStrategy, Component, DestroyRef, OnDestroy, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { cloneDeep, merge } from 'lodash-es';
import type { ExtensionClient } from 'signalk-plotterext-bus/extension';
import { DialogService } from '../../services/dialog.service';
import { WidgetService } from '../../services/widget.service';
import { IWidgetSvcConfig } from '../../interfaces/widgets-interface';
import { TILE_CONFIG_STATE_KEYS, readTileConfig, tileConfigState } from '../single-widget-host/widget-host-bridge';

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
 * config from host `state`, migrated to the current version, and on Save it writes the edited config
 * back to `state` stamped with that version (the widget iframe follows it via `state.changed`). Because it drives the actual options dialog with the passed
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

    // Load the widget component so its statics are cached: this iframe never renders the widget, so
    // without the load getDefaultConfig would be empty and the options form would have no fields, and
    // getOptionUnits would be empty and the dialog would show SI options unconverted. A failed load
    // opens nothing. Runs alongside the host connect.
    const [saved, componentType] = await Promise.all([this.connectAndLoad(type), this.widgetService.getComponentType(type)]);
    if (this.disposed || !componentType) return;

    // Seed the form with the saved config merged onto the CURRENT default (like the tile applies it),
    // so fields added by a later Skip version are present and editable, not dropped.
    const defaults = this.widgetService.getDefaultConfig(type) ?? {} as IWidgetSvcConfig;
    const current = saved ? merge(cloneDeep(defaults), saved) : defaults;
    const ref = this.dialog.openWidgetOptions({
      title: 'Widget Settings',
      config: { ...current, widgetName, widgetType: type },
      confirmBtnText: 'Save',
      cancelBtnText: 'Cancel'
    });
    const onClosed = makeConfigResultHandler(
      (cfg) => { void this.client?.state.set(tileConfigState(cfg)).catch(() => { /* host lacks state / write failed: config not persisted */ }); },
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

  /**
   * Connect to the host and read the widget's saved config, migrated as the tile migrates it, or
   * null when none is saved, it cannot be migrated, or there is no host.
   */
  private async connectAndLoad(type: string): Promise<IWidgetSvcConfig | null> {
    try {
      const { connectExtension } = await import('signalk-plotterext-bus/extension');
      const client = await connectExtension({ onError: () => { /* transport noise */ } });
      if (this.disposed) { client.close(); return null; }
      this.client = client;
      const values = await client.state.get([...TILE_CONFIG_STATE_KEYS]);
      return readTileConfig(type, values);
    } catch {
      // No host (direct-URL open) or handshake timeout: fall back to defaults; Save is inert.
      return null;
    }
  }
}
