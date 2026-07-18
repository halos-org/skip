import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { Subject } from 'rxjs';
import { ActivatedRouteSnapshot, convertToParamMap, NavigationEnd, Router } from '@angular/router';
import { NgGridStackWidget } from 'gridstack/dist/angular';
import { DefaultDashboard } from '../../../default-config/config.blank.dashboard';
import { SettingsService } from './settings.service';
import { Dashboard, DashboardService, widgetOperation } from './dashboard.service';
import { EmbedModeService } from './embed-mode.service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const makeWidget = (uuid: string): NgGridStackWidget => ({
  id: uuid,
  x: 0, y: 0, w: 2, h: 2,
  selector: 'widget-host2',
  input: { widgetProperties: { type: 'widget-numeric', uuid, config: { displayName: uuid } } }
});

const makeDashboard = (id: string, name: string, configuration: NgGridStackWidget[] = []): Dashboard =>
  ({ id, name, icon: 'dashboard-dashboard', configuration });

const seed = (): Dashboard[] => [
  makeDashboard('d-0', 'One'),
  makeDashboard('d-1', 'Two'),
  makeDashboard('d-2', 'Three')
];

const widgetsOf = (dashboard: Dashboard): NgGridStackWidget[] => dashboard.configuration as NgGridStackWidget[];

function makeRouterStub(idParam: string | null) {
  // Mirrors the app's top-level `page/:id` route: the id param lives on a
  // child snapshot, never on the root, so getRouteParam must walk firstChild.
  const snapshotRoot = (id: string | null): ActivatedRouteSnapshot =>
    ({
      paramMap: convertToParamMap({}),
      firstChild: id === null ? null : { paramMap: convertToParamMap({ id }), firstChild: null }
    } as unknown as ActivatedRouteSnapshot);
  const events = new Subject<NavigationEnd>();
  let navId = 0;
  const stub = {
    events,
    routerState: { snapshot: { root: snapshotRoot(idParam) } },
    navigate: vi.fn<(commands: unknown[]) => Promise<boolean>>(() => Promise.resolve(true)),
    setIdParam: (id: string | null): void => { stub.routerState.snapshot.root = snapshotRoot(id); },
    emitNavigationEnd: (): void => { navId++; events.next(new NavigationEnd(navId, '/page', '/page')); }
  };
  return stub;
}

function makeSettingsMock(dashboards: Dashboard[]) {
  return {
    getDashboardConfig: vi.fn<() => Dashboard[]>(() => dashboards),
    saveDashboards: vi.fn<(dashboards: Dashboard[]) => void>()
  };
}

describe('DashboardService', () => {
  let service: DashboardService;
  let settings: ReturnType<typeof makeSettingsMock>;
  let router: ReturnType<typeof makeRouterStub>;
  let consoleWarn: MockInstance;
  let consoleError: MockInstance;

  function setup(dashboards: Dashboard[] = seed(), routeId: string | null = null): void {
    settings = makeSettingsMock(dashboards);
    router = makeRouterStub(routeId);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: SettingsService, useValue: settings },
        { provide: Router, useValue: router }
      ]
    });
    service = TestBed.inject(DashboardService);
  }

  beforeEach(() => {
    consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('seeds the default dashboards with fresh UUIDs when settings has none', () => {
      setup([]);
      const dashboards = service.dashboards();
      expect(dashboards).toHaveLength(DefaultDashboard.length);
      dashboards.forEach((dashboard, i) => {
        expect(dashboard.id).toMatch(UUID_PATTERN);
        // A fresh id, not the constant's own — proves regeneration rather than shape alone
        // (the constant now carries real UUIDs, so UUID_PATTERN would match either way).
        expect(dashboard.id).not.toBe(DefaultDashboard[i].id);
        expect(dashboard.name).toBe(DefaultDashboard[i].name);
        // Each page deep-clones the shared DefaultDashboard constant so later in-place edits cannot corrupt it.
        expect(dashboard.configuration).not.toBe(DefaultDashboard[i].configuration);
        expect(dashboard.configuration).toEqual(DefaultDashboard[i].configuration);
      });
      expect(widgetsOf(dashboards[0])[0]).not.toBe(DefaultDashboard[0].configuration![0]);
      expect(consoleWarn).toHaveBeenCalled();
    });

    it('adopts the settings dashboards array as-is when present', () => {
      const stored = seed();
      setup(stored);
      expect(service.dashboards()).toBe(stored);
    });
  });

  describe('active dashboard from route', () => {
    it('applies a snapshot id param at construction', () => {
      setup(seed(), '2');
      expect(service.activeDashboard()).toBe(2);
    });

    it('stays unset until the first NavigationEnd, then defaults to 0', () => {
      setup();
      expect(service.activeDashboard()).toBeNull();
      router.emitNavigationEnd();
      expect(service.activeDashboard()).toBe(0);
    });

    it('uses the id param present at the first NavigationEnd', () => {
      setup();
      router.setIdParam('1');
      router.emitNavigationEnd();
      expect(service.activeDashboard()).toBe(1);
    });

    it('defaults to 0 when the first NavigationEnd param is not numeric', () => {
      setup();
      router.setIdParam('not-a-number');
      router.emitNavigationEnd();
      expect(service.activeDashboard()).toBe(0);
    });

    it('defaults to 0 when the first NavigationEnd param is a finite but out-of-range index', () => {
      setup();
      router.setIdParam('9');
      router.emitNavigationEnd();
      expect(service.activeDashboard()).toBe(0);
      // The rejected id is still logged once; the fallback to page 0 is silent.
      expect(consoleError).toHaveBeenCalledTimes(1);
    });

    it('defaults to 0 when the first NavigationEnd param is a fractional index', () => {
      setup();
      router.setIdParam('1.5');
      router.emitNavigationEnd();
      expect(service.activeDashboard()).toBe(0);
      expect(consoleError).toHaveBeenCalledTimes(1);
    });

    it('follows id param changes on later navigations', () => {
      setup();
      router.emitNavigationEnd();
      router.setIdParam('2');
      router.emitNavigationEnd();
      expect(service.activeDashboard()).toBe(2);
    });

    it('keeps the current index when a later param is non-numeric or out of range', () => {
      setup();
      router.emitNavigationEnd();
      router.setIdParam('1');
      router.emitNavigationEnd();
      router.setIdParam('not-a-number');
      router.emitNavigationEnd();
      expect(service.activeDashboard()).toBe(1);
      router.setIdParam('9');
      router.emitNavigationEnd();
      expect(service.activeDashboard()).toBe(1);
      expect(consoleError).toHaveBeenCalled();
    });
  });

  describe('setActiveDashboardIndex', () => {
    beforeEach(() => setup());

    it('activates in-bounds indexes and rejects out-of-bounds ones with an error', () => {
      service.setActiveDashboardIndex(1);
      expect(service.activeDashboard()).toBe(1);
      service.setActiveDashboardIndex(3);
      service.setActiveDashboardIndex(-1);
      expect(service.activeDashboard()).toBe(1);
      expect(consoleError).toHaveBeenCalledTimes(2);
    });

    it('rejects a fractional index instead of activating a non-integer dashboard', () => {
      service.setActiveDashboardIndex(1);
      service.setActiveDashboardIndex(1.5);
      expect(service.activeDashboard()).toBe(1);
      expect(consoleError).toHaveBeenCalledTimes(1);
    });
  });

  describe('add and update', () => {
    it('appends a dashboard with a fresh UUID and returns its index', () => {
      setup();
      const index = service.add('New One', []);
      expect(index).toBe(3);
      const added = service.dashboards()[3];
      expect(added.name).toBe('New One');
      expect(added.icon).toBe('dashboard-dashboard');
      expect(added.id).toMatch(UUID_PATTERN);
      expect(service.add('Iconic', [], 'custom-icon')).toBe(4);
      expect(service.dashboards()[4].icon).toBe('custom-icon');
    });

    it('rewrites name and icon only, preserving id and configuration', () => {
      const config = [makeWidget('w-0')];
      setup([makeDashboard('d-0', 'One', config), makeDashboard('d-1', 'Two')]);
      service.update(0, 'Renamed', 'new-icon');
      const updated = service.dashboards()[0];
      expect(updated.name).toBe('Renamed');
      expect(updated.icon).toBe('new-icon');
      expect(updated.id).toBe('d-0');
      expect(updated.configuration).toBe(config);
      expect(service.dashboards()[1].name).toBe('Two');
    });
  });

  describe('delete', () => {
    it('shifts the active index down so it follows the same dashboard when a lower one is removed', () => {
      setup();
      service.setActiveDashboardIndex(1);
      service.delete(0);
      expect(service.dashboards().map(d => d.id)).toEqual(['d-1', 'd-2']);
      // The active dashboard (d-1) shifts from index 1 to index 0; the active index follows it.
      expect(service.activeDashboard()).toBe(0);
      expect(service.dashboards()[service.activeDashboard()!].id).toBe('d-1');
    });

    it('leaves the active index unchanged when a higher-indexed dashboard is removed', () => {
      setup();
      service.setActiveDashboardIndex(1);
      service.delete(2);
      expect(service.activeDashboard()).toBe(1);
      expect(service.dashboards()[service.activeDashboard()!].id).toBe('d-1');
    });

    it('keeps the active index on the dashboard that slides up when the active, non-last one is deleted', () => {
      setup();
      service.setActiveDashboardIndex(1);
      service.delete(1);
      expect(service.dashboards().map(d => d.id)).toEqual(['d-0', 'd-2']);
      expect(service.activeDashboard()).toBe(1);
      expect(service.dashboards()[service.activeDashboard()!].id).toBe('d-2');
    });

    it('ignores an out-of-range index without touching the active dashboard', () => {
      setup();
      service.setActiveDashboardIndex(0);
      service.delete(-1);
      service.delete(5);
      expect(service.dashboards().map(d => d.id)).toEqual(['d-0', 'd-1', 'd-2']);
      expect(service.activeDashboard()).toBe(0);
      expect(consoleError).toHaveBeenCalledTimes(2);
    });

    it('rejects a fractional index without removing anything', () => {
      setup();
      service.setActiveDashboardIndex(0);
      service.delete(1.5);
      expect(service.dashboards().map(d => d.id)).toEqual(['d-0', 'd-1', 'd-2']);
      expect(service.activeDashboard()).toBe(0);
      expect(consoleError).toHaveBeenCalledTimes(1);
    });

    it('clamps the active index when it falls past the end', () => {
      setup();
      service.setActiveDashboardIndex(2);
      service.delete(2);
      expect(service.activeDashboard()).toBe(1);
    });

    it('recreates a blank dashboard and resets active when the last one is deleted', () => {
      setup([makeDashboard('d-only', 'Solo')]);
      service.setActiveDashboardIndex(0);
      service.delete(0);
      const dashboards = service.dashboards();
      expect(dashboards).toHaveLength(1);
      expect(dashboards[0].id).not.toBe('d-only');
      expect(dashboards[0].name).toBe('Page 1');
      expect(dashboards[0].configuration).toEqual([]);
      expect(service.activeDashboard()).toBe(0);
    });
  });

  describe('duplicate', () => {
    it('returns -1 and leaves the list unchanged for an out-of-bounds index', () => {
      setup();
      expect(service.duplicate(5, 'Copy', 'icon')).toBe(-1);
      expect(service.duplicate(-1, 'Copy', 'icon')).toBe(-1);
      expect(service.dashboards()).toHaveLength(3);
      expect(consoleError).toHaveBeenCalledTimes(2);
    });

    it('returns -1 for a fractional index instead of crashing on a missing dashboard', () => {
      setup();
      expect(service.duplicate(1.5, 'Copy', 'icon')).toBe(-1);
      expect(service.dashboards()).toHaveLength(3);
      expect(consoleError).toHaveBeenCalledTimes(1);
    });

    it('returns -1 for NaN without throwing on a missing dashboard', () => {
      setup();
      let result: number | undefined;
      expect(() => { result = service.duplicate(NaN, 'Copy', 'icon'); }).not.toThrow();
      expect(result).toBe(-1);
      expect(service.dashboards()).toHaveLength(3);
      expect(consoleError).toHaveBeenCalledTimes(1);
    });

    it('deep clones with fresh dashboard and widget UUIDs kept in sync', () => {
      setup([makeDashboard('d-src', 'Source', [makeWidget('w-src')])]);
      const index = service.duplicate(0, 'Copy', '');
      expect(index).toBe(1);
      const copy = service.dashboards()[1];
      expect(copy.name).toBe('Copy');
      expect(copy.icon).toBe('dashboard-dashboard');
      expect(copy.id).toMatch(UUID_PATTERN);
      const copiedWidget = widgetsOf(copy)[0];
      expect(copiedWidget.id).not.toBe('w-src');
      expect(copiedWidget.input!.widgetProperties.uuid).toBe(copiedWidget.id);
      const sourceWidget = widgetsOf(service.dashboards()[0])[0];
      expect(sourceWidget.id).toBe('w-src');
      expect(sourceWidget.input!.widgetProperties.uuid).toBe('w-src');
    });

    it('replaces a missing configuration with an empty array', () => {
      setup([{ id: 'd-src', name: 'Source' }]);
      service.duplicate(0, 'Copy', 'icon');
      expect(service.dashboards()[1].configuration).toEqual([]);
      expect(consoleError).toHaveBeenCalled();
    });

    it('keeps the original widget id when widgetProperties are missing', () => {
      setup([makeDashboard('d-src', 'Source', [{ id: 'w-bare', w: 1, h: 1, selector: 'widget-host2' }])]);
      service.duplicate(0, 'Copy', 'icon');
      expect(widgetsOf(service.dashboards()[1])[0].id).toBe('w-bare');
      expect(consoleError).toHaveBeenCalled();
    });
  });

  describe('updateConfiguration', () => {
    beforeEach(() => setup());

    it('stores a deep clone of the new configuration and treats null as empty', () => {
      const next = [makeWidget('w-next')];
      service.updateConfiguration(0, next);
      const stored = service.dashboards()[0].configuration;
      expect(stored).toEqual(next);
      expect(stored).not.toBe(next);
      next[0].w = 99;
      expect(widgetsOf(service.dashboards()[0])[0].w).toBe(2);
      service.updateConfiguration(0, null);
      expect(service.dashboards()[0].configuration).toEqual([]);
    });

    it('keeps the previous array identity when nothing changed', () => {
      service.updateConfiguration(0, [makeWidget('w-a')]);
      const before = service.dashboards();
      service.updateConfiguration(0, [makeWidget('w-a')]);
      expect(service.dashboards()).toBe(before);
    });
  });

  describe('dashboard cycling', () => {
    beforeEach(() => setup());

    // Correctly named: nextDashboard advances (wraps last -> first),
    // previousDashboard retreats (wraps first -> last).
    it('nextDashboard advances the active index, wrapping to the first', () => {
      service.setActiveDashboardIndex(1);
      service.nextDashboard();
      expect(service.activeDashboard()).toBe(2);
      service.nextDashboard();
      expect(service.activeDashboard()).toBe(0);
    });

    it('previousDashboard retreats the active index, wrapping to the last', () => {
      service.setActiveDashboardIndex(1);
      service.previousDashboard();
      expect(service.activeDashboard()).toBe(0);
      service.previousDashboard();
      expect(service.activeDashboard()).toBe(2);
    });
  });

  describe('router navigation', () => {
    beforeEach(() => setup());

    it('navigateToActive routes to the active dashboard index', () => {
      service.setActiveDashboardIndex(1);
      service.navigateToActive();
      expect(router.navigate).toHaveBeenCalledWith(['/page', 1]);
    });

    it('navigateTo routes to an in-bounds index and rejects others with an error', () => {
      service.navigateTo(2);
      expect(router.navigate).toHaveBeenCalledWith(['/page', 2]);
      service.navigateTo(3);
      expect(router.navigate).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalled();
    });

    it('navigateTo rejects a fractional index without navigating', () => {
      service.navigateTo(1.5);
      service.navigateTo(-1);
      expect(router.navigate).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledTimes(2);
    });

    it('navigateToNextDashboard routes forward and navigateToPreviousDashboard backward, with wrap', () => {
      service.setActiveDashboardIndex(0);
      service.navigateToNextDashboard();
      expect(router.navigate).toHaveBeenLastCalledWith(['/page', 1]);
      service.navigateToPreviousDashboard();
      expect(router.navigate).toHaveBeenLastCalledWith(['/page', 2]);
      service.setActiveDashboardIndex(2);
      service.navigateToPreviousDashboard();
      expect(router.navigate).toHaveBeenLastCalledWith(['/page', 1]);
      service.setActiveDashboardIndex(1);
      service.navigateToNextDashboard();
      expect(router.navigate).toHaveBeenLastCalledWith(['/page', 2]);
    });
  });

  describe('page transition direction and guard', () => {
    beforeEach(() => setup());

    it('records "next" going forward and "prev" going back', () => {
      service.setActiveDashboardIndex(1);
      service.navigateToNextDashboard();
      expect(service.consumePendingPageDirection()).toBe('next');
      service.setActiveDashboardIndex(1);
      service.navigateToPreviousDashboard();
      expect(service.consumePendingPageDirection()).toBe('prev');
    });

    it('records the travel direction across wrap-around at both ends', () => {
      service.setActiveDashboardIndex(2); // last of three
      service.navigateToNextDashboard(); // wraps to first
      expect(router.navigate).toHaveBeenLastCalledWith(['/page', 0]);
      expect(service.consumePendingPageDirection()).toBe('next');
      service.setActiveDashboardIndex(0); // first
      service.navigateToPreviousDashboard(); // wraps to last
      expect(router.navigate).toHaveBeenLastCalledWith(['/page', 2]);
      expect(service.consumePendingPageDirection()).toBe('prev');
    });

    it('derives direction from the target index on a direct jump', () => {
      service.setActiveDashboardIndex(0);
      service.navigateTo(2);
      expect(service.consumePendingPageDirection()).toBe('next');
      service.setActiveDashboardIndex(2);
      service.navigateTo(0);
      expect(service.consumePendingPageDirection()).toBe('prev');
    });

    it('records no direction when the target equals the current page', () => {
      service.setActiveDashboardIndex(1);
      service.navigateTo(1);
      expect(service.consumePendingPageDirection()).toBeNull();
    });

    it('is a no-op for next/previous with a single dashboard', () => {
      setup([makeDashboard('d-0', 'Only')]);
      service.navigateToNextDashboard();
      service.navigateToPreviousDashboard();
      expect(router.navigate).not.toHaveBeenCalled();
      expect(service.consumePendingPageDirection()).toBeNull();
    });

    it('consumes the pending direction once', () => {
      service.setActiveDashboardIndex(0);
      service.navigateToNextDashboard();
      expect(service.consumePendingPageDirection()).toBe('next');
      expect(service.consumePendingPageDirection()).toBeNull();
    });

    it('ignores navigation while a transition is in flight', () => {
      service.setActiveDashboardIndex(1);
      service.beginPageTransition();
      service.navigateToNextDashboard();
      service.navigateToPreviousDashboard();
      service.navigateTo(2);
      expect(router.navigate).not.toHaveBeenCalled();
      service.endPageTransition();
      expect(service.isPageTransitioning()).toBe(false);
      service.navigateToNextDashboard();
      expect(router.navigate).toHaveBeenCalledTimes(1);
    });
  });

  describe('widget actions', () => {
    beforeEach(() => setup());

    it('replays null to subscribers before any action', () => {
      const seen: (widgetOperation | null)[] = [];
      const subscription = service.widgetAction$.subscribe(op => seen.push(op));
      expect(seen).toEqual([null]);
      subscription.unsubscribe();
    });

    it('emits one operation per action call', () => {
      const seen: (widgetOperation | null)[] = [];
      const subscription = service.widgetAction$.subscribe(op => seen.push(op));
      service.deleteWidget('w-1');
      service.duplicateWidget('w-2');
      service.copyWidget('w-3');
      service.cutWidget('w-4');
      expect(seen.slice(1)).toEqual([
        { id: 'w-1', operation: 'delete' },
        { id: 'w-2', operation: 'duplicate' },
        { id: 'w-3', operation: 'copy' },
        { id: 'w-4', operation: 'cut' }
      ]);
      subscription.unsubscribe();
    });
  });

  describe('widget clipboard', () => {
    beforeEach(() => setup());

    it('stores a sanitized snapshot with a cloned config and clipboard uuid', () => {
      const node = makeWidget('w-src');
      node.x = 5;
      node.y = 6;
      service.setWidgetClipboardFromNode(node);
      expect(service.widgetClipboard()).toEqual({
        w: 2, h: 2,
        selector: 'widget-host2',
        input: { widgetProperties: { type: 'widget-numeric', uuid: 'clipboard', config: { displayName: 'w-src' } } }
      });
      node.input!.widgetProperties.config.displayName = 'mutated';
      expect(service.widgetClipboard()!.input!.widgetProperties.config.displayName).toBe('w-src');
      service.clearWidgetClipboard();
      expect(service.widgetClipboard()).toBeNull();
    });

    it('ignores nodes without a widget type', () => {
      service.setWidgetClipboardFromNode({ w: 1, h: 1, selector: 'widget-host2' });
      service.setWidgetClipboardFromNode(null);
      expect(service.widgetClipboard()).toBeNull();
    });
  });

  describe('layout state', () => {
    beforeEach(() => setup());

    it('toggles and sets the static flag', () => {
      expect(service.isDashboardStatic()).toBe(true);
      service.toggleStaticDashboard();
      expect(service.isDashboardStatic()).toBe(false);
      service.setStaticDashboard(true);
      expect(service.isDashboardStatic()).toBe(true);
    });

    it('counts layout edit save and cancel notifications', () => {
      expect(service.layoutEditSaved()).toBe(0);
      expect(service.layoutEditCanceled()).toBe(0);
      service.notifyLayoutEditSaved();
      service.notifyLayoutEditSaved();
      service.notifyLayoutEditCanceled();
      expect(service.layoutEditSaved()).toBe(2);
      expect(service.layoutEditCanceled()).toBe(1);
    });
  });

  // Embed mode pins isDashboardStatic true at this single read-only choke point (#216 E6).
  describe('layout state under embed', () => {
    function setupEmbed(embed: boolean): DashboardService {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          { provide: SettingsService, useValue: makeSettingsMock(seed()) },
          { provide: Router, useValue: makeRouterStub(null) },
          { provide: EmbedModeService, useValue: { embed: () => embed, profile: () => null } }
        ]
      });
      return TestBed.inject(DashboardService);
    }

    it('makes setStaticDashboard(false) and toggleStaticDashboard() no-ops under embed', () => {
      const svc = setupEmbed(true);
      expect(svc.isDashboardStatic()).toBe(true);
      svc.setStaticDashboard(false);
      expect(svc.isDashboardStatic()).toBe(true);
      svc.toggleStaticDashboard();
      expect(svc.isDashboardStatic()).toBe(true);
    });

    it('still applies a redundant lock under embed', () => {
      const svc = setupEmbed(true);
      svc.setStaticDashboard(true);
      expect(svc.isDashboardStatic()).toBe(true);
    });

    it('behaves normally (unlock/toggle work) when not embedded', () => {
      const svc = setupEmbed(false);
      svc.setStaticDashboard(false);
      expect(svc.isDashboardStatic()).toBe(false);
      svc.toggleStaticDashboard();
      expect(svc.isDashboardStatic()).toBe(true);
    });
  });

  describe('persistence', () => {
    it('saves dashboards through settings whenever the list changes', () => {
      setup();
      TestBed.tick();
      expect(settings.saveDashboards).toHaveBeenCalledTimes(1);
      expect(settings.saveDashboards).toHaveBeenLastCalledWith(service.dashboards());
      service.add('Fourth', []);
      TestBed.tick();
      expect(settings.saveDashboards).toHaveBeenCalledTimes(2);
      expect(settings.saveDashboards.mock.lastCall![0]).toHaveLength(4);
    });

    it('does not re-save when an update leaves the list deep-equal', () => {
      setup();
      TestBed.tick();
      expect(settings.saveDashboards).toHaveBeenCalledTimes(1);
      service.updateConfiguration(0, []);
      TestBed.tick();
      expect(settings.saveDashboards).toHaveBeenCalledTimes(1);
    });
  });
});

describe('DefaultDashboard seed constant', () => {
  const widgets = DefaultDashboard.flatMap(d => (d.configuration ?? []) as NgGridStackWidget[]);

  it('gives every page a unique id', () => {
    const ids = DefaultDashboard.map(d => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every widget a unique gridstack id that matches its widgetProperties uuid', () => {
    const ids = widgets.map(w => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    widgets.forEach(w => expect(w.id).toBe(w.input!.widgetProperties.uuid));
  });

  it('pins no vessel-specific $source — every source resolves to the server default', () => {
    // The seed is extracted from a live boat; a stray non-'default' source or a
    // pinned trackedDevices entry would bind to one vessel's hardware and blank
    // the widget on every other install (and leak a device id into the package).
    const offenders: string[] = [];
    const scan = (node: unknown, path: string): void => {
      if (Array.isArray(node)) {
        node.forEach((v, i) => scan(v, `${path}[${i}]`));
      } else if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
          if ((k === 'source' || k === 'datachartSource') && typeof v === 'string' && v !== '' && v !== 'default') {
            offenders.push(`${path}/${k}=${v}`);
          } else if (k === 'trackedDevices' && Array.isArray(v) && v.length > 0) {
            offenders.push(`${path}/${k} pins ${v.length} device(s)`);
          } else {
            scan(v, `${path}/${k}`);
          }
        }
      }
    };
    DefaultDashboard.forEach((d, i) => scan(d.configuration, `page${i}`));
    expect(offenders).toEqual([]);
  });
});
