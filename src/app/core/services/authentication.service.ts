import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, TimeoutError, lastValueFrom, timeout } from 'rxjs';
import { distinctUntilChanged, map } from "rxjs/operators";

/**
 * Parsed subset of the Signal K server's `GET /skServer/loginStatus` response. Drives session state
 * and carries the login/OIDC descriptors the bootstrap redirect needs. All fields are optional because
 * the response shape is owned by the server and is treated defensively (fail-closed: a session is only
 * "logged in" when {@link status} is exactly `'loggedIn'`).
 */
export interface ILoginStatus {
  status?: string;
  authenticationRequired?: boolean;
  userLevel?: string;
  username?: string;
  oidcEnabled?: boolean;
  oidcAutoLogin?: boolean;
  oidcLoginUrl?: string;
  oidcProviderName?: string;
}

const loginStatusPath = '/skServer/loginStatus'; // server-origin, not the /signalk/v1 API base
const loginStatusTimeoutMs = 5000; // bounded so a hung endpoint cannot block the APP_INITIALIZER
const noHttpResponseStatus = 0; // HttpErrorResponse.status is 0 when no response ever reached the client

/**
 * Session authentication for the Signal K server. SKip is served same-origin by the SK server (behind
 * the reverse proxy / SSO), so the httpOnly session cookie is the only credential: the interceptor
 * carries it on same-origin requests and this service derives session state from
 * `GET /skServer/loginStatus`. SKip never collects, stores, or transmits raw credentials or tokens.
 */
@Injectable({
  providedIn: 'root'
})
export class AuthenticationService {
  private http = inject(HttpClient);

  private _IsLoggedIn$ = new BehaviorSubject<boolean>(false);
  public isLoggedIn$ = this._IsLoggedIn$.asObservable();

  // Latest parsed loginStatus (null until an authoritative probe; a transport blip leaves it unchanged).
  private _loginStatus$ = new BehaviorSubject<ILoginStatus | null>(null);
  public loginStatus$ = this._loginStatus$.asObservable();

  /** Latest parsed loginStatus, read synchronously (e.g. by the SSO redirect). Null until refreshed. */
  public get loginStatusValue(): ILoginStatus | null {
    return this._loginStatus$.getValue();
  }

  /**
   * A real per-user identity is present: a logged-in session. Profiles availability and user-scope
   * applicationData key off this.
   */
  public isUserSession$ = this._loginStatus$.pipe(
    map(status => status?.status === 'loggedIn'),
    distinctUntilChanged()
  );

  /**
   * The current session can write user-scope data: a logged-in session that is not server-side
   * read-only. Write affordances (config save, profile create/rename/delete/switch) gate on this so a
   * read-only session does not present controls that silently fail server-side.
   */
  public canWriteUserData$ = this._loginStatus$.pipe(
    map(status => status?.status === 'loggedIn' && this.isWriteUserLevel(status.userLevel)),
    distinctUntilChanged()
  );

  /**
   * Query `GET /skServer/loginStatus` with credentials so the httpOnly session cookie authenticates
   * the probe, and derive session state from it (fail-closed). Returns the parsed status (including
   * OIDC descriptors for the bootstrap redirect). An authoritative answer — a not-logged-in verdict,
   * a non-2xx response, or an unparseable body — clears the session and returns null; a transport-layer
   * failure (unreachable server or timeout) instead preserves the last known-good status so a transient
   * drop cannot wedge a live cookie session into a false logged-out state. The request targets the served
   * origin — the effective Signal K origin equals `window.location.origin` by definition — not the
   * post-discovery `/signalk/v1` base.
   */
  public async refreshLoginStatus(): Promise<ILoginStatus | null> {
    const url = window.location.origin + loginStatusPath;
    try {
      const raw = await lastValueFrom(this.http.get<ILoginStatus>(url, { withCredentials: true }).pipe(timeout(loginStatusTimeoutMs)));
      return this.applyLoginStatus(raw);
    } catch (error) {
      if (this.isTransportFailure(error)) {
        // A transient blip carries no logout verdict: keep the last known-good session so a brief
        // connectivity drop cannot wedge the UI logged-out until a manual reload.
        return this.loginStatusValue;
      }
      // The server answered but the response is not an authenticated session: treat as not logged in.
      return this.applyLoginStatus(null);
    }
  }

  /**
   * Whether a failed probe is a transport-layer blip rather than an authoritative answer. A request
   * that never reached the server surfaces as an HttpErrorResponse with no HTTP status, and a slow
   * endpoint surfaces as an RxJS TimeoutError; neither implies the session ended.
   */
  private isTransportFailure(error: unknown): boolean {
    return (error instanceof HttpErrorResponse && error.status === noHttpResponseStatus)
      || error instanceof TimeoutError;
  }

  private applyLoginStatus(raw: unknown): ILoginStatus | null {
    const status: ILoginStatus | null = raw && typeof raw === 'object' ? (raw as ILoginStatus) : null;
    this._loginStatus$.next(status);
    this._IsLoggedIn$.next(status?.status === 'loggedIn');
    return status;
  }

  /**
   * Whether a Signal K userLevel (skPrincipal.permissions) can write user-scope data. SK treats
   * 'admin' and 'readwrite' as write-capable; 'readonly' (or an absent level) cannot. Note this is
   * NOT loginStatus.readOnlyAccess — that field is the server's allow_readonly (anonymous read)
   * config and is independent of the signed-in user's permission.
   */
  private isWriteUserLevel(userLevel?: string): boolean {
    return userLevel === 'admin' || userLevel === 'readwrite';
  }
}
