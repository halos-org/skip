import type { Mock } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { IScreensPayload, RemoteDashboardsService } from './remote-dashboards.service';
import { Dashboard, DashboardService } from './dashboard.service';
import { DataService, IPathUpdate } from './data.service';
import { SettingsService } from './settings.service';
import { SignalkRequestsService } from './signalk-requests.service';
import { States } from '../interfaces/signalk-interfaces';

const KIP_UUID = 'test-kip-uuid';
const SET_DISPLAY_PATH = 'self.kip.remote.setDisplay';
const SET_SCREEN_INDEX_PATH = 'self.kip.remote.setScreenIndex';
const REQUEST_ACTIVE_SCREEN_PATH = 'self.kip.remote.requestActiveScreen';
const OWN_SCREEN_INDEX_PATH = `self.displays.${KIP_UUID}.screenIndex`;
const OWN_ACTIVE_SCREEN_PATH = `self.displays.${KIP_UUID}.activeScreen`;

const DASHBOARDS: Dashboard[] = [
  { id: 'dash-0', name: 'Navigation', icon: 'sailing', configuration: [] },
  { id: 'dash-1', name: 'Engine', icon: 'engine', configuration: [] },
  { id: 'dash-2', name: 'Anchor', icon: 'anchor', configuration: [] }
];

class SettingsServiceStub {
  public readonly KipUUID = KIP_UUID;
  public readonly instanceName$ = new BehaviorSubject<string>('Helm Display');
  public readonly isRemoteControl$ = new BehaviorSubject<boolean>(false);
  getInstanceNameAsO(): Observable<string> { return this.instanceName$.asObservable(); }
  getIsRemoteControlAsO(): Observable<boolean> { return this.isRemoteControl$.asObservable(); }
}

class DashboardServiceStub {
  public dashboards = signal<Dashboard[]>(DASHBOARDS);
  public activeDashboard = signal<number | null>(null);
  public navigateTo: Mock = vi.fn();
}

class DataServiceStub {
  public readonly subscribedPaths: { path: string; source: string }[] = [];
  private readonly _subjects = new Map<string, BehaviorSubject<IPathUpdate>>();

  subscribePath(path: string, source: string): Observable<IPathUpdate> {
    this.subscribedPaths.push({ path, source });
    return this.subject(path).asObservable();
  }

  push(path: string, value: unknown): void {
    this.subject(path).next({ data: { value, timestamp: new Date() }, state: States.Normal });
  }

  private subject(path: string): BehaviorSubject<IPathUpdate> {
    let subject = this._subjects.get(path);
    if (!subject) {
      subject = new BehaviorSubject<IPathUpdate>({ data: { value: null, timestamp: null }, state: States.Normal });
      this._subjects.set(path, subject);
    }
    return subject;
  }
}

class SignalkRequestsServiceStub {
  public putRequest: Mock = vi.fn(() => 'request-id');
}

describe('RemoteDashboardsService', () => {
  let settings: SettingsServiceStub;
  let dashboard: DashboardServiceStub;
  let data: DataServiceStub;
  let requests: SignalkRequestsServiceStub;

  beforeEach(() => {
    settings = new SettingsServiceStub();
    dashboard = new DashboardServiceStub();
    data = new DataServiceStub();
    requests = new SignalkRequestsServiceStub();
    TestBed.configureTestingModule({
      providers: [
        { provide: SettingsService, useValue: settings },
        { provide: DashboardService, useValue: dashboard },
        { provide: DataService, useValue: data },
        { provide: SignalkRequestsService, useValue: requests }
      ]
    });
  });

  function createService(): RemoteDashboardsService {
    const service = TestBed.inject(RemoteDashboardsService);
    TestBed.tick();
    return service;
  }

  function enableRemoteControl(): void {
    settings.isRemoteControl$.next(true);
    TestBed.tick();
  }

  function callsTo(path: string): unknown[][] {
    return requests.putRequest.mock.calls.filter(call => call[0] === path);
  }

  describe('initialization', () => {
    it('clears the three remote control paths on the server at construction', () => {
      TestBed.inject(RemoteDashboardsService);

      expect(requests.putRequest).toHaveBeenCalledTimes(3);
      expect(requests.putRequest).toHaveBeenNthCalledWith(1, SET_SCREEN_INDEX_PATH, { displayId: KIP_UUID, screenIdx: null }, KIP_UUID);
      expect(requests.putRequest).toHaveBeenNthCalledWith(2, SET_DISPLAY_PATH, { displayId: KIP_UUID, display: null }, KIP_UUID);
      expect(requests.putRequest).toHaveBeenNthCalledWith(3, REQUEST_ACTIVE_SCREEN_PATH, { displayId: KIP_UUID, screenIdx: null }, KIP_UUID);
    });

    it('subscribes to its own display screenIndex and activeScreen paths', () => {
      createService();

      expect(data.subscribedPaths).toEqual([
        { path: OWN_SCREEN_INDEX_PATH, source: 'default' },
        { path: OWN_ACTIVE_SCREEN_PATH, source: 'default' }
      ]);
    });

    it('publishes nothing beyond the initial clears while remote control is off', () => {
      createService();

      expect(requests.putRequest).toHaveBeenCalledTimes(3);
    });
  });

  describe('enabling remote control', () => {
    it('publishes the dashboard list stripped of widget configuration', () => {
      createService();
      requests.putRequest.mockClear();

      enableRemoteControl();

      const displayCalls = callsTo(SET_DISPLAY_PATH);
      expect(displayCalls).toHaveLength(1);
      expect(displayCalls[0][1]).toEqual({
        displayId: KIP_UUID,
        display: {
          displayName: 'Helm Display',
          screens: [
            { id: 'dash-0', name: 'Navigation', icon: 'sailing' },
            { id: 'dash-1', name: 'Engine', icon: 'engine' },
            { id: 'dash-2', name: 'Anchor', icon: 'anchor' }
          ]
        }
      });
      const sent = displayCalls[0][1] as { display: IScreensPayload };
      expect('configuration' in sent.display.screens[0]).toBe(false);
    });

    it('publishes the active dashboard index when one is set', () => {
      dashboard.activeDashboard.set(1);
      createService();
      requests.putRequest.mockClear();

      enableRemoteControl();

      expect(callsTo(SET_SCREEN_INDEX_PATH)).toEqual([
        [SET_SCREEN_INDEX_PATH, { displayId: KIP_UUID, screenIdx: 1 }, KIP_UUID]
      ]);
    });

    it('does not publish an active index when none is set', () => {
      createService();
      requests.putRequest.mockClear();

      enableRemoteControl();

      expect(callsTo(SET_SCREEN_INDEX_PATH)).toHaveLength(0);
      expect(callsTo(SET_DISPLAY_PATH)).toHaveLength(1);
    });
  });

  describe('disabling remote control', () => {
    it('clears the active dashboard and the shared screens on the server', () => {
      dashboard.activeDashboard.set(0);
      createService();
      enableRemoteControl();
      requests.putRequest.mockClear();

      settings.isRemoteControl$.next(false);
      TestBed.tick();

      expect(callsTo(SET_SCREEN_INDEX_PATH)).toEqual([
        [SET_SCREEN_INDEX_PATH, { displayId: KIP_UUID, screenIdx: null }, KIP_UUID]
      ]);
      expect(callsTo(SET_DISPLAY_PATH)).toEqual([
        [SET_DISPLAY_PATH, { displayId: KIP_UUID, display: null }, KIP_UUID]
      ]);
    });
  });

  describe('display name changes', () => {
    it('republishes screens with the new display name while enabled', () => {
      createService();
      enableRemoteControl();
      requests.putRequest.mockClear();

      settings.instanceName$.next('Nav Station');
      TestBed.tick();

      const displayCalls = callsTo(SET_DISPLAY_PATH);
      expect(displayCalls).toHaveLength(1);
      expect((displayCalls[0][1] as { display: IScreensPayload }).display.displayName).toBe('Nav Station');
    });

    it('re-sends the active dashboard index on a name change', () => {
      dashboard.activeDashboard.set(2);
      createService();
      enableRemoteControl();
      requests.putRequest.mockClear();

      settings.instanceName$.next('Nav Station');
      TestBed.tick();

      expect(callsTo(SET_SCREEN_INDEX_PATH)).toEqual([
        [SET_SCREEN_INDEX_PATH, { displayId: KIP_UUID, screenIdx: 2 }, KIP_UUID]
      ]);
    });

    it('ignores name changes while disabled', () => {
      createService();
      requests.putRequest.mockClear();

      settings.instanceName$.next('Nav Station');
      TestBed.tick();

      expect(requests.putRequest).not.toHaveBeenCalled();
    });
  });

  describe('dashboard list changes', () => {
    it('republishes the screens payload when dashboards change while enabled', () => {
      createService();
      enableRemoteControl();
      requests.putRequest.mockClear();

      dashboard.dashboards.set([{ id: 'dash-9', name: 'New', icon: 'star', configuration: [] }]);
      TestBed.tick();

      const displayCalls = callsTo(SET_DISPLAY_PATH);
      expect(displayCalls).toHaveLength(1);
      expect((displayCalls[0][1] as { display: IScreensPayload }).display.screens).toEqual([
        { id: 'dash-9', name: 'New', icon: 'star' }
      ]);
    });

    it('ignores dashboard changes while disabled', () => {
      createService();
      requests.putRequest.mockClear();

      dashboard.dashboards.set([{ id: 'dash-9', name: 'New', icon: 'star', configuration: [] }]);
      TestBed.tick();

      expect(requests.putRequest).not.toHaveBeenCalled();
    });
  });

  describe('active dashboard changes', () => {
    it('publishes the new active index while enabled', () => {
      createService();
      enableRemoteControl();
      requests.putRequest.mockClear();

      dashboard.activeDashboard.set(2);
      TestBed.tick();

      expect(callsTo(SET_SCREEN_INDEX_PATH)).toEqual([
        [SET_SCREEN_INDEX_PATH, { displayId: KIP_UUID, screenIdx: 2 }, KIP_UUID]
      ]);
    });

    it('does not publish when the active dashboard becomes null', () => {
      dashboard.activeDashboard.set(1);
      createService();
      enableRemoteControl();
      requests.putRequest.mockClear();

      dashboard.activeDashboard.set(null);
      TestBed.tick();

      expect(callsTo(SET_SCREEN_INDEX_PATH)).toHaveLength(0);
    });

    it('ignores active dashboard changes while disabled', () => {
      createService();
      requests.putRequest.mockClear();

      dashboard.activeDashboard.set(1);
      TestBed.tick();

      expect(requests.putRequest).not.toHaveBeenCalled();
    });
  });

  describe('remote screen change requests', () => {
    it('navigates to a valid requested index', () => {
      createService();
      enableRemoteControl();

      data.push(OWN_ACTIVE_SCREEN_PATH, 2);
      TestBed.tick();

      expect(dashboard.navigateTo).toHaveBeenCalledTimes(1);
      expect(dashboard.navigateTo).toHaveBeenCalledWith(2);
    });

    it('coerces string values with Number()', () => {
      createService();
      enableRemoteControl();

      data.push(OWN_ACTIVE_SCREEN_PATH, '1');
      TestBed.tick();

      expect(dashboard.navigateTo).toHaveBeenCalledWith(1);
    });

    it('ignores a request matching the current active dashboard', () => {
      dashboard.activeDashboard.set(1);
      createService();
      enableRemoteControl();

      data.push(OWN_ACTIVE_SCREEN_PATH, 1);
      TestBed.tick();

      expect(dashboard.navigateTo).not.toHaveBeenCalled();
    });

    it('ignores out-of-range indexes', () => {
      createService();
      enableRemoteControl();

      data.push(OWN_ACTIVE_SCREEN_PATH, 3);
      TestBed.tick();
      data.push(OWN_ACTIVE_SCREEN_PATH, -1);
      TestBed.tick();

      expect(dashboard.navigateTo).not.toHaveBeenCalled();
    });

    it('ignores non-numeric and null values', () => {
      createService();
      enableRemoteControl();

      data.push(OWN_ACTIVE_SCREEN_PATH, 'not-a-number');
      TestBed.tick();
      data.push(OWN_ACTIVE_SCREEN_PATH, null);
      TestBed.tick();

      expect(dashboard.navigateTo).not.toHaveBeenCalled();
    });

    it('ignores requests while remote control is disabled', () => {
      createService();

      data.push(OWN_ACTIVE_SCREEN_PATH, 2);
      TestBed.tick();

      expect(dashboard.navigateTo).not.toHaveBeenCalled();
    });
  });

  describe('publish helpers', () => {
    it('addresses commands to the target display but signs requests with its own UUID', () => {
      const service = createService();
      requests.putRequest.mockClear();

      service.setActiveDashboardOnRemote('other-display', 4);
      service.clearActiveScreenOnRemote('other-display', 7);

      expect(requests.putRequest).toHaveBeenNthCalledWith(1, SET_SCREEN_INDEX_PATH, { displayId: 'other-display', screenIdx: 4 }, KIP_UUID);
      expect(requests.putRequest).toHaveBeenNthCalledWith(2, REQUEST_ACTIVE_SCREEN_PATH, { displayId: 'other-display', screenIdx: 7 }, KIP_UUID);
    });

    it('publishes a shallow copy of the screens payload', () => {
      const service = createService();
      requests.putRequest.mockClear();

      const payload: IScreensPayload = { displayName: 'Other', screens: [{ id: 'dash-0', name: 'Navigation', icon: 'sailing' }] };
      service.setScreensOnRemote('other-display', payload);

      const sent = requests.putRequest.mock.calls[0][1] as { displayId: string; display: IScreensPayload };
      expect(sent.displayId).toBe('other-display');
      expect(sent.display).toEqual(payload);
      expect(sent.display).not.toBe(payload);
      expect(sent.display.screens).toBe(payload.screens);
    });

    it('logs an error without throwing when the server rejects a request', () => {
      const service = createService();
      requests.putRequest.mockReturnValue(null);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      service.setActiveDashboardOnRemote(KIP_UUID, 1);
      service.setScreensOnRemote(KIP_UUID, null);
      service.clearActiveScreenOnRemote(KIP_UUID, null);

      expect(errorSpy).toHaveBeenCalledTimes(3);
      errorSpy.mockRestore();
    });
  });
});
