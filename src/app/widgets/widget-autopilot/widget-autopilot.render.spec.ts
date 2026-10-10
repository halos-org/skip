import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { By } from '@angular/platform-browser';
import { EMPTY, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetAutopilotComponent } from './widget-autopilot.component';
import { SvgAutopilotComponent } from '../svg-autopilot/svg-autopilot.component';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective } from '../../core/directives/widget-streams.directive';
import { SignalkRequestsService } from '../../core/services/signalk-requests.service';
import { DashboardService } from '../../core/services/dashboard.service';
import { UnitsService } from '../../core/services/units.service';
import { DataService, IPathUpdate } from '../../core/services/data.service';
import { WidgetService } from '../../core/services/widget.service';
import { IWidgetSvcConfig } from '../../core/interfaces/widgets-interface';

const DEG = Math.PI / 180;

const unitsServiceStub = {
  getUnitDisplaySymbol: (measure: string | null | undefined) => measure ?? '',
  convertToUnit: (unit: string, value: number) => unit === 'deg' ? value / DEG : value
};

/**
 * What the widget draws for a set of SI inputs, read from the rendered SVG: the dial and AWA
 * rotations, the rudder bars, and the heading, target and XTE/AWA readouts. Pins the rendering so a
 * change of the unit the widget computes in cannot move anything on screen.
 */
describe('WidgetAutopilotComponent rendering from SI inputs', () => {
  let fixture: ComponentFixture<WidgetAutopilotComponent>;
  let options: WritableSignal<IWidgetSvcConfig | undefined>;
  let callbacks: Map<string, (u: IPathUpdate) => void>;

  const makeConfig = (autopilot: Partial<NonNullable<IWidgetSvcConfig['autopilot']>> = {}): IWidgetSvcConfig => {
    const defaults = structuredClone(WidgetAutopilotComponent.DEFAULT_CONFIG);
    return {
      ...defaults,
      autopilot: {
        ...defaults.autopilot,
        apiVersion: 'v2',
        instanceId: 'test-autopilot',
        pluginId: 'autopilot',
        modes: ['auto', 'wind', 'route'],
        ...autopilot
      }
    } as IWidgetSvcConfig;
  };

  const feedRaw = (pathKey: string, value: unknown, measure?: string): void => {
    const callback = callbacks.get(pathKey);
    if (!callback) throw new Error(`${pathKey} is not observed`);
    callback({ data: { value, timestamp: null, measure }, state: 'normal' } as IPathUpdate);
  };
  /** An SI sample as the streams directive delivers it to this widget, with its presentation measure. */
  const feed = (pathKey: string, si: number, measure: string): void =>
    feedRaw(pathKey, si, measure);
  const feedAngle = (pathKey: string, deg: number): void => feed(pathKey, deg * DEG, 'deg');
  const feedDistance = (pathKey: string, m: number): void => feed(pathKey, m, 'm');

  const svg = (): SvgAutopilotComponent =>
    fixture.debugElement.query(By.directive(SvgAutopilotComponent)).componentInstance as SvgAutopilotComponent;
  const element = (ref: string): Element =>
    (svg() as unknown as Record<string, () => { nativeElement: Element }>)[ref]().nativeElement;
  const texts = (group: string): string[] =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll(`#${group} text`))
      .map(text => (text.textContent ?? '').trim());

  /** Runs change detection and lets every rotation and rudder animation finish. */
  const settle = (): void => {
    fixture.detectChanges();
    vi.advanceTimersByTime(2000);
    fixture.detectChanges();
  };

  const render = (config: IWidgetSvcConfig): void => {
    options.set(config);
    fixture = TestBed.createComponent(WidgetAutopilotComponent);
    fixture.componentRef.setInput('id', 'w1');
    fixture.componentRef.setInput('type', 'widget-autopilot');
    fixture.componentRef.setInput('theme', null);
    fixture.detectChanges();
  };

  const engage = (mode: string): void => {
    feedRaw('autopilotState', 'enabled');
    feedRaw('autopilotMode', mode);
    feedRaw('autopilotEngaged', true);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    options = signal<IWidgetSvcConfig | undefined>(undefined);
    callbacks = new Map<string, (u: IPathUpdate) => void>();
    const streamsMock = {
      observe: (pathName: string, next: (u: IPathUpdate) => void) => { callbacks.set(pathName, next); },
      unobserve: (pathName: string) => { callbacks.delete(pathName); }
    };
    TestBed.configureTestingModule({
      imports: [WidgetAutopilotComponent],
      providers: [
        { provide: WidgetRuntimeDirective, useValue: { options } },
        // The embedded route readouts would lazy-load widget-numeric through the real WidgetService;
        // on a slow runner that import lands after this file's environment is torn down.
        { provide: WidgetService, useValue: { getComponentType: () => Promise.resolve(undefined) } },
        { provide: WidgetStreamsDirective, useValue: streamsMock },
        { provide: SignalkRequestsService, useValue: { subscribeRequest: () => EMPTY, putRequest: vi.fn() } },
        { provide: HttpClient, useValue: { post: vi.fn(() => of({ statusCode: 200 })), put: vi.fn(() => of({ statusCode: 200 })), delete: vi.fn(() => of({ statusCode: 200 })) } },
        { provide: DashboardService, useValue: { isDashboardStatic: () => true } },
        { provide: UnitsService, useValue: unitsServiceStub },
        { provide: DataService, useValue: { subscribePath: vi.fn(() => EMPTY) } }
      ]
    });
  });

  afterEach(() => {
    fixture?.destroy();
    vi.useRealTimers();
  });

  it('turns the dial to the magnetic heading and shows the heading-hold target', () => {
    render(makeConfig());
    engage('auto');
    feedAngle('headingMag', 350.4);
    feedAngle('autopilotV2Target', 12.6);
    settle();
    feedAngle('headingMag', 20.2);
    settle();

    expect({
      dial: element('rotatingDial').getAttribute('transform'),
      heading: texts('counterAWA')[4],
      display: texts('displayArea')
    }).toEqual({
      dial: 'rotate(340 500 560.061)',
      heading: '20°M',
      display: ['13°', 'Mag', 'Heading Hold']
    });
  });

  it('reads the true heading when the widget is set to true heading', () => {
    render(makeConfig({ headingDirectionTrue: true, courseDirectionTrue: true }));
    engage('auto');
    feedAngle('headingTrue', 181.6);
    feedAngle('autopilotV2Target', 179.4);
    settle();

    expect({
      dial: element('rotatingDial').getAttribute('transform'),
      heading: texts('counterAWA')[4],
      display: texts('displayArea')
    }).toEqual({
      dial: 'rotate(-182 500 560.061)',
      heading: '182°T',
      display: ['179°', 'True', 'Heading Hold']
    });
  });

  it('shows XTE 150 m in metres and 400 m in nautical miles, with its side', () => {
    render(makeConfig());
    engage('route');
    const xte = (m: number): string[] => {
      feedDistance('courseXte', m);
      settle();
      return texts('counterAWA').slice(0, 3);
    };

    expect(xte(150)).toEqual(['XTE', '150 m', 'Stbd']);
    expect(xte(-400)).toEqual(['XTE', '0.2 nm', 'Port']);
    expect(xte(185)).toEqual(['XTE', '185 m', 'Stbd']);
    expect(xte(-186)).toEqual(['XTE', '0.1 nm', 'Port']);
    expect(xte(0)).toEqual(['XTE', '0 m', '']);
  });

  it('shows a heading target of 000° as a target', () => {
    render(makeConfig());
    engage('auto');
    feedAngle('autopilotV2Target', 0);
    settle();

    expect(texts('displayArea')).toEqual(['0°', 'Mag', 'Heading Hold']);
  });

  it('shows a dead-ahead wind target as 0° with no side', () => {
    render(makeConfig());
    engage('wind');
    feedAngle('autopilotV2Target', 0);
    settle();

    expect(texts('displayArea')).toEqual(['0°', '', 'Wind Hold']);
  });

  it('points the AWA indicator and shows the wind-hold angle and side', () => {
    render(makeConfig());
    engage('wind');
    feedAngle('windAngleApparent', -35.4);
    feedAngle('autopilotV2Target', -40.3);
    settle();
    feedAngle('windAngleApparent', 28.6);
    settle();

    expect({
      awa: element('awaIndicator').getAttribute('transform'),
      readout: texts('counterAWA').slice(0, 2),
      display: texts('displayArea')
    }).toEqual({
      awa: 'rotate(29 500 560.061)',
      readout: ['AWA', '29°S'],
      display: ['-40°', 'Port', 'Wind Hold']
    });
  });

  it('shows the V1 wind target in wind mode and the heading target in auto mode', () => {
    render(makeConfig({ apiVersion: 'v1' }));
    feedRaw('autopilotMode', 'wind');
    feedAngle('autopilotTargetHeading', 95.7);
    feedAngle('autopilotTargetWindHeading', 42.2);
    settle();
    const wind = texts('displayArea');

    feedRaw('autopilotMode', 'auto');
    settle();

    expect({ wind, auto: texts('displayArea') }).toEqual({
      wind: ['42°', 'Stbd', 'Wind Hold'],
      auto: ['96°', 'Mag', 'Heading Hold']
    });
  });

  it('draws the rudder bars from the rudder angle, inverted and capped at 30°', () => {
    render(makeConfig());
    engage('auto');
    const bars = (deg: number): [string | null, string | null] => {
      feedAngle('rudderAngle', deg);
      settle();
      return [element('rudderPortRect').getAttribute('width'), element('rudderStarboardRect').getAttribute('width')];
    };

    expect(bars(10.2)).toEqual(['166.6666667', '0']);
    expect(bars(-45)).toEqual(['0', '500.0000001']);
  });
});
