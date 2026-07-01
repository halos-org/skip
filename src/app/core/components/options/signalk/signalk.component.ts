import { ElementRef, Component, OnInit, OnDestroy, AfterViewInit, viewChild, inject, DestroyRef, computed } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { AppService } from '../../../services/app-service';
import { ToastService } from '../../../services/toast.service';
import { SettingsService } from '../../../services/settings.service';
import { IConnectionConfig } from "../../../interfaces/app-settings.interfaces";
import { SignalKConnectionService, IEndpointStatus } from '../../../services/signalk-connection.service';
import { IDeltaUpdate, DataService } from '../../../services/data.service';
import { SignalKDeltaService, IStreamStatus } from '../../../services/signalk-delta.service';
import { AuthenticationService } from '../../../services/authentication.service';
import { SsoRedirectService } from '../../../services/sso-redirect.service';
import { ConnectionStateMachine } from '../../../services/connection-state-machine.service';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatButton } from '@angular/material/button';
import { MatInput } from '@angular/material/input';
import { MatFormField, MatLabel, MatError } from '@angular/material/form-field';
import { FormsModule } from '@angular/forms';
import Chart from 'chart.js/auto';
import 'chartjs-adapter-date-fns';
import { CanvasService } from '../../../services/canvas.service';
import { InternetReachabilityService } from '../../../services/internet-reachability.service';



/**
 * Signal K settings component for managing server connection configuration.
 * Handles URL validation, connection establishment, and real-time monitoring
 * of connection status and data stream statistics. SKip authenticates only through
 * the server's same-origin session (SSO); it has no credential entry of its own.
 */
@Component({
  selector: 'settings-signalk',
  templateUrl: './signalk.component.html',
  styleUrls: ['./signalk.component.scss'],
  imports: [
    FormsModule,
    MatFormField,
    MatLabel,
    MatInput,
    MatError,
    MatCheckbox,
    MatButton
  ]
})

export class SettingsSignalkComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly settings = inject(SettingsService);
  protected readonly app = inject(AppService);
  protected readonly toast = inject(ToastService);
  private readonly DataService = inject(DataService);
  private readonly signalKConnectionService = inject(SignalKConnectionService);
  private readonly deltaService = inject(SignalKDeltaService);
  private readonly connectionStateMachine = inject(ConnectionStateMachine);
  private readonly internetReachability = inject(InternetReachabilityService);
  protected readonly auth = inject(AuthenticationService);
  private readonly ssoRedirect = inject(SsoRedirectService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly canvasService = inject(CanvasService);


  protected readonly activityGraph = viewChild<ElementRef<HTMLCanvasElement>>('activityGraph');

  public connectionConfig: IConnectionConfig;
  public isConnecting = false; // Loading state for connect button

  // The Connectivity tab shows the server session identity (SSO). These drive that identity block.
  protected readonly loginStatus = toSignal(this.auth.loginStatus$, { initialValue: null });
  protected readonly isUserSession = toSignal(this.auth.isUserSession$, { initialValue: false });
  protected readonly canWriteUserData = toSignal(this.auth.canWriteUserData$, { initialValue: false });

  protected signIn(): void {
    this.ssoRedirect.manualSignIn();
  }

  public endpointServiceStatus: IEndpointStatus;
  public streamStatus: IStreamStatus;

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


  private _chart: Chart = null;
  private textColor: string; // Store the computed text color for chart styling

  ngOnInit() {
    // get Signal K connection configuration
    this.connectionConfig = this.settings.getConnectionConfig();

    // get Signal K connection status
    this.signalKConnectionService.getServiceEndpointStatusAsO().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((status: IEndpointStatus) => {
      this.endpointServiceStatus = status;
    });

    // get Delta Service WebSocket stream status
    this.deltaService.getDataStreamStatusAsO().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((status: IStreamStatus): void => {
      this.streamStatus = status;
    });
  }

  ngAfterViewInit(): void {
    this.textColor = window.getComputedStyle(this.activityGraph().nativeElement).color;
    this._chart?.destroy();
    this.startChart();

    // Get real-time WebSocket Delta update statistics for chart
    this.DataService.getSignalkDeltaUpdateStatistics().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((update: IDeltaUpdate) => {
      this._chart.data.datasets[0].data.push({ x: update.timestamp, y: update.value });
      if (this._chart.data.datasets[0].data.length > 10) {
        this._chart.data.datasets[0].data.shift();
      }
      this._chart?.update("none");
    });
  }

  /**
   * Validates the Signal K server URL and establishes connection.
   * Handles the complete connection workflow including validation,
   * configuration saving, connection cleanup, and app reload. The same-origin
   * session cookie authenticates after reload — no in-app credential step.
   */
  public async connectToServer() {
    // Start loading state
    this.isConnecting = true;

    try {
      console.log('[Settings-SignalK] Validating Signal K server before connecting...');

      // Step 1: Validate the URL before proceeding
      await this.signalKConnectionService.validateSignalKUrl(this.connectionConfig.signalKUrl);

      console.log('[Settings-SignalK] Validation successful - proceeding with connection');

      // Step 2: Persist the now-validated configuration to localStorage.
      this.settings.setConnectionConfig(this.connectionConfig);

      // Step 3: Properly close WebSocket and HTTP connections
      this.connectionStateMachine.shutdown('Configuration changed - restarting app');

      // Step 4: Reload immediately - APP_INITIALIZER will handle connection and authentication with new URL
      // Skip during unit tests to avoid breaking the test connection
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!(window as any).__KIP_TEST__) {
        location.reload();
      }

    } catch (error: unknown) {
      // Validation failed - show error and stay on current page
      this.isConnecting = false;
      const errorMessage = (error as Error)?.message || 'Unknown validation error';
      console.error('[Settings-SignalK] Server validation failed:', errorMessage);
      this.toast.show(`${errorMessage}`, 0, false, 'error');
    }
  }

  /**
   * Initializes the Chart.js line chart for displaying WebSocket delta statistics.
   * Creates a time-series chart showing data update frequency over time.
   */
  private startChart() {
    this._chart = new Chart(this.activityGraph().nativeElement.getContext('2d'), {
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
