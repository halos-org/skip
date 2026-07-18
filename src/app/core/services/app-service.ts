import { effect, inject, Injectable, signal, untracked } from '@angular/core';
import { MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import { BehaviorSubject } from 'rxjs';
import { SettingsService } from './settings.service';
import { DataService } from './data.service';
import { toSignal } from '@angular/core/rxjs-interop';
import packageInfo from '../../../../package.json';

/**
 * Skip theme hex colors
 *
 * @export
 * @interface ITheme
 */
export interface ITheme {
  blue: string,
  blueDim: string,
  blueDimmer: string,
  green: string,
  greenDim: string,
  greenDimmer: string,
  purple: string,
  purpleDim: string,
  purpleDimmer: string,
  yellow: string,
  yellowDim: string,
  yellowDimmer: string,
  pink: string,
  pinkDim: string,
  pinkDimmer: string,
  orange: string,
  orangeDim: string,
  orangeDimmer: string,
  contrast: string,
  contrastDim: string,
  contrastDimmer: string,
  grey: string,
  greyDim: string,
  greyDimmer: string,
  port: string,
  starboard: string,
  zoneNominal: string,
  zoneAlert: string,
  zoneWarn: string,
  zoneAlarm: string,
  zoneEmergency: string,
  background: string,
  cardColor: string,
}

@Injectable({
  providedIn: 'root'
})
export class AppService {
  private readonly MODE_PATH: string = 'self.environment.mode';
  public readonly configurableThemeColors: {label: string, value: string}[] = [
    {label: "Contrast", value: "contrast"},
    {label: "Blue", value: "blue"},
    {label: "Green", value: "green"},
    {label: "Orange", value: "orange"},
    {label: "Yellow", value: "yellow"},
    {label: "Pink", value: "pink"},
    {label: "Purple", value: "purple"},
    {label: "Grey", value: "grey"}
  ];
  public readonly cssThemeColorRoles$ = new BehaviorSubject<ITheme|null>(null);
  private _cssThemeColorRoles: ITheme;
  private readonly _settings = inject(SettingsService);
  private readonly _data = inject(DataService);
  private readonly _iconRegistry = inject(MatIconRegistry);
  private readonly _sanitizer = inject(DomSanitizer);
  public isNightMode = signal<boolean>(false);
  private _useAutoNightMode = this._settings.autoNightMode;
  private _theme = this._settings.themeName;
  private _redNightMode = this._settings.redNightMode;
  private _environmentMode = toSignal(this._data.subscribePath(this.MODE_PATH, 'default'));

  private previousEnvironmentMode: string | null = null;
  private previousUseAutoNightMode = false;

  public readonly appVersion = signal<string>(packageInfo.version);
  public readonly browserVersion = signal<string>('Unknown');
  public readonly osVersion = signal<string>('Unknown');

  constructor() {
    // Register SVG icon set globally (only once)
    this._iconRegistry.addSvgIconSet(
      this._sanitizer.bypassSecurityTrustResourceUrl('assets/svg/icons.svg')
    );

    effect(() => {
      if (this._theme() === 'light-theme') {
        document.body.classList.toggle('light-theme', this._theme() === 'light-theme');
      } else {
        // Remove the light theme class if it exists
        document.body.classList.remove('light-theme');
      }
    });

    effect(() => {
      const environmentMode = this._environmentMode();
      const useAutoNightMode = this._useAutoNightMode();

      untracked(() => {
        if (!environmentMode) return;
        const mode = environmentMode.data.value;
        const modeChanged = this.previousEnvironmentMode !== mode;
        const autoNightModeJustEnabled = useAutoNightMode && !this.previousUseAutoNightMode;

        this.previousEnvironmentMode = mode;
        this.previousUseAutoNightMode = useAutoNightMode;

        if (!useAutoNightMode) return;
        if (!modeChanged && !autoNightModeJustEnabled) return;

        this.isNightMode.set(mode === "night");
        this.toggleDayNightMode();
      });
    });

    effect(() => {
      this._redNightMode();

      untracked(() => {
        this.toggleDayNightMode();
      });
    });

    this._cssThemeColorRoles = this.readThemeCssRoleVariables();

    this.browserVersion.set(this.getBrowserVersion());
    this.osVersion.set(this.getOSVersion());

    console.log("*********** Skip Version Information ***********");
    console.log(`** App Version: ${this.appVersion()}`);
    console.log(`** Browser Version: ${this.browserVersion()}`);
    console.log(`** OS Version: ${this.osVersion()}`);
    console.log("***********************************************");
  }

  private readThemeCssRoleVariables(): ITheme {
    const root = document.body;
    const computedStyle = getComputedStyle(root);
    const cssThemeRolesColor: ITheme = {
      background: computedStyle.getPropertyValue('--mat-sys-background').trim(),
      cardColor: computedStyle.getPropertyValue('--skip-widget-card-background-color').trim(),
      blue: computedStyle.getPropertyValue('--skip-blue-color').trim(),
      blueDim: computedStyle.getPropertyValue('--skip-blue-dim-color').trim(),
      blueDimmer: computedStyle.getPropertyValue('--skip-blue-dimmer-color').trim(),
      green: computedStyle.getPropertyValue('--skip-green-color').trim(),
      greenDim: computedStyle.getPropertyValue('--skip-green-dim-color').trim(),
      greenDimmer: computedStyle.getPropertyValue('--skip-green-dimmer-color').trim(),
      grey: computedStyle.getPropertyValue('--skip-grey-color').trim(),
      greyDim: computedStyle.getPropertyValue('--skip-grey-dim-color').trim(),
      greyDimmer: computedStyle.getPropertyValue('--skip-grey-dimmer-color').trim(),
      orange: computedStyle.getPropertyValue('--skip-orange-color').trim(),
      orangeDim: computedStyle.getPropertyValue('--skip-orange-dim-color').trim(),
      orangeDimmer: computedStyle.getPropertyValue('--skip-orange-dimmer-color').trim(),
      pink: computedStyle.getPropertyValue('--skip-pink-color').trim(),
      pinkDim: computedStyle.getPropertyValue('--skip-pink-dim-color').trim(),
      pinkDimmer: computedStyle.getPropertyValue('--skip-pink-dimmer-color').trim(),
      purple: computedStyle.getPropertyValue('--skip-purple-color').trim(),
      purpleDim: computedStyle.getPropertyValue('--skip-purple-dim-color').trim(),
      purpleDimmer: computedStyle.getPropertyValue('--skip-purple-dimmer-color').trim(),
      contrast: computedStyle.getPropertyValue('--skip-contrast-color').trim(),
      contrastDim: computedStyle.getPropertyValue('--skip-contrast-dim-color').trim(),
      contrastDimmer: computedStyle.getPropertyValue('--skip-contrast-dimmer-color').trim(),
      yellow: computedStyle.getPropertyValue('--skip-yellow-color').trim(),
      yellowDim: computedStyle.getPropertyValue('--skip-yellow-dim-color').trim(),
      yellowDimmer: computedStyle.getPropertyValue('--skip-yellow-dimmer-color').trim(),
      port: computedStyle.getPropertyValue('--skip-port-color').trim(),
      starboard: computedStyle.getPropertyValue('--skip-starboard-color').trim(),
      zoneNominal: computedStyle.getPropertyValue('--skip-zone-nominal-color').trim(),
      zoneAlert: computedStyle.getPropertyValue('--skip-zone-alert-color').trim(),
      zoneWarn: computedStyle.getPropertyValue('--skip-zone-warn-color').trim(),
      zoneAlarm: computedStyle.getPropertyValue('--skip-zone-alarm-color').trim(),
      zoneEmergency: computedStyle.getPropertyValue('--skip-zone-emergency-color').trim(),
    };
    this.cssThemeColorRoles$.next(cssThemeRolesColor);
    return cssThemeRolesColor;
  }

  public get cssThemeColors() : ITheme {
    return this._cssThemeColorRoles;
  }

  public setBrightness(brightness: number, applyNightFilters = false): void {
    const appFilterWrapper = document.body;

    // Set the brightness level
    appFilterWrapper.style.setProperty('--skip-nightModeBrightness', `${brightness}`);

    // Apply sepia and hue-rotate filters if night mode is active
    const additionalFilters = applyNightFilters ? ' sepia(0.5) hue-rotate(-30deg)' : '';
    appFilterWrapper.style.setProperty('--skip-nightModeFilters', additionalFilters);
  }

  public toggleNightMode(): void {
    this.isNightMode.set(!this.isNightMode());
    this.toggleDayNightMode();
  }

  public toggleDayNightMode(): void {
    if (this.isNightMode()) {
      if (this._redNightMode()) {
        document.body.classList.toggle('night-theme', true);
        this.setBrightness(1, false);
      } else {
        this.setBrightness(this._settings.getNightModeBrightness(), true);
        document.body.classList.remove('night-theme');
        if (this._theme() === 'light-theme') {
          document.body.classList.toggle('light-theme', this._theme() === 'light-theme');
        } else {
          document.body.classList.remove('light-theme');
        }
      }

    } else {
      document.body.classList.remove('night-theme');
      if (this._theme() === 'light-theme') {
        document.body.classList.toggle('light-theme', this._theme() === 'light-theme');
      }
      this.setBrightness(1, false);
    }
    this._cssThemeColorRoles = this.readThemeCssRoleVariables();
  }

  /**
   * Helper method to get the browser version.
   */
  private getBrowserVersion(): string {
    const userAgent = navigator.userAgent;
    let browser = 'Unknown';

    if (userAgent.includes('Edg')) {
      browser = `Edge ${userAgent.match(/Edg\/(\d+)/)?.[1]}`;
    } else if (userAgent.includes('Chrome') && !userAgent.includes('Edg') && !userAgent.includes('Chromium')) {
      browser = `Chrome ${userAgent.match(/Chrome\/(\d+)/)?.[1]}`;
    } else if (userAgent.includes('Chromium')) {
      browser = `Chromium ${userAgent.match(/Chromium\/(\d+)/)?.[1]}`;
    } else if (userAgent.includes('Firefox')) {
      browser = `Firefox ${userAgent.match(/Firefox\/(\d+)/)?.[1]}`;
    } else if (userAgent.includes('Safari') && !userAgent.includes('Chrome') && !userAgent.includes('Chromium')) {
      browser = `Safari ${userAgent.match(/Version\/(\d+)/)?.[1]}`;
    } else if (userAgent.includes('Opera') || userAgent.includes('OPR')) {
      browser = `Opera ${userAgent.match(/(Opera|OPR)\/(\d+)/)?.[2]}`;
    }

    return browser;
  }

  /**
   * Helper method to get the OS version.
   */
  private getOSVersion(): string {
    const platform = navigator.platform;
    const userAgent = navigator.userAgent;

    if (platform.startsWith('Mac')) {
      return 'macOS';
    } else if (platform.startsWith('Win')) {
      return 'Windows';
    } else if (/Linux/.test(platform)) {
      // Check for Raspberry Pi identifiers in the userAgent or platform
      if (
        userAgent.includes('ARM') ||
        userAgent.includes('aarch64') ||
        userAgent.includes('Raspberry') ||
        platform.includes('armv7l') ||
        platform.includes('armv8l')
      ) {
        return 'Raspberry Pi';
      }
      return 'Linux';
    } else {
      return 'Unknown OS';
    }
  }
}
