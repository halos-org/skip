import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WidgetBooleanSwitchComponent } from './widget-boolean-switch.component';
import { CanvasService } from '../../core/services/canvas.service';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective } from '../../core/directives/widget-streams.directive';
import { DashboardService } from '../../core/services/dashboard.service';
import { SignalkRequestsService } from '../../core/services/signalk-requests.service';
import { ToastService } from '../../core/services/toast.service';
import type { ITheme } from '../../core/services/app-service';
import type { IWidgetSvcConfig } from '../../core/interfaces/widgets-interface';

const themeMock = {
  contrast: '#fff', contrastDim: '#ccc', contrastDimmer: '#999'
} as unknown as ITheme;

function config(): IWidgetSvcConfig {
  return {
    displayName: 'Switch Panel', showLabel: false, filterSelfPaths: true, paths: [],
    enableTimeout: false, dataTimeout: 5, color: 'contrast', zonesOnlyPaths: false,
    putEnable: true, putMomentary: false,
    multiChildCtrls: [
      { ctrlLabel: 'Nav', type: '1', pathID: 'p0', value: false, color: 'contrast', isNumeric: false },
      { ctrlLabel: 'Anchor Light', type: '1', pathID: 'p1', value: false, color: 'contrast', isNumeric: false },
    ],
  } as unknown as IWidgetSvcConfig;
}

describe('WidgetBooleanSwitchComponent', () => {
  let fixture: ComponentFixture<WidgetBooleanSwitchComponent>;
  let component: WidgetBooleanSwitchComponent;
  let resolveFonts: () => void;

  let perCharWidth = 8;
  const runtimeMock = { options: vi.fn() };
  const streamsMock = { observe: vi.fn() };
  const dashboardMock = { isDashboardStatic: () => true };
  const canvasMock = {
    DEFAULT_FONT: 'Roboto',
    measureTextWidth: vi.fn((text: string) => String(text).length * perCharWidth),
    whenFontsReady: vi.fn(() => new Promise<void>((res) => { resolveFonts = res; })),
  };

  const flushMicrotasks = async () => { await Promise.resolve(); await Promise.resolve(); };

  const readDims = () =>
    (component as unknown as { ctrlDimensions: () => { width: number; height: number } }).ctrlDimensions();

  const resize = (width: number, height: number) =>
    component.onResized({ contentRect: { width, height } } as ResizeObserverEntry);

  const setup = async (options: IWidgetSvcConfig = config()) => {
    runtimeMock.options.mockReturnValue(options);
    await TestBed.configureTestingModule({
      imports: [WidgetBooleanSwitchComponent],
      providers: [
        { provide: CanvasService, useValue: canvasMock },
        { provide: WidgetRuntimeDirective, useValue: runtimeMock },
        { provide: WidgetStreamsDirective, useValue: streamsMock },
        { provide: DashboardService, useValue: dashboardMock },
        { provide: SignalkRequestsService, useValue: {} },
        { provide: ToastService, useValue: {} },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(WidgetBooleanSwitchComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('id', 'w-bool-1');
    fixture.componentRef.setInput('type', 'widget-boolean-switch');
    fixture.componentRef.setInput('theme', themeMock);
    fixture.detectChanges();
  };

  afterEach(() => {
    perCharWidth = 8;
    vi.clearAllMocks();
    TestBed.resetTestingModule();
  });

  it('measures the shared control height via CanvasService once the host has a size', async () => {
    await setup();
    resize(200, 260);
    expect(canvasMock.measureTextWidth).toHaveBeenCalled();
    expect(readDims().height).toBeGreaterThan(0);
  });

  it('re-measures when web fonts settle and the new metrics reach ctrlDimensions', async () => {
    perCharWidth = 2;
    await setup();
    resize(200, 260);
    const before = readDims().height;
    expect(before).toBeGreaterThan(0);

    perCharWidth = 60; // wider glyphs once the real web font is measured, vs the fallback
    resolveFonts();
    await flushMicrotasks();

    expect(readDims().height).not.toBe(before);
  });

  it('does not measure or crash when fonts settle before the host has a size', async () => {
    await setup();
    resolveFonts(); // fonts ready before any ResizeObserver callback
    await flushMicrotasks();
    expect(canvasMock.measureTextWidth).not.toHaveBeenCalled();
    expect(readDims().height).toBe(0);

    resize(200, 260); // size arrives later -> now it measures
    expect(readDims().height).toBeGreaterThan(0);
  });
});
