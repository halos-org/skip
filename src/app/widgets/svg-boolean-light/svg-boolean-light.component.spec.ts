import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SvgBooleanLightComponent } from './svg-boolean-light.component';
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
  return { ctrlLabel: 'Nav', type: '3', pathID: 'p', value: false, color, isNumeric: false };
}

describe('SvgBooleanLightComponent ON/OFF state', () => {
  let fixture: ComponentFixture<SvgBooleanLightComponent>;
  let component: SvgBooleanLightComponent;

  const setup = (color: string) => {
    TestBed.configureTestingModule({ imports: [SvgBooleanLightComponent] });
    fixture = TestBed.createComponent(SvgBooleanLightComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('controlData', control(color));
    fixture.componentRef.setInput('theme', makeTheme());
    fixture.componentRef.setInput('dimensions', dimensionsMock);
    fixture.detectChanges();
  };

  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('lights the OFF bulb with the dedicated dimmer color, not the label color', () => {
    setup('green');

    expect(component.offColor).toBe('greenDimmer');
    expect(component.offColor).not.toBe(component.labelColor);
  });

  it('falls back to the contrast dimmer for an unknown color', () => {
    setup('bogus');

    expect(component.offColor).toBe('contrastDimmer');
  });

  it('marks the ON label by full opacity and value color, without a text-shadow', () => {
    setup('blue');
    fixture.componentRef.setInput('theme', { ...makeTheme(), blue: 'rgb(0, 0, 255)', blueDim: 'rgb(0, 0, 128)' });
    fixture.detectChanges();
    const label = fixture.nativeElement.querySelector('foreignObject div') as HTMLElement;

    expect(label.style.opacity).toBe('0.6');
    expect(label.style.color).toBe('rgb(0, 0, 128)');

    fixture.componentRef.setInput('controlData', { ...control('blue'), value: true });
    fixture.detectChanges();

    expect(label.style.opacity).toBe('1');
    expect(label.style.color).toBe('rgb(0, 0, 255)');
    expect(label.style.textShadow).toBe('');
  });
});
