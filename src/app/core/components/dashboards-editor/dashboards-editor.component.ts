import { ChangeDetectionStrategy, Component, computed, inject, input, viewChild } from '@angular/core';
import { GestureDirective } from '../../directives/gesture.directive';
import { Dashboard, DashboardService } from '../../services/dashboard.service';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { DialogService } from '../../services/dialog.service';
import { CdkDropList, CdkDrag, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { uiEventService } from '../../services/uiEvent.service';
import { MatRippleModule } from '@angular/material/core';
import { ActionMenuComponent } from '../action-menu/action-menu.component';
import { ActionMenuItem } from '../action-menu/action-menu-item';


@Component({
  selector: 'dashboards-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, CdkDropList, CdkDrag, MatRippleModule, GestureDirective, ActionMenuComponent],
  templateUrl: './dashboards-editor.component.html',
  styleUrl: './dashboards-editor.component.scss',
  host: { '[class.compact]': 'compact()' }
})
export class DashboardsEditorComponent {
  protected _dashboard = inject(DashboardService);
  private _uiEvent = inject(uiEventService);
  private _dialog = inject(DialogService);

  /** Compact single-row layout for the page-manager bottom sheet; full tiled grid otherwise. */
  public readonly compact = input<boolean>(false);
  protected readonly iconSizePx = computed(() => this.compact() ? 40 : 72);

  private readonly _actionMenu = viewChild.required(ActionMenuComponent);
  /** The tile whose action menu is currently open. */
  private _menuIndex = -1;

  protected readonly pageActions: ActionMenuItem[] = [
    { id: 'edit', label: 'Edit', icon: 'edit' },
    { id: 'duplicate', label: 'Duplicate', icon: 'content_copy' },
    { id: 'delete', label: 'Delete', icon: 'delete_forever' }
  ];

  protected addDashboard(): void {
    this._dialog.openDashboardPageEditorDialog({
      title: 'New Page',
      name: `Page ${this._dashboard.dashboards().length + 1}`,
      icon: 'dashboard-dashboard',
      confirmBtnText: 'Create',
      cancelBtnText: 'Cancel'
    }).afterClosed().subscribe(data => {
      if (!data) { return } //clicked cancel
      this._dashboard.add(data.name, [], data.icon);
    });
  }

  /**
   * A single tap on a page tile opens its action menu at the tap point. Tap vs.
   * drag is arbitrated by the gesture directive's movement threshold — a reorder
   * moves past the tap slop and emits no tap, so it never reaches here. (Gating
   * on the shared isDragging signal instead would swallow a legitimate tap whose
   * minor travel already tripped cdkDrag's lower start threshold.)
   */
  protected onTileTap(index: number, e: Event | CustomEvent): void {
    const center = (e as CustomEvent).detail?.center as { x: number; y: number } | undefined;
    this.openMenu(index, center?.x ?? 0, center?.y ?? 0);
  }

  /** Keyboard equivalent: open the action menu centered on the focused tile. */
  protected onTileKey(index: number, e: Event): void {
    e.preventDefault();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    this.openMenu(index, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  private openMenu(index: number, x: number, y: number): void {
    this._menuIndex = index;
    this._actionMenu().open(x, y);
  }

  protected onPageAction(id: string): void {
    const index = this._menuIndex;
    if (index < 0 || index >= this._dashboard.dashboards().length) return;
    switch (id) {
      case 'edit':
        this.editDashboard(index);
        break;
      case 'duplicate':
        this.duplicateDashboard(index, this._dashboard.dashboards()[index].name);
        break;
      case 'delete':
        this.confirmDelete(index);
        break;
      default:
        break;
    }
  }

  private editDashboard(itemIndex: number): void {
    const dashboard = this._dashboard.dashboards()[itemIndex];
    this._dialog.openDashboardPageEditorDialog({
      title: 'Page Options',
      name: dashboard.name ?? '',
      icon: dashboard.icon || 'dashboard-dashboard',
      confirmBtnText: 'Save',
      cancelBtnText: 'Cancel'
    }).afterClosed().subscribe(data => {
      if (!data) { return } //clicked cancel
      this._dashboard.update(itemIndex, data.name, data.icon);
    });
  }

  private duplicateDashboard(itemIndex: number, currentName: string | undefined): void {
    const originalDashboard = this._dashboard.dashboards()[itemIndex];
    this._dialog.openDashboardPageEditorDialog({
      title: 'Duplicate Page',
      name: `${currentName} copy`,
      icon: originalDashboard.icon || 'dashboard-dashboard',
      confirmBtnText: 'Save',
      cancelBtnText: 'Cancel'
    }).afterClosed().subscribe(data => {
      if (!data) { return } //clicked cancel
      this._dashboard.duplicate(itemIndex, data.name, data.icon);
    });
  }

  private confirmDelete(itemIndex: number): void {
    const name = this._dashboard.dashboards()[itemIndex].name;
    this._dialog.openConfirmationDialog({
      title: 'Delete Page',
      message: `Delete the "${name}" page and all its widgets?`,
      confirmBtnText: 'Delete',
      cancelBtnText: 'Cancel'
    }).subscribe(confirmed => {
      if (confirmed) this._dashboard.delete(itemIndex);
    });
  }

  protected drop(event: CdkDragDrop<Dashboard[]>): void {
    this._dashboard.dashboards.update(dashboards => {
      const updatedDashboards = [...dashboards];
      moveItemInArray(updatedDashboards, event.previousIndex, event.currentIndex);

      // Update active dashboard index if it was affected by the move
      const currentActive = this._dashboard.activeDashboard();
      if (currentActive === event.previousIndex) {
        // Active item was moved to new position
        this._dashboard.activeDashboard.set(event.currentIndex);
      } else if (currentActive !== null && currentActive > event.previousIndex && currentActive <= event.currentIndex) {
        // Active item shifted down due to move
        this._dashboard.activeDashboard.set(currentActive - 1);
      } else if (currentActive !== null && currentActive < event.previousIndex && currentActive >= event.currentIndex) {
        // Active item shifted up due to move
        this._dashboard.activeDashboard.set(currentActive + 1);
      }
      return updatedDashboards;
    });
  }

  protected dragStart(): void {
    this._uiEvent.isDragging.set(true);
  }

  protected dragEnd(): void {
    this._uiEvent.isDragging.set(false);
  }
}
