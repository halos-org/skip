import { inject, Injectable } from '@angular/core';
import { BehaviorSubject, catchError, lastValueFrom, throwError, timeout } from 'rxjs';
import { HttpClient, HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { ISignalKUrl } from '../interfaces/app-settings.interfaces';
import { ConnectionStateMachine } from './connection-state-machine.service';

interface ISignalKEndpointResponse {
    endpoints: {
        v1: {
            version: string;
            "signalk-http"?: string;
            "signalk-ws"?: string;
            "signalk-tcp"?: string;
        };
        v2?: {
            version: string;
            "signalk-http"?: string;
            "signalk-ws"?: string;
            "signalk-tcp"?: string;
        };
    }
    server: {
        id: string;
        version: string;
    }
}

/**
 * HTTP endpoint discovery status for the Signal K server connection.
 */
export enum EndpointStatus {
  Disconnected = 'Disconnected',
  Connecting = 'Connecting',
  Connected = 'Connected',
  Error = 'Error'
}

/**
 * Signal K server HTTP endpoint discovery result: connection status plus the
 * discovered service URLs.
 */
export interface IEndpointStatus {
  state: EndpointStatus;
  message: string;
  serverDescription: string | null;
  httpServiceUrl: string | null;     // v1 API endpoint
  httpServiceUrlV2?: string;  // v2 API endpoint (if available)
  WsServiceUrl: string | null;
  WsServiceUrlV2?: string;    // v2 WebSocket endpoint (if available)
  subscribeAll?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class SignalKConnectionService {
  private readonly TIMEOUT_DURATION = 10000;
  private connectionStateMachine = inject(ConnectionStateMachine);

  constructor() {
    // Register HTTP retry callback with the ConnectionStateMachine
    this.connectionStateMachine.setHTTPRetryCallback(() => {
      console.log('[SignalKConnectionService] Executing HTTP retry via callback');
      this.retryCurrentConnection();
    });
  }

  public serverServiceEndpoint$: BehaviorSubject<IEndpointStatus> = new BehaviorSubject<IEndpointStatus>({
    state: EndpointStatus.Disconnected,
    message: "Not connected",
    serverDescription: null,
    httpServiceUrl: null,
    WsServiceUrl: null,
  });

  // Server information
  public signalKURL: ISignalKUrl;
  private serverName: string | undefined;
  public serverVersion$ = new BehaviorSubject<string | null>(null);
  private serverRoles: string[] = [];
  private http = inject(HttpClient);

  // Store current connection parameters for retries
  private currentProxyEnabled?: boolean;
  private currentSubscribeAll?: boolean;

  /**
   * Initializes the Signal K connection by establishing a new connection to the
   * Signal K server URL, retrieving the server's endpoint information, and
   * starting the HTTP discovery process.
   *
   * @param {ISignalKUrl} skUrl - The Signal K server URL object.
   * @param {boolean} [proxyEnabled] - Optional flag to enable proxy mode.
   * @param {boolean} [subscribeAll] - Optional flag to subscribe to all Delta messages.
   * @return {Promise<void>} - A promise that resolves when the operation is complete.
   * @memberof SignalKConnectionService
   */
  public async initializeConnection(skUrl: ISignalKUrl, proxyEnabled?: boolean, subscribeAll?: boolean): Promise<void> {
    if (!skUrl.url) {
      console.log("[Connection Service] Connection initialization called with null or empty URL value");
      return;
    }

    // Store parameters for potential retries
    this.currentProxyEnabled = proxyEnabled;
    this.currentSubscribeAll = subscribeAll;

    const serverServiceEndpoints: IEndpointStatus = {
      state: EndpointStatus.Connecting,
      message: "Connecting...",
      serverDescription: null,
      httpServiceUrl: null,
      WsServiceUrl: null,
    };

    this.signalKURL = skUrl;
    this.serverServiceEndpoint$.next(serverServiceEndpoints);

    // Notify ConnectionStateMachine that HTTP discovery is starting
    this.connectionStateMachine.startHTTPDiscovery(`Connecting to ${skUrl.url}`);

    let fullURL = this.signalKURL.url;
    if (!fullURL.endsWith("signalk/")) {
      fullURL += "/signalk/";
    }

    try {
      console.log("[Connection Service] Connecting to: " + this.signalKURL.url);
      const endpointResponse = await lastValueFrom(
        this.http.get<ISignalKEndpointResponse>(fullURL, {observe: 'response'}).pipe(
          timeout(this.TIMEOUT_DURATION),
          catchError(err => {
            if (err.name === 'TimeoutError') {
              console.error('[Connection Service] Connection request timed out after ' + this.TIMEOUT_DURATION + 'ms');
            }
            return throwError(err);
          })
        )
      );

      // Process the endpoint response to configure URLs
      Object.assign(serverServiceEndpoints, this.processEndpointResponse(endpointResponse, proxyEnabled, subscribeAll));

      // Notify ConnectionStateMachine of HTTP success
      this.connectionStateMachine.onHTTPDiscoverySuccess();

    } catch (error) {
      serverServiceEndpoints.state = EndpointStatus.Error;
      serverServiceEndpoints.message = error.message;

      // Notify ConnectionStateMachine of HTTP failure
      this.connectionStateMachine.onHTTPDiscoveryError(error.message);

      this.handleError(error);
    } finally {
      serverServiceEndpoints.subscribeAll = !!subscribeAll;
      this.serverServiceEndpoint$.next(serverServiceEndpoints);
    }
  }

  /**
   * Retry the current connection using stored parameters
   */
  private retryCurrentConnection(): void {
    if (!this.signalKURL?.url) {
      console.error('[SignalKConnectionService] Cannot retry - no current URL stored');
      return;
    }

    console.log(`[SignalKConnectionService] Retrying connection to ${this.signalKURL.url}`);
    // Perform only the HTTP request part without affecting retry count
    this.performHTTPDiscovery();
  }

  /**
   * Perform the actual HTTP discovery without affecting ConnectionStateMachine state
   */
  private async performHTTPDiscovery(): Promise<void> {
    if (!this.signalKURL?.url) {
      console.error('[SignalKConnectionService] No URL available for HTTP discovery');
      return;
    }

    let fullURL = this.signalKURL.url;
    if (!fullURL.endsWith("signalk/")) {
      fullURL += "/signalk/";
    }

    try {
      console.log("[Connection Service] Connecting to: " + this.signalKURL.url);
      const endpointResponse = await lastValueFrom(
        this.http.get<ISignalKEndpointResponse>(fullURL, {observe: 'response'}).pipe(
          timeout(this.TIMEOUT_DURATION),
          catchError(err => {
            if (err.name === 'TimeoutError') {
              console.error('[Connection Service] Connection request timed out after ' + this.TIMEOUT_DURATION + 'ms');
            }
            return throwError(err);
          })
        )
      );

      // Process the endpoint response to configure URLs
      const serverServiceEndpoints = this.processEndpointResponse(endpointResponse, this.currentProxyEnabled, this.currentSubscribeAll);

      // Notify ConnectionStateMachine of success
      this.connectionStateMachine.onHTTPDiscoverySuccess();

      this.serverServiceEndpoint$.next(serverServiceEndpoints);

    } catch (error) {
      const serverServiceEndpoints: IEndpointStatus = {
        state: EndpointStatus.Error,
        message: error.message,
        serverDescription: null,
        httpServiceUrl: null,
        WsServiceUrl: null,
      };

      // Notify ConnectionStateMachine of failure
      this.connectionStateMachine.onHTTPDiscoveryError(error.message);

      this.serverServiceEndpoint$.next(serverServiceEndpoints);
      this.handleError(error);
    }
  }

  /**
   * Process Signal K endpoint response and configure HTTP/WebSocket URLs
   * @param endpointResponse - The HTTP response containing endpoint information
   * @param proxyEnabled - Whether proxy mode is enabled
   * @param subscribeAll - Whether to subscribe to all messages
   * @returns Configured endpoint status object
   */
  private processEndpointResponse(
    endpointResponse: HttpResponse<ISignalKEndpointResponse>,
    proxyEnabled?: boolean,
    subscribeAll?: boolean
  ): IEndpointStatus {
    if (!endpointResponse.body) {
      throw new Error("Signal K server response did not include a body");
    }
    console.debug("[Connection Service] Signal K HTTP Endpoints retrieved");
    this.serverVersion$.next(endpointResponse.body.server.version);

    const httpUrl = endpointResponse.body.endpoints.v1["signalk-http"];
    const wsUrl = endpointResponse.body.endpoints.v1["signalk-ws"];
    const httpUrlV2 = endpointResponse.body.endpoints.v2?.["signalk-http"];
    const wsUrlV2 = endpointResponse.body.endpoints.v2?.["signalk-ws"];

    if (!httpUrl || !wsUrl) {
      throw new Error("Signal K server response is missing required v1 endpoint URLs");
    }

    const serverServiceEndpoints: IEndpointStatus = {
      state: EndpointStatus.Connected,
      message: endpointResponse.status?.toString() || "Connected",
      serverDescription: `${endpointResponse.body.server.id} ${endpointResponse.body.server.version}`,
      httpServiceUrl: null,
      WsServiceUrl: null,
    };

    if (proxyEnabled) {
      console.debug("[Connection Service] Proxy Mode Enabled");
      serverServiceEndpoints.httpServiceUrl = window.location.origin + new URL(httpUrl).pathname;
      serverServiceEndpoints.WsServiceUrl = window.location.protocol.replace('http', 'ws') + '//' + window.location.host + new URL(wsUrl).pathname;
      if (httpUrlV2) {
        serverServiceEndpoints.httpServiceUrlV2 = window.location.origin + new URL(httpUrlV2).pathname;
      }
      if (wsUrlV2) {
        serverServiceEndpoints.WsServiceUrlV2 = window.location.protocol.replace('http', 'ws') + '//' + window.location.host + new URL(wsUrlV2).pathname;
      }
    } else {
      serverServiceEndpoints.httpServiceUrl = httpUrl;
      // Only override ws:// to wss:// when page is HTTPS, otherwise keep original
      const isHttpsPage = window.location.protocol === 'https:';
      serverServiceEndpoints.WsServiceUrl = isHttpsPage ? wsUrl.replace('ws://', 'wss://') : wsUrl;
      if (httpUrlV2) {
        serverServiceEndpoints.httpServiceUrlV2 = httpUrlV2;
      }
      if (wsUrlV2) {
        serverServiceEndpoints.WsServiceUrlV2 = isHttpsPage ? wsUrlV2.replace('ws://', 'wss://') : wsUrlV2;
      }
    }

    console.debug("[Connection Service] HTTP URI: " + serverServiceEndpoints.httpServiceUrl);
    if (serverServiceEndpoints.httpServiceUrlV2) {
      console.debug("[Connection Service] HTTP V2 URI: " + serverServiceEndpoints.httpServiceUrlV2);
    }
    console.debug("[Connection Service] WebSocket URI: " + serverServiceEndpoints.WsServiceUrl);
    if (serverServiceEndpoints.WsServiceUrlV2) {
      console.debug("[Connection Service] WebSocket V2 URI: " + serverServiceEndpoints.WsServiceUrlV2);
    }

    serverServiceEndpoints.subscribeAll = !!subscribeAll;
    return serverServiceEndpoints;
  }

  private handleError(error: HttpErrorResponse): never {
    const errorMessage = error.status === 0
      ? `[Connection Service] ${error.name}: ${error.message}`
      : `[Connection Service] Backend returned code ${error.status}, body was: ${error.error}`;

    console.error(errorMessage);
    throw error;
  }

  // Endpoint status and address observable
  public getServiceEndpointStatusAsO() {
    return this.serverServiceEndpoint$.asObservable();
  }

  public setServerInfo(name: string | undefined, version: string | undefined, roles: string[] | undefined): void {
    this.serverName = name;
    this.serverRoles = roles ?? [];
    console.log(`[Connection Service] Server Name: ${name}, Version: ${version}, Roles: ${JSON.stringify(roles)}`);
  }

  public get skServerName() : string | undefined {
    return this.serverName;
  }

  public get skServerVersion() : string | null {
    return this.serverVersion$.getValue();
  }

  public get skServerRoles() : string[] {
    return this.serverRoles;
  }
}
