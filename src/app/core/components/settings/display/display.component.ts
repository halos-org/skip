import { Component, DestroyRef, inject, OnInit, viewChild, signal, Signal, model } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { BreakpointObserver, Breakpoints, BreakpointState } from '@angular/cdk/layout';
import { AppService } from '../../../services/app-service';
import { ToastService } from '../../../services/toast.service';
import { SettingsService } from '../../../services/settings.service';
import { uiEventService } from '../../../services/uiEvent.service';
import { AuthenticationService } from '../../../services/authentication.service';
import { PluginConfigClientService } from '../../../services/plugin-config-client.service';
import { IPluginApiFailure, ISignalkPlugin } from '../../../interfaces/signalk-plugin-config.interfaces';
import { FormsModule, NgForm } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatSliderModule } from '@angular/material/slider';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule, MatSlideToggleChange } from '@angular/material/slide-toggle';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { ThemeMode, THEME_MODES } from '../../../constants/themes.const';

/**
 * What the Automatic Night Mode dependency check concluded. The two refusals differ only in what
 * the user can already see: 'explained' left a persistent snackbar on screen, 'declined' means the
 * user dismissed the prompt and nothing is showing.
 */
type AutoNightOutcome = 'granted' | 'explained' | 'declined';


@Component({
    selector: 'settings-display',
    templateUrl: './display.component.html',
    styleUrls: ['./display.component.scss'],
    imports: [
        FormsModule,
        MatDividerModule,
        MatButtonModule,
        MatSliderModule,
        MatExpansionModule,
        MatInputModule,
        MatSlideToggleModule,
        MatButtonToggleModule
    ],
})
export class SettingsDisplayComponent implements OnInit {
  private readonly DERIVED_DATA_PLUGIN_ID = 'derived-data';
  protected readonly themeModes = THEME_MODES;
  private readonly displayForm = viewChild<NgForm>('displayForm');
  private readonly app = inject(AppService);
  private readonly toast = inject(ToastService);
  private readonly settings = inject(SettingsService);
  protected readonly uiEvent = inject(uiEventService);
  private readonly responsive = inject(BreakpointObserver);
  private readonly pluginConfig = inject(PluginConfigClientService);
  private readonly auth = inject(AuthenticationService);
  private readonly destroyRef = inject(DestroyRef);
  protected isPhonePortrait: Signal<BreakpointState>;
  protected nightBrightness = signal<number>(0.27);
  protected autoNightMode = model<boolean>(false);
  protected isRedNightMode = model<boolean>(false);
  protected themeMode = model<ThemeMode>('dark-theme');
  protected isRemoteControl = model<boolean>(false);
  protected instanceName = model<string>('');
  protected browserTabTitle = model<string>('Skip');
  protected keepScreenAwake = model<boolean>(true);
  protected autoRevealToolbar = model<boolean>(true);
  // Guards concurrent plugin enable checks to avoid stale promise handlers mutating state
  private _pluginCheckSeq = 0;

  constructor() {
    this.isPhonePortrait = toSignal(this.responsive.observe(Breakpoints.HandsetPortrait), { initialValue: { matches: false, breakpoints: {} } });
  }

  ngOnInit() {
    this.nightBrightness.set(this.settings.getNightModeBrightness());
    this.autoNightMode.set(this.settings.getAutoNightMode());
    const storedTheme = this.settings.getThemeName();
    this.themeMode.set(storedTheme === 'light-theme' || storedTheme === 'system' ? storedTheme : 'dark-theme');
    this.isRedNightMode.set(this.settings.getRedNightMode());
    this.isRemoteControl.set(this.settings.getIsRemoteControl());
    this.instanceName.set(this.settings.getInstanceName());
    this.browserTabTitle.set(this.settings.getBrowserTabTitle());
    this.keepScreenAwake.set(this.settings.getKeepScreenAwake());
    this.autoRevealToolbar.set(this.settings.getAutoRevealToolbar());
  }

  protected saveAllSettings():void {
    const form = this.displayForm();
    if (!form || form.invalid) {
      form?.form.markAllAsTouched();
      this.toast.show('Please fill out required fields before saving.', 3000, true);
      return;
    }

    // Any save supersedes a check still in flight, whether or not it starts one of its own —
    // otherwise a stale check resolves later and writes this form's state a second time.
    const seq = ++this._pluginCheckSeq;

    // If auto night mode is enabled, validate plugin requirements before saving
    if (this.autoNightMode()) {
      void this.validateAndSaveSettings(seq);
      return;
    }

    this.applyAndSaveSettings();
  }

  /**
   * @param announce Whether to confirm the save. Suppressed when a persistent snackbar is already
   * explaining what was turned down: MatSnackBar shows one at a time, so the confirmation would
   * dismiss the explanation and then vanish on its own timer.
   */
  private applyAndSaveSettings(announce = true): void {
    this.settings.setAutoNightMode(this.autoNightMode());
    this.settings.setRedNightMode(this.isRedNightMode());
    this.settings.setNightModeBrightness(this.nightBrightness());
    this.settings.setIsRemoteControl(this.isRemoteControl());
    if (this.isRemoteControl()) {
      this.settings.setInstanceName(this.instanceName());
    } else {
      // If remote control is disabled, reset instance name
      this.settings.setInstanceName('');
    }

    if (!this.app.isNightMode()) {
      this.app.setBrightness(1);
    }
    this.settings.setThemeName(this.themeMode());
    this.settings.setBrowserTabTitle(this.browserTabTitle());
    this.settings.setKeepScreenAwake(this.keepScreenAwake());
    this.settings.setAutoRevealToolbar(this.autoRevealToolbar());
    this.displayForm()?.form.markAsPristine();
    if (announce) {
      this.toast.show("Configuration saved", 1000, true, 'message');
    }
  }

  private async validateAndSaveSettings(seq: number): Promise<void> {
    const outcome = await this.validateAndHandleAutoNightRequirement(seq);
    if (seq !== this._pluginCheckSeq) return;

    if (outcome !== 'granted') {
      // Show what is stored, not the request that was turned down. Forcing the toggle off instead
      // would put the form, the stored config and AppService's live night-mode effect into three
      // different states, and the next save — which skips the check entirely once the toggle reads
      // off — would write that off state anyway.
      this.autoNightMode.set(this.settings.getAutoNightMode());
    }
    this.applyAndSaveSettings(outcome !== 'explained');
  }

  protected isAutoNightModeSupported(e: MatSlideToggleChange): void {
    this.displayForm()?.form.markAsDirty();
    this.autoNightMode.set(e.checked);
  }

  private async validateAndHandleAutoNightRequirement(seq: number): Promise<AutoNightOutcome> {
    const pluginResult = await this.pluginConfig.getPlugin(this.DERIVED_DATA_PLUGIN_ID);
    if (seq !== this._pluginCheckSeq) return 'declined';

    if (!pluginResult.ok) {
      const pluginFailure = pluginResult as IPluginApiFailure;
      if (pluginFailure.error.reason === 'not-found') {
        this.toast.show(
          'Automatic Night Mode requires the Signal K Derived Data plugin. This requirement is missing and must be installed manually by the user.',
          0,
          false,
          'error'
        );
        return 'explained';
      }

      this.toast.show(
        `Failed to validate Automatic Night Mode requirements: ${pluginFailure.error.message}`,
        0,
        false,
        'error'
      );
      return 'explained';
    }

    const plugin = pluginResult.data;
    const sunFlagPath = this.resolveEnvironmentSunFlagPath(plugin.state.configuration);
    const isSunFlagEnabled = this.readBooleanByPath(plugin.state.configuration, sunFlagPath) === true;

    if (plugin.state.enabled && isSunFlagEnabled) {
      return 'granted';
    }

    // Build precise message based on what needs to be changed
    const needsEnable = !plugin.state.enabled;
    const needsSunFlag = !isSunFlagEnabled;
    let message: string;

    if (needsEnable && needsSunFlag) {
      message = "To enable Automatic Night Mode, the Derived Data plugin must be enabled and the environment.sun path must be set to true. Do you wish to enable & and activate the path?";
    } else if (needsEnable) {
      message = "To enable Automatic Night Mode, the Derived Data plugin must be enabled. Do you wish to enable the plugin?";
    } else {
      message = "To enable Automatic Night Mode, the environment.sun path in the Derived Data plugin must be activated. Do you wish to activate the path?";
    }

    return new Promise<AutoNightOutcome>((resolve) => {
      const promptRef = this.toast.show(message, 0, false, 'warn', 'Ok');

      // Tied to the component: leaving /settings with the prompt open must not resolve later and
      // write a destroyed form's state over whatever the user has saved since.
      promptRef.onAction()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => {
          void this.enableAndConfigureAutoNight(plugin, sunFlagPath, seq, resolve);
        });

      promptRef.afterDismissed()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((dismissal) => {
          if (!dismissal.dismissedByAction) {
            resolve('declined');
          }
        });
    });
  }

  private async enableAndConfigureAutoNight(plugin: ISignalkPlugin, sunFlagPath: string[], seq: number, resolve: (value: AutoNightOutcome) => void): Promise<void> {
    // Enabling the plugin is a server-side write the Signal K server admin-gates. A session that
    // cannot write configuration would get a 403 reported as a save failure, so decline up front.
    if (!this.auth.canWriteUserData()) {
      this.toast.show('Automatic night mode needs the Derived Data plugin enabled, which requires signing in as an administrator.', 4000, true, 'warn');
      resolve('declined');
      return;
    }
    const nextConfiguration = this.cloneConfig(plugin.state.configuration);
    this.writeBooleanByPath(nextConfiguration, sunFlagPath, true);

    const saveResult = await this.pluginConfig.savePluginConfig(plugin.id, {
      configuration: nextConfiguration,
      enabled: true
    });

    if (seq !== this._pluginCheckSeq) {
      resolve('declined');
      return;
    }

    if (!saveResult.ok) {
      const saveFailure = saveResult as IPluginApiFailure;
      this.toast.show(
        `Failed to enable and configure Derived Data plugin: ${saveFailure.error.message}`,
        0,
        false,
        'error'
      );
      resolve('explained');
      return;
    }

    this.toast.show('Automatic Night Mode dependency enabled and configured.', 3000, true, 'success');
    resolve('granted');
  }

  private resolveEnvironmentSunFlagPath(configuration: Record<string, unknown>): string[] {
    const detectedPath = this.findBooleanSunPath(configuration);
    return detectedPath ?? ['sun'];
  }

  private findBooleanSunPath(obj: Record<string, unknown>, pathPrefix: string[] = []): string[] | null {
    const exactSunBoolean = Object.entries(obj).find(([key, value]) => key.toLowerCase() === 'sun' && typeof value === 'boolean');
    if (exactSunBoolean) {
      return [...pathPrefix, exactSunBoolean[0]];
    }

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'boolean' && key.toLowerCase().includes('sun')) {
        return [...pathPrefix, key];
      }

      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const nested = this.findBooleanSunPath(value as Record<string, unknown>, [...pathPrefix, key]);
        if (nested) {
          return nested;
        }
      }
    }

    return null;
  }

  private readBooleanByPath(obj: Record<string, unknown>, path: string[]): boolean | null {
    let current: unknown = obj;
    for (const segment of path) {
      if (!current || typeof current !== 'object' || Array.isArray(current)) {
        return null;
      }
      current = (current as Record<string, unknown>)[segment];
    }
    return typeof current === 'boolean' ? current : null;
  }

  private writeBooleanByPath(obj: Record<string, unknown>, path: string[], value: boolean): void {
    if (path.length === 0) return;

    let current: Record<string, unknown> = obj;
    for (let index = 0; index < path.length - 1; index++) {
      const key = path[index];
      const next = current[key];
      if (!next || typeof next !== 'object' || Array.isArray(next)) {
        current[key] = {};
      }
      current = current[key] as Record<string, unknown>;
    }
    current[path[path.length - 1]] = value;
  }

  private cloneConfig(configuration: Record<string, unknown>): Record<string, unknown> {
    return JSON.parse(JSON.stringify(configuration || {})) as Record<string, unknown>;
  }

  protected setBrightness(value: number): void {
    this.displayForm()?.form.markAsDirty();
    this.nightBrightness.set(value);
    this.app.setBrightness(value, this.app.isNightMode());
  }
}
