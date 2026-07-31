import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { SingleWidgetHostComponent } from './single-widget-host.component';
import { WidgetService } from '../../services/widget.service';
import type { IWidget } from '../../interfaces/widgets-interface';

// Reaches the protected signals under test without rendering the template (which would instantiate
// the heavy Host2 graph); the class logic is what this spec verifies.
interface Probe {
  type(): string;
  known(): boolean;
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
  // Only these selectors are "registered" for the test; getWidgetName mirrors WidgetService's
  // undefined-for-unknown contract, which the component uses as its type-existence check.
  const KNOWN = new Set(['widget-wind-steer']);

  function build(type: string): Probe {
    TestBed.configureTestingModule({
      imports: [SingleWidgetHostComponent],
      providers: [
        { provide: ActivatedRoute, useValue: makeRoute(type) },
        { provide: WidgetService, useValue: { getWidgetName: (sel: string) => (KNOWN.has(sel) ? 'Wind Steer' : undefined) } }
      ]
    });
    // No detectChanges: read the signals directly, never render <widget-host2>.
    return TestBed.createComponent(SingleWidgetHostComponent).componentInstance as unknown as Probe;
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('builds an IWidget for a registered widget type taken from the route', () => {
    const c = build('widget-wind-steer');
    expect(c.known()).toBe(true);
    const w = c.widget();
    expect(w?.type).toBe('widget-wind-steer');
    expect(typeof w?.uuid).toBe('string');
    expect(w?.uuid.length).toBeGreaterThan(0);
  });

  it('keeps a stable IWidget reference across reads so Host2 OnPush input does not churn', () => {
    const c = build('widget-wind-steer');
    expect(c.widget()).toBe(c.widget());
  });

  it('reports unknown and hosts no widget for an unrecognized type', () => {
    const c = build('widget-does-not-exist');
    expect(c.known()).toBe(false);
    expect(c.widget()).toBeNull();
  });
});
