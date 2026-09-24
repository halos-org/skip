import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetRacesteerComponent } from './widget-racesteer.component';
import { SvgRacesteerComponent } from '../svg-racesteer/svg-racesteer.component';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective } from '../../core/directives/widget-streams.directive';
import { UnitsService } from '../../core/services/units.service';
import { IPathUpdate } from '../../core/services/data.service';
import { IWidgetSvcConfig } from '../../core/interfaces/widgets-interface';

const DEG = Math.PI / 180;
const KNOTS_PER_MS = 1.94384;

const unitsServiceStub = {
  getUnitDisplaySymbol: (measure: string | null | undefined) => measure === 'knots' ? 'kn' : (measure ?? ''),
  convertToUnit: (unit: string, value: number) => {
    if (unit === 'knots') return value * KNOTS_PER_MS;
    if (unit === 'deg') return value / DEG;
    return value;
  }
};

/**
 * What the widget draws for a set of SI inputs, read from the rendered SVG: rotation attributes,
 * close-hauled line and wind-sector paths, the speed bar, and the text readouts with their colours.
 * Pins the rendering so a change of the unit the widget computes in cannot move anything on screen.
 */
describe('WidgetRacesteerComponent rendering from SI inputs', () => {
  let fixture: ComponentFixture<WidgetRacesteerComponent>;
  let options: WritableSignal<IWidgetSvcConfig | undefined>;
  let callbacks: Map<string, (u: IPathUpdate) => void>;

  const makeConfig = (overrides: Partial<IWidgetSvcConfig> = {}): IWidgetSvcConfig => ({
    ...WidgetRacesteerComponent.DEFAULT_CONFIG,
    ...overrides
  });

  /** An SI sample as the streams directive delivers it to this widget, with its presentation measure. */
  const feed = (pathKey: string, si: number, measure: string): void => {
    const callback = callbacks.get(pathKey);
    if (!callback) throw new Error(`${pathKey} is not observed`);
    callback({ data: { value: si, timestamp: null, measure }, state: 'normal' } as IPathUpdate);
  };
  const feedAngle = (pathKey: string, deg: number): void => feed(pathKey, deg * DEG, 'deg');
  const feedSpeed = (pathKey: string, knots: number): void => feed(pathKey, knots / KNOTS_PER_MS, 'knots');

  const svg = (): SvgRacesteerComponent =>
    fixture.debugElement.query(By.directive(SvgRacesteerComponent)).componentInstance as SvgRacesteerComponent;
  const rotation = (ref: string): string | null => {
    const element = (svg() as unknown as Record<string, () => { nativeElement: SVGGElement }>)[ref]().nativeElement;
    return element.getAttribute('transform');
  };
  const query = (selector: string): Element | null => (fixture.nativeElement as HTMLElement).querySelector(selector);
  const attr = (selector: string, name: string): string | null => query(selector)?.getAttribute(name) ?? null;
  const text = (selector: string): string => (query(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const texts = (selector: string): string[] =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll(selector))
      .map(el => (el.textContent ?? '').replace(/\s+/g, ' ').trim());
  const fill = (selector: string): string => (query(selector) as SVGElement | null)?.style.fill ?? '';
  /** Path coordinates to one decimal, so the pin reads the geometry and not float noise. */
  const oneDecimal = (d: string | null): string => (d ?? '').replace(/-?\d+\.\d+/g, n => Number(n).toFixed(1));

  /** Runs change detection and lets every rotation, path and speed-bar animation finish. */
  const settle = (): void => {
    fixture.detectChanges();
    vi.advanceTimersByTime(2000);
    fixture.detectChanges();
  };

  const render = (config: IWidgetSvcConfig): void => {
    options.set(config);
    fixture = TestBed.createComponent(WidgetRacesteerComponent);
    fixture.componentRef.setInput('id', 'w1');
    fixture.componentRef.setInput('type', 'widget-racesteer');
    fixture.componentRef.setInput('theme', null);
    TestBed.tick();
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
      imports: [WidgetRacesteerComponent],
      providers: [
        { provide: WidgetRuntimeDirective, useValue: { options } },
        { provide: WidgetStreamsDirective, useValue: streamsMock },
        { provide: UnitsService, useValue: unitsServiceStub }
      ]
    });
  });

  afterEach(() => {
    fixture?.destroy();
    vi.useRealTimers();
  });

  it('rotates the dial and indicators and places the laylines for HDG 350, water TWA 40, target angle 84', () => {
    render(makeConfig());
    feedAngle('headingPath', 350);
    feedAngle('trueWindAngle', 40);
    feedAngle('targetAngle', 84);
    feedAngle('tackTrue', 260);
    feedAngle('nextWaypointBearing', 20);
    feedAngle('set', 90);
    settle();

    expect({
      dial: rotation('rotatingDial'),
      twa: rotation('twaIndicator'),
      tack: rotation('tackIndicator'),
      wpt: rotation('wptIndicator'),
      set: rotation('setIndicator'),
      port: attr('#PortLayline', 'd'),
      stbd: attr('#StbdLayline', 'd'),
      heading: text('#layerHeading text'),
      tackOffset: text('#text42'),
      waypoint: texts('.waypoint-value'),
      wptDisplay: attr('#layerIndicators > g:last-child', 'display')
    }).toEqual({
      dial: 'rotate(10 600 620)',
      twa: 'rotate(40 600 620)',
      tack: 'rotate(84 600 620)',
      wpt: 'rotate(30 600 620)',
      set: 'rotate(100 600 620)',
      port: 'M 600,620 L 581,80',
      stbd: 'M 600,620 L 1134,544',
      heading: '350°T',
      tackOffset: '90 °',
      waypoint: ['VMG: 0', 'HDG: 30°T'],
      wptDisplay: 'inline'
    });
  });

  it('leaves no layline or sector frame running after destroy, even past an ease\'s first frame', () => {
    render(makeConfig());
    feedAngle('headingPath', 350);
    feedAngle('trueWindAngle', 40);
    feedAngle('targetAngle', 84);
    settle();
    const idle = vi.getTimerCount();

    feedAngle('targetAngle', 60);
    feedAngle('trueWindAngle', 70);
    fixture.detectChanges();
    vi.advanceTimersByTime(100);
    fixture.destroy();
    expect(vi.getTimerCount()).toBe(idle);
  });

  it('shows the same VMG difference and ratio colour for VMG 5 kn and target 6 kn', () => {
    render(makeConfig());
    feedSpeed('VMG', 5);
    feedSpeed('targetVMG', 6);
    feedSpeed('vmgToWaypoint', 4.3);
    feedAngle('nextWaypointBearing', 45);
    settle();

    expect({
      target: text('.wind-vmg-value'),
      offset: text('.wind-vmg-offset'),
      targetFill: fill('.wind-vmg-value'),
      offsetFill: fill('.wind-vmg-offset'),
      waypoint: texts('.waypoint-value')
    }).toEqual({
      target: '6 kn',
      offset: '-1.0 kn',
      targetFill: 'rgb(26,171,43)',
      offsetFill: 'rgb(26,171,43)',
      waypoint: ['VMG: 4.3 kn', 'HDG: 45°T']
    });
  });

  it('colours the VMG readouts with the start colour while the target VMG is still zero', () => {
    render(makeConfig());
    feedSpeed('VMG', 0);
    feedSpeed('targetVMG', 0);
    settle();

    expect(fill('.wind-vmg-offset')).toBe('rgb(50,152,255)');
  });

  it('wraps a relative waypoint bearing that rounds to 360° to 0°', () => {
    render(makeConfig());
    feedAngle('headingPath', 0);
    feedAngle('nextWaypointBearing', 359.8);
    settle();

    expect(texts('.waypoint-value')[1]).toBe('HDG: 0°T');
  });

  it('shows drift in the presentation unit and draws the speed bar from the polar speed ratio', () => {
    render(makeConfig());
    feed('drift', 0.5, 'knots');
    feed('polarSpeedRatio', 0.5, 'ratio');
    settle();
    feed('polarSpeedRatio', 0.75, 'ratio');
    settle();

    expect({
      flow: text('#text11'),
      tipY: attr('#speedLine', 'y2'),
      tip: attr('#speedTip', 'points')
    }).toEqual({
      flow: '1.0',
      tipY: '279.5',
      tip: '600,249.5 580,279.5 620,279.5'
    });
  });

  it('colours the true-wind pointer by how far the target angle is from the optimum', () => {
    render(makeConfig());
    feedAngle('headingPath', 0);
    feedAngle('trueWindAngle', 40);
    feedAngle('optimalWindAngle', 40);
    feedAngle('targetAngle', 130);
    settle();

    expect(fill('path.true-wind')).toBe('rgb(36,164,128)');
  });

  it('spans the wind sector across north and offsets it by half the target angle', () => {
    render(makeConfig());
    feedAngle('targetAngle', 80);
    feedAngle('appWindAngle', 358);
    vi.advanceTimersByTime(200);
    feedAngle('appWindAngle', 2);
    feedAngle('headingPath', 10);
    settle();

    expect([oneDecimal(attr('#portSectorShift', 'd')), oneDecimal(attr('#StbdSectorShift', 'd'))]).toEqual([
      'M 600,620 L 174.5,287.5 A 540,540 0 0 1 198.7,258.7 z',
      'M 600,620 L 853.5,143.2 A 540,540 0 0 1 886.2,162.1 z'
    ]);
  });
});
