import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WidgetPositionComponent } from './widget-position.component';
import { IWidgetSvcConfig } from '../../core/interfaces/widgets-interface';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective } from '../../core/directives/widget-streams.directive';
import { UnitsService } from '../../core/services/units.service';
import { CanvasService } from '../../core/services/canvas.service';
import type { ITheme } from '../../core/services/app-service';
import type { IPathUpdate } from '../../core/services/data.service';

// Any color property the theme palette builder reads resolves to a valid string.
const themeMock = new Proxy({}, { get: () => '#000000' }) as unknown as ITheme;

describe('WidgetPositionComponent', () => {
  it('exposes exactly one configurable location path — no separate latitude/longitude entries', () => {
    const paths = WidgetPositionComponent.DEFAULT_CONFIG.paths ?? {};
    // The whole point of the redesign: position is one location object, one path setting.
    expect(Object.keys(paths)).toEqual(['positionPath']);
    const p = paths['positionPath'];
    expect(p.path).toBe('self.navigation.position');
    expect(p.pathType).toBe('object');
    expect(p.isPathConfigurable).toBe(true);
  });

  describe('rendering', () => {
    let fixture: ComponentFixture<WidgetPositionComponent>;

    const runtimeMock = { options: vi.fn() };
    const streamsMock = { observe: vi.fn() };
    // Echo the measure and value so the test can prove both coordinates were drawn from the object.
    const unitsMock = { convertToUnit: (measure: string, value: number) => `${measure}:${value}` };
    const drawText = vi.fn();
    const canvasMock = {
      registerCanvas: vi.fn(),
      unregisterCanvas: vi.fn(),
      releaseCanvas: vi.fn(),
      calculateOptimalFontSize: vi.fn().mockReturnValue(20),
      createTitleBitmap: vi.fn().mockReturnValue(document.createElement('canvas')),
      clearCanvas: vi.fn(),
      drawText,
      drawTextBitmap: vi.fn(),
      MIN_LABEL_PX: 10
    };

    const makeConfig = (): IWidgetSvcConfig => ({ ...WidgetPositionComponent.DEFAULT_CONFIG, color: 'contrast' });

    const setup = async (): Promise<void> => {
      runtimeMock.options.mockReturnValue(makeConfig());
      await TestBed.configureTestingModule({
        imports: [WidgetPositionComponent],
        providers: [
          { provide: WidgetRuntimeDirective, useValue: runtimeMock },
          { provide: WidgetStreamsDirective, useValue: streamsMock },
          { provide: UnitsService, useValue: unitsMock },
          { provide: CanvasService, useValue: canvasMock }
        ]
      }).compileComponents();

      fixture = TestBed.createComponent(WidgetPositionComponent);
      fixture.componentRef.setInput('id', 'w1');
      fixture.componentRef.setInput('type', 'widget-position');
      fixture.componentRef.setInput('theme', themeMock);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };

    beforeEach(() => {
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
        .mockReturnValue({} as unknown as CanvasRenderingContext2D);
      runtimeMock.options.mockReset();
      streamsMock.observe.mockReset();
      drawText.mockReset();
    });

    afterEach(() => {
      vi.restoreAllMocks();
      TestBed.resetTestingModule();
    });

    it('observes the whole position object under one path key with no per-coordinate sub-field', async () => {
      await setup();

      expect(streamsMock.observe).toHaveBeenCalledTimes(1);
      const [pathKey, , subField] = streamsMock.observe.mock.calls[0];
      expect(pathKey).toBe('positionPath');
      // A third sub-field argument would mean per-coordinate extraction — the old two-path design.
      expect(subField).toBeUndefined();
    });

    it('renders both latitude and longitude from the single position object', async () => {
      await setup();
      const callback = streamsMock.observe.mock.calls[0][1] as (u: IPathUpdate) => void;
      drawText.mockReset();

      callback({ data: { value: { latitude: 59.5, longitude: 22.5 } } } as unknown as IPathUpdate);

      const drawn = drawText.mock.calls.map(c => c[1]);
      expect(drawn).toContain('latitudeMin:59.5');
      expect(drawn).toContain('longitudeMin:22.5');
    });

    it('renders a placeholder for both coordinates when no position value is present', async () => {
      await setup();
      const callback = streamsMock.observe.mock.calls[0][1] as (u: IPathUpdate) => void;
      drawText.mockReset();

      callback({ data: { value: null } } as unknown as IPathUpdate);

      const drawn = drawText.mock.calls.map(c => c[1]);
      // Both coordinates read '--' so the widget still shows its label and two value rows.
      expect(drawn.filter(s => s === '--')).toHaveLength(2);
      expect(drawn.some(s => typeof s === 'string' && s.includes(':'))).toBe(false);
    });

    it('renders only the present coordinate when the position object is partial (GPS acquiring)', async () => {
      await setup();
      const callback = streamsMock.observe.mock.calls[0][1] as (u: IPathUpdate) => void;
      drawText.mockReset();

      callback({ data: { value: { latitude: 59.5 } } } as unknown as IPathUpdate);

      const drawn = drawText.mock.calls.map(c => c[1]);
      expect(drawn).toContain('latitudeMin:59.5');
      // The absent longitude reads '--', never 'undefined'/'NaN' text.
      expect(drawn).toContain('--');
      expect(drawn.some(s => typeof s === 'string' && s.startsWith('longitudeMin'))).toBe(false);
    });

    it('shows a placeholder for a non-finite coordinate rather than formatting NaN', async () => {
      await setup();
      const callback = streamsMock.observe.mock.calls[0][1] as (u: IPathUpdate) => void;
      drawText.mockReset();

      callback({ data: { value: { latitude: NaN, longitude: 22.5 } } } as unknown as IPathUpdate);

      const drawn = drawText.mock.calls.map(c => c[1]);
      expect(drawn).toContain('longitudeMin:22.5');
      expect(drawn).toContain('--');
      expect(drawn.some(s => typeof s === 'string' && s.startsWith('latitudeMin'))).toBe(false);
    });

    it('shows a placeholder for both coordinates on a non-object scalar value (guards against +value coercion)', async () => {
      await setup();
      const callback = streamsMock.observe.mock.calls[0][1] as (u: IPathUpdate) => void;
      drawText.mockReset();

      callback({ data: { value: 42 } } as unknown as IPathUpdate);

      const drawn = drawText.mock.calls.map(c => c[1]);
      expect(drawn.some(s => typeof s === 'string' && s.includes(':'))).toBe(false);
    });
  });
});
