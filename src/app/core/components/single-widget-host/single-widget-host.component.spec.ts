import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivatedRoute, Route, convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { SingleWidgetHostComponent, applySavedConfig } from './single-widget-host.component';
import { WidgetService } from '../../services/widget.service';
import { PluginConfigClientService } from '../../services/plugin-config-client.service';
import { WidgetHostBridge } from './widget-host-bridge';
import { embedRequiredGuard } from '../../guards/embed-required-route.guard';
import { routes } from '../../../app.routes';
import type { IWidget, IWidgetSvcConfig } from '../../interfaces/widgets-interface';

// The widget type the plotter-extension manifest (@halos-org/skip-freeboard-panel WIND_STEER_TYPE)
// and the `#/widget/:type` route target. Kept here as the app-side end of that cross-package string contract.
const MANIFEST_WIDGET_TYPE = 'widget-wind-steer';

// Reaches the protected signals under test without rendering the template (which would instantiate
// the heavy Host2 graph); the class logic is what these read.
interface Probe {
  type(): string;
  widget(): IWidget | null;
}

function makeRoute(type: string) {
  const pm = convertToParamMap({ type });
  return {
    paramMap: new BehaviorSubject(pm).asObservable(),
    snapshot: { paramMap: pm }
  } as unknown as ActivatedRoute;
}

describe('SingleWidgetHostComponent', () => {
  // Only these selectors are "registered" for the class-logic tests; getWidgetName mirrors
  // WidgetService's undefined-for-unknown contract, which the component uses as its existence check.
  const KNOWN = new Set([MANIFEST_WIDGET_TYPE]);
  // config() returns null so the reconfigure effect is a no-op in these tests.
  const bridge = { enable: vi.fn(), disable: vi.fn(), config: () => null };

  function configure(type: string) {
    bridge.enable.mockClear();
    bridge.disable.mockClear();
    TestBed.configureTestingModule({
      imports: [SingleWidgetHostComponent],
      providers: [
        { provide: ActivatedRoute, useValue: makeRoute(type) },
        { provide: WidgetService, useValue: { getWidgetName: (sel: string) => (KNOWN.has(sel) ? 'Wind Steer' : undefined) } }
      ]
    });
    // The bridge is component-scoped (providers on the component), so override there, not at module level.
    TestBed.overrideComponent(SingleWidgetHostComponent, {
      set: { providers: [{ provide: WidgetHostBridge, useValue: bridge }] }
    });
  }

  function probe(type: string): Probe {
    configure(type);
    // No detectChanges: read the signals directly, never render <widget-host2>.
    return TestBed.createComponent(SingleWidgetHostComponent).componentInstance as unknown as Probe;
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('builds an IWidget for a registered widget type taken from the route', () => {
    const c = probe(MANIFEST_WIDGET_TYPE);
    const w = c.widget();
    expect(w?.type).toBe(MANIFEST_WIDGET_TYPE);
    expect(typeof w?.uuid).toBe('string');
    expect(w?.uuid.length).toBeGreaterThan(0);
  });

  it('keeps a stable IWidget reference across reads so Host2 OnPush input does not churn', () => {
    const c = probe(MANIFEST_WIDGET_TYPE);
    expect(c.widget()).toBe(c.widget());
  });

  it('hosts no widget for an unrecognized type', () => {
    const c = probe('widget-does-not-exist');
    expect(c.widget()).toBeNull();
  });

  it('renders the unknown-widget fallback (naming the offending type) for an unrecognized type', () => {
    configure('widget-does-not-exist');
    const fixture = TestBed.createComponent(SingleWidgetHostComponent);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Unknown widget');
    expect(text).toContain('widget-does-not-exist');
  });

  // Drive the lifecycle directly rather than detectChanges, so the heavy Host2 graph is never
  // rendered (the rest of the suite relies on the same no-render boundary).
  it('enables the host bridge for a hosted widget and disables it on destroy', () => {
    configure(MANIFEST_WIDGET_TYPE);
    const c = TestBed.createComponent(SingleWidgetHostComponent).componentInstance;
    c.ngOnInit();
    expect(bridge.enable).toHaveBeenCalledTimes(1);
    c.ngOnDestroy();
    expect(bridge.disable).toHaveBeenCalledTimes(1);
  });

  it('does not enable the host bridge for the unknown-widget fallback', () => {
    configure('widget-does-not-exist');
    const c = TestBed.createComponent(SingleWidgetHostComponent).componentInstance;
    c.ngOnInit();
    expect(bridge.enable).not.toHaveBeenCalled();
  });

  // Binds the two ends of the cross-file string contract so a rename fails CI instead of shipping an
  // "Unknown widget" tile inside Freeboard-SK (the feature's silent-break mode).
  it('targets a widget type that is a real registered WidgetService selector', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: PluginConfigClientService, useValue: {} }]
    });
    const name = TestBed.inject(WidgetService).getWidgetName(MANIFEST_WIDGET_TYPE);
    expect(name, `manifest/route type "${MANIFEST_WIDGET_TYPE}" is not a registered widget selector`).toBeTruthy();
  });

  it('exposes the embed-only widget route that resolves this component', () => {
    const route = routes.find((r: Route) => r.path === 'widget/:type');
    expect(route, 'route "widget/:type" is missing — the manifest widget URL would fall through to page/0').toBeDefined();
    expect(route?.loadComponent).toBeTypeOf('function');
    expect(route?.canActivate).toContain(embedRequiredGuard);
  });

  it('exposes the embed-only widget-config route (the manifest configPanel URL target)', () => {
    const route = routes.find((r: Route) => r.path === 'widget-config/:type');
    expect(route, 'route "widget-config/:type" is missing — the manifest config URL would fall through to page/0').toBeDefined();
    expect(route?.loadComponent).toBeTypeOf('function');
    expect(route?.canActivate).toContain(embedRequiredGuard);
  });
});

describe('applySavedConfig', () => {
  it('reconfigures the host when both a config and a host are present', () => {
    const host = { reconfigure: vi.fn() };
    const cfg = { updateInterval: 2000 } as IWidgetSvcConfig;
    applySavedConfig(cfg, host);
    expect(host.reconfigure).toHaveBeenCalledWith(cfg);
  });

  it('does nothing when the config or the host is absent', () => {
    const host = { reconfigure: vi.fn() };
    applySavedConfig(null, host);
    applySavedConfig({} as IWidgetSvcConfig, undefined);
    expect(host.reconfigure).not.toHaveBeenCalled();
  });
});
