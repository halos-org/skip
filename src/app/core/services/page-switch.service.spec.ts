import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { PageSwitchService, PAGE_SWITCH_DWELL_MS } from './page-switch.service';
import { Dashboard, DashboardService, IPageSwitchTrigger } from './dashboard.service';
import { DataService, IPathUpdate } from './data.service';
import { uiEventService } from './uiEvent.service';
import { EmbedModeService } from './embed-mode.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { States } from '../interfaces/signalk-interfaces';

const STATE = 'self.navigation.state';
const DEPTH = 'self.environment.depth.belowKeel';

const trig = (path: string, value: string): IPageSwitchTrigger => ({ path, value });
const page = (id: string, name: string, trigger?: IPageSwitchTrigger): Dashboard =>
  ({ id, name, icon: 'x', configuration: [], ...(trigger ? { trigger } : {}) });
const asUpdate = (value: unknown): IPathUpdate => ({ data: { value, timestamp: null }, state: States.Normal });

class DashboardStub {
  dashboards = signal<Dashboard[]>([]);
  activeDashboard = signal<number | null>(0);
  isDashboardStatic = signal<boolean>(true);
  navigateTo: Mock = vi.fn();
}

class DataStub {
  readonly subjects = new Map<string, BehaviorSubject<IPathUpdate>>();
  readonly released: string[] = [];

  acquirePath(path: string): { data$: Observable<IPathUpdate>; release: () => void } {
    return { data$: this.subject(path).asObservable(), release: () => this.released.push(path) };
  }
  /** Set a path's value; when called before the service subscribes it becomes the replayed seed. */
  push(path: string, value: unknown): void { this.subject(path).next(asUpdate(value)); }
  observed(path: string): boolean { return this.subjects.get(path)?.observed ?? false; }

  private subject(path: string): BehaviorSubject<IPathUpdate> {
    let s = this.subjects.get(path);
    if (!s) { s = new BehaviorSubject<IPathUpdate>(asUpdate(null)); this.subjects.set(path, s); }
    return s;
  }
}

describe('PageSwitchService', () => {
  let dashboard: DashboardStub;
  let data: DataStub;
  let dragging: ReturnType<typeof signal<boolean>>;
  let embed: boolean;
  let snackBar: { open: Mock };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    dashboard = new DashboardStub();
    data = new DataStub();
    dragging = signal(false);
    embed = false;
    snackBar = { open: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: DashboardService, useValue: dashboard },
        { provide: DataService, useValue: data },
        { provide: uiEventService, useValue: { isDragging: dragging } },
        { provide: EmbedModeService, useValue: { embed: () => embed, profile: () => null } },
        { provide: MatSnackBar, useValue: snackBar }
      ]
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function create(): PageSwitchService {
    const service = TestBed.inject(PageSwitchService);
    TestBed.tick(); // flush the subscription + startup effects
    return service;
  }
  const dwell = (): void => { vi.advanceTimersByTime(PAGE_SWITCH_DWELL_MS); };
  /** Establish a path's baseline real value (no switch, no dwell) so the next push is a change. */
  const baseline = (path: string, value: string): void => { data.push(path, value); };

  it('switches with a cue after a runtime change holds for the dwell', () => {
    dashboard.dashboards.set([page('p0', 'Zero'), page('p1', 'Sailing', trig(STATE, 'sailing'))]);
    create();
    baseline(STATE, 'moored');

    data.push(STATE, 'sailing');
    expect(dashboard.navigateTo).not.toHaveBeenCalled(); // still within the dwell

    dwell();
    expect(dashboard.navigateTo).toHaveBeenCalledTimes(1);
    expect(dashboard.navigateTo).toHaveBeenCalledWith(1);
    expect(snackBar.open).toHaveBeenCalledOnce();
  });

  it('cancels the pending switch when the value flaps to a non-matching value before the dwell', () => {
    dashboard.dashboards.set([page('p0', 'Zero'), page('p1', 'Sailing', trig(STATE, 'sailing'))]);
    create();
    baseline(STATE, 'moored');

    data.push(STATE, 'sailing');
    vi.advanceTimersByTime(PAGE_SWITCH_DWELL_MS - 1);
    data.push(STATE, 'anchored');
    dwell();

    expect(dashboard.navigateTo).not.toHaveBeenCalled();
  });

  it('re-arms to the latest matching value when it changes before the dwell elapses', () => {
    dashboard.dashboards.set([
      page('p0', 'Zero'),
      page('p1', 'Sailing', trig(STATE, 'sailing')),
      page('p2', 'Motoring', trig(STATE, 'motoring'))
    ]);
    create();
    baseline(STATE, 'anchored');

    data.push(STATE, 'sailing');
    vi.advanceTimersByTime(PAGE_SWITCH_DWELL_MS - 1);
    data.push(STATE, 'motoring');
    dwell();

    expect(dashboard.navigateTo).toHaveBeenCalledTimes(1);
    expect(dashboard.navigateTo).toHaveBeenCalledWith(2);
  });

  it('does not re-fire while a matching value simply persists (edge dedupe)', () => {
    dashboard.dashboards.set([page('p0', 'Zero'), page('p1', 'Sailing', trig(STATE, 'sailing'))]);
    create();
    baseline(STATE, 'moored');

    data.push(STATE, 'sailing');
    dwell();
    data.push(STATE, 'sailing'); // identical replay
    dwell();

    expect(dashboard.navigateTo).toHaveBeenCalledTimes(1);
  });

  it('fires again when the value leaves and re-enters the trigger value', () => {
    dashboard.dashboards.set([page('p0', 'Zero'), page('p1', 'Sailing', trig(STATE, 'sailing'))]);
    create();
    baseline(STATE, 'moored');

    data.push(STATE, 'sailing');
    dwell();
    data.push(STATE, 'moored');
    dwell();
    data.push(STATE, 'sailing');
    dwell();

    expect(dashboard.navigateTo).toHaveBeenCalledTimes(2);
    expect(dashboard.navigateTo).toHaveBeenLastCalledWith(1);
  });

  it('does not switch on a runtime change while the dashboard is being edited', () => {
    dashboard.dashboards.set([page('p0', 'Zero'), page('p1', 'Sailing', trig(STATE, 'sailing'))]);
    dashboard.isDashboardStatic.set(false);
    create();
    baseline(STATE, 'moored');

    data.push(STATE, 'sailing');
    dwell();

    expect(dashboard.navigateTo).not.toHaveBeenCalled();
  });

  it('does not switch on a runtime change while a drag is in progress', () => {
    dashboard.dashboards.set([page('p0', 'Zero'), page('p1', 'Sailing', trig(STATE, 'sailing'))]);
    dragging.set(true);
    create();
    baseline(STATE, 'moored');

    data.push(STATE, 'sailing');
    dwell();

    expect(dashboard.navigateTo).not.toHaveBeenCalled();
  });

  it('ignores a value that no page is configured for', () => {
    dashboard.dashboards.set([page('p0', 'Zero'), page('p1', 'Sailing', trig(STATE, 'sailing'))]);
    create();
    baseline(STATE, 'moored');

    data.push(STATE, 'anchored');
    dwell();

    expect(dashboard.navigateTo).not.toHaveBeenCalled();
  });

  it('picks the first page in order when several match the same value', () => {
    dashboard.dashboards.set([
      page('p0', 'Zero'),
      page('p1', 'Sailing A', trig(STATE, 'sailing')),
      page('p2', 'Sailing B', trig(STATE, 'sailing'))
    ]);
    create();
    baseline(STATE, 'moored');

    data.push(STATE, 'sailing');
    dwell();

    expect(dashboard.navigateTo).toHaveBeenCalledTimes(1);
    expect(dashboard.navigateTo).toHaveBeenCalledWith(1);
  });

  it('does not switch when the matching page is already active', () => {
    dashboard.dashboards.set([page('p0', 'Sailing', trig(STATE, 'sailing')), page('p1', 'Other')]);
    dashboard.activeDashboard.set(0);
    create();
    baseline(STATE, 'moored');

    data.push(STATE, 'sailing');
    dwell();

    expect(dashboard.navigateTo).not.toHaveBeenCalled();
    expect(snackBar.open).not.toHaveBeenCalled();
  });

  it('jumps immediately and silently to a page whose value is already true at startup', () => {
    dashboard.dashboards.set([page('p0', 'Zero'), page('p1', 'Sailing', trig(STATE, 'sailing')), page('p2', 'Two')]);
    dashboard.activeDashboard.set(0);
    data.push(STATE, 'sailing'); // already true, seeded before the service subscribes
    create();

    expect(dashboard.navigateTo).toHaveBeenCalledTimes(1);
    expect(dashboard.navigateTo).toHaveBeenCalledWith(1);
    expect(snackBar.open).not.toHaveBeenCalled(); // startup jump is silent
  });

  it('does not re-switch later for a value that was already true at startup (the swipe-away bug)', () => {
    dashboard.dashboards.set([page('p0', 'Zero'), page('p1', 'Sailing', trig(STATE, 'sailing')), page('p2', 'Two')]);
    dashboard.activeDashboard.set(0);
    data.push(STATE, 'sailing'); // already true at startup
    create();
    expect(dashboard.navigateTo).toHaveBeenCalledWith(1); // immediate startup jump
    dashboard.navigateTo.mockClear();

    // User swipes to another page; the state has not changed.
    dashboard.activeDashboard.set(2);
    dwell(); // advance well past any dwell window

    expect(dashboard.navigateTo).not.toHaveBeenCalled(); // no delayed re-switch
  });

  it('performs the startup jump once a page becomes active when the value was seeded first', () => {
    dashboard.dashboards.set([page('p0', 'Zero'), page('p1', 'Sailing', trig(STATE, 'sailing'))]);
    dashboard.activeDashboard.set(null);
    data.push(STATE, 'sailing');
    create();
    expect(dashboard.navigateTo).not.toHaveBeenCalled(); // no page active yet

    dashboard.activeDashboard.set(0);
    TestBed.tick();

    expect(dashboard.navigateTo).toHaveBeenCalledTimes(1);
    expect(dashboard.navigateTo).toHaveBeenCalledWith(1);
    expect(snackBar.open).not.toHaveBeenCalled();
  });

  it('tears down the subscription (unsubscribe + release) when a trigger path is removed', () => {
    dashboard.dashboards.set([page('p0', 'Sailing', trig(STATE, 'sailing'))]);
    create();
    expect(data.observed(STATE)).toBe(true);

    dashboard.dashboards.set([page('p0', 'Plain')]); // trigger removed
    TestBed.tick();

    expect(data.released).toContain(STATE);
    expect(data.observed(STATE)).toBe(false);

    data.push(STATE, 'sailing');
    dwell();
    expect(dashboard.navigateTo).not.toHaveBeenCalled();
  });

  it('rebuilds subscriptions only when the set of trigger paths changes', () => {
    dashboard.dashboards.set([page('p0', 'Sailing', trig(STATE, 'sailing'))]);
    create();
    expect(data.observed(STATE)).toBe(true);

    dashboard.dashboards.set([
      page('p0', 'Sailing', trig(STATE, 'sailing')),
      page('p1', 'Shallow', trig(DEPTH, '3'))
    ]);
    TestBed.tick();
    expect(data.observed(DEPTH)).toBe(true);
    expect(data.released).not.toContain(STATE);
  });

  it('is completely inert in embed mode', () => {
    embed = true;
    dashboard.dashboards.set([page('p0', 'Zero'), page('p1', 'Sailing', trig(STATE, 'sailing'))]);
    create();

    expect(data.observed(STATE)).toBe(false);
    data.push(STATE, 'sailing');
    dwell();
    expect(dashboard.navigateTo).not.toHaveBeenCalled();
  });
});
