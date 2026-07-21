import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { SvgZoneStatesComponent } from './svg-zone-states.component';
import type { IDynamicControl } from '../../core/interfaces/widgets-interface';
import type { ITheme } from '../../core/services/app-service';
import { States } from '../../core/interfaces/signalk-interfaces';

const control = (overrides: Partial<IDynamicControl> = {}): IDynamicControl => ({
  ctrlLabel: 'Zone',
  type: '4',
  pathID: 'p1',
  color: 'contrast',
  isNumeric: false,
  ...overrides
});

const theme = {
  contrast: '#fff',
  contrastDim: '#ccc',
  contrastDimmer: '#999',
  zoneEmergency: '#f0f',
  zoneAlarm: '#f00',
  zoneWarn: '#fa0',
  zoneAlert: '#ff0',
  background: '#000'
} as unknown as ITheme;

describe('SvgZoneStatesComponent', () => {
  let fixture: ComponentFixture<SvgZoneStatesComponent>;
  let component: SvgZoneStatesComponent;

  const build = (themeValue: ITheme | null, ctrl: IDynamicControl) => {
    fixture = TestBed.createComponent(SvgZoneStatesComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('controlData', ctrl);
    fixture.componentRef.setInput('theme', themeValue);
    fixture.componentRef.setInput('dimensions', { width: 180, height: 75 });
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SvgZoneStatesComponent] }).compileComponents();
  });

  it('does not throw and sets no colors while the theme is still null during init (#332)', () => {
    build(null, control({ notificationState: States.Emergency }));

    expect(() => fixture.detectChanges()).not.toThrow();
    expect(component.ctrlStateColor()).toBeNull();
    expect(component.messageTxtColor()).toBeNull();
    expect(component.ctrlLabelColor()).toBeNull();
  });

  it('resolves zone colors from the theme once it is provided', () => {
    build(theme, control({ notificationState: States.Emergency }));
    fixture.detectChanges();

    expect(component.ctrlStateColor()).toBe(theme.zoneEmergency);
    expect(component.messageTxtColor()).toBe(theme.background);
  });

  it('paints late once the theme resolves after an initial null binding (#332)', () => {
    build(null, control({ notificationState: States.Alarm }));
    fixture.detectChanges();
    expect(component.ctrlStateColor()).toBeNull();

    fixture.componentRef.setInput('theme', theme);
    fixture.detectChanges();

    expect(component.ctrlStateColor()).toBe(theme.zoneAlarm);
    expect(component.messageTxtColor()).toBe(theme.background);
  });
});
