import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetSteelCompassComponent, toCompassDegrees, shortestTurn } from './widget-gauge-steel-compass.component';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective } from '../../core/directives/widget-streams.directive';
import { IPathUpdate } from '../../core/services/data.service';
import { IWidgetSvcConfig, IPathArray } from '../../core/interfaces/widgets-interface';

/**
 * The card is this component's own SVG, so these assert both the decisions behind the reading (what
 * the LCD says, what happens to a stale one) and the geometry the template renders from. Both host
 * directives are faked.
 */
describe('WidgetSteelCompassComponent', () => {
  let fixture: ComponentFixture<WidgetSteelCompassComponent>;
  let internals: CompassInternals;
  let capturedNext: ((u: IPathUpdate) => void) | undefined;
  let options: WritableSignal<IWidgetSvcConfig | undefined>;

  interface CompassInternals {
    heading: () => number | null;
    headingText: () => string;
    unitLabel: () => string;
    displayName: () => string;
    cardRotation: () => number;
    side: () => number;
    onResized: (entry: ResizeObserverEntry) => void;
    cardLabels: () => { text: string; fill: string }[];
    ink: () => { index: string; label: string };
  }

  const makeConfig = (path: string | null = 'self.navigation.headingMagnetic'): IWidgetSvcConfig => {
    const dflt = WidgetSteelCompassComponent.DEFAULT_CONFIG;
    const gaugePath = (dflt.paths as IPathArray)['gaugePath'];
    return { ...dflt, paths: { gaugePath: { ...gaugePath, path } } };
  };

  const update = (value: unknown): IPathUpdate =>
    ({ data: { value, timestamp: null }, state: 'normal' }) as unknown as IPathUpdate;

  beforeEach(async () => {
    capturedNext = undefined;
    options = signal<IWidgetSvcConfig | undefined>(makeConfig());
    const streamsFake = {
      observe(_pathName: string, next: (u: IPathUpdate) => void) {
        capturedNext = next;
      }
    };
    await TestBed.configureTestingModule({
      imports: [WidgetSteelCompassComponent],
      providers: [
        { provide: WidgetRuntimeDirective, useValue: { options } },
        { provide: WidgetStreamsDirective, useValue: streamsFake }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(WidgetSteelCompassComponent);
    fixture.componentRef.setInput('id', 'steel-compass-1');
    fixture.componentRef.setInput('type', 'widget-gauge-steel-compass');
    fixture.componentRef.setInput('theme', { contrast: '#ffffff' });
    fixture.detectChanges();
    internals = fixture.componentInstance as unknown as CompassInternals;
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('shows no reading until a value arrives, so the card resting on 000 is not read as north', () => {
    expect(internals.heading()).toBeNull();
    expect(internals.headingText()).toBe('---');
  });

  it('pads the heading to three digits', () => {
    capturedNext?.(update(47.4));
    expect(internals.headingText()).toBe('047');
  });

  it('rounds 359.7 to 000 rather than to a 360 the card has no room for', () => {
    capturedNext?.(update(359.7));
    expect(internals.headingText()).toBe('000');
  });

  it('treats a non-numeric reading as no reading at all', () => {
    capturedNext?.(update(47));
    // A source publishing a non-numeric value would otherwise read as "NaN" on the LCD while the
    // pointer stayed on the last real heading.
    capturedNext?.(update(Number.NaN));

    expect(internals.heading()).toBeNull();
    expect(internals.headingText()).toBe('---');
  });

  it('drops the previous path reading when the widget is re-pointed', () => {
    capturedNext?.(update(47));
    expect(internals.heading()).toBe(47);
    expect(internals.cardRotation()).toBe(-47);

    // The new path reports nothing: suppressBootstrapNull filters its replayed leading null, so the
    // stream callback never runs and only the re-point clear can remove the old heading.
    options.set(makeConfig('self.navigation.courseOverGroundTrue'));
    fixture.detectChanges();

    expect(internals.heading()).toBeNull();
    expect(internals.headingText()).toBe('---');
    // The card too: left at 047 under a `---` it would read as the new path's heading. Back on 000
    // and dimmed, it is the stale state the stylesheet describes.
    expect(internals.cardRotation()).toBe(0);
  });

  it('turns the short way from 000 once a re-pointed path starts reporting', () => {
    capturedNext?.(update(47));
    options.set(makeConfig('self.navigation.courseOverGroundTrue'));
    fixture.detectChanges();

    capturedNext?.(update(350));
    // From the reset card, 350 is 10 degrees to port, not 350 to starboard.
    expect(internals.cardRotation()).toBe(10);
  });

  it('keeps the reading across an unrelated config edit on the same path', () => {
    capturedNext?.(update(47));
    options.set({ ...makeConfig(), displayName: 'Ship Heading' });
    fixture.detectChanges();

    expect(internals.heading()).toBe(47);
    expect(internals.displayName()).toBe('Ship Heading');
  });

  it('names the reference the heading is measured against, from the path', () => {
    expect(internals.unitLabel()).toBe('°M');

    options.set(makeConfig('self.navigation.headingTrue'));
    fixture.detectChanges();
    expect(internals.unitLabel()).toBe('°T');

    options.set(makeConfig('self.environment.wind.angleApparent'));
    fixture.detectChanges();
    expect(internals.unitLabel()).toBe('°');

    // "True" here is the wind's velocity frame, not a north reference: this is an angle off the
    // bow, and labelling it °T would present it as a true bearing.
    options.set(makeConfig('self.environment.wind.angleTrueWater'));
    fixture.detectChanges();
    expect(internals.unitLabel()).toBe('°');
  });

  it('turns the card against the heading, so the reading sits under the index', () => {
    capturedNext?.(update(87));
    // The card carries 087 to the top by rotating 87 degrees anticlockwise.
    expect(internals.cardRotation()).toBe(-87);
  });

  it('crosses north the short way instead of unwinding through south', () => {
    capturedNext?.(update(350));
    const before = internals.cardRotation();
    capturedNext?.(update(10));

    // A boat turning 350 -> 010 has swung 20 degrees to starboard, so the card turns 20 the other
    // way. Feeding the raw values to a CSS rotation would have unwound 340 degrees through south.
    expect(internals.cardRotation() - before).toBe(-20);
  });

  it('has no needle to render, whatever a stored config asks for', () => {
    // A compass needle points north; this dial's index is a fixed mark at the rim and the card is
    // what moves. An old config carrying the withdrawn fixed-card flag cannot bring one back.
    options.set({ ...makeConfig(), gauge: { type: 'steelCompass', rotateFace: false } });
    fixture.detectChanges();
    capturedNext?.(update(87));

    expect(internals.cardRotation()).toBe(-87);
    expect(fixture.nativeElement.querySelector('.pointer')).toBeNull();
  });

  it('sizes both layers to one square, so the case and the card cannot drift apart', () => {
    vi.useFakeTimers();
    try {
      const rect = (width: number, height: number) =>
        ({ contentRect: { width, height } }) as ResizeObserverEntry;

      // A box too small to draw in is ignored, as the Classic Steel gauge ignores it.
      internals.onResized(rect(40, 40));
      vi.advanceTimersByTime(200);
      expect(internals.side()).toBe(0);

      // The side is the short edge, whatever shape the tile is: a wide tile gets a square dial.
      internals.onResized(rect(420, 240));
      vi.advanceTimersByTime(200);
      expect(internals.side()).toBe(240);

      // Debounced: a drag that fires a burst of resizes repaints once, at the last size.
      internals.onResized(rect(300, 300));
      internals.onResized(rect(360, 360));
      expect(internals.side()).toBe(240);
      vi.advanceTimersByTime(200);
      expect(internals.side()).toBe(360);
    } finally {
      vi.useRealTimers();
    }
  });

  it('prints north in the index colour so the card reads at a glance', () => {
    const north = internals.cardLabels().find(l => l.text === 'N');
    expect(north?.fill).toBe(internals.ink().index);
    // Every other cardinal is in the label ink, so north is the only one that stands out.
    expect(internals.cardLabels().find(l => l.text === 'S')?.fill).toBe(internals.ink().label);
  });

  it('prints whole bearings, and drops them when the degree scale is off', () => {
    expect(internals.cardLabels().map(l => l.text)).toContain('30');
    expect(internals.cardLabels().map(l => l.text)).toContain('330');

    options.set({ ...makeConfig(), gauge: { ...WidgetSteelCompassComponent.DEFAULT_CONFIG.gauge, type: 'steelCompass', degreeScale: false } });
    fixture.detectChanges();

    const texts = internals.cardLabels().map(l => l.text);
    expect(texts).not.toContain('30');
    // The cardinals and intercardinals stay: they are what makes it a compass.
    expect(texts).toEqual(expect.arrayContaining(['N', 'E', 'S', 'W', 'NE', 'SE', 'SW', 'NW']));
  });

  it('still prints a readable card with no steelseries on the page', () => {
    // The library is a browser global loaded from index.html, absent until that script has run. The
    // test setup installs a stand-in for every spec, so it has to be taken away here for the guard
    // to be the branch under test rather than the stand-in's missing colour objects.
    const page = globalThis as { steelseries?: unknown };
    const shim = page.steelseries;
    delete page.steelseries;
    try {
      options.set({ ...makeConfig(), gauge: { type: 'steelCompass', backgroundColor: 'white', faceColor: 'chrome' } });
      fixture.detectChanges();

      // The fallback ink, not undefined: the case goes unpainted, the card does not go blank.
      expect(internals.ink().label).toBe('#FFFFFF');
      expect(internals.ink().index).toBe('#D8232A');
      expect(internals.cardLabels().every(l => !!l.fill)).toBe(true);
    } finally {
      page.steelseries = shim;
    }
  });

  it('is fed degrees off a radian path', () => {
    const cfg = WidgetSteelCompassComponent.DEFAULT_CONFIG;
    const gaugePath = (cfg.paths as IPathArray)['gaugePath'];
    expect(cfg.gauge?.backgroundColor).toBe('carbon');
    expect(cfg.gauge?.faceColor).toBe('anthracite');
    expect(gaugePath.pathSkUnitsFilter).toBe('rad');
    expect(gaugePath.convertUnitTo).toBe('deg');
    expect(gaugePath.suppressBootstrapNull).toBe(true);
  });
});

describe('toCompassDegrees', () => {
  it('maps a port-side negative angle onto the card', () => {
    expect(toCompassDegrees(-45)).toBe(315);
    expect(toCompassDegrees(-180)).toBe(180);
  });

  it('wraps an accumulated turn back onto the card', () => {
    expect(toCompassDegrees(370)).toBe(10);
  });

  it('leaves a heading already on the card alone', () => {
    expect(toCompassDegrees(0)).toBe(0);
    expect(toCompassDegrees(359.5)).toBe(359.5);
  });
});

describe('shortestTurn', () => {
  it('takes the short way across north in both directions', () => {
    expect(shortestTurn(350, 10)).toBe(20);
    expect(shortestTurn(10, 350)).toBe(-20);
  });

  it('keeps an ordinary turn as it is', () => {
    expect(shortestTurn(0, 90)).toBe(90);
    expect(shortestTurn(90, 0)).toBe(-90);
  });

  it('resolves the half turn the same way from either side rather than oscillating', () => {
    // Exactly a half turn has no shorter way round; the formula always takes it to port, and takes
    // it to port again on the way back, so a heading flapping across the reciprocal never sees the
    // card wind up.
    expect(shortestTurn(0, 180)).toBe(-180);
    expect(shortestTurn(180, 0)).toBe(-180);
    expect(shortestTurn(90, 270)).toBe(-180);
  });
});
