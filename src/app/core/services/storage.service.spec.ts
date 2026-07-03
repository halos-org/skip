import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { StorageService, IPatchFailure } from './storage.service';
import { IConfig } from '../interfaces/app-settings.interfaces';
import { SignalKConnectionService, IEndpointStatus } from './signalk-connection.service';
import { AuthenticationService } from './authentication.service';
import { ensureLocalStorage } from '../../../test-helpers/local-storage.test-helper';

const blankConfig = (): IConfig => ({ app: null, theme: null, dashboards: [] });

describe('StorageService', () => {
  let service: StorageService;
  let http: HttpTestingController;

  beforeEach(() => {
    ensureLocalStorage();
    // Provide StorageService in the module so its deps resolve to the global test stubs
    // (AuthenticationService / SignalKConnectionService) instead of the real root services.
    TestBed.configureTestingModule({ providers: [StorageService] });
    service = TestBed.inject(StorageService);
    http = TestBed.inject(HttpTestingController);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('write-safety guard', () => {
    beforeEach(() => {
      service.storageServiceReady$.next(true);
      service.activeConfigFileVersion = 11;
    });

    afterEach(() => http.verify());

    it('setConfig rejects an empty config name', async () => {
      await expect(service.setConfig('user', '', blankConfig())).rejects.toThrow(/name/i);
      http.expectNone(() => true);
    });

    it('removeItem throws on an empty name', () => {
      expect(() => service.removeItem('user', '')).toThrow(/name/i);
      http.expectNone(() => true);
    });

    it('patchConfig does not POST when the active slot name is unset', () => {
      service.sharedConfigName = undefined as unknown as string;
      service.patchConfig('Dashboards', []);
      http.expectNone(() => true);
    });

    it('patchConfig POSTs a patch targeting the active slot when set', () => {
      service.sharedConfigName = 'cockpit';
      service.patchConfig('Dashboards', [{ id: 'd1' }]);
      const req = http.expectOne((r) => r.method === 'POST');
      // JSON Patch op path is namespaced by the active slot name
      expect(req.request.body[0].path).toBe('/cockpit/dashboards');
      req.flush(null);
    });
  });

  describe('patch-failure reporting', () => {
    beforeEach(() => {
      service.storageServiceReady$.next(true);
      service.activeConfigFileVersion = 11;
      service.sharedConfigName = 'p';
    });

    afterEach(() => http.verify());

    it('emits on patchFailure$ when a routine patch fails, naming the target', () => {
      const failures: IPatchFailure[] = [];
      const sub = service.patchFailure$.subscribe((f) => failures.push(f));
      service.patchConfig('IThemeConfig', { themeName: 'dark' });
      http.expectOne((r) => r.method === 'POST').flush('boom', { status: 500, statusText: 'err' });
      sub.unsubscribe();
      expect(failures).toHaveLength(1);
      expect(failures[0].key).toBe('IThemeConfig');
      expect(failures[0].error).toBeTruthy();
    });

    it('reports the unset-slot refusal on patchFailure$ without POSTing', () => {
      service.sharedConfigName = undefined as unknown as string;
      const failures: IPatchFailure[] = [];
      const sub = service.patchFailure$.subscribe((f) => failures.push(f));
      service.patchConfig('Dashboards', []);
      sub.unsubscribe();
      expect(failures).toHaveLength(1);
      expect(failures[0].key).toBe('Dashboards');
      http.expectNone(() => true);
    });

    it('stays silent on patchFailure$ for a deferred patch (removeItem settles its own promise)', async () => {
      const failures: IPatchFailure[] = [];
      const sub = service.patchFailure$.subscribe((f) => failures.push(f));
      const removal = service.removeItem('user', 'slot');
      http.expectOne((r) => r.method === 'POST').flush('boom', { status: 500, statusText: 'err' });
      await expect(removal).rejects.toBeTruthy();
      sub.unsubscribe();
      expect(failures).toHaveLength(0);
    });
  });

  describe('awaitQueueDrain', () => {
    beforeEach(() => {
      service.storageServiceReady$.next(true);
      service.activeConfigFileVersion = 11;
      service.sharedConfigName = 'p';
    });

    it('resolves true immediately when the queue is empty', async () => {
      await expect(service.awaitQueueDrain(1000)).resolves.toBe(true);
    });

    it('resolves true once a queued write completes', async () => {
      service.patchConfig('Dashboards', []);
      const drain = service.awaitQueueDrain(2000);
      http.expectOne(() => true).flush(null);
      await expect(drain).resolves.toBe(true);
      http.verify();
    });

    it('resolves false (best-effort) when a write stalls past the timeout', async () => {
      service.patchConfig('Dashboards', []);
      await expect(service.awaitQueueDrain(40)).resolves.toBe(false);
      // drain the stalled request so the test ends clean
      http.expectOne(() => true).flush(null);
      http.verify();
    });

    it('a failed write does not wedge the queue (later writes still process)', async () => {
      service.patchConfig('Dashboards', []);
      http.expectOne(() => true).flush('boom', { status: 500, statusText: 'err' });
      service.patchConfig('Dashboards', []);
      const drain = service.awaitQueueDrain(2000);
      http.expectOne(() => true).flush(null);
      await expect(drain).resolves.toBe(true);
      http.verify();
    });
  });

  describe('removeItem completion', () => {
    beforeEach(() => {
      service.storageServiceReady$.next(true);
      service.activeConfigFileVersion = 11;
      service.sharedConfigName = 'p';
    });

    afterEach(() => http.verify());

    it('resolves only after the queued delete request completes', async () => {
      let resolved = false;
      const done = service.removeItem('user', 'race-config').then(() => { resolved = true; });

      // The request is dispatched synchronously through the patch queue...
      const req = http.expectOne((r) => r.method === 'POST');
      // ...but the promise must not resolve until the server responds.
      await Promise.resolve();
      expect(resolved).toBe(false);

      req.flush(null);
      await done;

      expect(resolved).toBe(true);
    });

    it('rejects on failure yet the patch queue keeps processing', async () => {
      const first = service.removeItem('user', 'first');
      http.expectOne((r) => r.method === 'POST').flush('boom', { status: 500, statusText: 'err' });
      await expect(first).rejects.toBeTruthy();

      // A failed delete must not kill the sequential queue for later operations.
      const second = service.removeItem('user', 'second');
      http.expectOne((r) => r.method === 'POST').flush(null);
      await expect(second).resolves.toBeUndefined();
    });
  });

  describe('setConfig queue serialization', () => {
    beforeEach(() => {
      service.storageServiceReady$.next(true);
      service.activeConfigFileVersion = 11;
      service.sharedConfigName = 'p';
    });

    afterEach(() => http.verify());

    it('queues behind an in-flight autosave patch instead of racing a direct POST', async () => {
      // An autosave JSON-Patch is in flight (dispatched, not yet answered).
      service.patchConfig('Dashboards', [{ id: 'd1' }]);
      const patchReq = http.expectOne((r) => Array.isArray(r.body));

      // A full-file write must NOT fire concurrently — it waits its turn in the queue.
      const done = service.setConfig('user', 'default', blankConfig());
      http.expectNone((r) => !Array.isArray(r.body));

      patchReq.flush(null);
      await Promise.resolve();

      // Only now does the full-file write go out, on its own.
      const setReq = http.expectOne((r) => !Array.isArray(r.body));
      expect(setReq.request.method).toBe('POST');
      setReq.flush(null);
      await done;
    });

    it('resolves only after the queued full-file write completes', async () => {
      let resolved = false;
      const done = service.setConfig('user', 'default', blankConfig()).then(() => { resolved = true; });

      const req = http.expectOne((r) => r.method === 'POST');
      await Promise.resolve();
      expect(resolved).toBe(false);

      req.flush(null);
      await done;
      expect(resolved).toBe(true);
    });

    it('rejects on failure yet the queue keeps processing later writes', async () => {
      const first = service.setConfig('user', 'first', blankConfig());
      http.expectOne((r) => r.method === 'POST').flush('boom', { status: 500, statusText: 'err' });
      await expect(first).rejects.toBeTruthy();

      const second = service.setConfig('user', 'second', blankConfig());
      http.expectOne((r) => r.method === 'POST').flush(null);
      await expect(second).resolves.toBeNull();
    });

    it('rejects a queued write that stalls past the request timeout, so the queue is not wedged', async () => {
      vi.useFakeTimers();
      try {
        const stalled = service.setConfig('user', 'first', blankConfig());
        const stalledRejects = expect(stalled).rejects.toBeTruthy(); // attach handler before the timeout fires
        http.expectOne((r) => r.method === 'POST'); // dispatched, never answered
        await vi.advanceTimersByTimeAsync(5001); // past REMOTE_CONFIG_TIMEOUT_MS (5000)
        await stalledRejects;

        // The timed-out write freed the queue; a later write still processes.
        const next = service.setConfig('user', 'second', blankConfig());
        http.expectOne((r) => r.method === 'POST').flush(null);
        await expect(next).resolves.toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('bootstrapRemoteContext appless-config guard', () => {
    it('rejects an appless config (SK 200 {}) as an absent bootstrap', () => {
      expect(() => service.bootstrapRemoteContext({
        sharedConfigName: 'cockpit',
        configFileVersion: 11,
        initConfig: blankConfig()
      })).toThrow(/invalid remote bootstrap/i);
      expect(service.isRemoteContextBootstrapped()).toBe(false);
    });

    it('accepts a config that carries an app section', () => {
      service.bootstrapRemoteContext({
        sharedConfigName: 'cockpit',
        configFileVersion: 11,
        initConfig: { app: { configVersion: 11 }, theme: null, dashboards: [] } as unknown as IConfig
      });
      expect(service.isRemoteContextBootstrapped()).toBe(true);
      expect(service.initConfig?.app).toBeTruthy();
    });
  });
});

interface StoragePrivate { serverEndpoint: string }

class AuthStub {
  isLoggedIn$ = new BehaviorSubject<boolean>(false);
}
class ConnStub {
  serverServiceEndpoint$ = new BehaviorSubject<IEndpointStatus>({ operation: 0 } as IEndpointStatus);
  serverVersion$ = new BehaviorSubject<string | null>(null);
}

function endpoint(httpServiceUrl: string, operation = 2): IEndpointStatus {
  return { operation, message: '', serverDescription: '', httpServiceUrl, WsServiceUrl: '' };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('StorageService — applicationData URLs, scope & version gate (characterization)', () => {
  const HTTP = 'https://sk.local/signalk/v1/api/';
  const ENDPOINT = 'https://sk.local/signalk/v1/applicationData/';
  let http: HttpTestingController;

  function setup(opts: { httpUrl?: string; version?: string | null; loggedIn?: boolean } = {}) {
    ensureLocalStorage();
    const auth = new AuthStub();
    const conn = new ConnStub();
    TestBed.configureTestingModule({
      providers: [
        StorageService,
        { provide: SignalKConnectionService, useValue: conn },
        { provide: AuthenticationService, useValue: auth },
      ],
    });
    const service = TestBed.inject(StorageService);
    http = TestBed.inject(HttpTestingController);
    if (opts.version !== undefined) conn.serverVersion$.next(opts.version);
    auth.isLoggedIn$.next(opts.loggedIn ?? true);
    conn.serverServiceEndpoint$.next(endpoint(opts.httpUrl ?? HTTP));
    service.activeConfigFileVersion = 11;
    service.sharedConfigName = 'cockpit';
    return { service, conn, auth };
  }

  afterEach(() => http?.verify());

  it('derives the applicationData endpoint by stripping the trailing "api/" from the v1 URL', () => {
    const { service } = setup({ httpUrl: 'https://sk.local/signalk/v1/api/' });
    expect((service as unknown as StoragePrivate).serverEndpoint).toBe('https://sk.local/signalk/v1/applicationData/');
  });

  it('gates isAppDataSupported on at server version 1.27.0 (boundary inclusive)', () => {
    expect(setup({ version: '1.27.0' }).service.isAppDataSupported).toBe(true);
  });
  it('gates isAppDataSupported off below 1.27.0', () => {
    expect(setup({ version: '1.26.9' }).service.isAppDataSupported).toBe(false);
  });
  it('reports isAppDataSupported for a clearly newer server', () => {
    expect(setup({ version: '2.5.0' }).service.isAppDataSupported).toBe(true);
  });

  it('listConfigs GETs the global then the user scoped keys URLs', async () => {
    const { service } = setup();
    const p = service.listConfigs();
    const g = http.expectOne(`${ENDPOINT}global/skip/11/?keys=true`);
    expect(g.request.method).toBe('GET');
    g.flush(['g-slot']);
    await tick();
    http.expectOne(`${ENDPOINT}user/skip/11/?keys=true`).flush(['u-slot']);
    await expect(p).resolves.toEqual([
      { scope: 'global', name: 'g-slot' },
      { scope: 'user', name: 'u-slot' },
    ]);
  });

  it('getConfig GETs the scoped, versioned, named URL and returns a deep clone', async () => {
    const { service } = setup();
    const p = service.getConfig('user', 'default');
    const req = http.expectOne(`${ENDPOINT}user/skip/11/default`);
    expect(req.request.method).toBe('GET');
    const body = blankConfig();
    req.flush(body);
    const result = await p;
    expect(result).toEqual(body);
    expect(result).not.toBe(body);
  });

  it('setConfig POSTs the config to the scoped, versioned, named URL', async () => {
    const { service } = setup();
    const cfg = blankConfig();
    const p = service.setConfig('global', 'shared', cfg);
    const req = http.expectOne(`${ENDPOINT}global/skip/11/shared`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(cfg);
    req.flush(null);
    await expect(p).resolves.toBeNull();
  });

  it('patchConfig POSTs a JSON Patch to the USER scope, namespaced by the active slot', () => {
    const { service } = setup();
    service.patchConfig('IAppConfig', { autoNightMode: true });
    const req = http.expectOne(`${ENDPOINT}user/skip/11`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual([{ op: 'replace', path: '/cockpit/app', value: { autoNightMode: true } }]);
    req.flush(null);
  });

  it('patchConfig maps a granular ObjType to its app sub-path', () => {
    const { service } = setup();
    service.patchConfig('Array<IUnitDefaults>', [{ group: 'speed' }]);
    const req = http.expectOne(`${ENDPOINT}user/skip/11`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual([{ op: 'replace', path: '/cockpit/app/unitDefaults', value: [{ group: 'speed' }] }]);
    req.flush(null);
  });

  it('removeItem POSTs a remove patch to the scoped, versioned URL', async () => {
    const { service } = setup();
    const p = service.removeItem('user', 'old-slot');
    const req = http.expectOne(`${ENDPOINT}user/skip/11`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual([{ op: 'remove', path: '/old-slot' }]);
    req.flush(null);
    await expect(p).resolves.toBeUndefined();
  });

  it('forceConfigFileVersion overrides the version segment of the URL', async () => {
    const { service } = setup();
    const p = service.getConfig('user', 'default', 1);
    const req = http.expectOne(`${ENDPOINT}user/skip/1/default`);
    expect(req.request.method).toBe('GET');
    req.flush(blankConfig());
    await p;
  });

  it('patchConfig IThemeConfig extracts themeName into the theme sub-path (not the whole object)', () => {
    const { service } = setup();
    service.patchConfig('IThemeConfig', { themeName: 'dark', extra: 'ignored' });
    const req = http.expectOne(`${ENDPOINT}user/skip/11`);
    expect(req.request.body).toEqual([{ op: 'replace', path: '/cockpit/theme/themeName', value: 'dark' }]);
    req.flush(null);
  });

  it('refuses reads and writes when the storage service is not ready', async () => {
    const { service } = setup();
    service.storageServiceReady$.next(false);
    await expect(service.getConfig('user', 'default')).rejects.toThrow(/not ready/i);
    expect(() => service.patchConfig('IAppConfig', {})).toThrow(/not ready/i);
    http.expectNone(() => true);
  });
});
