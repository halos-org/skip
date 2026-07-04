import { Component, inject, Input, ChangeDetectionStrategy, OnInit, viewChild } from '@angular/core';
import { WidgetTitleComponent } from '../widget-title/widget-title.component';
import { DashboardService } from '../../services/dashboard.service';
import { GestureDirective } from "../../directives/gesture.directive";
import { IWidget, IWidgetSvcConfig } from '../../interfaces/widgets-interface';
import { WidgetRuntimeDirective } from '../../directives/widget-runtime.directive';
import { DialogService } from '../../services/dialog.service';
import { ActionMenuComponent } from '../action-menu/action-menu.component';
import { WIDGET_ACTIONS } from '../action-menu/widget-actions';
import { cloneDeep } from 'lodash-es';
import { BaseWidget, NgCompInputs } from 'gridstack/dist/angular';

@Component({
  selector: 'group-widget',
  imports: [WidgetTitleComponent, GestureDirective, ActionMenuComponent],
  templateUrl: './group-widget.component.html',
  styleUrl: './group-widget.component.scss',
  hostDirectives: [
    { directive: WidgetRuntimeDirective }
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GroupWidgetComponent extends BaseWidget implements OnInit {
  // Gridstack supplies a single widgetProperties object - does NOT support input signal yet
  @Input({ required: true }) protected widgetProperties!: IWidget;
  protected readonly dashboard = inject(DashboardService);
  private readonly _dialog = inject(DialogService);
  protected readonly runtime = inject(WidgetRuntimeDirective);
  private readonly _actionMenu = viewChild.required(ActionMenuComponent);
  protected readonly widgetActions = WIDGET_ACTIONS;

  public static readonly DEFAULT_CONFIG: IWidgetSvcConfig = {
    displayName: 'Gauge Label',
    color: 'contrast'
  };
  private _optionsOpen = false;

  constructor() {
    super()
  }

  ngOnInit(): void {
    const shouldAutoOpenOptions = this.widgetProperties.autoOpenOptionsOnCreate === true;
    if (shouldAutoOpenOptions) {
      delete this.widgetProperties.autoOpenOptionsOnCreate;
    }

    // Resolve default and user configuration
    this.runtime?.initialize?.(GroupWidgetComponent.DEFAULT_CONFIG, this.widgetProperties.config);

    if (shouldAutoOpenOptions) {
      queueMicrotask(() => this.openWidgetOptions(new Event('kip:auto-open-options')));
    }
  }

  /**
   * Gridstack persistence hook. Ensures we always write the merged runtime options
   * (default + user) so external dashboard storage stays in sync.
   * Falls back to an empty object to avoid Gridstack serializing `undefined`.
   * @returns Gridstack input mapping containing updated `widgetProperties`.
   */
  public override serialize(): NgCompInputs {
    const merged = this.runtime?.options();
    if (merged) {
      this.widgetProperties.config = merged;
    } else if (!this.widgetProperties.config) {
      // As a final fallback ensure config is at least an empty object to avoid Gridstack persisting undefined
      this.widgetProperties.config = {} as IWidgetSvcConfig;
    }
    return { widgetProperties: this.widgetProperties as IWidget } as NgCompInputs;
  }

  /**
  * Open the widget options dialog (skips when dashboard is static).
  * @param e Event used to stop propagation (click/context menu/etc.).
  */
  public openWidgetOptions(e: Event | CustomEvent): void {
    (e as Event).stopPropagation();
    if (!this.dashboard.isDashboardStatic()) {
      if (this._optionsOpen) return;

      this._optionsOpen = true;

      this._dialog.openWidgetOptions({
        title: 'Widget Options',
        config: cloneDeep(this.runtime.options()),
        confirmBtnText: 'Save',
        cancelBtnText: 'Cancel'
      }).afterClosed().subscribe(result => {
        this._optionsOpen = false;
        if (result) {
          this.runtime.setRuntimeConfig(result);
        }
      });
    }
  }

  /** Single tap in edit mode opens the group action menu at the tap point. */
  public onSingleTap(e: Event | CustomEvent): void {
    (e as Event).stopPropagation();
    if (this.dashboard.isDashboardStatic()) return;
    const detail = (e as CustomEvent).detail as { center?: { x: number; y: number } } | undefined;
    this._actionMenu().open(detail?.center?.x ?? 0, detail?.center?.y ?? 0);
  }

  protected onWidgetAction(action: string): void {
    switch (action) {
      case 'settings':
        this.openWidgetOptions(new Event('widget-settings'));
        break;
      case 'duplicate':
        this.dashboard.duplicateWidget(this.widgetProperties.uuid);
        break;
      case 'copy':
        this.dashboard.copyWidget(this.widgetProperties.uuid);
        break;
      case 'cut':
        this.dashboard.cutWidget(this.widgetProperties.uuid);
        break;
      case 'delete':
        this.dashboard.deleteWidget(this.widgetProperties.uuid);
        break;
      default:
        break;
    }
  }
}
