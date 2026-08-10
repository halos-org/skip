import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { EMPTY, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetAutopilotComponent } from './widget-autopilot.component';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective } from '../../core/directives/widget-streams.directive';
import { SignalkRequestsService } from '../../core/services/signalk-requests.service';
import { DashboardService } from '../../core/services/dashboard.service';
import { UnitsService } from '../../core/services/units.service';
import { DataService } from '../../core/services/data.service';

describe('WidgetAutopilotComponent', () => {
  let component: WidgetAutopilotComponent;

  const runtimeOptions = {
    autopilot: {
      apiVersion: 'v2' as 'v1' | 'v2',
      instanceId: 'test-autopilot',
      pluginId: 'autopilot',
      modes: ['auto', 'wind', 'route'],
      invertRudder: true,
      headingDirectionTrue: false,
      courseDirectionTrue: false
    }
  };

  const runtimeMock = {
    options: () => runtimeOptions
  };

  const streamsMock = {
    observe: vi.fn()
  };

  const requestsMock = {
    subscribeRequest: () => EMPTY,
    putRequest: vi.fn()
  };

  const httpMock = {
    post: vi.fn(() => of({ statusCode: 200 })),
    put: vi.fn(() => of({ statusCode: 200 })),
    delete: vi.fn(() => of({ statusCode: 200 }))
  };

  const dashboardMock = {
    isDashboardStatic: () => true
  };

  const unitsMock = {
    convertToUnit: (_unit: string, value: unknown) => value
  };

  const dataMock = {
    subscribePath: vi.fn(() => EMPTY)
  };

  beforeEach(async () => {
    runtimeOptions.autopilot.apiVersion = 'v2';
    streamsMock.observe.mockClear();

    TestBed.configureTestingModule({
      providers: [
        { provide: WidgetRuntimeDirective, useValue: runtimeMock },
        { provide: WidgetStreamsDirective, useValue: streamsMock },
        { provide: SignalkRequestsService, useValue: requestsMock },
        { provide: HttpClient, useValue: httpMock },
        { provide: DashboardService, useValue: dashboardMock },
        { provide: UnitsService, useValue: unitsMock },
        { provide: DataService, useValue: dataMock }
      ]
    });

    component = TestBed.runInInjectionContext(() => new WidgetAutopilotComponent());
  });

  it('labels the v2 standby toggle as Engage when autopilot is not engaged', () => {
    (component as unknown as { apEngaged: { set: (value: boolean) => void } }).apEngaged.set(false);

    const label = (component as unknown as { standbyButtonLabel: () => string }).standbyButtonLabel();

    expect(label).toBe('Engage');
  });

  it('labels the v2 standby toggle as Disengage when autopilot is engaged', () => {
    (component as unknown as { apEngaged: { set: (value: boolean) => void } }).apEngaged.set(true);

    const label = (component as unknown as { standbyButtonLabel: () => string }).standbyButtonLabel();

    expect(label).toBe('Disengage');
  });

  it('labels the v2 standby toggle as Engage before the engaged state is known (null)', () => {
    runtimeOptions.autopilot.apiVersion = 'v2';
    (component as unknown as { apEngaged: { set: (value: boolean | null) => void } }).apEngaged.set(null);

    const label = (component as unknown as { standbyButtonLabel: () => string }).standbyButtonLabel();

    // A click in this state POSTs engage (apEngaged() is falsy), so the label must read Engage, not Disengage.
    expect(label).toBe('Engage');
  });

  it('keeps the v1 standby command label as Disengage', () => {
    runtimeOptions.autopilot.apiVersion = 'v1';
    (component as unknown as { apEngaged: { set: (value: boolean) => void } }).apEngaged.set(false);

    const label = (component as unknown as { standbyButtonLabel: () => string }).standbyButtonLabel();

    expect(label).toBe('Disengage');
  });

  const startV1 = () => (component as unknown as { startV1Subscriptions: () => void }).startV1Subscriptions();

  it('keeps the control rows laid out but disabled while no autopilot mode is known', () => {
    // A silent or unconfigured autopilot must still look like an autopilot, not collapse to two
    // buttons over an empty panel.
    const internals = component as unknown as {
      apMode: { set: (value: string | null) => void };
      adjustHdgBtnVisibility: () => boolean;
      tackBtnVisibility: () => boolean;
      apBtnDisabled: () => boolean;
    };

    internals.apMode.set(null);
    expect(internals.adjustHdgBtnVisibility()).toBe(true);
    expect(internals.tackBtnVisibility()).toBe(true);
    expect(internals.apBtnDisabled()).toBe(true);

    internals.apMode.set('off-line');
    expect(internals.adjustHdgBtnVisibility()).toBe(true);
    expect(internals.tackBtnVisibility()).toBe(true);
    expect(internals.apBtnDisabled()).toBe(true);
  });

  it('enables the control rows once a real mode is reported', () => {
    const internals = component as unknown as {
      apMode: { set: (value: string | null) => void };
      apEngaged: { set: (value: boolean) => void };
      adjustHdgBtnVisibility: () => boolean;
      apBtnDisabled: () => boolean;
    };

    internals.apMode.set('auto');
    internals.apEngaged.set(true);
    expect(internals.adjustHdgBtnVisibility()).toBe(true);
    expect(internals.apBtnDisabled()).toBe(false);
  });

  it('does not throw starting V1 subscriptions when the config has no paths object', () => {
    const spy = vi.spyOn(runtimeMock, 'options').mockReturnValue({ autopilot: runtimeOptions.autopilot } as unknown as typeof runtimeOptions);
    try {
      expect(() => startV1()).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });

  it('does not throw starting V1 subscriptions when paths exist but autopilotMode is absent', () => {
    const spy = vi.spyOn(runtimeMock, 'options').mockReturnValue({ autopilot: runtimeOptions.autopilot, paths: {} } as unknown as typeof runtimeOptions);
    try {
      expect(() => startV1()).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });

  it('rewrites the autopilotMode path to the V1 legacy path when present', () => {
    const cfg = { autopilot: runtimeOptions.autopilot, paths: { autopilotMode: { path: 'placeholder' } } };
    const spy = vi.spyOn(runtimeMock, 'options').mockReturnValue(cfg as unknown as typeof runtimeOptions);
    try {
      startV1();
      expect(cfg.paths.autopilotMode.path).toBe('self.steering.autopilot.state');
    } finally {
      spy.mockRestore();
    }
  });

  /**
   * What a screen reader would announce. `textContent` is not that: it includes subtrees marked
   * aria-hidden, which is exactly the markup that hid these labels, so a test built on it cannot
   * see the defect. Drop those subtrees first.
   */
  const accessibleName = (btn: HTMLButtonElement) => {
    const explicit = btn.getAttribute('aria-label');
    if (explicit) { return explicit.trim(); }
    const clone = btn.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('[aria-hidden="true"]').forEach(node => node.remove());
    return (clone.textContent ?? '').trim();
  };

  const render = (mode: string): ComponentFixture<WidgetAutopilotComponent> => {
    const fixture = TestBed.createComponent(WidgetAutopilotComponent);
    const set = fixture.componentRef.setInput.bind(fixture.componentRef) as (k: string, v: unknown) => void;
    set('id', 'autopilot-test');
    set('type', 'widget-autopilot');
    set('theme', null);
    const state = fixture.componentInstance as unknown as {
      apMode: { set: (value: string) => void };
      apState: { set: (value: string) => void };
    };
    state.apMode.set(mode);
    state.apState.set('engaged');
    fixture.detectChanges();
    return fixture;
  };

  const controls = (fixture: ComponentFixture<WidgetAutopilotComponent>) =>
    [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button.ap-btn')];

  it('gives every control a non-empty accessible name', () => {
    // Angular Material marks mat-icon aria-hidden unless given an explicit value, so a control's
    // label must not live inside one or the control has no name at all.
    for (const mode of ['auto', 'wind', 'route', 'nav']) {
      const found = controls(render(mode));
      // Every control is in the DOM in every mode; visibility is a `display` binding on the wrapper.
      expect(found.length, mode).toBe(10);
      for (const btn of found) {
        // An aria-label must not replace visible text (WCAG 2.5.3 Label in Name), so the degree
        // controls are named by "-1°" and carry no letters; a name is required, letters are not.
        expect(accessibleName(btn), `${mode}: ${btn.outerHTML}`).not.toBe('');
        expect(btn.querySelector('mat-icon'), mode).toBeNull();
        expect(btn.querySelector('svg text'), mode).toBeNull();
      }
    }
  });

  it('renders control labels as text rather than markup the accessibility tree drops', () => {
    const labels = controls(render('auto')).map(btn => btn.textContent?.trim());
    expect(labels).toContain('Engage');
    expect(labels).toContain('Tack Port');
    expect(labels).toContain('Tack Stbd');
    expect(labels).toContain('Dodge');
    expect(labels).toContain('Adv Wpt');
  });
});
