import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject } from 'rxjs';

import { AppNetworkInitService, IBootstrapIssue, MIN_SIGNALK_SERVER_VERSION, TCookieAuthOutcome } from './app-initNetwork.service';
import { IConfig, IConnectionConfig } from '../interfaces/app-settings.interfaces';
import { EndpointStatus, IEndpointStatus, SignalKConnectionService } from './signalk-connection.service';
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
import { LATEST_APP_CONFIG_VERSION, REMOTE_CONFIG_FILE_VERSION } from '../constants/config-versions.const';

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
        initializeConnection: vi.fn().mockResolvedValue(undefined),
        setSubscribeAll: vi.fn(),
        serverServiceEndpoint$: new BehaviorSubject<IEndpointStatus | null>(null),
        serverVersion$: new BehaviorSubject<string | null>(MIN_SIGNALK_SERVER_VERSION)
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

    // A v18 config holding one autopilot: the v18 -> v19 step fixes its heading picker and deletes
    // its dead windAngleTrueWater slot, so the rendered config shows whether the chain ran.
    const v18AutopilotConfig = (): IConfig => ({
        app: { configVersion: 18 },
        theme: { themeName: '' },
        dashboards: [{ id: 'd1', configuration: [{ id: 'w1', selector: 'widget-host2', input: { widgetProperties: {
            type: 'widget-autopilot', uuid: 'w1', config: { paths: {
                headingTrue: { path: 'self.navigation.headingTrue', isPathConfigurable: true },
                windAngleTrueWater: { path: 'self.environment.wind.angleTrueWater' }
            } }
        } } }] }]
    } as unknown as IConfig);

    function autopilotPaths(config: IConfig): Record<string, { isPathConfigurable?: boolean }> {
        return (config.dashboards[0].configuration?.[0] as unknown as {
            input: { widgetProperties: { config: { paths: Record<string, { isPathConfigurable?: boolean }> } } };
        }).input.widgetProperties.config.paths;
    }

    function bootstrappedConfig(): IConfig {
        return mockStorage.bootstrapRemoteContext.mock.calls[0][0].initConfig;
    }

    const mockStorage = {
        waitUntilReady: vi.fn().mockResolvedValue(true),
        getConfig: vi.fn().mockResolvedValue(validRemoteConfig()),
        listConfigs: vi.fn().mockResolvedValue([]),
        setConfig: vi.fn().mockResolvedValue(undefined),
        canPersist: vi.fn().mockReturnValue(true),
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
        mockStorage.setConfig.mockClear();
        mockStorage.canPersist.mockClear().mockReturnValue(true);
        mockConnection.setSubscribeAll.mockClear();
        mockConnection.serverVersion$.next(MIN_SIGNALK_SERVER_VERSION);
        mockEmbed.embed.mockClear().mockReturnValue(false);
        mockEmbed.profile.mockClear().mockReturnValue(null);
        mockAuth.loginStatusValue = null;
        mockAuth.refreshLoginStatus.mockReset().mockResolvedValue(null);
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

    function handleCookieAuth(status: ILoginStatus | null): TCookieAuthOutcome {
        return (service as unknown as { handleCookieAuth: (s: ILoginStatus | null) => TCookieAuthOutcome }).handleCookieAuth(status);
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

        it('narrows to subscribe=self when the ACTIVE profile computed demand is false', async () => {
            storeConn({ remoteContextDemand: { default: false } });
            await service.initNetworkServices();
            expect(mockConnection.initializeConnection).toHaveBeenCalledWith(
                { url: 'http://localhost', new: false }, true, false
            );
        });

        it('subscribes to all when the active profile computed demand is true', async () => {
            storeConn({ remoteContextDemand: { default: true } });
            await service.initNetworkServices();
            expect(mockConnection.initializeConnection).toHaveBeenCalledWith(
                { url: 'http://localhost', new: false }, true, true
            );
        });

        it('fails open when only a SIBLING profile has demand (profile switch regression, #386)', async () => {
            // Active profile is 'default'; the map holds demand for a different profile only. The
            // active profile's demand is unknown -> must fail open to `all`, never inherit the sibling's
            // false and silently hide AIS after a profile switch.
            storeConn({ remoteContextDemand: { night: false } });
            await service.initNetworkServices();
            expect(mockConnection.initializeConnection).toHaveBeenCalledWith(
                { url: 'http://localhost', new: false }, true, true
            );
        });

        it('forces subscribe=all in embed mode, ignoring a stored demand=false (#386)', async () => {
            // The device map describes device profiles, not the ephemerally-rendered embed slot,
            // so embed must fail open to all or an embedded AIS radar would go blank.
            storeConn({ remoteContextDemand: { default: false } });
            mockEmbed.embed.mockReturnValue(true);
            await service.initNetworkServices();
            expect(mockConnection.initializeConnection).toHaveBeenCalledWith(
                { url: 'http://localhost', new: false }, true, true
            );
        });

        it('forces subscribe=all under an ephemeral ?profile, ignoring a stored demand=false (#386)', async () => {
            storeConn({ remoteContextDemand: { default: false } });
            mockEmbed.profile.mockReturnValue('guest');
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

    // The server hardcodes authenticationRequired:true whenever security is enabled, whatever
    // allow_readonly says; readOnlyAccess is the field that reports anonymous read. Auto-login still
    // outranks it, so a device configured to sign its users in keeps doing that (#550).
    describe('anonymous read-only access (#550)', () => {
        const readOnly = (extra: Partial<ILoginStatus> = {}): ILoginStatus =>
            ({ status: 'notLoggedIn', authenticationRequired: true, readOnlyAccess: true, ...extra });

        it('readOnlyAccess without OIDC: read-only anonymous session, no redirect', () => {
            expect(handleCookieAuth(readOnly())).toBe('anonymous');

            expect(mockSsoRedirect.attemptAutoRedirect).not.toHaveBeenCalled();
            expect(latestIssue().reason).not.toBe('auth-blocked');
        });

        it('readOnlyAccess with oidcAutoLogin: still redirects (HaLOS keeps its SSO bounce)', () => {
            mockSsoRedirect.attemptAutoRedirect.mockReturnValue('redirected');

            expect(handleCookieAuth(readOnly({ oidcEnabled: true, oidcAutoLogin: true }))).toBe('redirecting');
        });

        it('readOnlyAccess with oidcAutoLogin:false: read-only rather than auth-blocked', () => {
            expect(handleCookieAuth(readOnly({ oidcEnabled: true, oidcAutoLogin: false }))).toBe('anonymous');

            expect(mockSsoRedirect.attemptAutoRedirect).not.toHaveBeenCalled();
            expect(latestIssue().reason).not.toBe('auth-blocked');
        });

        it('readOnlyAccess:false: unchanged, the visitor is still sent to sign in', () => {
            mockSsoRedirect.attemptAutoRedirect.mockReturnValue('redirected');

            expect(handleCookieAuth({ status: 'notLoggedIn', authenticationRequired: true, readOnlyAccess: false })).toBe('redirecting');
        });

        it('readOnlyAccess absent: fails closed to the sign-in path', () => {
            mockSsoRedirect.attemptAutoRedirect.mockReturnValue('redirected');

            expect(handleCookieAuth({ status: 'notLoggedIn', authenticationRequired: true })).toBe('redirecting');
        });

        it('an anonymous verdict never reaches the redirect machinery', () => {
            handleCookieAuth(readOnly());

            expect(mockSsoRedirect.attemptAutoRedirect).not.toHaveBeenCalled();
            expect(mockSsoRedirect.isBudgetExhausted).not.toHaveBeenCalled();
        });

        // The redirect being refused says something about this browser, not about what the server
        // will serve. A server granting anonymous read must still show the instruments.
        it('falls back to read-only when an auto-login redirect is refused (SSO down)', () => {
            mockSsoRedirect.attemptAutoRedirect.mockReturnValue('budget-exhausted');
            mockSsoRedirect.isBudgetExhausted.mockReturnValue(true);

            expect(handleCookieAuth(readOnly({ oidcEnabled: true, oidcAutoLogin: true }))).toBe('anonymous');

            expect(latestIssue().reason).toBe('none');
        });

        it('falls back to read-only for a framed boot the login endpoint would refuse', () => {
            mockSsoRedirect.attemptAutoRedirect.mockReturnValue('framed');

            expect(handleCookieAuth(readOnly({ oidcEnabled: true, oidcAutoLogin: true }))).toBe('anonymous');

            expect(latestIssue().reason).toBe('none');
        });

        it('still blocks when the redirect is refused and the server grants no anonymous read', () => {
            mockSsoRedirect.attemptAutoRedirect.mockReturnValue('budget-exhausted');
            mockSsoRedirect.isBudgetExhausted.mockReturnValue(true);

            expect(handleCookieAuth({ status: 'notLoggedIn', authenticationRequired: true, oidcAutoLogin: true })).toBe('auth-blocked');

            expect(latestIssue()).toEqual({ reason: 'auth-blocked', cause: 'budget-exhausted' });
        });
    });

    // A session-less visitor has no user-scope slot to load, so the dashboards come from the shared
    // global scope, falling back to the dashboards shipped in this release (#551).
    describe('anonymous bootstrap config source (#551)', () => {
        // The pre-auth scope comes from the stored per-device demand map, so these tests have to seed
        // localStorage rather than the in-memory config: initNetworkServices reloads it on entry.
        const storeAnonConn = (remoteContextDemand: Record<string, boolean>): void => {
            localStorage.setItem('skip.connectionConfig', JSON.stringify({
                configVersion: 13, skipUUID: 'test-uuid', signalKUrl: 'http://localhost',
                proxyEnabled: false, signalKSubscribeAll: false, sharedConfigName: 'default',
                isRemoteControl: false, instanceName: '', remoteContextDemand
            }));
            mockConnection.initializeConnection.mockClear();
        };

        beforeEach(() => {
            mockAuth.refreshLoginStatus.mockResolvedValue({
                status: 'notLoggedIn', authenticationRequired: true, readOnlyAccess: true
            });
        });

        it('reads the published dashboard from the global scope', async () => {
            const published = { app: { configVersion: LATEST_APP_CONFIG_VERSION }, theme: null, dashboards: [{ id: 'published' }] } as unknown as IConfig;
            mockStorage.getConfig.mockResolvedValue(published);

            await service.initNetworkServices();

            expect(mockStorage.getConfig).toHaveBeenCalledWith('global', 'default', REMOTE_CONFIG_FILE_VERSION);
            expect(mockStorage.bootstrapRemoteContext).toHaveBeenCalledWith(
                expect.objectContaining({ initConfig: published, readOnly: true })
            );
            expect(latestStatus()).toBe('ready');
        });

        it('renders an older published config migrated in memory, writing nothing back', async () => {
            mockStorage.getConfig.mockResolvedValue(v18AutopilotConfig());

            await service.initNetworkServices();

            const rendered = bootstrappedConfig();
            expect(rendered.app?.configVersion).toBe(LATEST_APP_CONFIG_VERSION);
            expect(autopilotPaths(rendered)['windAngleTrueWater']).toBeUndefined();
            expect(autopilotPaths(rendered)['headingTrue'].isPathConfigurable).toBe(false);
            expect(mockStorage.setConfig).not.toHaveBeenCalled();
            expect(latestStatus()).toBe('ready');
        });

        it('renders a published config newer than this release unmigrated, with a warning', async () => {
            const newer = { app: { configVersion: LATEST_APP_CONFIG_VERSION + 1 }, theme: null, dashboards: [{ id: 'newer' }] } as unknown as IConfig;
            mockStorage.getConfig.mockResolvedValue(newer);
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

            await service.initNetworkServices();

            expect(bootstrappedConfig()).toEqual(newer);
            expect(warn).toHaveBeenCalledWith(expect.stringMatching(/newer/i));
            warn.mockRestore();
        });

        it('falls back to the shipped dashboards when the published config cannot be migrated', async () => {
            mockStorage.getConfig.mockResolvedValue({ app: {}, theme: null, dashboards: [{ id: 'unversioned' }] } as unknown as IConfig);
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

            await service.initNetworkServices();

            const rendered = bootstrappedConfig();
            expect(rendered.app?.configVersion).toBe(LATEST_APP_CONFIG_VERSION);
            expect(rendered.dashboards.some(d => d.id === 'unversioned')).toBe(false);
            expect(rendered.dashboards.length).toBeGreaterThan(0);
            expect(warn).toHaveBeenCalledWith(expect.stringMatching(/recognizable version/i));
            expect(latestStatus()).toBe('ready');
            warn.mockRestore();
        });

        it('falls back to the shipped dashboards when the published config is below the migration floor', async () => {
            mockStorage.getConfig.mockResolvedValue({ app: { configVersion: 10 }, theme: null, dashboards: [{ id: 'ancient' }] } as unknown as IConfig);
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

            await service.initNetworkServices();

            const rendered = bootstrappedConfig();
            expect(rendered.app?.configVersion).toBe(LATEST_APP_CONFIG_VERSION);
            expect(rendered.dashboards.some(d => d.id === 'ancient')).toBe(false);
            expect(rendered.dashboards.length).toBeGreaterThan(0);
            expect(warn).toHaveBeenCalledWith(expect.stringMatching(/too old/i));
            expect(latestStatus()).toBe('ready');
            warn.mockRestore();
        });

        // The subscribe scope is picked pre-auth from the device's OWN profile demand, which describes
        // dashboards this session is not rendering (#561). A device whose profile needs no remote
        // contexts must not starve a shared dashboard's AIS widgets.
        it('widens the subscribe scope when the published dashboard needs remote contexts', async () => {
            storeAnonConn({ default: false });
            mockStorage.getConfig.mockResolvedValue({
                app: { configVersion: 11 },
                theme: null,
                dashboards: [{ configuration: [{ input: { widgetProperties: { type: 'widget-ais-radar' } } }] }]
            } as unknown as IConfig);

            await service.initNetworkServices();

            expect(mockConnection.initializeConnection).toHaveBeenCalledWith(expect.anything(), true, false);
            expect(mockConnection.setSubscribeAll).toHaveBeenCalledWith(true);
        });

        it('narrows the subscribe scope when the published dashboard needs none', async () => {
            storeAnonConn({ default: true });
            mockStorage.getConfig.mockResolvedValue({
                app: { configVersion: 11 },
                theme: null,
                dashboards: [{ configuration: [{ input: { widgetProperties: { type: 'widget-numeric' } } }] }]
            } as unknown as IConfig);

            await service.initNetworkServices();

            expect(mockConnection.initializeConnection).toHaveBeenCalledWith(expect.anything(), true, true);
            expect(mockConnection.setSubscribeAll).toHaveBeenCalledWith(false);
        });

        it('falls back to the shipped dashboards when the server publishes none', async () => {
            mockStorage.getConfig.mockRejectedValue({ status: 404 });

            await service.initNetworkServices();

            const context = mockStorage.bootstrapRemoteContext.mock.calls[0][0];
            expect(context.initConfig.dashboards.length).toBeGreaterThan(0);
            expect(context.readOnly).toBe(true);
            expect(latestStatus()).toBe('ready');
        });

        it('treats an appless 200 {} global slot as nothing published', async () => {
            mockStorage.getConfig.mockResolvedValue({} as IConfig);

            await service.initNetworkServices();

            const context = mockStorage.bootstrapRemoteContext.mock.calls[0][0];
            expect(context.initConfig.app).toBeTruthy();
            expect(latestStatus()).toBe('ready');
        });

        it('never offers the missing-shared-config recovery to a visitor who has no profile', async () => {
            mockStorage.getConfig.mockRejectedValue({ status: 404 });

            await service.initNetworkServices();

            // Assert the anonymous path specifically: 'reason: none' is also the initial value, so
            // it alone would pass with the feature reverted (the redirect path returns early).
            expect(mockStorage.bootstrapRemoteContext).toHaveBeenCalledWith(expect.objectContaining({ readOnly: true }));
            expect(mockSsoRedirect.attemptAutoRedirect).not.toHaveBeenCalled();
            expect(latestIssue().reason).toBe('none');
        });

        // A 404 and an appless body mean 'nothing published'. Everything else means the operator's
        // dashboard exists and could not be fetched: showing a different one as if it were the
        // boat's is worse than saying so.
        it('surfaces a fetch failure instead of passing off the shipped dashboards as the published one', async () => {
            mockStorage.getConfig.mockRejectedValue({ status: 500 });

            await service.initNetworkServices();

            expect(mockStorage.bootstrapRemoteContext).not.toHaveBeenCalled();
            expect(latestStatus()).toBe('degraded');
        });

        it('falls back to the shipped dashboards when the published config is not a usable Skip config', async () => {
            mockStorage.getConfig.mockResolvedValue({ app: { configVersion: 11 }, dashboards: 'not-an-array' } as unknown as IConfig);

            await service.initNetworkServices();

            const context = mockStorage.bootstrapRemoteContext.mock.calls[0][0];
            expect(Array.isArray(context.initConfig.dashboards)).toBe(true);
            expect(latestStatus()).toBe('ready');
        });

        it('does not consume the one-shot remote-control migration', async () => {
            localStorage.setItem('skip.connectionConfig', JSON.stringify({
                configVersion: 12, skipUUID: 'test-uuid', signalKUrl: 'http://localhost',
                proxyEnabled: false, signalKSubscribeAll: false, sharedConfigName: 'default',
                isRemoteControl: false, instanceName: ''
            }));
            mockStorage.getConfig.mockRejectedValue({ status: 404 });

            await service.initNetworkServices();

            expect(storedConn()?.configVersion).toBe(12);
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

    describe('Signal K server version floor', () => {
        function loggedInBoot(version: string): void {
            mockConnection.serverVersion$.next(version);
            mockConnectionStateMachine.currentState = ConnectionState.HTTPConnected;
            mockAuth.refreshLoginStatus.mockImplementation(async () => { isLoggedIn$.next(true); return { status: 'loggedIn' }; });
        }

        it.each(['2.26.0', '2.33.0', '2.33.0-beta.1'])('boots normally on server %s', async (version) => {
            loggedInBoot(version);

            await service.initNetworkServices();

            expect(latestIssue()).toEqual({ reason: 'none' });
            expect(latestStatus()).toBe('ready');
            expect(mockStorage.getConfig).toHaveBeenCalled();
            expect(mockConnectionStateMachine.startWebSocketConnection).toHaveBeenCalledTimes(1);
        });

        it.each(['2.25.9', '2.26.0-beta.2'])('refuses to boot on server %s', async (version) => {
            loggedInBoot(version);

            await service.initNetworkServices();

            expect(latestIssue()).toEqual({ reason: 'server-unsupported', serverVersion: version, requiredVersion: '2.26.0' });
            expect(latestStatus()).toBe('degraded');
            expect(mockStorage.getConfig).not.toHaveBeenCalled();
            expect(mockStorage.bootstrapRemoteContext).not.toHaveBeenCalled();
        });

        it('checks before the login refresh, so a signed-in session never opens the WebSocket', async () => {
            loggedInBoot('2.25.9');

            await service.initNetworkServices();

            // SignalKDeltaService connects as soon as isLoggedIn$ turns true, so the refresh itself
            // must not run behind the notice.
            expect(mockAuth.refreshLoginStatus).not.toHaveBeenCalled();
            expect(isLoggedIn$.value).toBe(false);
            expect(mockConnectionStateMachine.startWebSocketConnection).not.toHaveBeenCalled();
            expect(mockSsoRedirect.attemptAutoRedirect).not.toHaveBeenCalled();
        });

        it('does not reset the sign-in redirect budget on an unsupported server', async () => {
            loggedInBoot('2.25.9');

            await service.initNetworkServices();

            expect(mockSsoRedirect.resetBudget).not.toHaveBeenCalled();
        });

        describe('against the real connection state machine and delta service', () => {
            let stateMachine: ConnectionStateMachine;
            let entered: ConnectionState[];

            beforeEach(() => {
                TestBed.resetTestingModule();
                TestBed.configureTestingModule({
                    providers: [
                        AppNetworkInitService,
                        ConnectionStateMachine,
                        SignalKDeltaService,
                        {
                            provide: SignalKConnectionService,
                            useValue: {
                                ...mockConnection,
                                serverServiceEndpoint$: new BehaviorSubject<IEndpointStatus>({
                                    state: EndpointStatus.Disconnected, message: '', serverDescription: '',
                                    httpServiceUrl: '', WsServiceUrl: ''
                                })
                            }
                        },
                        { provide: AuthenticationService, useValue: mockAuth },
                        { provide: SsoRedirectService, useValue: mockSsoRedirect },
                        { provide: DataService, useValue: {} },
                        { provide: StorageService, useValue: mockStorage },
                        { provide: InternetReachabilityService, useValue: mockInternetReachability },
                        { provide: EmbedModeService, useValue: mockEmbed }
                    ]
                });
                stateMachine = TestBed.inject(ConnectionStateMachine);
                TestBed.inject(SignalKDeltaService);
                service = TestBed.inject(AppNetworkInitService);
                entered = [];
                stateMachine.state$.subscribe(s => entered.push(s));
                mockConnection.serverVersion$.next('2.25.9');
                stateMachine.onHTTPDiscoverySuccess();
            });

            it('does not open the WebSocket when HTTP discovery succeeds again behind the notice', async () => {
                await service.initNetworkServices();

                stateMachine.onHTTPDiscoverySuccess();

                expect(entered).not.toContain(ConnectionState.WebSocketConnecting);
            });
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

        describe("a writable session's own profile (per-widget SI steps)", () => {
            const windsteerAt = (version: number, config: Record<string, unknown>): IConfig => ({
                app: { configVersion: version },
                theme: { themeName: '' },
                dashboards: [{ id: 'd0', configuration: [
                    { id: 'w0', input: { widgetProperties: { type: 'widget-wind-steer', uuid: 'w0', config } } }
                ] }]
            } as unknown as IConfig);
            const windsteerConfig = (config: IConfig): Record<string, unknown> =>
                (config.dashboards[0].configuration?.[0] as unknown as { input: { widgetProperties: { config: Record<string, unknown> } } })
                    .input.widgetProperties.config;
            const converted = { closeHauledLineEnable: true, closeHauledLineAngle: 30 * Math.PI / 180, siVersion: 20 };

            it('converts unmarked widgets in a current slot before render and writes the slot back', async () => {
                seedPersistedConnConfig('default');
                loginAs();
                mockStorage.getConfig.mockResolvedValue(windsteerAt(LATEST_APP_CONFIG_VERSION, { laylineEnable: true, laylineAngle: 30 }));

                await service.initNetworkServices();

                expect(windsteerConfig(bootstrappedConfig())).toEqual(converted);
                expect(mockStorage.setConfig).toHaveBeenCalledExactlyOnceWith('user', 'default', expect.anything(), REMOTE_CONFIG_FILE_VERSION);
                expect(windsteerConfig(mockStorage.setConfig.mock.calls[0][2] as IConfig)).toEqual(converted);
            });

            // The boot saves the loaded dashboards back, so a conversion here would reach the slot
            // before the persistent upgrade backs it up.
            it('leaves an older slot unconverted for the persistent upgrade', async () => {
                seedPersistedConnConfig('default');
                loginAs();
                mockStorage.getConfig.mockResolvedValue(windsteerAt(19, { laylineEnable: true, laylineAngle: 30 }));

                await service.initNetworkServices();

                expect(bootstrappedConfig().app?.configVersion).toBe(19);
                expect(windsteerConfig(bootstrappedConfig())).toEqual({ laylineEnable: true, laylineAngle: 30 });
                expect(mockStorage.setConfig).not.toHaveBeenCalled();
            });

            it('writes nothing when every widget is already marked', async () => {
                seedPersistedConnConfig('default');
                loginAs();
                mockStorage.getConfig.mockResolvedValue(windsteerAt(LATEST_APP_CONFIG_VERSION, { closeHauledLineAngle: 0.6, siVersion: 20 }));

                await service.initNetworkServices();

                expect(mockStorage.setConfig).not.toHaveBeenCalled();
            });

            it('still boots when the write-back fails; the steps run again on the next load', async () => {
                seedPersistedConnConfig('default');
                loginAs();
                mockStorage.getConfig.mockResolvedValue(windsteerAt(LATEST_APP_CONFIG_VERSION, { laylineAngle: 30 }));
                mockStorage.setConfig.mockRejectedValueOnce(new Error('write failed'));
                const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

                await service.initNetworkServices();

                expect(warn).toHaveBeenCalledWith(expect.stringMatching(/runs again on the next load/));
                expect(windsteerConfig(bootstrappedConfig())['siVersion']).toBe(20);
                expect(latestStatus()).toBe('ready');
                warn.mockRestore();
            });
        });

        describe('a session that does not run the persistent upgrade', () => {
            it('renders an embedded ?profile slot migrated in memory, writing nothing', async () => {
                seedPersistedConnConfig('default');
                loginAs();
                mockEmbed.embed.mockReturnValue(true);
                mockEmbed.profile.mockReturnValue('day');
                mockStorage.listConfigs.mockResolvedValue([{ scope: 'user', name: 'day' }]);
                mockStorage.getConfig.mockResolvedValue(v18AutopilotConfig());

                await service.initNetworkServices();

                const rendered = bootstrappedConfig();
                expect(rendered.app?.configVersion).toBe(LATEST_APP_CONFIG_VERSION);
                expect(autopilotPaths(rendered)['windAngleTrueWater']).toBeUndefined();
                expect(autopilotPaths(rendered)['headingTrue'].isPathConfigurable).toBe(false);
                expect(mockStorage.setConfig).not.toHaveBeenCalled();
            });

            it('renders a read-only user\'s slot migrated in memory, writing nothing', async () => {
                seedPersistedConnConfig('default');
                loginAs();
                mockStorage.canPersist.mockReturnValue(false);
                mockStorage.getConfig.mockResolvedValue(v18AutopilotConfig());

                await service.initNetworkServices();

                const rendered = bootstrappedConfig();
                expect(rendered.app?.configVersion).toBe(LATEST_APP_CONFIG_VERSION);
                expect(autopilotPaths(rendered)['windAngleTrueWater']).toBeUndefined();
                expect(mockStorage.setConfig).not.toHaveBeenCalled();
            });

            it('renders a slot the chain cannot migrate as loaded, with a warning', async () => {
                seedPersistedConnConfig('default');
                loginAs();
                mockStorage.canPersist.mockReturnValue(false);
                const legacy = { app: { configVersion: 10 }, theme: null, dashboards: [] } as unknown as IConfig;
                mockStorage.getConfig.mockResolvedValue(legacy);
                const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

                await service.initNetworkServices();

                expect(bootstrappedConfig()).toEqual(legacy);
                expect(warn).toHaveBeenCalledWith(expect.stringMatching(/too old/i));
                expect(latestStatus()).toBe('ready');
                warn.mockRestore();
            });

            it('leaves a writable session\'s slot to the persistent upgrade', async () => {
                seedPersistedConnConfig('default');
                loginAs();
                mockStorage.getConfig.mockResolvedValue(v18AutopilotConfig());

                await service.initNetworkServices();

                expect(bootstrappedConfig().app?.configVersion).toBe(18);
            });

            // The in-memory copy is stamped current while the slot is not. A session that owned it
            // could write that stamp over dashboards no upgrade has touched, so it boots as a view.
            it('bootstraps a slot it migrated in memory as a read-only view', async () => {
                seedPersistedConnConfig('default');
                loginAs();
                mockStorage.canPersist.mockReturnValue(false);
                mockStorage.getConfig.mockResolvedValue(v18AutopilotConfig());

                await service.initNetworkServices();

                expect(mockStorage.bootstrapRemoteContext).toHaveBeenCalledWith(expect.objectContaining({ readOnly: true }));
            });

            it('bootstraps an embedded slot it migrated in memory as a read-only view', async () => {
                seedPersistedConnConfig('default');
                loginAs();
                mockEmbed.embed.mockReturnValue(true);
                mockStorage.getConfig.mockResolvedValue(v18AutopilotConfig());

                await service.initNetworkServices();

                expect(mockStorage.bootstrapRemoteContext).toHaveBeenCalledWith(expect.objectContaining({ readOnly: true }));
            });

            it('bootstraps a current slot as the session\'s own, with nothing to migrate', async () => {
                seedPersistedConnConfig('default');
                loginAs();
                mockStorage.canPersist.mockReturnValue(false);
                mockStorage.getConfig.mockResolvedValue({ app: { configVersion: LATEST_APP_CONFIG_VERSION }, theme: null, dashboards: [] } as unknown as IConfig);

                await service.initNetworkServices();

                expect(mockStorage.bootstrapRemoteContext.mock.calls[0][0].readOnly).toBeFalsy();
            });

            describe('against the real storage write gate', () => {
                let storage: StorageService;
                let http: HttpTestingController;
                let writable = false;

                beforeEach(() => {
                    writable = false;
                    TestBed.resetTestingModule();
                    TestBed.configureTestingModule({
                        providers: [
                            AppNetworkInitService,
                            StorageService,
                            {
                                provide: SignalKConnectionService,
                                useValue: {
                                    ...mockConnection,
                                    serverServiceEndpoint$: new BehaviorSubject<IEndpointStatus>({
                                        state: EndpointStatus.Connected, message: '', serverDescription: '',
                                        httpServiceUrl: 'http://localhost/signalk/v1/api/', WsServiceUrl: ''
                                    }),
                                    serverVersion$: new BehaviorSubject<string | null>(MIN_SIGNALK_SERVER_VERSION)
                                }
                            },
                            { provide: AuthenticationService, useValue: { ...mockAuth, canWriteUserData: () => writable } },
                            { provide: SsoRedirectService, useValue: mockSsoRedirect },
                            { provide: ConnectionStateMachine, useValue: mockConnectionStateMachine },
                            { provide: SignalKDeltaService, useValue: {} },
                            { provide: DataService, useValue: {} },
                            { provide: InternetReachabilityService, useValue: mockInternetReachability },
                            { provide: EmbedModeService, useValue: mockEmbed }
                        ]
                    });
                    service = TestBed.inject(AppNetworkInitService);
                    storage = TestBed.inject(StorageService);
                    http = TestBed.inject(HttpTestingController);
                });

                afterEach(() => http.verify());

                async function bootWithoutWriteAccess(slot: IConfig): Promise<void> {
                    seedPersistedConnConfig('default');
                    loginAs();
                    vi.spyOn(storage, 'getConfig').mockResolvedValue(slot);
                    await service.initNetworkServices();
                    // A loginStatus re-probe grants the session write access after boot.
                    writable = true;
                }

                it('keeps a slot migrated in memory unwritable after the session gains write access', async () => {
                    await bootWithoutWriteAccess(v18AutopilotConfig());

                    expect(storage.canPersist()).toBe(false);
                    storage.patchConfig('IAppConfig', { configVersion: LATEST_APP_CONFIG_VERSION });
                    http.expectNone(() => true);
                });

                it('lets a current slot become writable when the session gains write access', async () => {
                    await bootWithoutWriteAccess({ app: { configVersion: LATEST_APP_CONFIG_VERSION }, theme: null, dashboards: [] } as unknown as IConfig);

                    expect(storage.canPersist()).toBe(true);
                });
            });
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
