import { TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { INotification, INotificationInfo, NotificationsService } from './notifications.service';
import { DataService } from './data.service';
import { SettingsService } from './settings.service';
import { SignalkRequestsService } from './signalk-requests.service';
import { ConnectionState, ConnectionStateMachine } from './connection-state-machine.service';
import { INotificationConfig } from '../interfaces/app-settings.interfaces';
import { ISignalKDataValueUpdate, ISignalKNotification, ISkMetadata, Methods, States, TMethod, TState } from '../interfaces/signalk-interfaces';
import { IMeta } from '../interfaces/app-interfaces';

function makeConfig(overrides?: {
  disableNotifications?: boolean;
  showNormalState?: boolean;
  showNominalState?: boolean;
  disableSound?: boolean;
  muteAlarm?: boolean;
}): INotificationConfig {
  return {
    disableNotifications: overrides?.disableNotifications ?? false,
    menuGrouping: true,
    security: { disableSecurity: true },
    devices: {
      disableDevices: false,
      showNormalState: overrides?.showNormalState ?? false,
      showNominalState: overrides?.showNominalState ?? false,
    },
    sound: {
      disableSound: overrides?.disableSound ?? false,
      muteNormal: false,
      muteNominal: false,
      muteWarn: false,
      muteAlert: false,
      muteAlarm: overrides?.muteAlarm ?? false,
      muteEmergency: false,
    },
  };
}

function makeValue(state: TState, method: TMethod[], message = 'test message'): ISignalKNotification {
  return { state, method, message, timestamp: '2026-07-03T00:00:00Z' };
}

function makeDelta(path: string, value: ISignalKNotification | null): ISignalKDataValueUpdate {
  return { path, value };
}

describe('NotificationsService', () => {
  let configSignal: WritableSignal<INotificationConfig>;
  let notificationMsg$: Subject<ISignalKDataValueUpdate>;
  let notificationMeta$: Subject<IMeta>;
  let connectionState$: Subject<ConnectionState>;
  let putRequest: ReturnType<typeof vi.fn>;
  let service: NotificationsService;

  function setup(initialConfig: INotificationConfig = makeConfig()): void {
    configSignal = signal<INotificationConfig>(initialConfig);
    notificationMsg$ = new Subject<ISignalKDataValueUpdate>();
    notificationMeta$ = new Subject<IMeta>();
    connectionState$ = new Subject<ConnectionState>();
    putRequest = vi.fn().mockReturnValue(null);

    const settingsStub: Partial<SettingsService> = {
      notificationConfig: configSignal,
      getNotificationConfig: () => configSignal(),
    };
    const dataStub: Partial<DataService> = {
      getNotificationMsgObservable: () => notificationMsg$.asObservable(),
      getNotificationMetaObservable: () => notificationMeta$.asObservable(),
    };
    const requestsStub: Partial<SignalkRequestsService> = {
      putRequest: putRequest as SignalkRequestsService['putRequest'],
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: SettingsService, useValue: settingsStub },
        { provide: DataService, useValue: dataStub },
        { provide: SignalkRequestsService, useValue: requestsStub },
        { provide: ConnectionStateMachine, useValue: { state$: connectionState$.asObservable() } },
      ],
    });
    service = TestBed.inject(NotificationsService);
  }

  function latestNotifications(): INotification[] {
    let latest: INotification[] = [];
    service.observeNotifications().subscribe(n => latest = n).unsubscribe();
    return latest;
  }

  function latestInfo(): INotificationInfo {
    let latest!: INotificationInfo;
    service.observerNotificationsInfo().subscribe(i => latest = i).unsubscribe();
    return latest;
  }

  function activeTrack(): number | null {
    return (service as unknown as { _activeAlarmSoundtrack: number | null })._activeAlarmSoundtrack;
  }

  function alarmPlayer(track: number): HTMLAudioElement {
    return (service as unknown as { _players: Map<number, HTMLAudioElement> })._players.get(track)!;
  }

  describe('alarm state aggregation from deltas', () => {
    it('adds a new notification and aggregates its severity', () => {
      setup();
      notificationMsg$.next(makeDelta('notifications.mob', makeValue(States.Alarm, [Methods.Visual, Methods.Sound])));

      const notifications = latestNotifications();
      expect(notifications).toHaveLength(1);
      expect(notifications[0].path).toBe('notifications.mob');
      expect(notifications[0].value?.state).toBe(States.Alarm);
      expect(latestInfo()).toEqual({ audioSev: 3, visualSev: 2, alarmCount: 1, isMuted: false, isWarn: false, isAlarmEmergency: true });
    });

    it('takes the max severity across multiple notifications', () => {
      setup();
      notificationMsg$.next(makeDelta('notifications.a', makeValue(States.Alert, [Methods.Visual, Methods.Sound])));
      notificationMsg$.next(makeDelta('notifications.b', makeValue(States.Emergency, [Methods.Visual, Methods.Sound])));

      expect(latestInfo()).toEqual({ audioSev: 4, visualSev: 2, alarmCount: 2, isMuted: false, isWarn: false, isAlarmEmergency: true });
    });

    it('ignores notifications.security paths entirely', () => {
      setup();
      notificationMsg$.next(makeDelta('notifications.security.accessRequest', makeValue(States.Alarm, [Methods.Visual])));

      expect(latestNotifications()).toHaveLength(0);
      expect(latestInfo().alarmCount).toBe(0);
    });

    it('keeps method-less notifications in the list but out of the aggregate', () => {
      setup();
      notificationMsg$.next(makeDelta('notifications.silent', makeValue(States.Alarm, [])));

      expect(latestNotifications()).toHaveLength(1);
      expect(latestInfo()).toEqual({ audioSev: 0, visualSev: 0, alarmCount: 0, isMuted: false, isWarn: false, isAlarmEmergency: false });
    });

    it('hides normal state from the aggregate unless showNormalState is set', () => {
      setup();
      notificationMsg$.next(makeDelta('notifications.ok', makeValue(States.Normal, [Methods.Visual, Methods.Sound])));
      expect(latestInfo().alarmCount).toBe(0);

      configSignal.set(makeConfig({ showNormalState: true }));
      TestBed.tick();
      expect(latestInfo().alarmCount).toBe(1);
    });

    it('hides nominal state from the aggregate unless showNominalState is set', () => {
      setup();
      notificationMsg$.next(makeDelta('notifications.fine', makeValue(States.Nominal, [Methods.Visual, Methods.Sound])));
      expect(latestInfo().alarmCount).toBe(0);

      configSignal.set(makeConfig({ showNominalState: true }));
      TestBed.tick();
      expect(latestInfo().alarmCount).toBe(1);
    });

    it('excludes notifications with an unknown state from the alarm count', () => {
      setup();
      notificationMsg$.next(makeDelta('notifications.odd', makeValue('bogus' as TState, [Methods.Visual, Methods.Sound])));

      expect(latestInfo()).toEqual({ audioSev: 0, visualSev: 0, alarmCount: 0, isMuted: false, isWarn: false, isAlarmEmergency: false });
    });
  });

  describe('update and delete transitions', () => {
    it('updates the existing entry when the state changes', () => {
      setup();
      notificationMsg$.next(makeDelta('notifications.engine', makeValue(States.Warn, [Methods.Visual, Methods.Sound])));
      notificationMsg$.next(makeDelta('notifications.engine', makeValue(States.Alarm, [Methods.Visual, Methods.Sound])));

      const notifications = latestNotifications();
      expect(notifications).toHaveLength(1);
      expect(notifications[0].value?.state).toBe(States.Alarm);
      expect(latestInfo().visualSev).toBe(2);
    });

    it('does not re-emit when state, message and method are unchanged', () => {
      setup();
      const emissions: INotification[][] = [];
      service.observeNotifications().subscribe(n => emissions.push(n));

      notificationMsg$.next(makeDelta('notifications.engine', makeValue(States.Warn, [Methods.Visual])));
      const countAfterAdd = emissions.length;
      // Same state/message/method but a different timestamp: dedupe ignores timestamps.
      notificationMsg$.next({ path: 'notifications.engine', value: { ...makeValue(States.Warn, [Methods.Visual]), timestamp: '2026-07-03T01:00:00Z' } });

      expect(emissions.length).toBe(countAfterAdd);
    });

    it('updates the existing entry when only the message changes', () => {
      setup();
      const emissions: INotification[][] = [];
      service.observeNotifications().subscribe(n => emissions.push(n));

      notificationMsg$.next(makeDelta('notifications.engine', makeValue(States.Warn, [Methods.Visual])));
      const countAfterAdd = emissions.length;
      notificationMsg$.next(makeDelta('notifications.engine', makeValue(States.Warn, [Methods.Visual], 'pressure rising')));

      expect(emissions.length).toBeGreaterThan(countAfterAdd);
      expect(latestNotifications()[0].value?.message).toBe('pressure rising');
    });

    it('updates the existing entry when only the method changes', () => {
      setup();
      const emissions: INotification[][] = [];
      service.observeNotifications().subscribe(n => emissions.push(n));

      notificationMsg$.next(makeDelta('notifications.engine', makeValue(States.Warn, [Methods.Visual])));
      const countAfterAdd = emissions.length;
      notificationMsg$.next(makeDelta('notifications.engine', makeValue(States.Warn, [Methods.Visual, Methods.Sound])));

      expect(emissions.length).toBeGreaterThan(countAfterAdd);
      expect(latestNotifications()[0].value?.method).toEqual([Methods.Visual, Methods.Sound]);
    });

    it('clears the value but keeps the entry on a null-value delta', () => {
      setup();
      notificationMsg$.next(makeDelta('notifications.engine', makeValue(States.Alarm, [Methods.Visual, Methods.Sound])));
      notificationMsg$.next(makeDelta('notifications.engine', null));

      const notifications = latestNotifications();
      expect(notifications).toHaveLength(1);
      expect(notifications[0].value).toBeUndefined();
      expect(latestInfo().alarmCount).toBe(0);
    });

    it('emits nothing for a null-value delta on an unknown path', () => {
      setup();
      const emissions: INotification[][] = [];
      service.observeNotifications().subscribe(n => emissions.push(n));
      const initialCount = emissions.length;

      notificationMsg$.next(makeDelta('notifications.unknown', null));

      expect(emissions.length).toBe(initialCount);
      expect(latestNotifications()).toHaveLength(0);
    });

    it('creates a meta-only entry for an unknown path and upserts on repeat', () => {
      setup();
      const meta: ISkMetadata = { units: 'K', description: 'temp', properties: {} };
      notificationMeta$.next({ context: 'vessels.self', path: 'notifications.temp', meta });
      notificationMeta$.next({ context: 'vessels.self', path: 'notifications.temp', meta: { ...meta, description: 'updated' } });

      const notifications = latestNotifications();
      expect(notifications).toHaveLength(1);
      expect(notifications[0].value).toBeUndefined();
      expect(notifications[0].meta?.description).toBe('updated');
    });

    it('attaches a later value delta to a meta-only entry', () => {
      setup();
      const meta: ISkMetadata = { units: 'K', description: 'temp', properties: {} };
      notificationMeta$.next({ context: 'vessels.self', path: 'notifications.temp', meta });
      notificationMsg$.next(makeDelta('notifications.temp', makeValue(States.Warn, [Methods.Visual])));

      const notifications = latestNotifications();
      expect(notifications).toHaveLength(1);
      expect(notifications[0].meta).toBe(meta);
      expect(notifications[0].value?.state).toBe(States.Warn);
    });
  });

  describe('severity gating against methods and settings', () => {
    it('zeroes audio severity when the method lacks sound', () => {
      setup();
      notificationMsg$.next(makeDelta('notifications.a', makeValue(States.Warn, [Methods.Visual])));

      expect(latestInfo()).toMatchObject({ audioSev: 0, visualSev: 1 });
    });

    it('zeroes visual severity when the method lacks visual', () => {
      setup();
      notificationMsg$.next(makeDelta('notifications.a', makeValue(States.Alarm, [Methods.Sound])));

      expect(latestInfo()).toMatchObject({ audioSev: 3, visualSev: 0 });
    });

    it('zeroes audio severity when the state is muted in settings', () => {
      setup(makeConfig({ muteAlarm: true }));
      notificationMsg$.next(makeDelta('notifications.a', makeValue(States.Alarm, [Methods.Visual, Methods.Sound])));

      expect(latestInfo()).toMatchObject({ audioSev: 0, visualSev: 2, alarmCount: 1 });
    });

    it('maps visual severity to isWarn and isAlarmEmergency flags', () => {
      setup();
      notificationMsg$.next(makeDelta('notifications.a', makeValue(States.Warn, [Methods.Visual])));
      expect(latestInfo()).toMatchObject({ isWarn: true, isAlarmEmergency: false });

      notificationMsg$.next(makeDelta('notifications.a', makeValue(States.Emergency, [Methods.Visual])));
      expect(latestInfo()).toMatchObject({ isWarn: false, isAlarmEmergency: true });
    });
  });

  describe('mute', () => {
    it('mutePlayer(true) zeroes audio severity and reports isMuted', () => {
      setup();
      notificationMsg$.next(makeDelta('notifications.a', makeValue(States.Emergency, [Methods.Visual, Methods.Sound])));
      expect(latestInfo()).toMatchObject({ audioSev: 4, isMuted: false });

      service.mutePlayer(true);
      expect(latestInfo()).toMatchObject({ audioSev: 0, visualSev: 2, isMuted: true });

      service.mutePlayer(false);
      expect(latestInfo()).toMatchObject({ audioSev: 4, isMuted: false });
    });
  });

  describe('alarm sound track selection', () => {
    it('selects the track matching the highest audio severity', () => {
      setup();
      expect(activeTrack()).toBe(1000);

      notificationMsg$.next(makeDelta('notifications.a', makeValue(States.Emergency, [Methods.Visual, Methods.Sound])));
      expect(activeTrack()).toBe(1004);

      notificationMsg$.next(makeDelta('notifications.a', null));
      expect(activeTrack()).toBe(1000);
    });

    it('falls back to the silent track when sound is disabled', () => {
      setup();
      notificationMsg$.next(makeDelta('notifications.a', makeValue(States.Emergency, [Methods.Visual, Methods.Sound])));
      expect(activeTrack()).toBe(1004);

      configSignal.set(makeConfig({ disableSound: true }));
      TestBed.tick();
      expect(activeTrack()).toBe(1000);

      notificationMsg$.next(makeDelta('notifications.b', makeValue(States.Alarm, [Methods.Visual, Methods.Sound])));
      expect(activeTrack()).toBe(1000);
    });
  });

  describe('configuration transitions', () => {
    it('re-emits settings changes on observeNotificationConfiguration', () => {
      setup();
      let observed: INotificationConfig | undefined;
      service.observeNotificationConfiguration().subscribe(c => observed = c);
      expect(observed).toBe(configSignal());

      const next = makeConfig({ showNormalState: true });
      configSignal.set(next);
      TestBed.tick();
      expect(observed).toBe(next);
    });

    it('does not re-apply the seeded config on the effect first flush (reference guard)', () => {
      setup();
      let emissions = 0;
      service.observeNotificationConfiguration().subscribe(() => emissions++);
      // The seed applied once at construction; the effect first flush re-reads the same config and
      // the reference guard must skip it — no duplicate config emission.
      TestBed.tick();
      expect(emissions).toBe(1);
    });

    it('disabling notifications clears the list and detaches the stream', () => {
      setup();
      notificationMsg$.next(makeDelta('notifications.a', makeValue(States.Alarm, [Methods.Visual, Methods.Sound])));
      expect(latestNotifications()).toHaveLength(1);

      configSignal.set(makeConfig({ disableNotifications: true }));
      TestBed.tick();
      expect(latestNotifications()).toHaveLength(0);
      expect(latestInfo()).toMatchObject({ audioSev: 0, visualSev: 0, alarmCount: 0 });

      notificationMsg$.next(makeDelta('notifications.b', makeValue(States.Alarm, [Methods.Visual, Methods.Sound])));
      expect(latestNotifications()).toHaveLength(0);
    });

    it('re-enabling notifications resubscribes to the stream', () => {
      setup(makeConfig({ disableNotifications: true }));
      notificationMsg$.next(makeDelta('notifications.a', makeValue(States.Alarm, [Methods.Visual, Methods.Sound])));
      expect(latestNotifications()).toHaveLength(0);

      configSignal.set(makeConfig());
      TestBed.tick();
      notificationMsg$.next(makeDelta('notifications.b', makeValue(States.Alarm, [Methods.Visual, Methods.Sound])));
      expect(latestNotifications()).toHaveLength(1);
    });
  });

  describe('reconcile on connection reconnect', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('keeps an active alarm across a reconnect without clearing it or restarting its tone', () => {
      setup();
      connectionState$.next(ConnectionState.Connected);
      notificationMsg$.next(makeDelta('notifications.bilge', makeValue(States.Alarm, [Methods.Visual, Methods.Sound])));
      expect(latestNotifications()).toHaveLength(1);
      expect(activeTrack()).toBe(1003);

      const player = alarmPlayer(1003);
      const playSpy = vi.spyOn(player, 'play');
      const pauseSpy = vi.spyOn(player, 'pause');

      vi.useFakeTimers();
      // A drop must not clear; the reconnect that follows must not blank or silence the alarm.
      connectionState$.next(ConnectionState.Disconnected);
      connectionState$.next(ConnectionState.Connected);
      expect(latestNotifications()).toHaveLength(1);
      expect(latestInfo().alarmCount).toBe(1);
      expect(activeTrack()).toBe(1003);

      // The snapshot re-delivers the same still-active alarm: recognised as the existing entry, not
      // cleared-and-re-added, so the looping player is never paused/restarted.
      notificationMsg$.next(makeDelta('notifications.bilge', makeValue(States.Alarm, [Methods.Visual, Methods.Sound])));
      vi.runOnlyPendingTimers();

      expect(latestNotifications()).toHaveLength(1);
      expect(latestInfo().alarmCount).toBe(1);
      expect(activeTrack()).toBe(1003);
      expect(playSpy).not.toHaveBeenCalled();
      expect(pauseSpy).not.toHaveBeenCalled();
    });

    it('sweeps a notification the server no longer reports once the snapshot settles', () => {
      setup();
      connectionState$.next(ConnectionState.Connected);
      notificationMsg$.next(makeDelta('notifications.engine', makeValue(States.Alarm, [Methods.Visual, Methods.Sound])));
      notificationMsg$.next(makeDelta('notifications.bilge', makeValue(States.Warn, [Methods.Visual, Methods.Sound])));
      expect(latestNotifications()).toHaveLength(2);

      vi.useFakeTimers();
      connectionState$.next(ConnectionState.Disconnected);
      connectionState$.next(ConnectionState.Connected);

      // The snapshot re-delivers only the engine alarm; the bilge warning resolved during the outage.
      notificationMsg$.next(makeDelta('notifications.engine', makeValue(States.Alarm, [Methods.Visual, Methods.Sound])));

      // Nothing is removed until the grace window elapses.
      expect(latestNotifications()).toHaveLength(2);

      vi.runOnlyPendingTimers();

      expect(latestNotifications().map(n => n.path)).toEqual(['notifications.engine']);
      expect(latestInfo().alarmCount).toBe(1);
    });

    it('adds notifications that first appear after a reconnect', () => {
      setup();
      connectionState$.next(ConnectionState.Connected);
      notificationMsg$.next(makeDelta('notifications.engine', makeValue(States.Alarm, [Methods.Visual, Methods.Sound])));

      vi.useFakeTimers();
      connectionState$.next(ConnectionState.Disconnected);
      connectionState$.next(ConnectionState.Connected);

      // The snapshot re-confirms the existing alarm and introduces a brand-new one.
      notificationMsg$.next(makeDelta('notifications.engine', makeValue(States.Alarm, [Methods.Visual, Methods.Sound])));
      notificationMsg$.next(makeDelta('notifications.mob', makeValue(States.Emergency, [Methods.Visual, Methods.Sound])));
      expect(latestNotifications().map(n => n.path)).toContain('notifications.mob');

      vi.runOnlyPendingTimers();

      expect(latestNotifications().map(n => n.path).sort()).toEqual(['notifications.engine', 'notifications.mob']);
      expect(latestInfo().alarmCount).toBe(2);
    });

    it('keeps an unconfirmed alarm when the server re-delivers no snapshot on reconnect', () => {
      setup();
      connectionState$.next(ConnectionState.Connected);
      notificationMsg$.next(makeDelta('notifications.mob', makeValue(States.Emergency, [Methods.Visual, Methods.Sound])));
      expect(latestNotifications()).toHaveLength(1);
      expect(activeTrack()).toBe(1004);

      vi.useFakeTimers();
      connectionState$.next(ConnectionState.Disconnected);
      connectionState$.next(ConnectionState.Connected);
      // No delta arrives after reconnect (a server that emits only on change, not on subscribe).
      vi.runOnlyPendingTimers();

      // The still-active alarm must not be silently dropped for lack of a snapshot.
      expect(latestNotifications()).toHaveLength(1);
      expect(latestInfo().alarmCount).toBe(1);
      expect(activeTrack()).toBe(1004);
    });

    it('does not sweep a carried alarm when only an unrelated new path arrives after reconnect', () => {
      setup();
      connectionState$.next(ConnectionState.Connected);
      notificationMsg$.next(makeDelta('notifications.bilge', makeValue(States.Alarm, [Methods.Visual, Methods.Sound])));
      expect(latestNotifications()).toHaveLength(1);
      expect(activeTrack()).toBe(1003);

      const pauseSpy = vi.spyOn(alarmPlayer(1003), 'pause');

      vi.useFakeTimers();
      connectionState$.next(ConnectionState.Disconnected);
      connectionState$.next(ConnectionState.Connected);

      // A change-only server never re-delivers bilge; only an unrelated new path updates in the
      // window. That is not evidence the carried alarm was re-streamed, so it must not arm the sweep.
      notificationMsg$.next(makeDelta('notifications.other', makeValue(States.Normal, [Methods.Visual])));
      vi.runOnlyPendingTimers();

      expect(latestNotifications().map(n => n.path)).toContain('notifications.bilge');
      expect(latestInfo().alarmCount).toBe(1);
      expect(activeTrack()).toBe(1003);
      expect(pauseSpy).not.toHaveBeenCalled();
    });

    it('does not reconcile or clear notifications while the connection stays up', () => {
      setup();
      connectionState$.next(ConnectionState.Connected);
      notificationMsg$.next(makeDelta('notifications.a', makeValue(States.Alarm, [Methods.Visual, Methods.Sound])));

      // A repeated Connected emission without an intervening drop must not clear.
      connectionState$.next(ConnectionState.Connected);

      expect(latestNotifications()).toHaveLength(1);
    });
  });

  describe('Signal K PUT helpers', () => {
    it('setSkMethod PUTs the method list to <path>.method', () => {
      setup();
      service.setSkMethod('notifications.a', [Methods.Visual]);

      expect(putRequest).toHaveBeenCalledWith('notifications.a.method', [Methods.Visual], expect.any(String));
    });

    it('setSkState PUTs the state to <path>.state', () => {
      setup();
      service.setSkState('notifications.a', States.Normal);

      expect(putRequest).toHaveBeenCalledWith('notifications.a.state', States.Normal, expect.any(String));
    });
  });
});
