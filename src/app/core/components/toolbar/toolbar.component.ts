import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatBadgeModule } from '@angular/material/badge';
import { toSignal } from '@angular/core/rxjs-interop';
import { ChromeVisibilityService } from '../../services/chrome-visibility.service';
import { DashboardService } from '../../services/dashboard.service';
import { uiEventService } from '../../services/uiEvent.service';
import { AppService } from '../../services/app-service';
import { SettingsService } from '../../services/settings.service';
import { DialogService } from '../../services/dialog.service';
import { NotificationsService } from '../../services/notifications.service';
import { PageNavControlComponent } from '../page-nav-control/page-nav-control.component';

/**
 * The auto-hiding navigation toolbar. Overlays the top of the app (never
 * reflows the grid), is shown/hidden via {@link ChromeVisibilityService}, and
 * hosts the global controls migrated off the old sidenavs plus the page-icon
 * navigator. Hovering the bar suppresses auto-hide so it never disappears
 * mid-interaction; the transient peek strip re-reveals it on click.
 */
@Component({
  selector: 'app-toolbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MatBadgeModule, PageNavControlComponent],
  templateUrl: './toolbar.component.html',
  styleUrl: './toolbar.component.scss',
})
export class ToolbarComponent implements OnDestroy {
  protected readonly chrome = inject(ChromeVisibilityService);
  private readonly dashboard = inject(DashboardService);
  protected readonly uiEvent = inject(uiEventService);
  private readonly app = inject(AppService);
  private readonly settings = inject(SettingsService);
  private readonly dialog = inject(DialogService);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationsService);

  protected readonly isNightMode = this.app.isNightMode;
  protected readonly autoNightMode = this.settings.autoNightMode;
  protected readonly fullscreenSupported = this.uiEvent.fullscreenSupported;
  protected readonly fullscreenStatus = this.uiEvent.fullscreenStatus;

  private readonly notificationsInfo = toSignal(this.notifications.observerNotificationsInfo());
  protected readonly alarmCount = computed(() => this.notificationsInfo()?.alarmCount ?? 0);

  protected toggleFullScreen(): void {
    this.uiEvent.toggleFullScreen();
  }

  protected toggleNightMode(): void {
    this.app.toggleNightMode();
  }

  protected openSettings(): void {
    this.router.navigate(['/settings']);
  }

  protected enterEdit(): void {
    this.dashboard.setStaticDashboard(false);
  }

  protected openNotifications(): void {
    this.dialog.openNotifications();
  }

  protected reveal(): void {
    this.chrome.reveal();
  }

  protected onPointerEnter(): void {
    if (this._hideSuppressed) return;
    this._hideSuppressed = true;
    this.chrome.suppressHide();
  }

  protected onPointerLeave(): void {
    if (!this._hideSuppressed) return;
    this._hideSuppressed = false;
    this.chrome.allowHide();
  }

  // Releasing on destroy matters: routing away from the toolbar (e.g. tapping
  // Settings) unmounts it mid-hover, so `mouseleave` never fires. Without this
  // the ref-count on the singleton service would leak and pin the toolbar open.
  ngOnDestroy(): void {
    this.onPointerLeave();
  }

  private _hideSuppressed = false;
}
