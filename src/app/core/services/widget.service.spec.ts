import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetService } from './widget.service';
import { PluginConfigClientService } from './plugin-config-client.service';

const AUTOPILOT_V2_URL = '/signalk/v2/api/vessels/self/autopilots';

describe('WidgetService', () => {
  let service: WidgetService;
  let httpMock: HttpTestingController;
  let installedPlugins: Set<string>;

  beforeEach(() => {
    installedPlugins = new Set<string>();
    const pluginConfigFake = {
      getPlugin: vi.fn(async (pluginId: string) =>
        installedPlugins.has(pluginId)
          ? { ok: true, data: { id: pluginId, state: { enabled: true } } }
          : { ok: false }
      )
    };

    TestBed.configureTestingModule({
      providers: [{ provide: PluginConfigClientService, useValue: pluginConfigFake }]
    });
    service = TestBed.inject(WidgetService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('registers the available electrical family widgets in definitions', () => {
    const selectors = service.skipWidgets.map(widget => widget.selector);

    expect(selectors).toContain('widget-solar-charger');
    expect(selectors).toContain('widget-charger');
    expect(selectors).toContain('widget-alternator');
    expect(selectors).toContain('widget-inverter');
    expect(selectors).toContain('widget-ac');
  });

  it('lazily resolves a component type as a promise and dedupes concurrent lookups', async () => {
    const p1 = service.getComponentType('widget-text');
    const p2 = service.getComponentType('widget-text');
    expect(p1).toBeInstanceOf(Promise);
    expect(p1).toBe(p2); // same in-flight promise reused (single import())

    const type = await p1;
    expect(type).toBeTruthy();
  });

  it('resolves undefined for an unknown selector without attempting an import', async () => {
    await expect(service.getComponentType('widget-does-not-exist')).resolves.toBeUndefined();
  });

  it('exposes DEFAULT_CONFIG only after the component has been loaded', async () => {
    // Not fetched yet: config-only consumers get undefined and fall back to saved config.
    expect(service.getDefaultConfig('widget-text')).toBeUndefined();

    await service.getComponentType('widget-text');

    // Once the chunk has loaded, the static DEFAULT_CONFIG is cached for synchronous reads.
    expect(service.getDefaultConfig('widget-text')).toBeDefined();
  });

  it('exposes OPTION_UNITS once the component has been loaded', async () => {
    expect(service.getOptionUnits('widget-sea-horizon')).toBeUndefined();

    await service.getComponentType('widget-sea-horizon');

    expect(service.getOptionUnits('widget-sea-horizon')).toEqual({ 'gauge.heelCautionAngle': 'rad', 'gauge.heelAlarmAngle': 'rad' });
  });

  describe('provider-API dependencies', () => {
    const autopilotStatus = async (respondToProbe: () => Promise<void>) => {
      const pending = service.getSkipWidgetsWithStatus();
      await respondToProbe();
      const widgets = await pending;
      const autopilot = widgets.find(widget => widget.selector === 'widget-autopilot');
      expect(autopilot).toBeDefined();
      return autopilot!;
    };

    const flushProbe = async (body: Record<string, unknown>) => {
      const request = await vi.waitFor(() => httpMock.expectOne(AUTOPILOT_V2_URL));
      request.flush(body);
    };

    it('declares the Autopilot API v2 endpoint on the Autopilot Head widget', () => {
      const autopilot = service.skipWidgets.find(widget => widget.selector === 'widget-autopilot');

      expect(autopilot?.anyOfApis).toEqual([AUTOPILOT_V2_URL]);
    });

    it('accepts a widget whose provider API answers even when no any-of plugin is installed', async () => {
      const autopilot = await autopilotStatus(
        () => flushProbe({ 'my-pilot': { provider: 'some-other-plugin', isDefault: true } })
      );

      expect(autopilot.isDependencyValid).toBe(true);
    });

    it('rejects a widget whose provider API reports no provider', async () => {
      const autopilot = await autopilotStatus(() => flushProbe({}));

      expect(autopilot.isDependencyValid).toBe(false);
    });

    it('rejects a widget whose provider API is absent', async () => {
      const autopilot = await autopilotStatus(async () => {
        const request = await vi.waitFor(() => httpMock.expectOne(AUTOPILOT_V2_URL));
        request.flush('not found', { status: 404, statusText: 'Not Found' });
      });

      expect(autopilot.isDependencyValid).toBe(false);
    });

    it('does not probe the provider API when an any-of plugin already satisfies the widget', async () => {
      installedPlugins.add('autopilot');

      const widgets = await service.getSkipWidgetsWithStatus();
      const autopilot = widgets.find(widget => widget.selector === 'widget-autopilot');

      expect(autopilot?.isDependencyValid).toBe(true);
      httpMock.expectNone(AUTOPILOT_V2_URL);
    });
  });

  describe('hasAnyApiProvider', () => {
    it('is false without endpoints to probe', async () => {
      await expect(service.hasAnyApiProvider(undefined)).resolves.toBe(false);
      await expect(service.hasAnyApiProvider([])).resolves.toBe(false);
    });

    it('reads a probe that never answers as no provider', async () => {
      vi.useFakeTimers();
      try {
        const pending = service.hasAnyApiProvider(['/hangs']);
        const request = await vi.waitFor(() => httpMock.expectOne('/hangs'));
        await vi.advanceTimersByTimeAsync(5000);

        await expect(pending).resolves.toBe(false);
        expect(request.cancelled).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('is true when any endpoint returns a non-empty collection', async () => {
      const pending = service.hasAnyApiProvider(['/a', '/b']);
      const requests = await vi.waitFor(() => {
        const found = httpMock.match(() => true);
        expect(found).toHaveLength(2);
        return found;
      });
      requests[0].flush({});
      requests[1].flush({ 'my-pilot': { provider: 'some-other-plugin' } });

      await expect(pending).resolves.toBe(true);
    });
  });
});
