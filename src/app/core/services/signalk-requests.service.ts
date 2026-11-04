import { Injectable, inject } from '@angular/core';
import { Observable , Subject } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ISignalKDeltaMessage } from '../interfaces/signalk-interfaces';
import { SignalKDeltaService } from './signalk-delta.service';
import { UUID } from '../utils/uuid.util'
import { ToastService } from './toast.service';

const deltaStatusCodes: Record<number, string> = {
  200: "The request was successful.",
  202: "Request accepted and pending completion.",
  400: "Something is wrong with the client's request.",
  401: "Login failed. Your User ID or Password is incorrect.",
  403: "DENIED: Authorization with R/W or Admin permission level is required to send commands. Configure Sign In credential.",
  405: "The server does not support the request.",
  500: "The request failed.",
  502: "Something went wrong carrying out the request on the server.",
  504: "Timeout on the server side trying to carry out the request."
}
// Codes dispatched as recognized responses; anything else raises the unknown-status error toast.
const handledStatusCodes = new Set([200, 202, 400, 401, 403, 405, 500, 502, 504]);
// Server-side failures surfaced to the user as an error toast carrying their description.
const serverErrorStatusCodes = new Set([500, 502, 504]);
export interface skRequest {
  requestId: string;
  state: string | null;
  statusCode: number | null;
  statusCodeDescription?: string;
  widgetUUID?: string;
  message?: string;
}

@Injectable({
  providedIn: 'root'
})
export class SignalkRequestsService {
  private signalKDeltaService = inject(SignalKDeltaService);
  private toast = inject(ToastService);

  private requestStatus$ = new Subject<skRequest>(); // public Observable passing message post processing
  private requests: skRequest[] = []; // Private array of all requests.

  constructor() {
      // Observer to get all signalk-delta messages of type request type.
      this.signalKDeltaService.subscribeRequestUpdates()
        .pipe(takeUntilDestroyed())
        .subscribe(requestMessage => { this.updateRequest(requestMessage); });
    }

  /**
   * Sends a async PUT request to the Signal K server and returns a requestId for tracking.
   *
   * @param path - The Signal K full path to write to. Must be a non-empty string. If
   * the path starts with 'self.', it will be removed automatically.
   * @param value - The value to be sent. Can be any type, but must not be undefined.
   * @param widgetUUID - (Optional) The widget's UUID. Used for filtering responses
   * specific to the requesting widget.
   * @returns The Signal K server generated request tracking number
   * for this PUT.
   *
   * Returns null and logs an error if the server did not accept the request or if
   * the path is missing/empty or the value is undefined.
   *
   * @example
   *   const reqId = putRequest('navigation.lights', true, 'this.widgetProperties.uuid');
   *   if (reqId) { ... }
   */
  public putRequest(path: string, value: unknown, widgetUUID: string): string | null {
    if (typeof value === 'undefined') {
      console.error("[Request Service] Undefined value for PUT request");
      return null;
    }
    if (!path) {
      console.error("[Request Service] Path is required for PUT request");
      return null;
    }
    const requestId = UUID.create();
    const noSelfPath = path.replace(/^(self\.)/,""); //no self in path...
    const selfContext = "vessels.self";    // hard coded context. Could be dynamic at some point
    const message = {
      "context": selfContext,
      "requestId": requestId,
      "put": {
        "path": noSelfPath,
        "value": value,
      }
    }
    this.signalKDeltaService.publishDelta(message); //send request

    const request: skRequest = {
      requestId: requestId,
      state: null,
      statusCode: null,
      widgetUUID: widgetUUID,
    };

    this.requests.push(request); // save to private array pending response with widgetUUID so we can filter response from subscriber
    return requestId; // return the ID to the Subscriber, if tracking of individual request is required
  }

  /**
   * Handles request updates, issue display and logging.
   *
   * @param delta Signal K Delta message
   */
  private updateRequest(delta: ISignalKDeltaMessage) {
    const index = this.requests.findIndex(r => r.requestId == delta.requestId);
    if (index > -1) {  // exists in local array
      const statusCode = delta.statusCode;
      this.requests[index].state = delta.state ?? null;
      this.requests[index].statusCode = statusCode ?? null;
      this.requests[index].message = delta.message;

      const currentStatusCode = statusCode !== undefined ? deltaStatusCodes[statusCode] : undefined;

      if (statusCode !== undefined && (typeof currentStatusCode != 'undefined') && handledStatusCodes.has(statusCode)) {
        this.requests[index].statusCodeDescription = currentStatusCode;

        if (statusCode == 202) {
          console.log("[Request Service] Async 202 response received");
          return;
        }

        if (statusCode == 400) {
          this.toast.show(this.requests[index].message ?? '', 0, false, 'error');
          console.log("[Request Service] " + this.requests[index].message );
        }

        if (statusCode == 403) {
          console.warn("[Request Service] Status Code: " + statusCode + " - " + currentStatusCode);
        }

        if (statusCode == 405) {
          console.error("[Request Service] Status Code: " + statusCode + " - " + this.requests[index].message);
        }

        if (serverErrorStatusCodes.has(statusCode)) {
          const detail = this.requests[index].message ? currentStatusCode + " - " + this.requests[index].message : currentStatusCode;
          this.toast.show(detail, 0, false, 'error');
          console.error("[Request Service] Status Code: " + statusCode + " - " + currentStatusCode);
        }

      } else {
        this.toast.show("Unknown Request Status Code received: " + statusCode + " - " + currentStatusCode + " - " + this.requests[index].message, 0, false, 'error');
        console.error("[Request Service] Unknown Request Status Code received: " + statusCode + " - " + currentStatusCode + " - " + this.requests[index].message);
      }
      try {
        this.requestStatus$.next(this.requests[index]);    // dispatched results
        this.requests.splice(index, 1);                 // cleanup array
      } catch (err) {
        this.requestStatus$.error(err);
        console.error("[Request Service] " + err);
        this.requests = []; // flush array to clean values that will become stale post error
      }
    } else {
      this.toast.show("A request message that contains an unknown Request ID was received. Request Delta:\n" + JSON.stringify(delta), 0, false, 'warn');
      console.error("[Request Service] A Request message that contains an unknown Request ID was received. from delta:\n" + JSON.stringify(delta))
    }
  }

  /**
   * Subscribe to Signal K request response. This allows you to inspect server
   * response information such as State, Status Codes and such for further processing
   * logic. Subscription object should be used for the Return :)
   *
   * @return Observable of type skRequest.
   */
  public subscribeRequest(): Observable<skRequest> {
    return this.requestStatus$.asObservable();
  }
}
