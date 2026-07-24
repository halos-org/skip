import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject } from 'rxjs';

import { AppNetworkInitService, IBootstrapIssue } from './app-initNetwork.service';
import { IConfig, IConnectionConfig } from '../interfaces/app-settings.interfaces';
import { SignalKConnectionService } from './signalk-connection.service';
import { AuthenticationService, ILoginStatus } from './authentication.service';
import { SsoRedirectService } from './sso-redirect.service';
import { ConnectionState, ConnectionStateMachine } from './connection-state-machine.service';
import { SignalKDeltaService } from './signalk-delta.service';
import { DataService } from './data.service';
import { StorageService } from './storage.service';
import { InternetReachabilityService } from './internet-reachability.service';
import { EmbedModeService } from './embed-mode.service';
import { ensureLocalStorage } from '../../../test-helpers/local-storage.test-helper';
import { DefaultConnectionConfig } from '../../../default-config/config.blank.const';
import { REMOTE_CONFIG_FILE_VERSION } from '../constants/config-versions.const';

// jsdom has no FontFace; preloadFonts() constructs one during the end-to-end initNetworkServices runs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (typeof (globalThis as any).FontFace === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).FontFace = class { load() { return Promise.resolve(this); } };
}

describe('AppNetworkInitService', () => {
    let service: AppNetworkInitService;

    const isLoggedIn$ = new BehaviorSubject<boolean>(false);
    const state$ = new BehaviorSubject<ConnectionState>(ConnectionState.Disconnected);

    const mockConnection = {
        initializeConnection: vi.fn().mockResolvedValue(undefined)
    };

    const mockAuth = {
        isLoggedIn$,
        loginStatusValue: null as ILoginStatus | null,
        refreshLoginStatus: vi.fn().mockResolvedValue(null)
    };

    const mockSsoRedirect = {
        attemptAutoRedirect: vi.fn().mockReturnValue('redirected'),
        resetBudget: vi.fn(),
        isBudgetExhausted: vi.fn().mockReturnValue(false),
        manualSignIn: vi.fn()
    };

    const mockConnectionStateMachine = {
        state$,
        currentState: ConnectionState.Disconnected,
        getHttpRetryWindowMs: vi.fn().mockReturnValue(4321),
        isHTTPConnected: vi.fn().mockReturnValue(false),
        enableWebSocketMode: vi.fn(),
        startWebSocketConnection: vi.fn()
    };

    const validRemoteConfig = (): IConfig => ({ app: { configVersion: 11 }, theme: null, dashboards: [] } as unknown as IConfig);

    const mockStorage = {
        waitUntilReady: vi.fn().mockResolvedValue(true),
        getConfig: vi.fn().mockResolvedValue(validRemoteConfig()),
        listConfigs: vi.fn().mockResolvedValue([]),
        bootstrapRemoteContext: vi.fn()
    };

    const mockInternetReachability = {
        start: vi.fn()
    };

    const mockEmbed = {
        embed: vi.fn().mockReturnValue(false),
        profile: vi.fn().mockReturnValue(null as string | null)
    };

    beforeEach(() => {
        ensureLocalStorage();
        isLoggedIn$.next(false);
        state$.next(ConnectionState.Disconnected);
        mockConnectionStateMachine.currentState = ConnectionState.Disconnected;
        mockConnectionStateMachine.getHttpRetryWindowMs.mockClear();
        mockConnectionStateMachine.isHTTPConnected.mockClear();
        mockConnectionStateMachine.enableWebSocketMode.mockClear();
        mockConnectionStateMachine.startWebSocketConnection.mockClear();
        mockStorage.getConfig.mockReset().mockResolvedValue(validRemoteConfig());
        mockStorage.listConfigs.mockReset().mockResolvedValue([]);
        mockStorage.bootstrapRemoteContext.mockClear();
        mockEmbed.embed.mockClear().mockReturnValue(false);
        mockEmbed.profile.mockClear().mockReturnValue(null);
        mockAuth.loginStatusValue = null;
        mockAuth.refreshLoginStatus.mockClear();
        mockSsoRedirect.attemptAutoRedirect.mockClear().mockReturnValue('redirected');
        mockSsoRedirect.resetBudget.mockClear();
        mockSsoRedirect.isBudgetExhausted.mockClear().mockReturnValue(false);

        TestBed.configureTestingModule({
            providers: [
                AppNetworkInitService,
                { provide: SignalKConnectionService, useValue: mockConnection },
                { provide: AuthenticationService, useValue: mockAuth },
                { provide: SsoRedirectService, useValue: mockSsoRedirect },
                { provide: ConnectionStateMachine, useValue: mockConnectionStateMachine },
                { provide: SignalKDeltaService, useValue: {} },
                { provide: DataService, useValue: {} },
                { provide: StorageService, useValue: mockStorage },
                { provide: InternetReachabilityService, useValue: mockInternetReachability },
                { provide: EmbedModeService, useValue: mockEmbed }
            ]
        });
        service = TestBed.inject(AppNetworkInitService);
    });

    function handleCookieAuth(status: ILoginStatus | null): 'redirecting' | 'proceed' | 'auth-blocked' {
        return (service as unknown as { handleCookieAuth: (s: ILoginStatus | null) => 'redirecting' | 'proceed' | 'auth-blocked' }).handleCookieAuth(status);
    }

    function routeToReauth(): void {
        (service as unknown as { routeToReauth: () => void }).routeToReauth();
    }

    function latestIssue(): IBootstrapIssue {
        let issue: IBootstrapIssue = { reason: 'none' };
        service.bootstrapIssue$.subscribe(i => (issue = i)).unsubscribe();
        return issue;
    }

    function latestStatus(): string {
        let status = '';
        service.bootstrapStatus$.subscribe(s => (status = s)).unsubscribe();
        return status;
    }

    function setConnConfig(cfg: Partial<IConnectionConfig>): void {
        (service as unknown as { config: Partial<IConnectionConfig> }).config = cfg;
    }
    function migrate(remoteConfig: IConfig | null, ephemeralOverrideActive = false): void {
        (service as unknown as { migrateRemoteControlToDevice: (r: IConfig | null, e?: boolean) => void }).migrateRemoteControlToDevice(remoteConfig, ephemeralOverrideActive);
    }
    function storedConn(): IConnectionConfig | null {
        const raw = localStorage.getItem('skip.connectionConfig');
        return raw ? JSON.parse(raw) : null;
    }

    describe('connection initialization (fixed routing, demand-driven subscription #386)', () => {
        const storeConn = (extra: Record<string, unknown>): void => {
            localStorage.setItem('skip.connectionConfig', JSON.stringify({
                configVersion: 13, skipUUID: 'test-uuid', signalKUrl: 'http://localhost',
                proxyEnabled: false, signalKSubscribeAll: false, sharedConfigName: 'default',
                isRemoteControl: false, instanceName: '', ...extra
            }));
            mockConnection.initializeConnection.mockClear();
        };

        it('fails open to subscribe=all when demand was never computed (absent flag)', async () => {
            // proxyEnabled is always true (routing forced to the app origin); the legacy
            // signalKSubscribeAll=false is inert. With no remoteContextDemand, scope must be `all` so
            // AIS targets are never silently hidden.
            storeConn({});
            await service.initNetworkServices();
            expect(mockConnection.initializeConnection).toHaveBeenCalledWith(
                { url: 'http://localhost', new: false }, true, true
            );
        });

        it('narrows to subscribe=self when the computed demand is false', async () => {
            storeConn({ remoteContextDemand: false });
            await service.initNetworkServices();
            expect(mockConnection.initializeConnection).toHaveBeenCalledWith(
                { url: 'http://localhost', new: false }, true, false
            );
        });

        it('subscribes to all remote contexts when the computed demand is true', async () => {
            storeConn({ remoteContextDemand: true });
            await service.initNetworkServices();
            expect(mockConnection.initializeConnection).toHaveBeenCalledWith(
                { url: 'http://localhost', new: false }, true, true
            );
        });
    });

    describe('migrateRemoteControlToDevice (connectionConfig v12 -> v13)', () => {
        const baseV12: Partial<IConnectionConfig> = { configVersion: 12, isRemoteControl: false, instanceName: '' };

        it('boot with a loaded profile lifts its identity and stamps v13 once', () => {
            localStorage.removeItem('skip.connectionConfig');
            setConnConfig({ ...baseV12 });
            migrate({ app: { isRemoteControl: true, instanceName: 'Helm' } } as unknown as IConfig);
            expect(storedConn()?.isRemoteControl).toBe(true);
            expect(storedConn()?.instanceName).toBe('Helm');
            expect(storedConn()?.configVersion).toBe(13);
        });

        it('boot without a profile lifts the identity from the legacy local appConfig', () => {
            localStorage.removeItem('skip.connectionConfig');
            localStorage.setItem('skip.appConfig', JSON.stringify({ isRemoteControl: true, instanceName: 'Mast' }));
            setConnConfig({ ...baseV12 });
            migrate(null);
            expect(storedConn()?.isRemoteControl).toBe(true);
            expect(storedConn()?.instanceName).toBe('Mast');
            expect(storedConn()?.configVersion).toBe(13);
        });

        it('a default-blob appConfig (getDefault* side-effect shape) contributes nothing — identity defaults apply', () => {
            // Pins decision 5's safety argument (issue #17): the fallback read wants previously-stored
            // legacy identity. A blob written by SettingsService.getDefaultAppConfig carries no
            // isRemoteControl/instanceName (removed from IAppConfig), so its presence yields exactly
            // what its absence would — stripping that side-effect write is unobservable here.
            localStorage.removeItem('skip.connectionConfig');
            localStorage.setItem('skip.appConfig', JSON.stringify({
                configVersion: 12, autoNightMode: true, redNightMode: false, nightModeBrightness: 0.27,
                dataSets: [], notificationConfig: {}, browserTabTitle: 'Skip'
            }));
            setConnConfig({ ...baseV12, isRemoteControl: true, instanceName: 'stale' });
            migrate(null);
            expect(storedConn()?.isRemoteControl).toBe(false);
            expect(storedConn()?.instanceName).toBe('');
            expect(storedConn()?.configVersion).toBe(13);
        });

        it('boot with neither profile nor local appConfig migrates with identity defaults', () => {
            localStorage.removeItem('skip.connectionConfig');
            localStorage.removeItem('skip.appConfig');
            setConnConfig({ ...baseV12, isRemoteControl: true, instanceName: 'stale' });
            migrate(null);
            expect(storedConn()?.isRemoteControl).toBe(false);
            expect(storedConn()?.instanceName).toBe('');
            expect(storedConn()?.configVersion).toBe(13);
        });

        it('is a no-op when already migrated (version >= 13)', () => {
            localStorage.removeItem('skip.connectionConfig');
            setConnConfig({ ...baseV12, configVersion: 13 });
            migrate({ app: { isRemoteControl: true, instanceName: 'X' } } as unknown as IConfig);
            expect(storedConn()).toBeNull();
        });

        it('an ephemeral ?profile override never sources the device identity from its slot (#216 E6)', () => {
            // The ephemeral slot advertises a remote-control identity that must NOT persist; the
            // device migrates from its OWN legacy local appConfig instead.
            localStorage.removeItem('skip.connectionConfig');
            localStorage.setItem('skip.appConfig', JSON.stringify({ isRemoteControl: false, instanceName: 'DeviceOwn' }));
            setConnConfig({ ...baseV12 });
            migrate({ app: { isRemoteControl: true, instanceName: 'EphemeralDay' } } as unknown as IConfig, true);
            expect(storedConn()?.isRemoteControl).toBe(false);
            expect(storedConn()?.instanceName).toBe('DeviceOwn');
            expect(storedConn()?.configVersion).toBe(13);
        });

        it('an ephemeral override with no local appConfig migrates with identity defaults, not the ephemeral slot', () => {
            localStorage.removeItem('skip.connectionConfig');
            localStorage.removeItem('skip.appConfig');
            setConnConfig({ ...baseV12 });
            migrate({ app: { isRemoteControl: true, instanceName: 'EphemeralDay' } } as unknown as IConfig, true);
            expect(storedConn()?.isRemoteControl).toBe(false);
            expect(storedConn()?.instanceName).toBe('');
            expect(storedConn()?.configVersion).toBe(13);
        });
    });

    describe('cookie-mode bootstrap auth (Unit 6)', () => {
        it('logged-in: proceeds without resetting the budget here (reset deferred to a clean bootstrap)', () => {
            expect(handleCookieAuth({ status: 'loggedIn' })).toBe('proceed');
            expect(mockSsoRedirect.resetBudget).not.toHaveBeenCalled();
            expect(mockSsoRedirect.attemptAutoRedirect).not.toHaveBeenCalled();
        });

        it('null/unreachable loginStatus: fails closed to auth-blocked, not anonymous-open', () => {
            expect(handleCookieAuth(null)).toBe('auth-blocked');
            expect(mockSsoRedirect.attemptAutoRedirect).not.toHaveBeenCalled();
            expect(latestIssue()).toEqual({ reason: 'auth-blocked', cause: 'sign-in-required' });
        });
    });

    describe('mid-bootstrap 401 re-auth routing (Unit 6)', () => {
        it('oidcAutoLogin auto-redirects (budget-guarded)', () => {
            mockAuth.loginStatusValue = { status: 'loggedIn', oidcAutoLogin: true };
            mockSsoRedirect.attemptAutoRedirect.mockReturnValue('redirected');

            routeToReauth();

            expect(mockSsoRedirect.attemptAutoRedirect).toHaveBeenCalledWith(mockAuth.loginStatusValue);
        });

        it('cookie mode honors oidcAutoLogin:false (no auto-redirect on a 401)', () => {
            mockAuth.loginStatusValue = { status: 'loggedIn', oidcAutoLogin: false };

            routeToReauth();

            expect(mockSsoRedirect.attemptAutoRedirect).not.toHaveBeenCalled();
            expect(latestIssue()).toEqual({ reason: 'auth-blocked', cause: 'sign-in-required' });
        });

        it('cookie mode surfaces auth-blocked when the budget is exhausted (no infinite 401 loop)', () => {
            mockAuth.loginStatusValue = { status: 'loggedIn', oidcAutoLogin: true };
            mockSsoRedirect.attemptAutoRedirect.mockReturnValue('budget-exhausted');
            mockSsoRedirect.isBudgetExhausted.mockReturnValue(true);

            routeToReauth();

            expect(latestIssue()).toEqual({ reason: 'auth-blocked', cause: 'budget-exhausted' });
        });

        it('not-logged-in + authRequired + oidcAutoLogin: auto-redirects to SSO', () => {
            mockSsoRedirect.attemptAutoRedirect.mockReturnValue('redirected');
            const status: ILoginStatus = { status: 'notLoggedIn', authenticationRequired: true, oidcAutoLogin: true, oidcEnabled: true };

            expect(handleCookieAuth(status)).toBe('redirecting');

            expect(mockSsoRedirect.attemptAutoRedirect).toHaveBeenCalledWith(status);
        });

        it('budget exhausted: proceeds with an auth-blocked/budget-exhausted issue, no loop', () => {
            mockSsoRedirect.attemptAutoRedirect.mockReturnValue('budget-exhausted');
            mockSsoRedirect.isBudgetExhausted.mockReturnValue(true);

            expect(handleCookieAuth({ status: 'notLoggedIn', authenticationRequired: true, oidcAutoLogin: true })).toBe('auth-blocked');

            expect(latestIssue()).toEqual({ reason: 'auth-blocked', cause: 'budget-exhausted' });
        });

        it('framed boot: framed outcome -> auth-blocked/sign-in-required even if a stale shared budget is exhausted (#217)', () => {
            mockSsoRedirect.attemptAutoRedirect.mockReturnValue('framed');
            mockSsoRedirect.isBudgetExhausted.mockReturnValue(true);

            expect(handleCookieAuth({ status: 'notLoggedIn', authenticationRequired: true, oidcAutoLogin: true })).toBe('auth-blocked');

            // The framed prompt must never inherit a stale standalone budget's 'budget-exhausted' wording.
            expect(latestIssue()).toEqual({ reason: 'auth-blocked', cause: 'sign-in-required' });
        });

        it('oidcAutoLogin disabled: does not auto-redirect, surfaces sign-in-required', () => {
            const status: ILoginStatus = { status: 'notLoggedIn', authenticationRequired: true, oidcAutoLogin: false, oidcEnabled: true };

            expect(handleCookieAuth(status)).toBe('auth-blocked');

            expect(mockSsoRedirect.attemptAutoRedirect).not.toHaveBeenCalled();
            expect(latestIssue()).toEqual({ reason: 'auth-blocked', cause: 'sign-in-required' });
        });

        it('authentication not required: anonymous read, no redirect, no auth-blocked issue', () => {
            expect(handleCookieAuth({ status: 'notLoggedIn', authenticationRequired: false })).toBe('proceed');

            expect(mockSsoRedirect.attemptAutoRedirect).not.toHaveBeenCalled();
            expect(latestIssue().reason).not.toBe('auth-blocked');
        });
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    describe('loadLocalStorageConfig default seeding (issue #100)', () => {
        it('clones DefaultConnectionConfig instead of mutating the shared singleton', () => {
            localStorage.removeItem('skip.connectionConfig');

            (service as unknown as { loadLocalStorageConfig: () => void }).loadLocalStorageConfig();

            const config = (service as unknown as { config: IConnectionConfig }).config;
            expect(config).not.toBe(DefaultConnectionConfig);
            expect(config.signalKUrl).toBe(window.location.origin);
            // The blank singleton stays pristine: earlier end-to-end runs in this file also seed the
            // default config, so assert the known blank value rather than a captured "before" value.
            expect(DefaultConnectionConfig.signalKUrl).toBeNull();
        });
    });

    it('should use connection retry window when no timeout is provided', async () => {
        mockConnectionStateMachine.currentState = ConnectionState.HTTPConnected;

        const result = await (service as unknown as {
            waitForHttpRetryCompletion: (timeoutMs?: number) => Promise<ConnectionState | null>;
        }).waitForHttpRetryCompletion();

        expect(mockConnectionStateMachine.getHttpRetryWindowMs).toHaveBeenCalledWith(2000);
        expect(result).toBe(ConnectionState.HTTPConnected);
    });

    it('should skip connection retry window lookup when explicit timeout is provided', async () => {
        mockConnectionStateMachine.currentState = ConnectionState.PermanentFailure;

        const result = await (service as unknown as {
            waitForHttpRetryCompletion: (timeoutMs?: number) => Promise<ConnectionState | null>;
        }).waitForHttpRetryCompletion(100);

        expect(mockConnectionStateMachine.getHttpRetryWindowMs).not.toHaveBeenCalled();
        expect(result).toBe(ConnectionState.PermanentFailure);
    });

    // End-to-end initNetworkServices() runs — these pin the seam between handleCookieAuth and the
    // finally that an isolated handleCookieAuth test cannot see (the original P0 loop-guard hole).
    describe('cookie-mode bootstrap end-to-end (Unit 6 loop-guard seam)', () => {
        it('budget-exhausted: keeps the auth-blocked recovery state and does NOT reset the budget', async () => {
            mockAuth.refreshLoginStatus.mockResolvedValue({ status: 'notLoggedIn', authenticationRequired: true, oidcAutoLogin: true });
            mockSsoRedirect.attemptAutoRedirect.mockReturnValue('budget-exhausted');
            mockSsoRedirect.isBudgetExhausted.mockReturnValue(true);

            await service.initNetworkServices();

            expect(latestIssue()).toEqual({ reason: 'auth-blocked', cause: 'budget-exhausted' });
            expect(mockSsoRedirect.resetBudget).not.toHaveBeenCalled();
        });

        it('null loginStatus: keeps the auth-blocked recovery state and does NOT reset the budget', async () => {
            mockAuth.refreshLoginStatus.mockResolvedValue(null);

            await service.initNetworkServices();

            expect(latestIssue()).toEqual({ reason: 'auth-blocked', cause: 'sign-in-required' });
            expect(mockSsoRedirect.resetBudget).not.toHaveBeenCalled();
        });

        it('logged-in clean bootstrap resets the budget', async () => {
            mockAuth.refreshLoginStatus.mockImplementation(async () => { isLoggedIn$.next(true); return { status: 'loggedIn' }; });

            await service.initNetworkServices();

            expect(mockSsoRedirect.resetBudget).toHaveBeenCalled();
        });

        it('logged-in with an appless 200 {} config raises missing-shared-config, not a clean bootstrap', async () => {
            mockAuth.refreshLoginStatus.mockImplementation(async () => { isLoggedIn$.next(true); return { status: 'loggedIn' }; });
            mockStorage.getConfig.mockResolvedValue({} as IConfig);

            await service.initNetworkServices();

            expect(latestIssue().reason).toBe('missing-shared-config');
            expect(mockStorage.bootstrapRemoteContext).not.toHaveBeenCalled();
            expect(mockSsoRedirect.resetBudget).not.toHaveBeenCalled();
        });

        it('does not double-start the WebSocket when a connect is already in flight at the finally', async () => {
            mockAuth.refreshLoginStatus.mockImplementation(async () => { isLoggedIn$.next(true); return { status: 'loggedIn' }; });
            mockConnectionStateMachine.currentState = ConnectionState.WebSocketConnecting;

            await service.initNetworkServices();

            expect(mockConnectionStateMachine.startWebSocketConnection).not.toHaveBeenCalled();
        });

        it('classifies a genuine storage 404 as missing-shared-config (recovery toast reachable)', async () => {
            mockAuth.refreshLoginStatus.mockImplementation(async () => { isLoggedIn$.next(true); return { status: 'loggedIn' }; });
            mockStorage.getConfig.mockRejectedValue({ status: 404 });

            await service.initNetworkServices();

            expect(latestIssue()).toEqual({ reason: 'missing-shared-config', statusCode: 404, sharedConfigName: 'default' });
        });

        it('classifies a discovery 404 as unknown — config recovery must not be offered', async () => {
            // A 404 from GET /signalk/ (SK serving the app but not the API) reaches the same
            // bootstrap catch; only the config fetch's own 404 may claim missing-shared-config.
            mockConnection.initializeConnection.mockRejectedValueOnce({ status: 404 });

            await service.initNetworkServices();

            // Unknown bootstrap failure surfaces the in-place recovery state (degraded -> Retry toast),
            // never a redirect to the legacy /options page (#190).
            expect(latestIssue()).toEqual({ reason: 'unknown', statusCode: 404 });
            expect(latestStatus()).toBe('degraded');
        });

        it('network-unreachable (status 0) that stays down: raises the recovery issue, degraded, no redirect', async () => {
            mockConnection.initializeConnection.mockRejectedValueOnce({ status: 0 });
            // Terminal, non-recovered state so the HTTP retry wait returns at once.
            mockConnectionStateMachine.currentState = ConnectionState.PermanentFailure;

            await service.initNetworkServices();

            expect(latestIssue()).toEqual({ reason: 'network-unreachable', statusCode: 0 });
            expect(latestStatus()).toBe('degraded');
        });

        it('network-unreachable (status 0) that recovers during retry: reports startup-failed, not a false "cannot reach"', async () => {
            mockConnection.initializeConnection.mockRejectedValueOnce({ status: 0 });
            // HTTP is back by the time the retry wait checks -> recovery branch.
            mockConnectionStateMachine.currentState = ConnectionState.HTTPConnected;

            await service.initNetworkServices();

            // Reachable again but bootstrap never completed -> an accurate 'unknown' recovery issue,
            // NOT a misleading 'network-unreachable' that would claim the server is unreachable.
            expect(latestIssue()).toEqual({ reason: 'unknown', statusCode: 0 });
            expect(latestStatus()).toBe('degraded');
        });

        it('starts the WebSocket once from a fresh HTTPConnected state', async () => {
            // Anonymous read (authentication not required): a clean, non-degraded bootstrap.
            mockAuth.refreshLoginStatus.mockResolvedValue({ status: 'notLoggedIn', authenticationRequired: false });
            mockConnectionStateMachine.currentState = ConnectionState.HTTPConnected;

            await service.initNetworkServices();

            expect(mockConnectionStateMachine.startWebSocketConnection).toHaveBeenCalledTimes(1);
        });
    });

    // Ephemeral URL-selected profile (#216 E6): a valid `?profile=<name>` loads a different slot for
    // this session only; it must thread into getConfig + bootstrap but NEVER persist to localStorage.
    describe('ephemeral URL profile override (#216 E6)', () => {
        function seedPersistedConnConfig(name: string): void {
            localStorage.setItem('skip.connectionConfig', JSON.stringify({
                configVersion: 13,
                skipUUID: 'test-uuid',
                signalKUrl: 'http://localhost',
                proxyEnabled: false,
                signalKSubscribeAll: false,
                sharedConfigName: name,
                isRemoteControl: false,
                instanceName: ''
            }));
        }

        function loginAs(): void {
            mockAuth.refreshLoginStatus.mockImplementation(async () => { isLoggedIn$.next(true); return { status: 'loggedIn' }; });
        }

        it('threads a valid, existing override into getConfig + bootstrap without persisting it', async () => {
            seedPersistedConnConfig('default');
            loginAs();
            mockEmbed.profile.mockReturnValue('day');
            mockStorage.listConfigs.mockResolvedValue([
                { scope: 'user', name: 'default' },
                { scope: 'user', name: 'day' }
            ]);

            await service.initNetworkServices();

            expect(mockStorage.listConfigs).toHaveBeenCalledWith(REMOTE_CONFIG_FILE_VERSION);
            expect(mockStorage.getConfig).toHaveBeenCalledWith('user', 'day', REMOTE_CONFIG_FILE_VERSION);
            expect(mockStorage.bootstrapRemoteContext).toHaveBeenCalledWith(expect.objectContaining({ sharedConfigName: 'day' }));
            // Ephemerality: the persisted per-device profile in localStorage is UNCHANGED.
            expect(storedConn()?.sharedConfigName).toBe('default');
        });

        it('falls back with a warning (not missing-config) when the override is unknown', async () => {
            seedPersistedConnConfig('default');
            loginAs();
            mockEmbed.profile.mockReturnValue('ghost');
            mockStorage.listConfigs.mockResolvedValue([{ scope: 'user', name: 'default' }]);
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

            await service.initNetworkServices();

            expect(mockStorage.getConfig).toHaveBeenCalledWith('user', 'default', REMOTE_CONFIG_FILE_VERSION);
            expect(latestIssue().reason).toBe('none');
            expect(warn).toHaveBeenCalled();
            expect(storedConn()?.sharedConfigName).toBe('default');
            warn.mockRestore();
        });

        it('rejects a malformed override on charset, without listing or persisting', async () => {
            seedPersistedConnConfig('default');
            loginAs();
            mockEmbed.profile.mockReturnValue('../etc/passwd');
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

            await service.initNetworkServices();

            expect(mockStorage.listConfigs).not.toHaveBeenCalled();
            expect(mockStorage.getConfig).toHaveBeenCalledWith('user', 'default', REMOTE_CONFIG_FILE_VERSION);
            expect(warn).toHaveBeenCalled();
            expect(storedConn()?.sharedConfigName).toBe('default');
            warn.mockRestore();
        });

        it('no override: the persisted default still drives the 404 missing-shared-config recovery', async () => {
            seedPersistedConnConfig('default');
            loginAs();
            mockStorage.getConfig.mockRejectedValue({ status: 404 });

            await service.initNetworkServices();

            expect(mockStorage.listConfigs).not.toHaveBeenCalled();
            expect(latestIssue()).toEqual({ reason: 'missing-shared-config', statusCode: 404, sharedConfigName: 'default' });
        });

        it('pre-v13 boot: a valid override never leaks the ephemeral slot identity into the persisted config', async () => {
            // Pre-v13 connectionConfig so the one-time remote-control migration runs during bootstrap.
            localStorage.setItem('skip.connectionConfig', JSON.stringify({
                configVersion: 12, skipUUID: 'test-uuid', signalKUrl: 'http://localhost',
                proxyEnabled: false, signalKSubscribeAll: false, sharedConfigName: 'default',
                isRemoteControl: false, instanceName: ''
            }));
            localStorage.removeItem('skip.appConfig');
            loginAs();
            mockEmbed.profile.mockReturnValue('day');
            mockStorage.listConfigs.mockResolvedValue([
                { scope: 'user', name: 'default' },
                { scope: 'user', name: 'day' }
            ]);
            // The ephemeral 'day' slot advertises a remote-control identity that must NOT persist.
            mockStorage.getConfig.mockResolvedValue({
                app: { configVersion: 11, isRemoteControl: true, instanceName: 'EphemeralDay' }, theme: null, dashboards: []
            } as unknown as IConfig);

            await service.initNetworkServices();

            const cc = storedConn();
            expect(cc?.isRemoteControl).toBe(false);
            expect(cc?.instanceName).toBe('');
            expect(cc?.sharedConfigName).toBe('default');
            expect(cc?.configVersion).toBe(13);
        });
    });
});
