import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SvgBooleanSwitchComponent } from './svg-boolean-switch.component';
import type { IDynamicControl, IDimensions } from '../../core/interfaces/widgets-interface';
import type { ITheme } from '../../core/services/app-service';

const COLOR_KEYS = ['blue', 'green', 'purple', 'yellow', 'pink', 'orange', 'contrast', 'grey'] as const;

function makeTheme(): ITheme {
  const theme: Record<string, string> = {
    port: 'port', starboard: 'starboard',
    zoneNominal: 'zoneNominal', zoneAlert: 'zoneAlert', zoneWarn: 'zoneWarn',
    zoneAlarm: 'zoneAlarm', zoneEmergency: 'zoneEmergency',
    background: 'background', cardColor: 'cardColor'
  };
  for (const key of COLOR_KEYS) {
    theme[key] = key;
    theme[`${key}Dim`] = `${key}Dim`;
    theme[`${key}Dimmer`] = `${key}Dimmer`;
  }
  return theme as unknown as ITheme;
}

const dimensionsMock: IDimensions = { width: 180, height: 35 };

function control(color: string): IDynamicControl {
  return { ctrlLabel: 'Nav', type: '1', pathID: 'p', value: false, color, isNumeric: false };
}

describe('SvgBooleanSwitchComponent OFF-state', () => {
  let fixture: ComponentFixture<SvgBooleanSwitchComponent>;
  let component: SvgBooleanSwitchComponent;

  const setup = (color: string) => {
    TestBed.configureTestingModule({ imports: [SvgBooleanSwitchComponent] });
    fixture = TestBed.createComponent(SvgBooleanSwitchComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('controlData', control(color));
    fixture.componentRef.setInput('theme', makeTheme());
    fixture.componentRef.setInput('dimensions', dimensionsMock);
    fixture.detectChanges();
  };

  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('paints the OFF indicator with the dedicated dimmer color, not the label color', () => {
    setup('blue');

    expect(component.offColor).toBe('blueDimmer');
    expect(component.offColor).not.toBe(component.labelColor);
  });

  it('falls back to the contrast dimmer for an unknown color', () => {
    setup('bogus');

    expect(component.offColor).toBe('contrastDimmer');
  });
});
