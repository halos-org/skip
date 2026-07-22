import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatBadgeModule } from '@angular/material/badge';
import { MatMenuModule } from '@angular/material/menu';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { toSignal } from '@angular/core/rxjs-interop';
import { ChromeVisibilityService, CHROME_HOVER_DWELL_MS } from '../../services/chrome-visibility.service';
import { DashboardService } from '../../services/dashboard.service';
import { uiEventService } from '../../services/uiEvent.service';
import { AppService } from '../../services/app-service';
import { SettingsService } from '../../services/settings.service';
import { DialogService } from '../../services/dialog.service';
import { NotificationsService } from '../../services/notifications.service';
import { PageNavControlComponent } from '../page-nav-control/page-nav-control.component';
import { PageManagerBottomSheetComponent } from '../page-manager-bottom-sheet/page-manager-bottom-sheet.component';

/** Top-edge band (px) whose cursor dwell exposes the toolbar; matches `--peek-height` in the SCSS. */
const PEEK_HOTZONE_PX = 8;

/**
 * The auto-hiding navigation toolbar. Overlays the top of the app (never
 * reflows the grid), is shown/hidden via {@link ChromeVisibilityService}, and
 * hosts the global controls migrated off the old sidenavs plus the page-icon
 * navigator. Hovering the bar suppresses auto-hide so it never disappears
 * mid-interaction. It is re-exposed either by clicking the transient peek strip
 * (also the keyboard/touch path) or, on a hover-capable pointer, by dwelling the
 * cursor in the top peek band; both routes call the same {@link reveal}, so the
 * existing idle-hide re-arms cleanly when the cursor leaves.
 */
@Component({
  selector: 'app-toolbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MatBadgeModule, MatMenuModule, PageNavControlComponent],
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
  private readonly bottomSheet = inject(MatBottomSheet);

  protected readonly isNightMode = this.app.isNightMode;
  protected readonly autoNightMode = this.settings.autoNightMode;
  protected readonly fullscreenSupported = this.uiEvent.fullscreenSupported;
  protected readonly fullscreenStatus = this.uiEvent.fullscreenStatus;
  protected readonly appVersion = this.app.appVersion;
  /** Serving host shown in the app-menu footer; the app is served same-origin by the SK server.
   *  hostname (not host) so the constant Traefik port is left off. */
  protected readonly host = window.location.hostname;

  /** While a layout edit is active the toolbar swaps its normal nav controls for edit contents. */
  protected readonly isEditing = computed(() => !this.dashboard.isDashboardStatic());

  private readonly notificationsInfo = toSignal(this.notifications.observerNotificationsInfo());
  protected readonly alarmCount = computed(() => this.notificationsInfo()?.alarmCount ?? 0);

  private dwellTimer: ReturnType<typeof setTimeout> | null = null;
  private inPeekZone = false;

  /** Reveals the toolbar once the cursor dwells in the top peek band, on a hover-capable pointer. */
  private readonly onDocumentPointerMove = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') return; // touch has no hover; the tap-the-peek-strip path stays
    const inZone = event.clientY <= PEEK_HOTZONE_PX;
    if (inZone && !this.inPeekZone && !this.chrome.revealed()) {
      this.armHoverDwell();
    } else if (!inZone && this.inPeekZone) {
      this.clearHoverDwell();
    }
    this.inPeekZone = inZone;
  };

  constructor() {
    // Passive so it never blocks scrolling; a document listener sees moves over the peek band even
    // though the strip is pointer-events:none until it peeks. Hover-reveal is gated per-event on a
    // hover-capable pointer, leaving the tap-the-peek-strip path for touch.
    document.addEventListener('pointermove', this.onDocumentPointerMove, { passive: true });
  }

  private armHoverDwell(): void {
    this.clearHoverDwell();
    this.dwellTimer = setTimeout(() => {
      this.dwellTimer = null;
      this.reveal();
    }, CHROME_HOVER_DWELL_MS);
  }

  private clearHoverDwell(): void {
    if (this.dwellTimer !== null) {
      clearTimeout(this.dwellTimer);
      this.dwellTimer = null;
    }
  }

  protected toggleFullScreen(): void {
    this.uiEvent.toggleFullScreen();
  }

  protected toggleNightMode(): void {
    this.app.toggleNightMode();
  }

  protected openSettings(): void {
    this.router.navigate(['/settings']);
  }

  protected openConnection(): void {
    this.router.navigate(['/connection']);
  }

  protected openRemote(): void {
    this.router.navigate(['/remote']);
  }

  protected openHelp(): void {
    this.router.navigate(['/help']);
  }

  protected enterEdit(): void {
    this.dashboard.setStaticDashboard(false);
  }

  /** Commit the current page's layout edit; the mounted dashboard serialises and saves the grid. */
  protected doneEdit(): void {
    this.dashboard.requestLayoutEditSave();
  }

  /** Discard the current page's layout edit; the mounted dashboard reloads the persisted config. */
  protected cancelEdit(): void {
    this.dashboard.requestLayoutEditCancel();
  }

  /** Open the page-manager sheet (add / reorder / rename / duplicate / delete pages). */
  protected openPageManager(): void {
    // A sheet page op (e.g. deleting a lower page) can reassign the active page without
    // navigating, leaving the URL on a now-stale index; re-sync the route on dismiss so the
    // page dots stay tappable.
    this.bottomSheet
      .open(PageManagerBottomSheetComponent)
      .afterDismissed()
      .subscribe(() => this.dashboard.navigateToActive());
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
    document.removeEventListener('pointermove', this.onDocumentPointerMove);
    this.clearHoverDwell();
  }

  private _hideSuppressed = false;
}
