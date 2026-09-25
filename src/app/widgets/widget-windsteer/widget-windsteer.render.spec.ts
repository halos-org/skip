import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetWindComponent } from './widget-windsteer.component';
import { SvgWindsteerComponent } from '../svg-windsteer/svg-windsteer.component';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective } from '../../core/directives/widget-streams.directive';
import { UnitsService } from '../../core/services/units.service';
import { IPathUpdate } from '../../core/services/data.service';
import { IWidgetSvcConfig } from '../../core/interfaces/widgets-interface';
import { ActivePolarService } from '../../core/services/active-polar.service';
import { Polar, toCanonicalPolarTable } from '../../core/utils/polar-engine.util';
import hurmaPolar from '../../core/utils/polar-engine.hurma-polar.fixture.json';

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

const hurma = (() => {
  const result = toCanonicalPolarTable(hurmaPolar);
  if (!result.ok) throw new Error(result.reason);
  return new Polar(result.table);
})();

const readyPolar = {
  status: signal({ kind: 'ready' }),
  polar: signal(hurma),
  peakSpeed: signal(hurma.peakSpeed()),
  performanceFactor: signal(1),
  ensureStarted: () => undefined
};

/**
 * What the widget draws for a set of SI inputs, read from the rendered SVG: rotation attributes,
 * close-hauled line and wind shift trace paths, and the text readouts. Pins the rendering so a change of
 * the unit the widget computes in cannot move anything on screen.
 */
describe('WidgetWindComponent rendering from SI inputs', () => {
  let fixture: ComponentFixture<WidgetWindComponent>;
  let options: WritableSignal<IWidgetSvcConfig | undefined>;
  let callbacks: Map<string, (u: IPathUpdate) => void>;

  const makeConfig = (overrides: Partial<IWidgetSvcConfig> = {}): IWidgetSvcConfig => ({
    ...WidgetWindComponent.DEFAULT_CONFIG,
    compassModeEnabled: true,
    windSectorEnable: true,
    ...overrides
  });

  /** An SI sample as the streams directive delivers it to this widget, with its presentation measure. */
  const feed = (pathKey: string, si: number, measure: string): void => {
    const callback = callbacks.get(pathKey);
    if (!callback) throw new Error(`${pathKey} is not observed`);
    callback({ data: { value: si, timestamp: null, measure }, state: 'normal' } as IPathUpdate);
  };
  const feedAngle = (pathKey: string, deg: number): void => feed(pathKey, deg * DEG, 'deg');
  const feedSpeed = (pathKey: string, ms: number): void => feed(pathKey, ms, 'knots');

  const svg = (): SvgWindsteerComponent =>
    fixture.debugElement.query(By.directive(SvgWindsteerComponent)).componentInstance as SvgWindsteerComponent;
  const rotation = (ref: string): string | null => {
    const element = (svg() as unknown as Record<string, () => { nativeElement: SVGGElement }>)[ref]().nativeElement;
    // Six decimals: a rad input converted to degrees for the attribute carries float noise.
    return element.getAttribute('transform')?.replace(/-?\d+\.\d+/g, n => String(Number(Number(n).toFixed(6)))) ?? null;
  };
  const attr = (selector: string, name: string): string | null =>
    (fixture.nativeElement as HTMLElement).querySelector(selector)?.getAttribute(name) ?? null;
  const text = (id: string): string =>
    ((fixture.nativeElement as HTMLElement).querySelector(`#${id}`)?.textContent ?? '').trim();

  /** Point count and coordinate sums of a path, to one decimal: compact enough to pin a long curve. */
  const pathSummary = (d: string | null): string => {
    const points: string[] = (d ?? '').match(/-?\d+(\.\d+)?,-?\d+(\.\d+)?/g) ?? [];
    const sum = points.reduce<[number, number]>(([sx, sy], point) => {
      const [x, y] = point.split(',').map(Number);
      return [sx + x, sy + y];
    }, [0, 0]);
    return `${points.length} points, Σx ${sum[0].toFixed(1)}, Σy ${sum[1].toFixed(1)}`;
  };

  /** Runs change detection and lets every rotation and path animation finish. */
  const settle = (): void => {
    fixture.detectChanges();
    vi.advanceTimersByTime(2000);
    fixture.detectChanges();
  };

  const render = (config: IWidgetSvcConfig): void => {
    options.set(config);
    fixture = TestBed.createComponent(WidgetWindComponent);
    fixture.componentRef.setInput('id', 'w1');
    fixture.componentRef.setInput('type', 'widget-wind-steer');
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
      imports: [WidgetWindComponent],
      providers: [
        { provide: WidgetRuntimeDirective, useValue: { options } },
        { provide: WidgetStreamsDirective, useValue: streamsMock },
        { provide: UnitsService, useValue: unitsServiceStub },
        { provide: ActivePolarService, useValue: readyPolar }
      ]
    });
  });

  afterEach(() => {
    fixture?.destroy();
    vi.useRealTimers();
  });

  it('rotates the dial and indicators and places the close-hauled lines for HDG 350, TWA 40, close-hauled 45', () => {
    render(makeConfig());
    feedAngle('headingPath', 350);
    feedAngle('trueWindAngle', 40);
    feedAngle('appWindAngle', 30);
    feedAngle('courseOverGround', 355);
    feedAngle('nextWaypointBearing', 20);
    feedAngle('set', 90);
    feedSpeed('speedOverGround', 3);
    settle();

    expect({
      dial: rotation('rotatingDial'),
      twa: rotation('twaIndicator'),
      awa: rotation('awaIndicator'),
      cog: rotation('cogIndicator'),
      wpt: rotation('wptIndicator'),
      set: rotation('setIndicator'),
      portTack: attr('#PortTackCloseHauledLine', 'd'),
      stbdTack: attr('#StbdTackCloseHauledLine', 'd')
    }).toEqual({
      dial: 'rotate(10 500 500)',
      twa: 'rotate(40 500 500)',
      awa: 'rotate(30 500 500)',
      cog: 'rotate(5 500 500)',
      wpt: 'rotate(20 500 500)',
      set: 'rotate(100 904 912)',
      portTack: 'M 500,500 L 838,409',
      stbdTack: 'M 500,500 L 409,161'
    });
  });

  it('shows speeds in the presentation unit with its symbol', () => {
    render(makeConfig());
    feedSpeed('trueWindSpeed', 5.144);
    feedSpeed('appWindSpeed', 7.2);
    feedSpeed('drift', 0.5);
    feedAngle('headingPath', 10);
    settle();

    expect(text('text42')).toBe('10.0');
    expect(text('text43')).toBe('kn');
    expect(text('text40')).toBe('14.0');
    expect(text('text39')).toBe('kn');
    expect(text('driftValue')).toBe('1.0');
    expect(text('driftUnit')).toBe('kn');
  });

  it('places the close-hauled lines and the wind shift traces at the polar beat angle, and the run lines at its run angle', () => {
    render(makeConfig({ runLineEnable: true }));
    feedAngle('headingPath', 0);
    feed('polarTrueWindSpeed', 5, 'm/s');
    feedAngle('trueWindAngle', 0);
    vi.advanceTimersByTime(1000);
    settle();

    // Dial angle of a path's first point after the center, degrees clockwise from up.
    const angleOf = (selector: string): number => {
      const [x, y] = (attr(selector, 'd') ?? '').split(' L ')[1].split(' ')[0].split(',').map(Number);
      return Math.round(((Math.atan2(x - 500, 500 - y) / DEG) + 360) % 360);
    };
    const beatDeg = Math.round((hurma.targetsAt({ tws: 5 }).value?.beat?.twa ?? NaN) / DEG);
    const runDeg = Math.round((hurma.targetsAt({ tws: 5 }).value?.run?.twa ?? NaN) / DEG);
    expect({
      portTackLine: angleOf('#PortTackCloseHauledLine'),
      stbdTackLine: angleOf('#StbdTackCloseHauledLine'),
      portTackTrace: angleOf('path.wind-trace-port'),
      stbdTackTrace: angleOf('path.wind-trace-stbd'),
      portTackRun: angleOf('#PortTackRunLine'),
      stbdTackRun: angleOf('#StbdTackRunLine')
    }).toEqual({
      portTackLine: beatDeg,
      stbdTackLine: 360 - beatDeg,
      // A steady wind's trace is 2° wide, centred on the line; its path starts at the lower edge.
      portTackTrace: beatDeg - 1,
      stbdTackTrace: 360 - beatDeg - 1,
      portTackRun: runDeg,
      stbdTackRun: 360 - runDeg
    });
    expect(beatDeg).not.toBe(45);
  });

  it('sweeps the wind shift traces across north without a 358° swing', () => {
    render(makeConfig());
    feedAngle('headingPath', 0);
    feedAngle('trueWindAngle', 358);
    vi.advanceTimersByTime(200);
    feedAngle('trueWindAngle', 2);
    settle();

    // Rim edges of each trace wedge, dial degrees: the steady first sample, then the 358°→2° sweep.
    const edges = (selector: string): number[][] =>
      Array.from((fixture.nativeElement as HTMLElement).querySelectorAll(selector)).map(path => {
        const pairs = [...(path.getAttribute('d') ?? '').matchAll(/(-?[\d.]+),(-?[\d.]+)/g)];
        return [pairs[1], pairs[3]].map(([, x, y]) => Math.round(((Math.atan2(+x - 500, 500 - +y) / DEG) + 360) % 360));
      });
    expect({ port: edges('path.wind-trace-port'), stbd: edges('path.wind-trace-stbd') }).toEqual({
      port: [[42, 44], [43, 47]],
      stbd: [[312, 314], [313, 317]]
    });
  });

  it('draws the rudder bar from a signed rudder angle', () => {
    render(makeConfig());
    feedAngle('headingPath', 0);
    feedAngle('rudderAngle', 17.5);
    settle();

    expect(attr('path.rudder-stbd', 'style')).toContain('stroke-dashoffset: 50');
    expect(attr('path.rudder-port', 'style')).toContain('stroke-dashoffset: 100');
  });

  it('draws the polar overlay: curve turned by the water TWA, VMC lobe toward the waypoint, and the dot', () => {
    render(makeConfig({ polarOverlayEnable: true, windSectorEnable: false }));
    feedAngle('headingPath', 30);
    feed('polarTrueWindSpeed', 5, 'm/s');
    feed('polarTrueWindAngle', 45 * DEG, 'rad');
    feed('polarSpeedThroughWater', 3, 'm/s');
    settle();

    const polarRotation = rotation('polarOverlay');
    const polarDot = Number(attr('circle.polar-dot', 'cy')).toFixed(3);

    feedAngle('nextWaypointBearing', 10);
    settle();

    expect({
      polarRotation,
      polarDot,
      vmc: pathSummary(attr('path.vmc-fill', 'd')),
      vmcEdge: pathSummary(attr('path.vmc-edge', 'd')),
      vmcDot: Number(attr('circle.polar-dot', 'cy')).toFixed(3)
    }).toEqual({
      polarRotation: 'rotate(45 500 500)',
      polarDot: '249.234',
      vmc: '180 points, Σx 88685.4, Σy 79998.0',
      vmcEdge: '59 points, Σx 28185.4, Σy 19498.0',
      vmcDot: '264.357'
    });
    expect(attr('path.vmc-edge', 'd')).not.toContain('500.0,500.0');
  });
});
