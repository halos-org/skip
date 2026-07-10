import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetHorizonComponent } from './widget-horizon.component';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective } from '../../core/directives/widget-streams.directive';
import type { IWidgetSvcConfig } from '../../core/interfaces/widgets-interface';

// The "Show Frame" checkbox binds directly to gauge.noFrameVisible (no inversion),
// so noFrameVisible === true means "draw the frame". Two consumers must stay in
// agreement: buildOptions().frameVisible (the steelseries gauge option) and
// frameVisibleView() (drives the wrapper padding). A regression that negates one
// but not the other inverts the padding relative to the frame.
interface HorizonInternals {
  frameVisibleView: () => boolean;
  buildOptions: (cfg: IWidgetSvcConfig, size: number) => void;
  gaugeOptions: { frameVisible?: boolean };
}

function mount(noFrameVisible: boolean) {
  const options = signal<IWidgetSvcConfig | undefined>({ gauge: { type: 'horizon', noFrameVisible } });
  TestBed.configureTestingModule({
    imports: [WidgetHorizonComponent],
    providers: [
      { provide: WidgetRuntimeDirective, useValue: { options } },
      { provide: WidgetStreamsDirective, useValue: { observe: vi.fn() } },
    ],
  });
  const fixture = TestBed.createComponent(WidgetHorizonComponent);
  fixture.componentRef.setInput('id', 'test-horizon');
  fixture.componentRef.setInput('type', 'widget-horizon');
  fixture.componentRef.setInput('theme', null);
  fixture.detectChanges();
  return fixture.componentInstance as unknown as HorizonInternals;
}

describe('WidgetHorizonComponent frame visibility', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('draws the frame and pads the wrapper when Show Frame is on (noFrameVisible=true)', () => {
    const c = mount(true);
    c.buildOptions({ gauge: { type: 'horizon', noFrameVisible: true } } as IWidgetSvcConfig, 200);
    expect(c.gaugeOptions.frameVisible).toBe(true);
    expect(c.frameVisibleView()).toBe(true);
  });

  it('hides the frame and drops the wrapper padding when Show Frame is off (noFrameVisible=false)', () => {
    const c = mount(false);
    c.buildOptions({ gauge: { type: 'horizon', noFrameVisible: false } } as IWidgetSvcConfig, 200);
    expect(c.gaugeOptions.frameVisible).toBe(false);
    expect(c.frameVisibleView()).toBe(false);
  });
});
