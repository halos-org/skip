import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SvgWindsteerComponent } from './svg-windsteer.component';
import { OverlayPoint } from '../../core/utils/polar-overlay.util';

describe('SvgWindsteerComponent', () => {
    let fixture: ComponentFixture<SvgWindsteerComponent>;
    let component: SvgWindsteerComponent;

    // The tests speak degrees; the component takes its angle inputs in rad.
    const ANGLE_INPUTS = new Set([
        'compassHeading', 'courseOverGroundAngle', 'trueWindAngle', 'appWindAngle', 'closeHauledLineAngle', 'driftSet',
        'waypointAngle', 'rudderAngle', 'polarCurveRotation',
        'runLineAngle'
    ]);
    const setInput = (key: string, value: unknown): void => {
        const converted = ANGLE_INPUTS.has(key) && typeof value === 'number' ? value * Math.PI / 180 : value;
        fixture.componentRef.setInput(key, converted);
    };

    const setRequiredInputs = (overrides: Record<string, unknown> = {}): void => {
        const defaults: Record<string, unknown> = {
            compassHeading: 15,
            compassModeEnabled: true,
            courseOverGroundEnabled: true,
            trueWindAngle: 20,
            twsEnabled: true,
            twaEnabled: true,
            trueWindSpeed: 12,
            trueWindSpeedUnit: 'knots',
            appWindAngle: 18,
            awsEnabled: true,
            appWindSpeed: 10,
            appWindSpeedUnit: 'knots',
            closeHauledLineEnabled: false,
            sailSetupEnabled: false,
            windTraceEnabled: false,
            driftEnabled: true,
            setArrowActive: true,
            waypointEnabled: true,
            driftSet: 7,
            driftFlow: 5,
            driftUnit: 'kn',
            waypointAngle: 30,
            courseOverGroundAngle: 16,
            sogActive: true,
            windTraceSeconds: 5
        };

        Object.entries({ ...defaults, ...overrides }).forEach(([key, value]) => setInput(key, value));
    };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [SvgWindsteerComponent]
        }).compileComponents();

        fixture = TestBed.createComponent(SvgWindsteerComponent);
        component = fixture.componentInstance;
    });

    // One 1000 ms tween (the default update interval), stepped by hand.
    const frameQueue = () => {
        const pending = new Map<number, FrameRequestCallback>();
        let nextId = 1;
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => { pending.set(nextId, cb); return nextId++; });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { pending.delete(id); });
        vi.spyOn(performance, 'now').mockReturnValue(0);
        return {
            run(now: number) {
                const callbacks = [...pending.values()];
                pending.clear();
                callbacks.forEach(cb => cb(now));
                fixture.detectChanges();
            },
            get size() { return pending.size; }
        };
    };
    it('derives the needle animation duration from updateInterval', () => {
        setRequiredInputs({ updateInterval: 100 });
        fixture.detectChanges();
        expect(component['animationDuration']()).toBe(100);

        fixture.componentRef.setInput('updateInterval', 5000);
        fixture.detectChanges();
        expect(component['animationDuration']()).toBe(1000);

        fixture.componentRef.setInput('updateInterval', undefined);
        fixture.detectChanges();
        expect(component['animationDuration']()).toBe(1000);
    });

    it('renders first values without rotation animation', () => {
        // Set up component with initial values
        setRequiredInputs();
        fixture.detectChanges();

        // Verify that the dial and COG are set to their correct initial values (not animating)
        const dialElement = component['rotatingDial']()?.nativeElement;
        const cogElement = component['cogIndicator']()?.nativeElement;

        // On first render, the transform should be set immediately (not animated)
        // Dial should be at -15 degrees (compass heading 15), COG should be at 1 degree (16 - 15)
        expect(dialElement?.getAttribute('transform')).toMatch(/rotate\(-15 /);
        expect(cogElement?.getAttribute('transform')).toMatch(/rotate\(1 /);
    });

    it('animates on subsequent updates after initialization', () => {
        const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);

        setRequiredInputs();
        fixture.detectChanges();
        rafSpy.mockClear();

        setInput('appWindAngle', 42);
        fixture.detectChanges();

        expect(rafSpy).toHaveBeenCalled();
    });

    it('treats waypoint angle 0 as valid data', () => {
        setRequiredInputs({ waypointAngle: 0, waypointEnabled: true });
        fixture.detectChanges();

        expect((component as unknown as {
            waypointActive: () => boolean;
        }).waypointActive()).toBe(true);
        expect((component as unknown as {
            wpt: {
                newValue: number;
            };
        }).wpt.newValue).toBe(0);
    });

    // Geometry helpers: recover the dial-local angle (degrees, 0 = up, clockwise) from a
    // drawn SVG path. The dial lines place points at (R*sinθ+C, -R*cosθ+C).
    const CENTER = 500;
    const norm = (a: number): number => ((a % 360) + 360) % 360;
    const angleOf = (x: number, y: number): number => norm((Math.atan2(x - CENTER, CENTER - y) * 180) / Math.PI);
    const pathOf = (id: string): string => fixture.nativeElement.querySelector(`#${id}`)?.getAttribute('d') ?? '';
    const firstPointAngle = (path: string): number => {
        const m = path.match(/L\s*([\d.-]+),([\d.-]+)/);
        return angleOf(parseFloat(m![1]), parseFloat(m![2]));
    };

    it('centers close-hauled lines on the true wind, not the apparent wind', () => {
        // heading 0 => the true-wind input value is also the boat-relative TWA.
        setRequiredInputs({
            compassHeading: 0,
            trueWindAngle: 40,
            appWindAngle: 20, // deliberately different from true wind
            closeHauledLineEnabled: true,
            closeHauledLineAngle: 30,
            trueWindFresh: true
        });
        fixture.detectChanges();

        const angles = [
            firstPointAngle(pathOf('StbdTackCloseHauledLine')),
            firstPointAngle(pathOf('PortTackCloseHauledLine'))
        ].sort((a, b) => a - b);

        // True-wind based: 40 ± 30 => 10 and 70. (Apparent-based would give 20 ± 30.)
        expect(angles[0]).toBeCloseTo(10, 0);
        expect(angles[1]).toBeCloseTo(70, 0);
    });

    it('names each close-hauled line by the tack whose course it marks', () => {
        // Wind dead ahead: heading 45° to starboard puts the wind on the port bow (port tack).
        setRequiredInputs({ compassHeading: 0, trueWindAngle: 0, closeHauledLineEnabled: true, closeHauledLineAngle: 45, trueWindFresh: true });
        fixture.detectChanges();
        expect(firstPointAngle(pathOf('PortTackCloseHauledLine'))).toBeCloseTo(45, 0);
        expect(firstPointAngle(pathOf('StbdTackCloseHauledLine'))).toBeCloseTo(315, 0);
    });

    describe('wind shift traces', () => {
        const DEG = Math.PI / 180;
        const traces = (cls: string): SVGPathElement[] => Array.from(fixture.nativeElement.querySelectorAll(`#LayerWindShift path.${cls}`));
        /** The two rim edges of a wedge path `M c L start A … end Z`, as dial angles in degrees. */
        const edges = (path: SVGPathElement): [number, number] => {
            const pairs = [...(path.getAttribute('d') ?? '').matchAll(/(-?[\d.]+),(-?[\d.]+)/g)];
            return [pairs[1], pairs[3]].map(([, x, y]) => Math.round(angleOf(+x, +y))) as [number, number];
        };
        /** Samples swept between consecutive directions (degrees), the first from its own direction. */
        const sweep = (...directionsDeg: number[]) => directionsDeg.map((deg, index) =>
            ({ id: index + 1, from: (directionsDeg[index - 1] ?? deg) * DEG, to: deg * DEG }));

        it('paints each sample as a wedge from the previous direction, ± the close-hauled angle, the red port tack on the right', () => {
            setRequiredInputs({ compassHeading: 0, windTraceEnabled: true, closeHauledLineAngle: 45, windTrace: sweep(355, 0, 5) });
            fixture.detectChanges();
            expect(traces('wind-trace-port').map(edges)).toEqual([[39, 41], [40, 45], [45, 50]]);
            expect(traces('wind-trace-stbd').map(edges)).toEqual([[309, 311], [310, 315], [315, 320]]);
        });

        it('spans a backing shift the same way as a veering one', () => {
            setRequiredInputs({ compassHeading: 0, windTraceEnabled: true, closeHauledLineAngle: 45, windTrace: sweep(10, 4) });
            fixture.detectChanges();
            expect(traces('wind-trace-port').map(edges)[1]).toEqual([49, 55]);
        });

        it('places the traces in the compass frame in compass mode and boat-relative in simple mode', () => {
            setRequiredInputs({ compassHeading: 30, windTraceEnabled: true, closeHauledLineAngle: 45, windTrace: sweep(100) });
            fixture.detectChanges();
            // Inside the dial, which turns by the heading: dial-local 145 shows at 115 off the bow.
            expect(traces('wind-trace-port').map(edges)).toEqual([[144, 146]]);

            setInput('compassModeEnabled', false);
            fixture.detectChanges();
            expect(traces('wind-trace-port').map(edges)).toEqual([[114, 116]]);
        });

        it('fades each trace out over the window', () => {
            setRequiredInputs({ windTraceEnabled: true, closeHauledLineAngle: 45, windTrace: sweep(0), windTraceSeconds: 8 });
            fixture.detectChanges();
            for (const trace of [...traces('wind-trace-port'), ...traces('wind-trace-stbd')]) {
                expect(trace.classList).toContain('wind-trace');
                expect(trace.style.animationDuration).toBe('8s');
            }
        });

        it('keeps each drawn trace as newer samples arrive, so its fade is not restarted, and drops expired ones', () => {
            setRequiredInputs({ windTraceEnabled: true, closeHauledLineAngle: 45, windTrace: sweep(0) });
            fixture.detectChanges();
            const first = traces('wind-trace-port')[0];
            setInput('windTrace', sweep(0, 10));
            fixture.detectChanges();
            expect(traces('wind-trace-port')[0]).toBe(first);
            expect(traces('wind-trace-port')).toHaveLength(2);

            setInput('windTrace', []);
            fixture.detectChanges();
            expect(traces('wind-trace-port')).toHaveLength(0);
        });

        it('grows the newest trace with the close-hauled line as it eases to the new wind', () => {
            const frames = frameQueue();
            setRequiredInputs({ compassHeading: 0, windTraceEnabled: true, closeHauledLineAngle: 45, windTrace: sweep(0) });
            fixture.detectChanges();
            setInput('windTrace', sweep(0, 20));
            fixture.detectChanges();
            expect(traces('wind-trace-port').map(edges)).toEqual([[44, 46], [44, 46]]);
            frames.run(500);
            expect(traces('wind-trace-port').map(edges)[1]).toEqual([45, 55]);
            frames.run(1000);
            expect(traces('wind-trace-port').map(edges)[1]).toEqual([45, 65]);
            vi.restoreAllMocks();
        });

        it('scales each trace\'s opacity to the samples in the window, so a steady wind builds up alike at any rate', () => {
            const peak = (): string => fixture.nativeElement.querySelector('#LayerWindShift').style.getPropertyValue('--wind-trace-peak');
            setRequiredInputs({ windTraceEnabled: true, windTraceSeconds: 5, updateInterval: 1000, windTrace: sweep(0) });
            fixture.detectChanges();
            expect(peak()).toBe('0.35');
            setInput('updateInterval', 100);
            fixture.detectChanges();
            expect(peak()).toBe('0.06');
        });

        it('draws the traces under the close-hauled and run lines', () => {
            setRequiredInputs();
            fixture.detectChanges();
            expect(fixture.nativeElement.querySelector('#LayerWindShift').nextElementSibling?.id).toBe('LayerCloseHauledLines');
        });

        it('draws no traces with the option off', () => {
            setRequiredInputs({ windTraceEnabled: false, closeHauledLineAngle: 45, windTrace: sweep(0) });
            fixture.detectChanges();
            expect(fixture.nativeElement.querySelector('#LayerWindShift').style.display).toBe('none');
        });
    });

    it('draws the run lines at the run angle off the true wind, named by tack', () => {
        setRequiredInputs({ compassHeading: 0, trueWindAngle: 0, closeHauledLineEnabled: true, closeHauledLineAngle: 45, runLineAngle: 150, trueWindFresh: true });
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('#LayerRunLines').style.display).toBe('inline');
        expect(firstPointAngle(pathOf('PortTackRunLine'))).toBeCloseTo(150, 0);
        expect(firstPointAngle(pathOf('StbdTackRunLine'))).toBeCloseTo(210, 0);
    });

    it('hides the run lines without a run angle or without true wind', () => {
        setRequiredInputs({ runLineAngle: null, trueWindFresh: true });
        fixture.detectChanges();
        const layer = fixture.nativeElement.querySelector('#LayerRunLines') as SVGGElement;
        expect(layer.style.display).toBe('none');

        setInput('runLineAngle', 150);
        setInput('trueWindFresh', false);
        fixture.detectChanges();
        expect(layer.style.display).toBe('none');
    });

    it('draws the run lines with the close-hauled lines off', () => {
        setRequiredInputs({ compassHeading: 0, trueWindAngle: 0, closeHauledLineEnabled: false, runLineAngle: 150, trueWindFresh: true });
        fixture.detectChanges();
        expect(firstPointAngle(pathOf('PortTackRunLine'))).toBeCloseTo(150, 0);
    });

    describe('turning in a steady wind', () => {
        afterEach(() => vi.restoreAllMocks());

        it('turns the true wind pointer with the heading, and keeps the tack lines on the wind', () => {
            const frames = frameQueue();
            setRequiredInputs({ compassHeading: 0, trueWindAngle: 40, closeHauledLineEnabled: true, closeHauledLineAngle: 45, trueWindFresh: true });
            fixture.detectChanges();
            setInput('compassHeading', 20);
            fixture.detectChanges();
            frames.run(500);
            // Midway the pointer and the dial have both turned half of the 20° change.
            expect(component['twaIndicator']().nativeElement.getAttribute('transform')).toBe('rotate(30 500 500)');
            expect(component['rotatingDial']().nativeElement.getAttribute('transform')).toBe('rotate(-10 500 500)');
            frames.run(2000);
            expect(component['twaIndicator']().nativeElement.getAttribute('transform')).toBe('rotate(20 500 500)');
            expect(firstPointAngle(pathOf('PortTackCloseHauledLine'))).toBeCloseTo(85, 0);
            expect(firstPointAngle(pathOf('StbdTackCloseHauledLine'))).toBeCloseTo(355, 0);
        });

        it('turns the COG arrow with the heading on a steady course', () => {
            const frames = frameQueue();
            setRequiredInputs({ compassHeading: 15, courseOverGroundAngle: 16 });
            fixture.detectChanges();
            setInput('compassHeading', 30);
            fixture.detectChanges();
            frames.run(2000);
            expect(component['cogIndicator']().nativeElement.getAttribute('transform')).toBe('rotate(346 500 500)');
        });

        it('keeps the true wind pointer where the first heading places it, even with a wind ease running', () => {
            const frames = frameQueue();
            setRequiredInputs({ compassHeading: undefined, trueWindAngle: 40, trueWindFresh: true, closeHauledLineEnabled: true, closeHauledLineAngle: 45 });
            fixture.detectChanges();
            setInput('trueWindAngle', 50);
            fixture.detectChanges();
            frames.run(500);

            setInput('compassHeading', 20);
            fixture.detectChanges();
            frames.run(2000);
            expect(component['twaIndicator']().nativeElement.getAttribute('transform')).toBe('rotate(30 500 500)');
            expect(firstPointAngle(pathOf('PortTackCloseHauledLine'))).toBeCloseTo(95, 0);
        });

        it('puts the pointers in the right frame when compass mode is toggled', () => {
            const frames = frameQueue();
            setRequiredInputs({ compassHeading: 20, trueWindAngle: 60, courseOverGroundAngle: 30, trueWindFresh: true });
            fixture.detectChanges();
            expect(component['twaIndicator']().nativeElement.getAttribute('transform')).toBe('rotate(40 500 500)');

            // In simple mode the parent passes the boat-relative angles; here the inputs stay as they are.
            setInput('compassModeEnabled', false);
            fixture.detectChanges();
            frames.run(500);
            // Eases with the dial rather than snapping, although two effects place the same target.
            expect(component['twaIndicator']().nativeElement.getAttribute('transform')).toBe('rotate(50 500 500)');
            frames.run(2000);
            expect(component['twaIndicator']().nativeElement.getAttribute('transform')).toBe('rotate(60 500 500)');
            expect(component['cogIndicator']().nativeElement.getAttribute('transform')).toBe('rotate(30 500 500)');

            setInput('compassModeEnabled', true);
            fixture.detectChanges();
            frames.run(4000);
            expect(component['twaIndicator']().nativeElement.getAttribute('transform')).toBe('rotate(40 500 500)');
            expect(component['cogIndicator']().nativeElement.getAttribute('transform')).toBe('rotate(10 500 500)');
        });

        it('leaves the pointers boat-relative in simple mode, where heading does not turn them', () => {
            const frames = frameQueue();
            setRequiredInputs({ compassModeEnabled: false, compassHeading: 0, trueWindAngle: 40, trueWindFresh: true });
            fixture.detectChanges();
            setInput('compassHeading', 20);
            fixture.detectChanges();
            frames.run(2000);
            expect(component['twaIndicator']().nativeElement.getAttribute('transform')).toBe('rotate(40 500 500)');
        });
    });

    describe('tack line easing', () => {
        afterEach(() => vi.restoreAllMocks());
        const lineInputs = { compassHeading: 0, trueWindAngle: 20, closeHauledLineEnabled: true, closeHauledLineAngle: 45, trueWindFresh: true };

        it('eases a line along the shorter arc, across north', () => {
            const frames = frameQueue();
            setRequiredInputs(lineInputs);
            fixture.detectChanges();
            expect(firstPointAngle(pathOf('StbdTackCloseHauledLine'))).toBeCloseTo(335, 0);

            setInput('trueWindAngle', 60);
            fixture.detectChanges();
            frames.run(500);
            expect(firstPointAngle(pathOf('StbdTackCloseHauledLine'))).toBeCloseTo(355, 0);
            frames.run(1000);
            expect(firstPointAngle(pathOf('StbdTackCloseHauledLine'))).toBeCloseTo(15, 0);
            expect(frames.size).toBe(0);
        });

        it('retargets a running ease from the angle drawn, without a jump', () => {
            const frames = frameQueue();
            setRequiredInputs(lineInputs);
            fixture.detectChanges();
            setInput('trueWindAngle', 60);
            fixture.detectChanges();
            frames.run(500);

            // A polar TWS update nudges the close-hauled angle mid-ease.
            setInput('closeHauledLineAngle', 46);
            fixture.detectChanges();
            expect(firstPointAngle(pathOf('StbdTackCloseHauledLine'))).toBeCloseTo(355, 0);
            frames.run(500);
            expect(firstPointAngle(pathOf('StbdTackCloseHauledLine'))).toBeCloseTo(4.5, 0);
            frames.run(1000);
            expect(firstPointAngle(pathOf('StbdTackCloseHauledLine'))).toBeCloseTo(14, 0);
        });

        it('places the close-hauled lines without a sweep when they are switched back on', () => {
            const frames = frameQueue();
            setRequiredInputs(lineInputs);
            fixture.detectChanges();
            setInput('closeHauledLineEnabled', false);
            fixture.detectChanges();
            setInput('trueWindAngle', 120);
            fixture.detectChanges();
            frames.run(1000);

            setInput('closeHauledLineEnabled', true);
            fixture.detectChanges();
            expect(firstPointAngle(pathOf('StbdTackCloseHauledLine'))).toBeCloseTo(75, 0);
            expect(frames.size).toBe(0);
        });
    });

    it('hides the close-hauled lines when true wind is unavailable', () => {
        setRequiredInputs({ closeHauledLineEnabled: true, closeHauledLineAngle: 30, trueWindFresh: false });
        fixture.detectChanges();
        const layer = fixture.nativeElement.querySelector('#LayerCloseHauledLines') as SVGGElement;
        expect(layer.style.display).toBe('none');

        fixture.componentRef.setInput('trueWindFresh', true);
        fixture.detectChanges();
        expect(layer.style.display).toBe('inline');
    });

    it('centers the close-hauled lines on the true wind in simple mode', () => {
        setRequiredInputs({
            compassModeEnabled: false,
            compassHeading: 30,
            trueWindAngle: 40, // boat-relative TWA in simple mode
            closeHauledLineEnabled: true,
            closeHauledLineAngle: 30,
            trueWindFresh: true
        });
        fixture.detectChanges();

        const angles = [
            firstPointAngle(pathOf('StbdTackCloseHauledLine')),
            firstPointAngle(pathOf('PortTackCloseHauledLine'))
        ].sort((a, b) => a - b);
        expect(angles[0]).toBeCloseTo(10, 0);
        expect(angles[1]).toBeCloseTo(70, 0);
    });

    it('hides the COG, waypoint, drift and current indicators when compass mode is off', () => {
        setRequiredInputs({
            compassModeEnabled: false,
            courseOverGroundEnabled: true,
            driftEnabled: true,
            waypointEnabled: true,
            waypointAngle: 30
        });
        fixture.detectChanges();

        const el = fixture.nativeElement as HTMLElement;
        expect(component['cogIndicator']().nativeElement.getAttribute('display')).toBe('none');
        expect(component['wptIndicator']().nativeElement.getAttribute('display')).toBe('none');
        expect(component['setIndicator']().nativeElement.style.display).toBe('none');
        expect((el.querySelector('#layerCurrent') as SVGGElement).style.display).toBe('none');
    });

    it('shows the COG, drift and current indicators when compass mode is on', () => {
        setRequiredInputs({
            compassModeEnabled: true,
            courseOverGroundEnabled: true,
            driftEnabled: true,
            waypointEnabled: true,
            waypointAngle: 30
        });
        fixture.detectChanges();

        const el = fixture.nativeElement as HTMLElement;
        expect(component['cogIndicator']().nativeElement.getAttribute('display')).toBe('inline');
        expect(component['setIndicator']().nativeElement.style.display).toBe('inline');
        expect((el.querySelector('#layerCurrent') as SVGGElement).style.display).toBe('inline');
    });

    it('hides the bearing (waypoint) circle when no waypoint bearing is available', () => {
        setRequiredInputs({ waypointAngle: undefined, waypointEnabled: true, compassModeEnabled: true });
        fixture.detectChanges();

        expect(component['wptIndicator']().nativeElement.getAttribute('display')).toBe('none');
        expect((component as unknown as { waypointActive: () => boolean }).waypointActive()).toBe(false);
    });

    it('shows the bearing circle for a real waypoint, including a due-north (0) bearing', () => {
        setRequiredInputs({ waypointAngle: 0, waypointEnabled: true, compassModeEnabled: true });
        fixture.detectChanges();

        expect(component['wptIndicator']().nativeElement.getAttribute('display')).toBe('inline');
        expect((component as unknown as { waypointActive: () => boolean }).waypointActive()).toBe(true);
    });

    it('hides only the set arrow when it is not active; the readout stays', () => {
        setRequiredInputs({ setArrowActive: false, driftEnabled: true, compassModeEnabled: true });
        fixture.detectChanges();

        expect(component['setIndicator']().nativeElement.style.display).toBe('none');
        expect((fixture.nativeElement.querySelector('#layerCurrent') as SVGGElement).style.display).toBe('inline');
    });

    it('shows the set arrow and current readout when the set arrow is active', () => {
        setRequiredInputs({ setArrowActive: true, driftEnabled: true, compassModeEnabled: true });
        fixture.detectChanges();

        expect(component['setIndicator']().nativeElement.style.display).toBe('inline');
        expect((fixture.nativeElement.querySelector('#layerCurrent') as SVGGElement).style.display).toBe('inline');
    });

    // The readout carries no speed gate (#637): a fresh value shows at any magnitude, even 0.0.
    for (const flow of [0, 0.04]) {
        it(`shows the drift readout for a fresh drift of ${flow}`, () => {
            setRequiredInputs({ driftFlow: flow, driftFresh: true, setArrowActive: false });
            fixture.detectChanges();

            expect((fixture.nativeElement.querySelector('#layerCurrent') as SVGGElement).style.display).toBe('inline');
            expect(fixture.nativeElement.querySelector('#driftValue').textContent).toContain(flow.toFixed(1));
        });
    }

    it('renders the drift value with its unit label', () => {
        setRequiredInputs({ driftEnabled: true, compassModeEnabled: true, driftFlow: 0.3, driftUnit: 'kn' });
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('#driftValue').textContent).toContain('0.3');
        expect(fixture.nativeElement.querySelector('#driftUnit').textContent).toContain('kn');
    });

    it('omits the drift unit label when no unit is resolved', () => {
        setRequiredInputs({ driftEnabled: true, compassModeEnabled: true, driftFlow: 0.3, driftUnit: '' });
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('#driftUnit')).toBeNull();
    });

    // Current readout (#637): drift and a heading-up set arrow in the bottom-right corner.
    const rotationOf = (el: Element): { angle: number; cx: number; cy: number } => {
        const m = (el.getAttribute('transform') ?? '').match(/rotate\(([-\d.]+) ([-\d.]+) ([-\d.]+)\)/);
        expect(m).not.toBeNull();
        return { angle: parseFloat(m![1]), cx: parseFloat(m![2]), cy: parseFloat(m![3]) };
    };
    const currentLayer = (): SVGGElement => fixture.nativeElement.querySelector('#layerCurrent') as SVGGElement;
    const setArrowGroup = (): SVGGElement => component['setIndicator']().nativeElement;

    it('shows the corner readout and points the set arrow at set minus heading (heading 000)', () => {
        setRequiredInputs({ driftFlow: 1.0, driftSet: 90, compassHeading: 0 });
        fixture.detectChanges();

        expect(currentLayer().style.display).toBe('inline');
        expect(setArrowGroup().style.display).toBe('inline');
        expect(rotationOf(setArrowGroup()).angle).toBeCloseTo(90);
    });

    it('keeps the set arrow heading-up: set 090 at heading 045 points 45 degrees right', () => {
        setRequiredInputs({ driftFlow: 1.0, driftSet: 90, compassHeading: 45 });
        fixture.detectChanges();

        expect(rotationOf(setArrowGroup()).angle).toBeCloseTo(45);
    });

    // Queues requestAnimationFrame callbacks so a spec can run them at a chosen time.
    const queueFrames = (): { frames: FrameRequestCallback[]; restore: () => void } => {
        const frames: FrameRequestCallback[] = [];
        const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            frames.push(cb);
            return frames.length;
        });
        return { frames, restore: () => rafSpy.mockRestore() };
    };
    const runFrames = (frames: FrameRequestCallback[], at: number): void => {
        frames.splice(0).forEach((cb) => cb(at));
    };

    it('turns the set arrow when only the heading changes', () => {
        setRequiredInputs({ driftFlow: 1.0, driftSet: 90, compassHeading: 0 });
        fixture.detectChanges();

        const { frames, restore } = queueFrames();
        try {
            setInput('compassHeading', 45);
            fixture.detectChanges();

            // The arrow animates rather than snaps: frames are queued and it has not moved yet.
            // The dial queues frames too, so the unmoved arrow is what pins the arrow's own animation.
            expect(frames.length).toBeGreaterThan(0);
            expect(rotationOf(setArrowGroup()).angle).toBeCloseTo(90);

            // Past the animation's end, each rotation lands on its target in one step.
            runFrames(frames, performance.now() + 60_000);
        } finally {
            restore();
        }

        const { angle, cx, cy } = rotationOf(setArrowGroup());
        expect(angle).toBeCloseTo(45);
        expect(cx).toBe(904);
        expect(cy).toBe(912);
    });

    it('points the set arrow at set minus heading when the set is below the heading', () => {
        setRequiredInputs({ driftFlow: 1.0, driftSet: 30, compassHeading: 300 });
        fixture.detectChanges();

        expect(rotationOf(setArrowGroup()).angle).toBeCloseTo(90);
    });

    it('turns the set arrow the short way when the heading crosses north', () => {
        // Set 010 at heading 350 is 20 right of the bow; at heading 030 it is 20 left (340).
        setRequiredInputs({ driftFlow: 1.0, driftSet: 10, compassHeading: 350, updateInterval: 1000 });
        fixture.detectChanges();
        expect(rotationOf(setArrowGroup()).angle).toBeCloseTo(20);

        const { frames, restore } = queueFrames();
        try {
            setInput('compassHeading', 30);
            fixture.detectChanges();

            // Halfway through, the short way passes the bow (0); the long way would be near 180.
            const start = performance.now();
            runFrames(frames, start + 500);
            const midway = rotationOf(setArrowGroup()).angle;
            expect(Math.abs(midway)).toBeLessThan(10);

            runFrames(frames, start + 60_000);
        } finally {
            restore();
        }

        expect(rotationOf(setArrowGroup()).angle).toBeCloseTo(340);
    });

    it('hides the corner readout and set arrow when drift is disabled', () => {
        setRequiredInputs({ driftEnabled: false });
        fixture.detectChanges();

        expect(currentLayer().style.display).toBe('none');
        expect(setArrowGroup().style.display).toBe('none');
    });

    it('hides the corner readout when the drift value is stale, but the set arrow follows setFresh', () => {
        setRequiredInputs({ driftFresh: false, setFresh: true });
        fixture.detectChanges();

        expect(currentLayer().style.display).toBe('none');
        expect(setArrowGroup().style.display).toBe('inline');
    });

    it('leaves nothing of the current readout at the dial center', () => {
        setRequiredInputs({ driftFlow: 1.0, driftSet: 90, compassHeading: 0, driftUnit: 'kn' });
        fixture.detectChanges();

        // The arrow sits outside the rotating dial and turns in place in the corner.
        expect(component['rotatingDial']().nativeElement.contains(setArrowGroup())).toBe(false);

        // Three quarters of the 1000-unit viewBox: past it on both axes is the bottom-right corner.
        const CORNER_BOUND = 750;
        const texts = Array.from(currentLayer().querySelectorAll('text'));
        expect(texts.length).toBeGreaterThan(0);
        for (const t of texts) {
            expect(parseFloat(t.getAttribute('x')!)).toBeGreaterThan(CORNER_BOUND);
            expect(parseFloat(t.getAttribute('y')!)).toBeGreaterThan(CORNER_BOUND);
        }
    });

    it('centres the set arrow pivot on the drift value', () => {
        setRequiredInputs({ driftFlow: 1.0, driftSet: 90, compassHeading: 0 });
        fixture.detectChanges();

        // Roboto digits stand 0.711 em tall, so their visual centre is half that above the baseline.
        const DIGIT_HALF_HEIGHT_EM = 0.711 / 2;
        const value = fixture.nativeElement.querySelector('#driftValue') as SVGTextElement;
        const fontSize = parseFloat(value.style.fontSize);
        const { cx, cy } = rotationOf(setArrowGroup());
        expect(parseFloat(value.getAttribute('x')!)).toBeCloseTo(cx, 0);
        expect(parseFloat(value.getAttribute('y')!) - fontSize * DIGIT_HALF_HEIGHT_EM).toBeCloseTo(cy, 0);
    });

    it('keeps every point of the set arrow inside the viewBox and off the dial at any rotation', () => {
        setRequiredInputs();
        fixture.detectChanges();

        // The dial's outer edge; the rudder arcs end on the same radius.
        const DIAL_OUTER_RADIUS = 489.5;
        const DIAL_CENTER = 500;
        const VIEWBOX_SIZE = 1000;
        const ROTATION_STEP_DEG = 5;
        const { cx, cy } = rotationOf(setArrowGroup());
        const arrow = setArrowGroup().querySelector('path')!;
        const translate = (arrow.getAttribute('transform') ?? '').match(/translate\(([-\d.]+) ([-\d.]+)\)/);
        expect(translate).not.toBeNull();
        const [tx, ty] = [parseFloat(translate![1]), parseFloat(translate![2])];
        const coords = (arrow.getAttribute('d')!.match(/-?\d+(\.\d+)?/g) ?? []).map(parseFloat);
        expect(coords.length).toBeGreaterThan(0);
        expect(coords.length % 2).toBe(0);
        const points: [number, number][] = [];
        for (let i = 0; i < coords.length; i += 2) points.push([coords[i] + tx, coords[i + 1] + ty]);

        for (let deg = 0; deg < 360; deg += ROTATION_STEP_DEG) {
            const rad = deg * Math.PI / 180;
            for (const [px, py] of points) {
                const x = cx + (px - cx) * Math.cos(rad) - (py - cy) * Math.sin(rad);
                const y = cy + (px - cx) * Math.sin(rad) + (py - cy) * Math.cos(rad);
                expect(x, `x at ${deg} deg`).toBeGreaterThan(0);
                expect(x, `x at ${deg} deg`).toBeLessThan(VIEWBOX_SIZE);
                expect(y, `y at ${deg} deg`).toBeGreaterThan(0);
                expect(y, `y at ${deg} deg`).toBeLessThan(VIEWBOX_SIZE);
                expect(Math.hypot(x - DIAL_CENTER, y - DIAL_CENTER), `dial clearance at ${deg} deg`).toBeGreaterThan(DIAL_OUTER_RADIUS);
            }
        }
    });

    it('hides the COG arrow when SOG is inactive (boat at rest)', () => {
        setRequiredInputs({ sogActive: false, courseOverGroundEnabled: true, compassModeEnabled: true });
        fixture.detectChanges();

        expect(component['cogIndicator']().nativeElement.getAttribute('display')).toBe('none');
    });

    it('shows the COG arrow when SOG is active (underway or SOG absent)', () => {
        setRequiredInputs({ sogActive: true, courseOverGroundEnabled: true, compassModeEnabled: true });
        fixture.detectChanges();

        expect(component['cogIndicator']().nativeElement.getAttribute('display')).toBe('inline');
    });

    // Rudder bar (#435): the reveal is stroke-dashoffset over a static per-side arc (pathLength 100).
    // offset 100 = empty, 0 = full; the fraction is 1:1 with the angle, capped at 35 degrees.
    const stbdOffset = (): number => component['rudderStbdOffset']();
    const portOffset = (): number => component['rudderPortOffset']();

    it('hides both rudder arcs (offset 100) when the feature is disabled', () => {
        setRequiredInputs({ rudderEnabled: false, rudderAngle: 20 });
        fixture.detectChanges();
        expect(stbdOffset()).toBe(100);
        expect(portOffset()).toBe(100);
        expect(fixture.nativeElement.querySelector('#layerRudder').style.display).toBe('none');
    });

    it('hides both rudder arcs when there is no rudder data (null)', () => {
        setRequiredInputs({ rudderEnabled: true, rudderAngle: null });
        fixture.detectChanges();
        expect(stbdOffset()).toBe(100);
        expect(portOffset()).toBe(100);
        expect(fixture.nativeElement.querySelector('#layerRudder').style.display).toBe('inline');
    });

    it('reveals the starboard arc for a positive angle and keeps port empty', () => {
        setRequiredInputs({ rudderEnabled: true, rudderAngle: 17.5 });
        fixture.detectChanges();
        expect(stbdOffset()).toBeCloseTo(50);   // 17.5/35 = 0.5 revealed
        expect(portOffset()).toBe(100);
    });

    it('reveals the port arc for a negative angle and keeps starboard empty', () => {
        setRequiredInputs({ rudderEnabled: true, rudderAngle: -35 });
        fixture.detectChanges();
        expect(portOffset()).toBe(0);           // full reveal at hard-over
        expect(stbdOffset()).toBe(100);
    });

    it('caps the reveal at 35 degrees for over-range angles', () => {
        setRequiredInputs({ rudderEnabled: true, rudderAngle: 70 });
        fixture.detectChanges();
        expect(stbdOffset()).toBe(0);
    });

    it('ties the rudder reveal transition to the update interval', () => {
        setRequiredInputs({ rudderEnabled: true, rudderAngle: 10, updateInterval: 100 });
        fixture.detectChanges();
        expect(component['rudderTransition']()).toBe('stroke-dashoffset 100ms linear');
    });

    it('binds the reveal to the correct per-side arc element (starboard = green/right)', () => {
        setRequiredInputs({ rudderEnabled: true, rudderAngle: 17.5 });
        fixture.detectChanges();
        const stbd = fixture.nativeElement.querySelector('.rudder-stbd') as SVGPathElement;
        const port = fixture.nativeElement.querySelector('.rudder-port') as SVGPathElement;
        expect(parseFloat(stbd.style.strokeDashoffset)).toBeCloseTo(50);
        expect(parseFloat(port.style.strokeDashoffset)).toBeCloseTo(100);
    });

    // Freeze-then-hide gating (#475): indicators hide / blank when their path is stale.
    it('hides the compass labels and blanks the heading readout when heading is stale', () => {
        setRequiredInputs({ compassModeEnabled: true, headingFresh: false });
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('#dialLabelsCompass')).toBeNull();
        expect(fixture.nativeElement.querySelector('#layerHeading text').textContent).toContain('--');
    });

    it('shows the compass labels when heading is fresh', () => {
        setRequiredInputs({ compassModeEnabled: true, headingFresh: true });
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('#dialLabelsCompass')).not.toBeNull();
    });

    it('hides the AWA needle when apparent wind is stale', () => {
        setRequiredInputs({ appWindFresh: false });
        fixture.detectChanges();
        expect(component['awaIndicator']().nativeElement.style.display).toBe('none');
    });

    it('shows "--" for a stale true-wind-speed readout instead of 0', () => {
        setRequiredInputs({ twsEnabled: true, trueWindSpeed: 12, trueWindSpeedFresh: false });
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('#text42').textContent).toContain('--');
    });

    it('shows "--" for a stale apparent-wind-speed readout instead of 0', () => {
        setRequiredInputs({ awsEnabled: true, appWindSpeed: 10, appWindSpeedFresh: false });
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('#text40').textContent).toContain('--');
    });

    it('hides the COG arrow when course data is stale', () => {
        setRequiredInputs({ courseOverGroundEnabled: true, compassModeEnabled: true, sogActive: true, courseFresh: false });
        fixture.detectChanges();
        expect(component['cogIndicator']().nativeElement.getAttribute('display')).toBe('none');
    });

    it('hides the TWA needle when true wind is stale', () => {
        setRequiredInputs({ twaEnabled: true, trueWindFresh: false });
        fixture.detectChanges();
        expect(component['twaIndicator']().nativeElement.style.display).toBe('none');
    });

    it('hides the set arrow when set (direction) is stale but keeps the drift readout gate independent', () => {
        setRequiredInputs({ driftEnabled: true, setArrowActive: true, compassModeEnabled: true, setFresh: false, driftFresh: true });
        fixture.detectChanges();
        expect(component['setIndicator']().nativeElement.style.display).toBe('none');
        expect(fixture.nativeElement.querySelector('#layerCurrent').style.display).toBe('inline');
    });

    describe('polar overlay', () => {
        const CURVE: OverlayPoint[] = [
            { angle: 0, r: 0 },
            { angle: -Math.PI / 2, r: 100 },
            { angle: Math.PI, r: 200 },
            { angle: Math.PI / 2, r: 100 }
        ];
        const polarPath = (): SVGPathElement => fixture.nativeElement.querySelector('#layerPolarCurve path');
        const vmcFill = (): SVGPathElement => fixture.nativeElement.querySelector('#layerVmcCurve path.vmc-fill');
        const vmcEdge = (): SVGPathElement => fixture.nativeElement.querySelector('#layerVmcCurve path.vmc-edge');
        const layer = (id: string): SVGGElement => fixture.nativeElement.querySelector(`#${id}`);
        const dot = (): SVGCircleElement => fixture.nativeElement.querySelector('#layerPolarDot circle.polar-dot');

        it('draws nothing while the overlay is hidden', () => {
            setRequiredInputs({ polarOverlayMode: 'hidden', polarCurve: CURVE, vmcCurve: CURVE, overlayDotRadius: 150 });
            fixture.detectChanges();
            expect(layer('layerPolarCurve').style.display).toBe('none');
            expect(layer('layerVmcCurve').style.display).toBe('none');
            expect(layer('layerPolarDot').style.display).toBe('none');
        });

        it('draws the polar curve as an open line, angle clockwise from the bow', () => {
            setRequiredInputs({ polarOverlayMode: 'polar', polarCurve: CURVE });
            fixture.detectChanges();
            expect(layer('layerPolarCurve').style.display).toBe('inline');
            expect(layer('layerVmcCurve').style.display).toBe('none');
            expect(polarPath().getAttribute('d')).toBe('M 500.0,500.0 L 400.0,500.0 L 500.0,700.0 L 600.0,500.0');
            expect(polarPath().getAttribute('class')).toBe('polar-curve');
        });

        it('draws the VMC curve as a filled lobe inside the rotating dial', () => {
            setRequiredInputs({ polarOverlayMode: 'vmc', vmcCurve: CURVE, polarCurve: CURVE });
            fixture.detectChanges();
            expect(layer('layerVmcCurve').style.display).toBe('inline');
            expect(layer('layerPolarCurve').style.display).toBe('none');
            expect(vmcFill().getAttribute('d')).toBe('M 500.0,500.0 L 400.0,500.0 L 500.0,700.0 L 600.0,500.0 Z');
            expect(component['rotatingDial']().nativeElement.contains(vmcFill())).toBe(true);
        });

        it('strokes the VMC lobe only where it has a radius, leaving no radial edges to the center', () => {
            setRequiredInputs({ polarOverlayMode: 'vmc', vmcCurve: CURVE });
            fixture.detectChanges();
            expect(vmcEdge().getAttribute('d')).toBe('M 400.0,500.0 L 500.0,700.0 L 600.0,500.0');
        });

        it('strokes each tack of the VMC lobe as its own subpath', () => {
            const twoTacks: OverlayPoint[] = [
                { angle: 0, r: 0 },
                { angle: Math.PI / 4, r: 100 },
                { angle: Math.PI / 2, r: 100 },
                { angle: Math.PI, r: 0 },
                { angle: -Math.PI / 2, r: 100 },
                { angle: -Math.PI / 4, r: 100 }
            ];
            setRequiredInputs({ polarOverlayMode: 'vmc', vmcCurve: twoTacks });
            fixture.detectChanges();
            expect(vmcEdge().getAttribute('d')).toBe('M 570.7,429.3 L 600.0,500.0 M 400.0,500.0 L 429.3,429.3');
        });

        it('marks each tack\'s best VMC heading with a ring inside the rotating dial', () => {
            setRequiredInputs({
                polarOverlayMode: 'vmc', vmcCurve: CURVE,
                vmcOptima: { port: { angle: Math.PI / 2, r: 100, twa: 1 }, starboard: { angle: -Math.PI / 2, r: 200, twa: 1 } }
            });
            fixture.detectChanges();
            const port = fixture.nativeElement.querySelector('#PortTackVmcOptimum') as SVGCircleElement;
            const stbd = fixture.nativeElement.querySelector('#StbdTackVmcOptimum') as SVGCircleElement;
            expect([port.getAttribute('cx'), port.getAttribute('cy')]).toEqual(['600.0', '500.0']);
            expect([stbd.getAttribute('cx'), stbd.getAttribute('cy')]).toEqual(['300.0', '500.0']);
            expect(port.getAttribute('class')).toBe('vmc-optimum');
            expect(component['rotatingDial']().nativeElement.contains(port)).toBe(true);
        });

        it('leaves a tack without a best heading unmarked, and marks nothing outside VMC mode', () => {
            setRequiredInputs({ polarOverlayMode: 'vmc', vmcCurve: CURVE, vmcOptima: { port: null, starboard: { angle: 0, r: 100, twa: 1 } } });
            fixture.detectChanges();
            expect(fixture.nativeElement.querySelector('#PortTackVmcOptimum')).toBeNull();
            expect(fixture.nativeElement.querySelector('#StbdTackVmcOptimum')).not.toBeNull();

            setInput('polarOverlayMode', 'polar');
            fixture.detectChanges();
            expect(fixture.nativeElement.querySelector('#StbdTackVmcOptimum')).toBeNull();
        });

        it('stacks the groups per the layer order: VMC after the tack lines, polar after the compass, dot after the crosshair', () => {
            setRequiredInputs();
            fixture.detectChanges();
            expect(layer('layerVmcCurve').previousElementSibling?.id).toBe('LayerRunLines');
            expect(layer('layerPolarCurve').previousElementSibling?.id).toBe('layerCompass');
            expect(layer('layerPolarDot').previousElementSibling?.id).toBe('layerCrosshair');
        });

        it('turns the polar curve group by the water TWA it is given, not by the displayed true wind', () => {
            setRequiredInputs({ polarOverlayMode: 'polar', polarCurve: CURVE, trueWindAngle: 95, compassHeading: 15, polarCurveRotation: 45 });
            fixture.detectChanges();
            expect(component['polarOverlay']().nativeElement.getAttribute('transform')).toBe('rotate(45 500 500)');
            expect(component['twaIndicator']().nativeElement.getAttribute('transform')).toBe('rotate(80 500 500)');
        });

        it('wraps a port-side (negative) water TWA into the rotation', () => {
            setRequiredInputs({ polarOverlayMode: 'polar', polarCurve: CURVE, polarCurveRotation: -45 });
            fixture.detectChanges();
            expect(component['polarOverlay']().nativeElement.getAttribute('transform')).toBe('rotate(315 500 500)');
        });

        it('eases the polar curve group to a new water TWA like the true-wind pointer', () => {
            const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
            setRequiredInputs({ polarOverlayMode: 'polar', polarCurve: CURVE, polarCurveRotation: 45 });
            fixture.detectChanges();
            rafSpy.mockClear();

            setInput('polarCurveRotation', 60);
            fixture.detectChanges();
            expect(rafSpy).toHaveBeenCalled();
        });

        it('cancels a running polar curve animation on destroy', () => {
            vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 77);
            const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame');
            setRequiredInputs({ polarOverlayMode: 'polar', polarCurve: CURVE, polarCurveRotation: 45, appWindAngle: 18 });
            fixture.detectChanges();
            setInput('polarCurveRotation', 90);
            fixture.detectChanges();

            cancelSpy.mockClear();
            fixture.destroy();
            expect(cancelSpy).toHaveBeenCalledWith(77);
        });

        it('puts the dot on the bow axis at its radius, in either mode', () => {
            setRequiredInputs({ polarOverlayMode: 'polar', polarCurve: CURVE, overlayDotRadius: 150 });
            fixture.detectChanges();
            expect(layer('layerPolarDot').style.display).toBe('inline');
            expect(dot().getAttribute('cx')).toBe('500');
            expect(dot().getAttribute('cy')).toBe('350');

            fixture.componentRef.setInput('polarOverlayMode', 'vmc');
            fixture.componentRef.setInput('overlayDotRadius', 200);
            fixture.detectChanges();
            expect(dot().getAttribute('cy')).toBe('300');
        });

        it('marks the dot as the VMC dot only in VMC mode, so it takes the colour of the curve it compares against', () => {
            setRequiredInputs({ polarOverlayMode: 'polar', polarCurve: CURVE, overlayDotRadius: 150 });
            fixture.detectChanges();
            expect(dot().classList.contains('vmc-dot')).toBe(false);

            fixture.componentRef.setInput('polarOverlayMode', 'vmc');
            fixture.detectChanges();
            expect(dot().classList.contains('vmc-dot')).toBe(true);
        });

        describe('easing between updates', () => {
            const LOBE_A: OverlayPoint[] = [{ angle: 0, r: 100 }, { angle: Math.PI / 2, r: 0 }, { angle: Math.PI, r: 0 }, { angle: -Math.PI / 2, r: 100 }];
            const LOBE_B: OverlayPoint[] = [{ angle: 0, r: 200 }, { angle: Math.PI / 2, r: 0 }, { angle: Math.PI, r: 0 }, { angle: -Math.PI / 2, r: 200 }];

            afterEach(() => vi.restoreAllMocks());

            it('eases the dot to a new radius over the update interval', () => {
                const frames = frameQueue();
                setRequiredInputs({ polarOverlayMode: 'polar', polarCurve: CURVE, overlayDotRadius: 150 });
                fixture.detectChanges();
                expect(dot().getAttribute('cy')).toBe('350');

                setInput('overlayDotRadius', 250);
                fixture.detectChanges();
                frames.run(250);
                expect(dot().getAttribute('cy')).toBe('325');
                frames.run(1000);
                expect(dot().getAttribute('cy')).toBe('250');
                expect(frames.size).toBe(0);
            });

            it('places the dot without easing when it reappears', () => {
                frameQueue();
                setRequiredInputs({ polarOverlayMode: 'polar', polarCurve: CURVE, overlayDotRadius: 150 });
                fixture.detectChanges();
                setInput('overlayDotRadius', null);
                fixture.detectChanges();
                setInput('overlayDotRadius', 250);
                fixture.detectChanges();
                expect(dot().getAttribute('cy')).toBe('250');
            });

            it('eases the VMC lobe to a new curve, fill and edge together', () => {
                const frames = frameQueue();
                setRequiredInputs({ polarOverlayMode: 'vmc', vmcCurve: LOBE_A });
                fixture.detectChanges();
                expect(vmcEdge().getAttribute('d')).toBe('M 400.0,500.0 L 500.0,400.0');

                setInput('vmcCurve', LOBE_B);
                fixture.detectChanges();
                frames.run(500);
                expect(vmcEdge().getAttribute('d')).toBe('M 350.0,500.0 L 500.0,350.0');
                expect(vmcFill().getAttribute('d')).toContain('500.0,350.0');
                frames.run(1000);
                expect(vmcEdge().getAttribute('d')).toBe('M 300.0,500.0 L 500.0,300.0');
            });

            it('eases the VMC markers to a new optimum', () => {
                const frames = frameQueue();
                setRequiredInputs({ polarOverlayMode: 'vmc', vmcCurve: LOBE_A, vmcOptima: { port: null, starboard: { angle: 0, r: 100, twa: 1 } } });
                fixture.detectChanges();
                setInput('vmcOptima', { port: null, starboard: { angle: 0, r: 200, twa: 1 } });
                fixture.detectChanges();
                frames.run(500);
                expect(fixture.nativeElement.querySelector('#StbdTackVmcOptimum').getAttribute('cy')).toBe('350.0');
                frames.run(1000);
                expect(fixture.nativeElement.querySelector('#StbdTackVmcOptimum').getAttribute('cy')).toBe('300.0');
            });

            it('draws the lobe without easing when the overlay switches to VMC mode', () => {
                frameQueue();
                setRequiredInputs({ polarOverlayMode: 'polar', polarCurve: CURVE, vmcCurve: LOBE_A });
                fixture.detectChanges();
                setInput('polarOverlayMode', 'vmc');
                setInput('vmcCurve', LOBE_B);
                fixture.detectChanges();
                expect(vmcEdge().getAttribute('d')).toBe('M 300.0,500.0 L 500.0,300.0');
            });

            it('cancels a running overlay tween on destroy', () => {
                const frames = frameQueue();
                setRequiredInputs({ polarOverlayMode: 'vmc', vmcCurve: LOBE_A, overlayDotRadius: 150 });
                fixture.detectChanges();
                setInput('vmcCurve', LOBE_B);
                setInput('overlayDotRadius', 250);
                fixture.detectChanges();
                expect(frames.size).toBeGreaterThan(0);

                fixture.destroy();
                expect(frames.size).toBe(0);
            });
        });

        it('hides the dot when it has no radius', () => {
            setRequiredInputs({ polarOverlayMode: 'vmc', vmcCurve: CURVE, overlayDotRadius: null });
            fixture.detectChanges();
            expect(layer('layerPolarDot').style.display).toBe('none');
            expect(layer('layerVmcCurve').style.display).toBe('inline');
        });

        it('keeps the dot in the fixed boat frame, outside every rotating group', () => {
            setRequiredInputs({ polarOverlayMode: 'polar', polarCurve: CURVE, overlayDotRadius: 150 });
            fixture.detectChanges();
            expect(component['rotatingDial']().nativeElement.contains(dot())).toBe(false);
            expect(component['polarOverlay']().nativeElement.contains(dot())).toBe(false);
        });
    });
});
