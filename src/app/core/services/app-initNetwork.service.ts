/**
* This Service uses the APP_INITIALIZER feature to dynamically load
* network service (SignalKConnection & Authentication) when the app is initialized,
* before loading appComponent and other stuff.
*
* @usage must return a Promise in all cases or will block app from loading.
* All execution in this service delays app start. Keep code small and simple.
**/
import { inject, Injectable, OnDestroy } from '@angular/core';
import { IConfig, IConnectionConfig } from "../interfaces/app-settings.interfaces";
import { SignalKConnectionService } from "./signalk-connection.service";
import { AuthenticationService, ILoginStatus } from './authentication.service';
import { SsoRedirectService } from './sso-redirect.service';
import { DefaultConnectionConfig } from '../../../default-config/config.blank.const';
import { buildDefaultConfig } from '../../../default-config/config.default.factory';
import { isValidConfigShape } from '../utils/config-shape.util';
import { dashboardsRequireRemoteContexts } from '../utils/remote-context-demand.util';
import { cloneDeep } from 'lodash-es';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { DataService } from './data.service';
import { SignalKDeltaService } from './signalk-delta.service';
import { IStorageRemoteBootstrapContext, StorageService } from './storage.service';
import { ConnectionState, ConnectionStateMachine } from './connection-state-machine.service';
import { InternetReachabilityService } from './internet-reachability.service';
import { EmbedModeService } from './embed-mode.service';
import { PROFILE_NAME_PATTERN } from './profile.service';
import { LOCAL_CONFIG_KEYS } from '../constants/config-storage.const';
import { REMOTE_CONFIG_FILE_VERSION, CONNECTION_CONFIG_VERSION, LATEST_APP_CONFIG_VERSION } from '../constants/config-versions.const';
import { getLocalStorageItem, setLocalStorageItem } from '../utils/local-storage.util';

const CONNECTION_CONFIG_KEY = LOCAL_CONFIG_KEYS.connectionConfig;
// Where an operator publishes the dashboard anonymous visitors land on. The global applicationData
// scope is the only one they can read: Signal K admin-gates its writes but not its reads, while the
// user scope belongs to a signed-in identity an anonymous visitor does not have.
const ANONYMOUS_CONFIG_SCOPE = 'global';
const ANONYMOUS_CONFIG_NAME = 'default';
export type TBootstrapStatus = 'starting' | 'ready' | 'degraded';
/** Bootstrap auth verdict. 'anonymous' is a session-less read-only visit that must not be redirected. */
export type TCookieAuthOutcome = 'redirecting' | 'proceed' | 'anonymous' | 'auth-blocked';
export type TBootstrapIssueReason = 'none' | 'missing-shared-config' | 'network-unreachable' | 'unauthorized' | 'unknown' | 'auth-blocked';
export type TAuthBlockedCause = 'budget-exhausted' | 'sign-in-required';

export interface IBootstrapIssue {
  reason: TBootstrapIssueReason;
  statusCode?: number;
  sharedConfigName?: string;
  cause?: TAuthBlockedCause;
}

@Injectable()
export class AppNetworkInitService implements OnDestroy {
  private config: IConnectionConfig;
  private isLoggedIn = false;
  private loggedInSubscription: Subscription;

  private readonly connection = inject(SignalKConnectionService);
  private readonly auth = inject(AuthenticationService);
  private readonly ssoRedirect = inject(SsoRedirectService);
  private readonly connectionStateMachine = inject(ConnectionStateMachine);
  private readonly delta = inject(SignalKDeltaService); // Init to get data before app starts
  private readonly data = inject(DataService); // Init to get data before app starts
  private readonly storage = inject(StorageService); // Init to get data before app starts
  private readonly internetReachability = inject(InternetReachabilityService);
  // Injected to force construction of the boot-latched embed/profile flag reader as part of the
  // first blocking initializer, and to resolve the ephemeral `?profile` override below.
  private readonly embedMode = inject(EmbedModeService);
  private readonly _bootstrapStatus$ = new BehaviorSubject<TBootstrapStatus>('starting');
  private readonly _bootstrapIssue$ = new BehaviorSubject<IBootstrapIssue>({ reason: 'none' });

  constructor () {
    this.loggedInSubscription = this.auth.isLoggedIn$.subscribe((isLoggedIn) => {
      this.isLoggedIn = isLoggedIn;
    })
  }

  /**
   * Bootstrap auth decision from loginStatus. Returns 'redirecting' when the browser is being
   * sent to the SK/SSO login (caller should stop), or 'proceed' otherwise:
   * - loggedIn   → reset the redirect budget; the storage bootstrap then runs (isLoggedIn is true).
   * - notLoggedIn + authRequired + readOnlyAccess → the server serves this visitor without a session,
   *   so read anonymously rather than demanding a sign-in — unless the server asked for auto-login,
   *   which is a deployment saying its users are expected to arrive signed in.
   * - notLoggedIn + authRequired → auto-redirect when allowed by oidcAutoLogin and the budget; else
   *   surface the auth-blocked recovery state (budget exhausted, or a manual sign-in is required).
   * - auth not required → anonymous read; proceed with no redirect.
   */
  private handleCookieAuth(status: ILoginStatus | null): TCookieAuthOutcome {
    if (status?.status === 'loggedIn') {
      // The budget reset is deferred to a genuinely completed bootstrap (see initNetworkServices'
      // finally), so a loggedIn -> applicationData-401 -> reauth path cannot reset-then-loop.
      return 'proceed';
    }
    if (!status) {
      // loginStatus unreachable/unparseable: fail closed — do not assume anonymous-open access.
      this._bootstrapIssue$.next({ reason: 'auth-blocked', cause: 'sign-in-required' });
      return 'auth-blocked';
    }
    if (status.authenticationRequired) {
      if (status.oidcAutoLogin !== true && status.readOnlyAccess) {
        return 'anonymous';
      }
      if (this.attemptCookieRedirect(status) === 'redirecting') {
        return 'redirecting';
      }
      // The redirect was refused (framed, budget spent, or an untrackable budget) — reasons about
      // this browser, not about what the server will serve. When the server grants anonymous read,
      // show the instruments instead of a sign-in wall: this is the SSO-is-down case the read-only
      // path exists for. Clear the auth-blocked issue attemptCookieRedirect already emitted.
      if (status.readOnlyAccess) {
        this._bootstrapIssue$.next({ reason: 'none' });
        return 'anonymous';
      }
      return 'auth-blocked';
    }
    // authentication explicitly not required: anonymous read access, no redirect.
    return 'proceed';
  }

  /**
   * Redirect-or-block decision shared by the bootstrap path and the mid-bootstrap 401 path.
   * Auto-redirects when oidcAutoLogin allows and the budget permits; otherwise surfaces the
   * auth-blocked recovery state (budget exhausted, or a manual sign-in is required).
   */
  private attemptCookieRedirect(status: ILoginStatus | null): 'redirecting' | 'blocked' {
    const outcome = status?.oidcAutoLogin !== false ? this.ssoRedirect.attemptAutoRedirect(status) : null;
    if (outcome === 'redirected') {
      return 'redirecting';
    }
    // A framed boot deliberately skips the redirect without spending budget, so its recovery is
    // always an explicit sign-in — never a stale (shared per-origin-per-tab) budget's
    // 'budget-exhausted' wording.
    const cause: TAuthBlockedCause = outcome !== 'framed' && this.ssoRedirect.isBudgetExhausted()
      ? 'budget-exhausted'
      : 'sign-in-required';
    this._bootstrapIssue$.next({ reason: 'auth-blocked', cause });
    return 'blocked';
  }

  /**
   * Re-authentication routing for a mid-bootstrap 401. Reuses the same oidcAutoLogin/budget-guarded
   * decision as the bootstrap path (so a 401 cannot loop past the budget, and honors
   * oidcAutoLogin:false).
   */
  private routeToReauth(): void {
    this.attemptCookieRedirect(this.auth.loginStatusValue);
  }

  public async initNetworkServices() {
    let startupDegraded = false;
    let redirecting = false;
    this.loadLocalStorageConfig();
    this.preloadFonts();
    this.internetReachability.start();

    try {
      if (this.config?.signalKUrl !== undefined && this.config.signalKUrl !== null) {
        // Routing always serves the server's discovered API path from the app's own origin, so the
        // same-origin session cookie always applies (proxyEnabled is not user-configurable). Subscribe
        // scope is widget-demand-driven (#386): connect to all remote (AIS/DSC) contexts only when the
        // ACTIVE profile's dashboards need them. remoteContextDemand is keyed by profile (demand is
        // per-profile); the entry for this profile is the value computed on its last dashboard change.
        // A missing entry — never computed, or a just-switched-to profile whose demand belongs to a
        // sibling — fails open to `all` so AIS targets are never silently hidden. Demand isn't known
        // until dashboards load post-auth, so a change takes effect on the next reload. An embed or an
        // ephemeral ?profile session renders a slot this per-device map cannot describe, so fail open
        // to `all` there rather than trust it.
        const embedOrEphemeral = this.embedMode.embed() || this.embedMode.profile() !== null;
        const profileDemand = this.config.remoteContextDemand?.[this.config.sharedConfigName];
        await this.connection.initializeConnection(
          {url: this.config.signalKUrl, new: false},
          true,
          embedOrEphemeral ? true : (profileDemand ?? true)
        );
      }

      // Same-origin session: state comes from loginStatus, not a credential login.
      const status = await this.auth.refreshLoginStatus();
      const outcome = this.handleCookieAuth(status);
      if (outcome === 'redirecting') {
        redirecting = true;
        return; // browser is navigating to the SK/SSO login
      }
      if (outcome === 'auth-blocked') {
        // Not authorized and not auto-redirecting: keep the auth-blocked recovery state (set by
        // handleCookieAuth), do not reset the loop budget, and finish degraded (not 'ready') so the
        // recovery UI shows. Returning here also avoids the 'reason: none' overwrite below.
        startupDegraded = true;
        this._bootstrapStatus$.next('degraded');
        return;
      }

      if (outcome === 'anonymous') {
        await this.bootstrapAnonymousConfig();
      }

      let remoteConfig: IConfig | null = null;
      // True when an ephemeral URL `?profile` override was honored (a valid, existing, different
      // slot). The remote-control migration must then ignore the loaded (ephemeral) config and take
      // the device identity from its own persisted source instead.
      let ephemeralOverrideActive = false;
      if (this.isLoggedIn) {
        // Wait for storage to be fully ready before accessing it
        const storageReady = await this.storage.waitUntilReady();
        if (!storageReady) {
          throw new Error('[AppInit Network Service] StorageService did not become ready in time. Cannot bootstrap remote configuration.');
        } else {
          // Ephemeral (URL-selected) profile: loaded for this session only, never persisted. Falls
          // back to the persisted per-device profile when absent/invalid/unknown.
          const effectiveSharedConfigName = await this.resolveEffectiveSharedConfigName();
          ephemeralOverrideActive = effectiveSharedConfigName !== this.config.sharedConfigName;
          try {
            remoteConfig = await this.storage.getConfig('user', effectiveSharedConfigName, REMOTE_CONFIG_FILE_VERSION);
          } catch (error) {
            // Only a 404 from the config fetch itself means "no shared configuration"; 404s from
            // earlier bootstrap steps (e.g. /signalk/ discovery) must not offer config recovery.
            if (error?.status === 404) {
              startupDegraded = true;
              this._bootstrapIssue$.next({
                reason: 'missing-shared-config',
                statusCode: 404,
                sharedConfigName: this.config.sharedConfigName
              });
              this._bootstrapStatus$.next('degraded');
              return;
            }
            throw error;
          }
          if (!remoteConfig?.app) {
            // A slot that was never written 404s, handled above; an appless 200 is the other shape
            // "no shared configuration yet" arrives in, so it lands in the same degraded state.
            startupDegraded = true;
            this._bootstrapIssue$.next({
              reason: 'missing-shared-config',
              sharedConfigName: this.config.sharedConfigName
            });
            this._bootstrapStatus$.next('degraded');
            return;
          }
          const bootstrapContext: IStorageRemoteBootstrapContext = {
            sharedConfigName: effectiveSharedConfigName,
            configFileVersion: REMOTE_CONFIG_FILE_VERSION,
            initConfig: remoteConfig
          };
          this.storage.bootstrapRemoteContext(bootstrapContext);
        }
      }

      // Lift remote-control identity to the per-device connectionConfig (once). Identity comes from
      // the loaded profile, else the legacy local appConfig blob, else identity defaults. An
      // ephemeral `?profile` override is excluded as a source — the device must never adopt the
      // ephemeral slot's identity as its own.
      // An anonymous session has no authoritative profile to lift the remote-control identity from,
      // and the migration is one-shot: running it here would stamp the connection config as migrated
      // with identity defaults, so the real identity in the user's profile could never be lifted.
      if (outcome !== 'anonymous') {
        this.migrateRemoteControlToDevice(remoteConfig, ephemeralOverrideActive);
      }

      this._bootstrapIssue$.next({ reason: 'none' });

    } catch (error) {
      startupDegraded = true;
      if (error?.status === 0) {
        // Only after the HTTP retry cycle resolves do we know the accurate recovery message: a link
        // that came back must not raise a "cannot reach the server" toast. Either way the bootstrap
        // never completed (config not loaded), so recovery is offered in place — never a redirect (#190).
        const finalState = await this.waitForHttpRetryCompletion();
        if (finalState === ConnectionState.HTTPConnected || this.connectionStateMachine.isHTTPConnected()) {
          console.warn('[AppInit Network Service] Connection recovered during retry cycle but bootstrap did not complete; offering reload.');
          this._bootstrapIssue$.next({ reason: 'unknown', statusCode: 0 });
        } else {
          console.warn('[AppInit Network Service] Network unreachable after HTTP retries; offering in-place recovery (no redirect).');
          this._bootstrapIssue$.next({ reason: 'network-unreachable', statusCode: 0 });
        }
      } else if (error?.status === 401) {
        this._bootstrapIssue$.next({ reason: 'unauthorized', statusCode: 401 });
        console.warn("[AppInit Network Service] Initialization failed. Unauthorized access. Routing to re-authentication.");
        this.routeToReauth();
      } else {
        this._bootstrapIssue$.next({ reason: 'unknown', statusCode: error?.status });
        console.warn("[AppInit Network Service] Initialization failed. Error: ", JSON.stringify(error), "— recovery offered in place (no redirect).");
      }
      console.warn('[AppInit Network Service] Startup continuing in degraded mode to allow UI feedback.');
      this._bootstrapStatus$.next('degraded');
      return;
    } finally {
      if (!startupDegraded && !redirecting) {
        // A clean, non-redirecting bootstrap is a stable state: clear the SSO redirect loop budget so
        // a future genuine logout gets a fresh set of attempts. Not reset on the redirect/degraded
        // paths, so a loggedIn -> 401 -> reauth loop stays bounded.
        this.ssoRedirect.resetBudget();
      }
      if (!startupDegraded) {
        this._bootstrapStatus$.next('ready');
      }
      console.log("[AppInit Network Service] Initialization completed");
      // Enable WebSocket functionality now that initialization is complete
      this.connectionStateMachine.enableWebSocketMode();

      // Start the WebSocket only on a clean bootstrap from a fresh HTTPConnected state. Skip it when
      // degraded/redirecting (e.g. the cookie auth-blocked path, where HTTP is connected but there is
      // no session — an anonymous WS would just churn behind the recovery toast), and when the delta
      // service's isLoggedIn$ reconnect has already driven the state to WebSocketConnecting (starting
      // again would close and reopen the in-flight socket).
      if (this.connectionStateMachine.currentState === ConnectionState.HTTPConnected && !startupDegraded && !redirecting) {
        console.log("[AppInit Network Service] Starting WebSocket connection after initialization");
        this.connectionStateMachine.startWebSocketConnection();
      }
    }
  }

  /**
   * Loads the configuration an anonymous visitor sees and hands it to storage as a read-only
   * context. There is no user scope to read — the anonymous principal is not a user — so the source
   * is the shared global slot an operator publishes, and the dashboards shipped in this release when
   * none is published. Either way the visitor gets a working app instead of the missing-shared-config
   * recovery state, which offers to fix a profile they do not have.
   */
  private async bootstrapAnonymousConfig(): Promise<void> {
    const requestedProfile = this.embedMode.profile();
    if (requestedProfile) {
      // The parameter selects a user-scope slot, which an anonymous principal has no access to.
      // Say so rather than rendering the shared config as if the link had worked.
      console.warn(`[AppInit Network Service] Ignoring ?profile='${requestedProfile}': profiles need a signed-in session. Showing the shared configuration.`);
    }
    const storageReady = await this.storage.waitUntilReady();
    if (!storageReady) {
      throw new Error('[AppInit Network Service] StorageService did not become ready in time. Cannot bootstrap anonymous configuration.');
    }
    const initConfig = await this.loadAnonymousConfig();
    // The subscribe scope was chosen before the session was known, from a demand value computed for
    // this device's own profile (#386). An anonymous visitor renders someone else's configuration, so
    // that value describes the wrong dashboards: a device whose own profile needs no remote contexts
    // would leave a shared dashboard's AIS and DSC widgets empty for the life of the page, with no
    // error anywhere. Recompute from what is actually being rendered — the socket is still closed.
    this.connection.setSubscribeAll(dashboardsRequireRemoteContexts(initConfig.dashboards));
    this.storage.bootstrapRemoteContext({
      sharedConfigName: ANONYMOUS_CONFIG_NAME,
      configFileVersion: REMOTE_CONFIG_FILE_VERSION,
      initConfig,
      readOnly: true
    });
  }

  /**
   * The published global config, or the shipped defaults. A slot that was never written 404s, and
   * an appless 200 body means "nothing published" just as that 404 does —
   * but nothing else does: a 5xx or a timeout means the operator's dashboard exists and could not
   * be fetched, and silently showing a different one as if it were the boat's is worse than the
   * recovery state, so it is rethrown to the bootstrap's handler.
   *
   * The published slot is the one configuration in Skip that is necessarily hand-authored — no code
   * path writes the global scope — so it gets the same shape validation and in-memory migration as
   * an imported profile. An unusable body falls back rather than booting a half-broken app.
   */
  private async loadAnonymousConfig(): Promise<IConfig> {
    try {
      const published = await this.storage.getConfig(ANONYMOUS_CONFIG_SCOPE, ANONYMOUS_CONFIG_NAME, REMOTE_CONFIG_FILE_VERSION);
      if (published?.app) {
        return this.preparePublishedConfig(published);
      }
      console.log('[AppInit Network Service] No shared configuration published; using the dashboards shipped with this version.');
    } catch (error) {
      if (error?.status !== 404) {
        throw error;
      }
      console.log('[AppInit Network Service] No shared configuration published (404); using the dashboards shipped with this version.');
    }
    return buildDefaultConfig();
  }

  /**
   * Screens a published shared config before it becomes the session's configuration. It is the one
   * config in Skip that is necessarily hand-authored — no code path writes the global scope — so a
   * body that is merely plausible reaches code that dereferences `theme` and iterates `dashboards`,
   * and boots an app that throws on the first toast or renders a blank page. An unusable body falls
   * back to the shipped dashboards instead.
   *
   * A version older than this release is rendered as-is with a warning, not migrated: the migration
   * belongs to the signed-in session that owns a slot, and a read-only visitor must not rewrite one.
   */
  private preparePublishedConfig(published: IConfig): IConfig {
    if (!isValidConfigShape(published)) {
      console.warn('[AppInit Network Service] The published shared configuration is not a usable Skip config; using the dashboards shipped with this version.');
      return buildDefaultConfig();
    }
    if (published.app?.configVersion !== LATEST_APP_CONFIG_VERSION) {
      console.warn(`[AppInit Network Service] The published shared configuration is version ${published.app?.configVersion}, not ${LATEST_APP_CONFIG_VERSION}. Rendering it unmigrated; republish it from a current Skip to keep it in step.`);
    }
    return published;
  }

  /**
   * Resolves the config slot to load this boot. Honors an ephemeral `?profile=<name>` URL override —
   * validated against the profile-name charset and confirmed present in the user scope — without ever
   * writing it back to `this.config`/localStorage, so the URL-selected profile lives only for this
   * session. Falls back to the persisted per-device profile when no override is requested, the name
   * is malformed, the slot does not exist, or the listing fails.
   */
  private async resolveEffectiveSharedConfigName(): Promise<string> {
    const requested = this.embedMode.profile();
    const persisted = this.config.sharedConfigName;
    if (!requested) {
      return persisted;
    }
    if (!PROFILE_NAME_PATTERN.test(requested)) {
      console.warn(`[AppInit Network Service] Ignoring malformed ?profile override '${requested}'; using persisted profile '${persisted}'.`);
      return persisted;
    }
    try {
      const configs = await this.storage.listConfigs(REMOTE_CONFIG_FILE_VERSION);
      if (configs.some(c => c.scope === 'user' && c.name === requested)) {
        return requested;
      }
      console.warn(`[AppInit Network Service] Requested ?profile '${requested}' does not exist in the user scope; using persisted profile '${persisted}'.`);
      return persisted;
    } catch (error) {
      console.warn(`[AppInit Network Service] Could not verify ?profile '${requested}'; using persisted profile '${persisted}'.`, error);
      return persisted;
    }
  }

  /**
   * Emits the APP_INITIALIZER bootstrap lifecycle status.
   *
   * @returns {Observable<TBootstrapStatus>} Stream of bootstrap status values.
   *
   * @example
   * this.appNetworkInit.bootstrapStatus$
   *   .subscribe(status => console.log('Bootstrap status', status));
   */
  public get bootstrapStatus$(): Observable<TBootstrapStatus> {
    return this._bootstrapStatus$.asObservable();
  }

  /**
   * Emits detailed bootstrap issue metadata for degraded startup scenarios.
   *
   * @returns {Observable<IBootstrapIssue>} Stream of bootstrap issue descriptors.
   *
   * @example
   * this.appNetworkInit.bootstrapIssue$
   *   .subscribe(issue => console.log(issue.reason, issue.sharedConfigName));
   */
  public get bootstrapIssue$(): Observable<IBootstrapIssue> {
    return this._bootstrapIssue$.asObservable();
  }

  private async waitForHttpRetryCompletion(timeoutMs?: number): Promise<ConnectionState | null> {
    const effectiveTimeoutMs = timeoutMs ?? this.connectionStateMachine.getHttpRetryWindowMs(2000);
    const terminalStates = new Set<ConnectionState>([
      ConnectionState.HTTPConnected,
      ConnectionState.PermanentFailure,
    ]);

    const current = this.connectionStateMachine.currentState;
    if (terminalStates.has(current)) {
      return current;
    }

    return new Promise<ConnectionState | null>((resolve) => {
      const timeoutId = window.setTimeout(() => {
        subscription.unsubscribe();
        resolve(null);
      }, effectiveTimeoutMs);

      const subscription = this.connectionStateMachine.state$.subscribe((state: ConnectionState) => {
        if (!terminalStates.has(state)) {
          return;
        }

        clearTimeout(timeoutId);
        subscription.unsubscribe();
        resolve(state);
      });
    });
  }

  private setLocalStorageConfig(): void {
    setLocalStorageItem(CONNECTION_CONFIG_KEY, JSON.stringify(this.config));
  }

  /**
   * One-time migration (connectionConfig version < 13 → 13): the remote-control identity
   * (isRemoteControl, instanceName) moved from the profile (IAppConfig) to the per-device
   * connectionConfig. Lift the existing values from the profile loaded this boot, falling back to
   * the legacy local appConfig blob when no profile is available; absent both, migrate with the
   * identity defaults.
   *
   * @param {IConfig | null} remoteConfig The profile loaded this boot, or null when unavailable.
   * @param {boolean} ephemeralOverrideActive True when the loaded profile is an ephemeral `?profile`
   *   override rather than the persisted device profile; its identity is ignored as a migration
   *   source so the ephemeral slot's identity is never persisted as the device's own.
   */
  private migrateRemoteControlToDevice(remoteConfig: IConfig | null, ephemeralOverrideActive = false): void {
    if (!this.config || this.config.configVersion >= CONNECTION_CONFIG_VERSION) {
      return;
    }
    // The fields still exist at runtime in pre-migration stored configs, but were removed from IAppConfig.
    // Under an ephemeral override the loaded config is NOT the device's own, so it is skipped as a
    // source: fall through to the device's legacy local appConfig blob, else identity defaults.
    let app: { isRemoteControl?: boolean; instanceName?: string } | null = ephemeralOverrideActive
      ? null
      : (remoteConfig?.app as unknown as { isRemoteControl?: boolean; instanceName?: string }) ?? null;
    if (!app) {
      try {
        app = JSON.parse(getLocalStorageItem(LOCAL_CONFIG_KEYS.appConfig) ?? 'null');
      } catch {
        app = null;
      }
    }
    this.config.isRemoteControl = app?.isRemoteControl ?? false;
    this.config.instanceName = app?.instanceName ?? '';
    this.config.configVersion = CONNECTION_CONFIG_VERSION;
    this.setLocalStorageConfig();
    console.log('[AppInit Network Service] Migrated remote-control identity to per-device connectionConfig (v13)');
  }

  private loadLocalStorageConfig(): void {
    const stored = getLocalStorageItem(CONNECTION_CONFIG_KEY);
    const parsedConfig: IConnectionConfig | null = stored ? JSON.parse(stored) : null;

    if (!parsedConfig) {
      this.config = cloneDeep(DefaultConnectionConfig);
      this.config.signalKUrl = window.location.origin;
      console.log(`[AppInit Network Service] Connection Configuration not found. Creating configuration using Auto-Discovery URL: ${this.config.signalKUrl}`);
      this.setLocalStorageConfig();
    } else {
      this.config = parsedConfig;
      if (!this.config.signalKUrl) {
        this.config.signalKUrl = window.location.origin;
        this.setLocalStorageConfig();
        console.log(`[AppInit Network Service] Config found with no server URL. Setting Auto-Discovery URL: ${this.config.signalKUrl}`);
      }
    }

    if (this.config.configVersion == 9) {
      this.config.configVersion = 10;
      this.setLocalStorageConfig();
      console.log(`[AppInit Network Service] Upgrading Connection version from 9 to 10`);
    }
    if (this.config.configVersion == 10) {
      this.config.configVersion = 11;
      this.setLocalStorageConfig();
      console.log(`[AppInit Network Service] Upgrading Connection version from 10 to 11`);
    }
    if (this.config.configVersion == 11) {
      this.config.configVersion = 12;
      this.setLocalStorageConfig();
      console.log(`[AppInit Network Service] Upgrading Connection version from 11 to 12`);
    }
  }

  private preloadFonts (): void {
    // Preload fonts else browser can delay and cause canvas font issues
    const fonts = [
      {
        family: "Roboto",
        src: "url(./assets/google-fonts/KFOlCnqEu92Fr1MmSU5fChc4AMP6lbBP.woff2)",
        options: {
          weight: "300",
          style: "normal"
        }
      },
      {
        family: "Roboto",
        src: "url(./assets/google-fonts/KFOlCnqEu92Fr1MmSU5fBBc4AMP6lQ.woff2)",
        options: {
          weight: "300",
          style: "normal"
        }
      },
      {
        family: "Roboto",
        src: "url(./assets/google-fonts/KFOmCnqEu92Fr1Mu7GxKKTU1Kvnz.woff2)",
        options: {
          weight: "400",
          style: "normal"
        }
      },
      {
        family: "Roboto",
        src: "url(./assets/google-fonts/KFOmCnqEu92Fr1Mu4mxKKTU1Kg.woff2)",
        options: {
          weight: "400",
          style: "normal"
        }
      },
    {
        family: "Roboto",
        src: "url(./assets/google-fonts/KFOlCnqEu92Fr1MmEU9fChc4AMP6lbBP.woff2)",
        options: {
          weight: "500",
          style: "normal"
        }
      },
      {
        family: "Roboto",
        src: "url(./assets/google-fonts/KFOlCnqEu92Fr1MmEU9fBBc4AMP6lQ.woff2)",
        options: {
          weight: "500",
          style: "normal"
        }
      }
    ];

    for (const {family, src, options} of fonts) {
      const font = new FontFace(family, src, options);
      font.load()
        .then(() =>
          document.fonts.add(font)
      )
        .catch(err =>
          console.log(`[AppInit Network Service] Error loading fonts: ${err}`)
        );
    }
  }

  ngOnDestroy(): void {
    this.loggedInSubscription?.unsubscribe();
  }
}
