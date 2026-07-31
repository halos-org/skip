import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ActivatedRoute, Route, convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { SingleWidgetHostComponent } from './single-widget-host.component';
import { WidgetService } from '../../services/widget.service';
import { PluginConfigClientService } from '../../services/plugin-config-client.service';
import { embedRequiredGuard } from '../../guards/embed-required-route.guard';
import { routes } from '../../../app.routes';
import type { IWidget } from '../../interfaces/widgets-interface';

// The widget type the plotter-extension manifest (plugin/index.js WIND_STEER_TYPE) and the
// `#/widget/:type` route target. Kept here as the app-side end of that cross-file string contract.
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

  function configure(type: string) {
    TestBed.configureTestingModule({
      imports: [SingleWidgetHostComponent],
      providers: [
        { provide: ActivatedRoute, useValue: makeRoute(type) },
        { provide: WidgetService, useValue: { getWidgetName: (sel: string) => (KNOWN.has(sel) ? 'Wind Steer' : undefined) } }
      ]
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
});
