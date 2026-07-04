import { ChangeDetectionStrategy, Component, OnDestroy, inject, AfterViewInit, effect, Signal, DestroyRef, signal, viewChild, ElementRef } from '@angular/core';
import { Router, NavigationEnd, RouterModule } from '@angular/router';
import { filter } from 'rxjs/operators';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { OverlayModule } from '@angular/cdk/overlay';
import { BreakpointObserver, Breakpoints, BreakpointState } from '@angular/cdk/layout';
import { Title } from '@angular/platform-browser';
import { AuthenticationService } from './core/services/authentication.service';
import { SettingsService } from './core/services/settings.service';
import { SignalKDeltaService } from './core/services/signalk-delta.service';
import { ConnectionStateMachine, IConnectionStatus } from './core/services/connection-state-machine.service';
import { GestureDirective } from './core/directives/gesture.directive';
import { ChromeIntent, PageNavDirection, ScrollNavDirective } from './core/directives/scroll-nav.directive';
import { ToolbarComponent } from './core/components/toolbar/toolbar.component';
import { DashboardService } from './core/services/dashboard.service';
import { uiEventService } from './core/services/uiEvent.service';
import { ChromeVisibilityService } from './core/services/chrome-visibility.service';
import { NotificationsService } from './core/services/notifications.service';
import { ConfigurationUpgradeService } from './core/services/configuration-upgrade.service';
import { RemoteDashboardsService } from './core/services/remote-dashboards.service';
import { ToastService } from './core/services/toast.service';
import { AppNetworkInitService, IBootstrapIssue } from './core/services/app-initNetwork.service';
import { SsoRedirectService } from './core/services/sso-redirect.service';
import { DashboardHistorySeriesSyncService } from './core/services/dashboard-history-series-sync.service';
import { NotificationOverlayService } from './core/services/notification-overlay.service';
import { DialogService } from './core/services/dialog.service';
import { resolveBrowserTabTitle } from './core/utils/browser-tab-title.util';

const MOUSE_PEEK_THROTTLE_MS = 250;

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  imports: [RouterModule, MatIconModule, MatProgressSpinnerModule, OverlayModule, GestureDirective, ScrollNavDirective, ToolbarComponent]
})
export class AppComponent implements AfterViewInit, OnDestroy {
  // Services pre-initialized via APP_INITIALIZER; injected here for their lifecycle.
  private readonly _deltaService = inject(SignalKDeltaService);
  private readonly _connectionStateMachine = inject(ConnectionStateMachine);
  private readonly _appNetworkInit = inject(AppNetworkInitService);
  private readonly _ssoRedirect = inject(SsoRedirectService);
  private readonly _historySeriesReconcile = inject(DashboardHistorySeriesSyncService);
  public readonly authenticationService = inject(AuthenticationService);

  private readonly _dashboard = inject(DashboardService);
  private readonly _remoteControl = inject(RemoteDashboardsService);
  private readonly toast = inject(ToastService);
  private readonly _notifications = inject(NotificationsService);
  private readonly _uiEvent = inject(uiEventService);
  protected readonly chrome = inject(ChromeVisibilityService);
  private readonly _dialog = inject(DialogService);
  public readonly settings = inject(SettingsService);
  private readonly _titleService = inject(Title);
  private readonly _browserTabTitle = this.settings.browserTabTitle;
  private readonly _responsive = inject(BreakpointObserver);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _notificationOverlay = inject(NotificationOverlayService);
  private readonly _router = inject(Router);
  protected readonly upgrade = inject(ConfigurationUpgradeService); // expose for template overlay

  private upgradeMessagesRef = viewChild<ElementRef<HTMLUListElement> | undefined>('upgradeMessages');
  private _upgradeShown = false;

  // Exposed for the shell template.
  protected readonly dashboardStatic = this._dashboard.isDashboardStatic;
  protected readonly isDragging = this._uiEvent.isDragging;

  protected readonly notificationsInfo = toSignal(this._notifications.observerNotificationsInfo());
  protected readonly bootstrapStatus = toSignal(this._appNetworkInit.bootstrapStatus$, { initialValue: 'starting' });
  protected readonly bootstrapIssue: Signal<IBootstrapIssue> = toSignal(this._appNetworkInit.bootstrapIssue$, { initialValue: { reason: 'none' } as IBootstrapIssue });
  protected dashboardVisible = signal<boolean>(false);
  protected isPhonePortrait: Signal<BreakpointState>;
  private missingConfigPromptShown = false;
  private authBlockedPromptShown = false;

  private readonly _hotkeyHandler = (key: string) => this.handleKeyDown(key);
  private _lastPeekAt = Number.NEGATIVE_INFINITY;

  constructor() {
    // Keep the browser tab title (document.title) in sync with the user setting (#1055).
    effect(() => {
      this._titleService.setTitle(resolveBrowserTabTitle(this._browserTabTitle()));
    });

    effect(() => {
      if (this.settings.configUpgrade()) {
        const liveVersion = this.settings.getConfigVersion();

        if (liveVersion === 11 || liveVersion === 12) {
          this.upgrade.runUpgrade(liveVersion);
        }

        if (!liveVersion) {
          if (!this._upgradeShown) {
            this._upgradeShown = true;
            this._dialog.openFrameDialog({
              title: 'Upgrade Instructions',
              component: 'upgrade-config',
            }, true)
              .pipe(takeUntilDestroyed(this._destroyRef))
              .subscribe();
          }
        }
      }
    });

    effect(() => {
      const msg = this.upgrade.messages();
      if (this.upgrade.upgrading() && msg.length && this.upgradeMessagesRef()) {
        const ul = this.upgradeMessagesRef().nativeElement;
        ul.scrollTop = ul.scrollHeight;
      }
    });

    // initialize dashboardVisible from current URL
    try {
      this.dashboardVisible.set(this.isUrlDashboard(this._router.url));
    } catch { /* ignore */ }

    // update dashboardVisible on navigation (auto-unsubscribes via DestroyRef)
    this._router.events
      .pipe(filter(e => e instanceof NavigationEnd), takeUntilDestroyed(this._destroyRef))
      .subscribe((e: NavigationEnd) => {
        try {
          this.dashboardVisible.set(this.isUrlDashboard((e as NavigationEnd).urlAfterRedirects || (e as NavigationEnd).url));
        } catch { /* ignore */ }
      });

    // Persistent alarm badge: shown whenever an alarm is active on a locked
    // dashboard, independent of the (removed) sidenav and the auto-hiding
    // toolbar. This is the one piece of always-visible chrome, for safety.
    effect(() => {
      const shouldShowBadge = this.dashboardVisible() && this._dashboard.isDashboardStatic() && (this.notificationsInfo()?.alarmCount ?? 0) > 0;
      try {
        if (shouldShowBadge) this._notificationOverlay.open();
        else this._notificationOverlay.close();
      } catch { /* ignore */ }
    });

    this.isPhonePortrait = toSignal(this._responsive.observe(Breakpoints.HandsetPortrait));

    this._connectionStateMachine.status$
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((status: IConnectionStatus) => this.displayConnectionsStatusNotification(status));

    effect(() => {
      const issue = this.bootstrapIssue();
      if (issue.reason !== 'missing-shared-config' || this.missingConfigPromptShown) {
        return;
      }

      this.missingConfigPromptShown = true;
      const cfgName = issue.sharedConfigName || 'default';
      const ref = this.toast.show(
        `Server is reachable, but no shared configuration '${cfgName}' exists for this user. Create a default configuration now?`,
        0,
        true,
        'warn',
        'Create'
      );

      ref.onAction()
        .pipe(takeUntilDestroyed(this._destroyRef))
        .subscribe(() => this.settings.resetSettings());
    });

    // Cookie-mode auth blocked (SSO auto-login looped out of budget, or sign-in required): offer an
    // explicit Sign in that resets the budget and disables auto-login so it is not auto-bounced.
    effect(() => {
      const issue = this.bootstrapIssue();
      if (issue.reason !== 'auth-blocked' || this.authBlockedPromptShown) {
        return;
      }
      this.authBlockedPromptShown = true;
      const message = issue.cause === 'budget-exhausted'
        ? 'Automatic sign-in did not complete. Sign in to Signal K to continue.'
        : 'Sign in to Signal K to access your configuration.';
      const ref = this.toast.show(message, 0, true, 'warn', 'Sign in');
      ref.onAction()
        .pipe(takeUntilDestroyed(this._destroyRef))
        .subscribe(() => this._ssoRedirect.manualSignIn());
    });
  }

  private isUrlDashboard(url: string | null | undefined): boolean {
    if (!url) return false;
    const path = url.split('?')[0].replace(/\/+$/, '');
    return (
      path === '/' ||
      /^\/dashboard(\/\d+)?$/.test(path)
    );
  }

  ngAfterViewInit(): void {
    this._uiEvent.addHotkeyListener(
      this._hotkeyHandler,
      { ctrlKey: true, keys: ['arrowright', 'arrowleft'] }
    );
  }

  private handleKeyDown(key: string): void {
    switch (key) {
      case 'arrowright':
        this.pageNav('next');
        break;
      case 'arrowleft':
        this.pageNav('prev');
        break;
    }
  }

  /** Navigate pages, honoring locked mode and suppressing during a drag. */
  protected pageNav(direction: PageNavDirection): void {
    if (!this.dashboardVisible() || !this._dashboard.isDashboardStatic() || this._uiEvent.isDragging()) return;
    if (direction === 'next') this._dashboard.navigateToNextDashboard();
    else this._dashboard.navigateToPreviousDashboard();
  }

  protected onChromeIntent(intent: ChromeIntent): void {
    if (intent === 'reveal') this.chrome.reveal();
    else this.chrome.hide();
  }

  /** Throttled edge-peek cue on pointer activity. */
  protected onMouseActivity(): void {
    const now = performance.now();
    if (now - this._lastPeekAt < MOUSE_PEEK_THROTTLE_MS) return;
    this._lastPeekAt = now;
    this.chrome.pulsePeek();
  }

  private displayConnectionsStatusNotification(connectionStatus: IConnectionStatus) {
    const message = connectionStatus.message;
    const silentDuringBootstrap = this.bootstrapStatus() !== 'ready';
    switch (connectionStatus.operation) {
      case 0:
        this.toast.show(message, 5000, true);
        break;
      case 1:
      case 2:
        break;
      case 3:
        this.toast.show(message, 3000, silentDuringBootstrap, 'warn');
        break;
      case 4:
        this.toast.show(message, 3000, true, 'info');
        break;
      case 5:
        this.toast.show(message, 0, silentDuringBootstrap);
        break;
      default:
        console.error('[AppComponent] Unknown operation code:', connectionStatus.operation);
        this.toast.show(`Unknown connection status: ${connectionStatus.state}`, 0, silentDuringBootstrap, 'error');
    }
  }

  ngOnDestroy() {
    this._uiEvent.removeHotkeyListener(this._hotkeyHandler);
  }
}
