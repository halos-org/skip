import { TestBed } from '@angular/core/testing';
import { MatIconRegistry } from '@angular/material/icon';
import { signal } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import packageInfo from '../../../../package.json';
import { States } from '../interfaces/signalk-interfaces';
import { AppService } from './app-service';
import { DataService, IPathUpdate } from './data.service';
import { SettingsService } from './settings.service';

class SettingsServiceMock {
  public themeName = signal<string>('');
  public autoNightMode = signal<boolean>(false);
  public redNightMode = signal<boolean>(false);
  public nightModeBrightness = 0.27;

  getNightModeBrightness(): number { return this.nightModeBrightness; }
}

const modeUpdate = (value: string): IPathUpdate => ({
  data: { value, timestamp: null },
  state: States.Normal
});

describe('AppService', () => {
  let settings: SettingsServiceMock;
  let envMode$: BehaviorSubject<IPathUpdate>;

  beforeEach(() => {
    document.body.className = '';
    document.body.removeAttribute('style');
    settings = new SettingsServiceMock();
    envMode$ = new BehaviorSubject<IPathUpdate>(modeUpdate('day'));
    TestBed.configureTestingModule({
      providers: [
        { provide: SettingsService, useValue: settings },
        { provide: DataService, useValue: { subscribePath: () => envMode$.asObservable() } as Partial<DataService> }
      ]
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(window.navigator, 'userAgent');
    Reflect.deleteProperty(window.navigator, 'platform');
  });

  function setNavigator(userAgent: string, platform = ''): void {
    Object.defineProperty(window.navigator, 'userAgent', { configurable: true, value: userAgent });
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: platform });
  }

  function createService(): AppService {
    const service = TestBed.inject(AppService);
    TestBed.tick();
    return service;
  }

  describe('construction', () => {
    it('exposes the package.json version as appVersion', () => {
      expect(createService().appVersion()).toBe(packageInfo.version);
    });

    it('registers the SVG icon set once with the icon registry', () => {
      const iconRegistry = TestBed.inject(MatIconRegistry);
      const addSvgIconSet = vi.spyOn(iconRegistry, 'addSvgIconSet');
      createService();
      expect(addSvgIconSet).toHaveBeenCalledTimes(1);
    });

    it('publishes CSS theme color roles and mirrors them on cssThemeColors', () => {
      const service = createService();
      const colors = service.cssThemeColorRoles$.getValue();
      expect(colors).not.toBeNull();
      expect(colors).toHaveProperty('blue');
      expect(colors).toHaveProperty('zoneEmergency');
      expect(service.cssThemeColors).toBe(colors);
    });

    it('exposes the eight configurable theme colors', () => {
      expect(createService().configurableThemeColors.map(c => c.value)).toEqual(
        ['contrast', 'blue', 'green', 'orange', 'yellow', 'pink', 'purple', 'grey']
      );
    });
  });

  describe('light-theme body class', () => {
    it('adds the light-theme class when the theme is light-theme', () => {
      settings.themeName.set('light-theme');
      createService();
      expect(document.body.classList.contains('light-theme')).toBe(true);
    });

    it('removes the light-theme class when the theme changes away from light-theme', () => {
      settings.themeName.set('light-theme');
      createService();
      settings.themeName.set('dark-theme');
      TestBed.tick();
      expect(document.body.classList.contains('light-theme')).toBe(false);
    });
  });

  describe('setBrightness', () => {
    it('writes the brightness CSS variable without filters by default', () => {
      createService().setBrightness(0.35);
      expect(document.body.style.getPropertyValue('--kip-nightModeBrightness')).toBe('0.35');
      expect(document.body.style.getPropertyValue('--kip-nightModeFilters')).toBe('');
    });

    it('applies sepia and hue-rotate filters when night filters are requested', () => {
      createService().setBrightness(0.5, true);
      expect(document.body.style.getPropertyValue('--kip-nightModeBrightness')).toBe('0.5');
      const filters = document.body.style.getPropertyValue('--kip-nightModeFilters');
      expect(filters).toContain('sepia(0.5)');
      expect(filters).toContain('hue-rotate(-30deg)');
    });
  });

  describe('toggleDayNightMode', () => {
    it('applies full-brightness day styling when not in night mode', () => {
      const service = createService();
      document.body.classList.add('night-theme');
      service.toggleDayNightMode();
      expect(document.body.classList.contains('night-theme')).toBe(false);
      expect(document.body.style.getPropertyValue('--kip-nightModeBrightness')).toBe('1');
      expect(document.body.style.getPropertyValue('--kip-nightModeFilters')).toBe('');
    });

    it('dims to the configured brightness with night filters in night mode', () => {
      const service = createService();
      service.isNightMode.set(true);
      service.toggleDayNightMode();
      expect(document.body.classList.contains('night-theme')).toBe(false);
      expect(document.body.style.getPropertyValue('--kip-nightModeBrightness')).toBe('0.27');
      expect(document.body.style.getPropertyValue('--kip-nightModeFilters')).toContain('sepia(0.5)');
    });

    it('keeps the light-theme class in night mode when the theme is light', () => {
      settings.themeName.set('light-theme');
      const service = createService();
      service.isNightMode.set(true);
      service.toggleDayNightMode();
      expect(document.body.classList.contains('light-theme')).toBe(true);
    });

    it('applies the red night theme at full brightness when red night mode is on', () => {
      settings.redNightMode.set(true);
      const service = createService();
      service.isNightMode.set(true);
      service.toggleDayNightMode();
      expect(document.body.classList.contains('night-theme')).toBe(true);
      expect(document.body.style.getPropertyValue('--kip-nightModeBrightness')).toBe('1');
      expect(document.body.style.getPropertyValue('--kip-nightModeFilters')).toBe('');
    });

    it('publishes a fresh theme color snapshot on each toggle', () => {
      const service = createService();
      const before = service.cssThemeColorRoles$.getValue();
      service.toggleDayNightMode();
      const after = service.cssThemeColorRoles$.getValue();
      expect(after).not.toBe(before);
      expect(service.cssThemeColors).toBe(after);
    });
  });

  describe('auto night mode from environment mode', () => {
    it('follows environment day/night transitions when auto night mode is on', () => {
      settings.autoNightMode.set(true);
      const service = createService();
      expect(service.isNightMode()).toBe(false);

      envMode$.next(modeUpdate('night'));
      TestBed.tick();
      expect(service.isNightMode()).toBe(true);
      expect(document.body.style.getPropertyValue('--kip-nightModeBrightness')).toBe('0.27');

      envMode$.next(modeUpdate('day'));
      TestBed.tick();
      expect(service.isNightMode()).toBe(false);
      expect(document.body.style.getPropertyValue('--kip-nightModeBrightness')).toBe('1');
    });

    it('ignores environment mode changes when auto night mode is off', () => {
      const service = createService();
      envMode$.next(modeUpdate('night'));
      TestBed.tick();
      expect(service.isNightMode()).toBe(false);
    });

    it('does not reapply styling when the same mode is emitted again', () => {
      settings.autoNightMode.set(true);
      const service = createService();
      const toggle = vi.spyOn(service, 'toggleDayNightMode');

      envMode$.next(modeUpdate('night'));
      TestBed.tick();
      expect(toggle).toHaveBeenCalledTimes(1);

      envMode$.next(modeUpdate('night'));
      TestBed.tick();
      expect(toggle).toHaveBeenCalledTimes(1);
    });

    // Enabling the setting while the environment is already night applies the
    // current mode immediately, without waiting for the next transition.
    it('applies the current night mode when auto night mode is enabled later', () => {
      const service = createService();
      envMode$.next(modeUpdate('night'));
      TestBed.tick();
      expect(service.isNightMode()).toBe(false);

      settings.autoNightMode.set(true);
      TestBed.tick();
      expect(service.isNightMode()).toBe(true);
      expect(document.body.style.getPropertyValue('--kip-nightModeBrightness')).toBe('0.27');
      expect(document.body.style.getPropertyValue('--kip-nightModeFilters')).toContain('sepia(0.5)');

      envMode$.next(modeUpdate('day'));
      TestBed.tick();
      envMode$.next(modeUpdate('night'));
      TestBed.tick();
      expect(service.isNightMode()).toBe(true);
    });
  });

  describe('red night mode setting', () => {
    it('reapplies styling whenever the red night mode setting changes', () => {
      const service = createService();
      service.isNightMode.set(true);

      settings.redNightMode.set(true);
      TestBed.tick();
      expect(document.body.classList.contains('night-theme')).toBe(true);

      settings.redNightMode.set(false);
      TestBed.tick();
      expect(document.body.classList.contains('night-theme')).toBe(false);
      expect(document.body.style.getPropertyValue('--kip-nightModeFilters')).toContain('sepia(0.5)');
    });
  });

  describe('browser detection', () => {
    it('detects Chrome with its major version', () => {
      setNavigator('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
      expect(createService().browserVersion()).toBe('Chrome 126');
    });

    it('detects Edge before Chrome when both tokens are present', () => {
      setNavigator('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.87');
      expect(createService().browserVersion()).toBe('Edge 126');
    });

    it('detects Chromium when its token is present', () => {
      setNavigator('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chromium/125.0.0.0 Chrome/125.0.0.0 Safari/537.36');
      expect(createService().browserVersion()).toBe('Chromium 125');
    });

    it('detects Firefox with its major version', () => {
      setNavigator('Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0');
      expect(createService().browserVersion()).toBe('Firefox 127');
    });

    it('detects Safari using the Version token', () => {
      setNavigator('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15');
      expect(createService().browserVersion()).toBe('Safari 17');
    });

    // Modern Opera UAs also contain 'Chrome', so the Chrome branch wins and
    // the Opera branch is unreachable for them.
    it('reports Opera as Chrome because the Chrome token matches first', () => {
      setNavigator('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0');
      expect(createService().browserVersion()).toBe('Chrome 120');
    });

    it('reports Unknown for an unrecognized user agent', () => {
      setNavigator('SomeBot/1.0');
      expect(createService().browserVersion()).toBe('Unknown');
    });
  });

  describe('OS detection', () => {
    it('detects macOS from the platform', () => {
      setNavigator('SomeBot/1.0', 'MacIntel');
      expect(createService().osVersion()).toBe('macOS');
    });

    it('detects Windows from the platform', () => {
      setNavigator('SomeBot/1.0', 'Win32');
      expect(createService().osVersion()).toBe('Windows');
    });

    it('detects generic Linux without ARM identifiers', () => {
      setNavigator('Mozilla/5.0 (X11; Linux x86_64)', 'Linux x86_64');
      expect(createService().osVersion()).toBe('Linux');
    });

    it('detects Raspberry Pi from an armv7l platform', () => {
      setNavigator('Mozilla/5.0 (X11; Linux armv7l)', 'Linux armv7l');
      expect(createService().osVersion()).toBe('Raspberry Pi');
    });

    it('detects Raspberry Pi from an aarch64 user agent', () => {
      setNavigator('Mozilla/5.0 (X11; Linux aarch64)', 'Linux');
      expect(createService().osVersion()).toBe('Raspberry Pi');
    });

    it('reports Unknown OS for an empty platform', () => {
      setNavigator('SomeBot/1.0', '');
      expect(createService().osVersion()).toBe('Unknown OS');
    });
  });
});
