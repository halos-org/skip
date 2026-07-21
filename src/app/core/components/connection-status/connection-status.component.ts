import { ElementRef, Component, OnDestroy, AfterViewInit, viewChild, inject, DestroyRef, computed, ChangeDetectionStrategy } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { AppService } from '../../services/app-service';
import { SignalKConnectionService } from '../../services/signalk-connection.service';
import { IDeltaUpdate, DataService } from '../../services/data.service';
import { SignalKDeltaService } from '../../services/signalk-delta.service';
import { AuthenticationService } from '../../services/authentication.service';
import { SsoRedirectService } from '../../services/sso-redirect.service';
import { MatButton } from '@angular/material/button';
import { Chart } from 'chart.js';
import 'chartjs-adapter-date-fns';
import { CanvasService } from '../../services/canvas.service';
import { InternetReachabilityService } from '../../services/internet-reachability.service';
import { registerChartComponents } from '../../utils/chart-registration.util';

registerChartComponents();

/**
 * Connection status and diagnostics: server session identity (SSO), server/stream state, versions,
 * internet reachability, and a live delta-throughput chart. Read-only — the connection itself is
 * auto-configured (same-origin, server-discovered endpoints), so there is nothing to edit here.
 * Skip authenticates only through the server's same-origin session (SSO); it has no credential
 * entry of its own.
 */
@Component({
  selector: 'connection-status',
  templateUrl: './connection-status.component.html',
  styleUrls: ['./connection-status.component.scss'],
  imports: [
    MatButton
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class ConnectionStatusComponent implements AfterViewInit, OnDestroy {
  protected readonly app = inject(AppService);
  private readonly DataService = inject(DataService);
  private readonly signalKConnectionService = inject(SignalKConnectionService);
  private readonly deltaService = inject(SignalKDeltaService);
  private readonly internetReachability = inject(InternetReachabilityService);
  protected readonly auth = inject(AuthenticationService);
  private readonly ssoRedirect = inject(SsoRedirectService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly canvasService = inject(CanvasService);

  protected readonly activityGraph = viewChild<ElementRef<HTMLCanvasElement>>('activityGraph');

  // The server session identity (SSO). These drive the identity block.
  protected readonly loginStatus = toSignal(this.auth.loginStatus$, { initialValue: null });
  protected readonly isUserSession = toSignal(this.auth.isUserSession$, { initialValue: false });
  protected readonly canWriteUserData = toSignal(this.auth.canWriteUserData$, { initialValue: false });

  protected signIn(): void {
    this.ssoRedirect.manualSignIn();
  }

  // Both streams are BehaviorSubjects that replay their current value synchronously, so requireSync
  // guarantees the view always has a status to render on first read. Both services re-emit the same
  // mutated status object on each update, so equal:()=>false is required — the default Object.is
  // equality would treat a same-reference re-emit as unchanged and drop the update under OnPush.
  protected readonly endpointServiceStatus = toSignal(
    this.signalKConnectionService.getServiceEndpointStatusAsO(), { requireSync: true, equal: () => false });
  protected readonly streamStatus = toSignal(
    this.deltaService.getDataStreamStatusAsO(), { requireSync: true, equal: () => false });

  protected readonly internetAvailabilityLabel = computed(() => {
    if (this.internetReachability.isChecking()) {
      return 'Checking...';
    }

    if (this.internetReachability.internetAvailable()) {
      return 'Available';
    }

    if (this.internetReachability.isReachable() === false) {
      return 'Unavailable';
    }

    return 'Unknown';
  });

  private _chart: Chart | null = null;
  private textColor: string; // Store the computed text color for chart styling

  ngAfterViewInit(): void {
    const canvas = this.activityGraph()?.nativeElement;
    if (!canvas) return;
    this.textColor = window.getComputedStyle(canvas).color;
    this._chart?.destroy();
    this.startChart(canvas);

    // Get real-time WebSocket Delta update statistics for chart
    this.DataService.getSignalkDeltaUpdateStatistics().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((update: IDeltaUpdate) => {
      const chart = this._chart;
      if (!chart) return;
      chart.data.datasets[0].data.push({ x: update.timestamp, y: update.value });
      if (chart.data.datasets[0].data.length > 10) {
        chart.data.datasets[0].data.shift();
      }
      chart.update("none");
    });
  }

  /**
   * Initializes the Chart.js line chart for displaying WebSocket delta statistics.
   * Creates a time-series chart showing data update frequency over time.
   */
  private startChart(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    this._chart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [
          {
            data: [],
            fill: true,
            borderColor: this.textColor
          },
        ]
      },
      options: {
        maintainAspectRatio: false,
        animation: false,
        parsing: false,
        scales: {
          x: {
            type: "time",
            display: true,
            time: {
              unit: "minute",
              minUnit: "second",
              round: "second",
              displayFormats: {
                // eslint-disable-next-line no-useless-escape
                hour: `k:mm\''`,
                // eslint-disable-next-line no-useless-escape
                minute: `mm\''`,
                second: `mm ss"`,
                millisecond: "SSS"
              }
            },
            position: 'bottom',
            ticks: {
              display: false,
            },
            grid: {
              display: true
            }
          },
          y: {
            beginAtZero: true,
            type: 'linear',
            position: 'right',
            title: {
              text: "Delta / Sec",
              display: true
            }
          }
        },
        plugins: {
          legend: {
            display: false,
            labels: {
              color: this.textColor,
            }
          }
        }
      }
    });
  }

  ngOnDestroy() {
    this._chart?.destroy();
    const canvas = this.activityGraph?.()?.nativeElement as HTMLCanvasElement | undefined;
    this.canvasService.releaseCanvas(canvas, { clear: true, removeFromDom: true });
  }
}
