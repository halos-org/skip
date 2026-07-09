import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SvgWindsteerComponent } from './svg-windsteer.component';

describe('SvgWindsteerComponent', () => {
    let fixture: ComponentFixture<SvgWindsteerComponent>;
    let component: SvgWindsteerComponent;

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
            windSectorEnabled: false,
            driftEnabled: true,
            waypointEnabled: true,
            driftSet: 7,
            waypointAngle: 30,
            courseOverGroundAngle: 16
        };

        Object.entries({ ...defaults, ...overrides }).forEach(([key, value]) => {
            fixture.componentRef.setInput(key, value);
        });
    };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [SvgWindsteerComponent]
        }).compileComponents();

        fixture = TestBed.createComponent(SvgWindsteerComponent);
        component = fixture.componentInstance;
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

        fixture.componentRef.setInput('appWindAngle', 42);
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
    // drawn SVG path. drawLayline/computeSectorPath place points at (R*sinθ+C, -R*cosθ+C).
    const CENTER = 500;
    const norm = (a: number): number => ((a % 360) + 360) % 360;
    const angleOf = (x: number, y: number): number => norm((Math.atan2(x - CENTER, CENTER - y) * 180) / Math.PI);
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
            laylineAngle: 30,
            trueWindActive: true
        });
        fixture.detectChanges();

        const angles = [
            firstPointAngle((component as unknown as { closeHauledLinePortPath: () => string }).closeHauledLinePortPath()),
            firstPointAngle((component as unknown as { closeHauledLineStbdPath: () => string }).closeHauledLineStbdPath())
        ].sort((a, b) => a - b);

        // True-wind based: 40 ± 30 => 10 and 70. (Apparent-based would give 20 ± 30.)
        expect(angles[0]).toBeCloseTo(10, 0);
        expect(angles[1]).toBeCloseTo(70, 0);
    });

    it('hides laylines when true wind is unavailable', () => {
        setRequiredInputs({ closeHauledLineEnabled: true, laylineAngle: 30, trueWindActive: false });
        fixture.detectChanges();
        const layer = fixture.nativeElement.querySelector('#LayerLayline') as SVGGElement;
        expect(layer.style.display).toBe('none');

        fixture.componentRef.setInput('trueWindActive', true);
        fixture.detectChanges();
        expect(layer.style.display).toBe('inline');
    });

    it('positions wind sectors from the true wind DIRECTION (compass), not boat-relative', () => {
        // Stored min/mid/max are compass true-wind directions; with heading 30 the min at
        // TWD 100 must render at dial-local 100 (screen 70 = boat-relative). A boat-relative
        // reading of the same value would land at 130.
        setRequiredInputs({
            compassHeading: 30,
            windSectorEnabled: true,
            closeHauledLineEnabled: false,
            laylineAngle: 0,
            trueWindMinHistoric: 100,
            trueWindMidHistoric: 110,
            trueWindMaxHistoric: 120,
            trueWindActive: true
        });
        fixture.detectChanges();

        const sectorMin = firstPointAngle((component as unknown as { portWindSectorPath: () => string }).portWindSectorPath());
        expect(sectorMin).toBeCloseTo(100, 0);
    });

    it('converts wind sectors to boat-relative in simple mode using the real heading', () => {
        // Simple/bow-fixed mode forces compass.newValue to 0, so the conversion must read the
        // compassHeading input. Stored TWD 100 at heading 30 renders boat-relative at 70, not the
        // absolute 100 (the pre-fix bug displaced the sector by the heading).
        setRequiredInputs({
            compassModeEnabled: false,
            compassHeading: 30,
            windSectorEnabled: true,
            closeHauledLineEnabled: false,
            laylineAngle: 0,
            trueWindMinHistoric: 100,
            trueWindMidHistoric: 110,
            trueWindMaxHistoric: 120,
            trueWindActive: true
        });
        fixture.detectChanges();

        const sectorMin = firstPointAngle((component as unknown as { portWindSectorPath: () => string }).portWindSectorPath());
        expect(sectorMin).toBeCloseTo(70, 0);
    });

    it('centers laylines on the true wind in simple mode', () => {
        setRequiredInputs({
            compassModeEnabled: false,
            compassHeading: 30,
            trueWindAngle: 40, // boat-relative TWA in simple mode
            closeHauledLineEnabled: true,
            laylineAngle: 30,
            trueWindActive: true
        });
        fixture.detectChanges();

        const angles = [
            firstPointAngle((component as unknown as { closeHauledLinePortPath: () => string }).closeHauledLinePortPath()),
            firstPointAngle((component as unknown as { closeHauledLineStbdPath: () => string }).closeHauledLineStbdPath())
        ].sort((a, b) => a - b);
        expect(angles[0]).toBeCloseTo(10, 0);
        expect(angles[1]).toBeCloseTo(70, 0);
    });

    it('clears the wind sector when true wind data drops out', () => {
        setRequiredInputs({
            compassHeading: 0,
            windSectorEnabled: true,
            closeHauledLineEnabled: false,
            laylineAngle: 0,
            trueWindMinHistoric: 100,
            trueWindMidHistoric: 110,
            trueWindMaxHistoric: 120,
            trueWindActive: true
        });
        fixture.detectChanges();
        expect((component as unknown as { portWindSectorPath: () => string }).portWindSectorPath()).not.toBe('');

        fixture.componentRef.setInput('trueWindMinHistoric', undefined);
        fixture.componentRef.setInput('trueWindMidHistoric', undefined);
        fixture.componentRef.setInput('trueWindMaxHistoric', undefined);
        fixture.detectChanges();

        expect((component as unknown as { portWindSectorPath: () => string }).portWindSectorPath()).toBe('');
        expect((component as unknown as { stbdWindSectorPath: () => string }).stbdWindSectorPath()).toBe('');
    });
});
