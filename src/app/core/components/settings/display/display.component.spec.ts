import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY, Subject, of } from 'rxjs';
import { signal } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { ToastService } from '../../../services/toast.service';
import { AppService } from '../../../services/app-service';
import { SettingsService } from '../../../services/settings.service';
import { PluginConfigClientService } from '../../../services/plugin-config-client.service';

import { SettingsDisplayComponent } from './display.component';
import { MatSlideToggle } from '@angular/material/slide-toggle';

class BreakpointObserverMock {
    public observe() {
        return of({ matches: false, breakpoints: {} });
    }
}

class AppServiceMock {
    public isNightMode = signal(false);

    public setBrightness(): void { }
}

class ToastServiceMock {
    // Prompts resolve as "dismissed without action" (the user declined) unless a test pushes to
    // `action$` first. Without a live action stream the accept-the-prompt path is unreachable, and
    // with it the only route that ever stores autoNightMode = true.
    public readonly action$ = new Subject<void>();
    public show = vi.fn().mockReturnValue({
        onAction: () => this.action$,
        afterDismissed: () => of({ dismissedByAction: false })
    });

    /** Answer the next prompt with its action button instead of a dismissal. */
    public acceptNextPrompt(): void {
        this.show.mockReturnValueOnce({
            onAction: () => of(undefined),
            afterDismissed: () => EMPTY
        });
    }
}

class SettingsServiceMock {
    public getNightModeBrightness() { return 0.27; }
    public getAutoNightMode() { return false; }
    public getThemeName() { return ''; }
    public getRedNightMode() { return false; }
    public getIsRemoteControl() { return false; }
    public getInstanceName() { return ''; }
    public getBrowserTabTitle() { return 'Skip'; }
    public getKeepScreenAwake() { return true; }
    public getAutoRevealToolbar() { return true; }
    public setAutoNightMode(): void { }
    public setRedNightMode(): void { }
    public setNightModeBrightness(): void { }
    public setIsRemoteControl(): void { }
    public setInstanceName(): void { }
    public setThemeName(): void { }
    public setBrowserTabTitle(): void { }
    public setKeepScreenAwake(): void { }
    public setAutoRevealToolbar(): void { }
}

class PluginConfigClientServiceMock {
    public getPlugin = vi.fn().mockResolvedValue({
        ok: true,
        data: {
            id: 'derived-data',
            state: {
                enabled: false,
                configuration: { sun: false },
                enableLogging: false,
                enableDebug: false
            }
        }
    });
    public savePluginConfig = vi.fn().mockResolvedValue({ ok: true });
}

describe('SettingsNotificationsComponent', () => {
    let component: SettingsDisplayComponent;
    let fixture: ComponentFixture<SettingsDisplayComponent>;
    let toast: ToastServiceMock;

    const flushPromises = async (): Promise<void> => {
        await Promise.resolve();
        await Promise.resolve();
    };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [SettingsDisplayComponent],
            providers: [
                { provide: BreakpointObserver, useClass: BreakpointObserverMock },
                { provide: AppService, useClass: AppServiceMock },
                { provide: ToastService, useClass: ToastServiceMock },
                { provide: SettingsService, useClass: SettingsServiceMock },
                { provide: PluginConfigClientService, useClass: PluginConfigClientServiceMock }
            ]
        })
            .compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(SettingsDisplayComponent);
        component = fixture.componentInstance;
        toast = TestBed.inject(ToastService) as unknown as ToastServiceMock;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('maps a legacy empty stored theme to Dark in the picker', () => {
        // SettingsServiceMock.getThemeName() returns '' (legacy dark)
        expect(component['themeMode']()).toBe('dark-theme');
    });

    it('loads a stored system theme into the picker unchanged', () => {
        const settings = TestBed.inject(SettingsService) as unknown as SettingsServiceMock;
        vi.spyOn(settings, 'getThemeName').mockReturnValue('system');
        const fx = TestBed.createComponent(SettingsDisplayComponent);
        fx.detectChanges();
        expect(fx.componentInstance['themeMode']()).toBe('system');
    });

    it('loads a stored automatic-toolbar-reveal opt-out into the toggle (#495)', () => {
        // The stored value must differ from the model's own default, or the assertion passes with
        // the ngOnInit hydration deleted.
        const settings = TestBed.inject(SettingsService) as unknown as SettingsServiceMock;
        vi.spyOn(settings, 'getAutoRevealToolbar').mockReturnValue(false);
        const fx = TestBed.createComponent(SettingsDisplayComponent);
        fx.detectChanges();
        expect(fx.componentInstance['autoRevealToolbar']()).toBe(false);
    });

    it('saves the automatic-toolbar-reveal preference (#495)', async () => {
        const settings = TestBed.inject(SettingsService) as unknown as SettingsServiceMock;
        const setAutoRevealToolbar = vi.spyOn(settings, 'setAutoRevealToolbar');

        component['autoRevealToolbar'].set(false);
        component['saveAllSettings']();
        await flushPromises();
        await flushPromises();

        expect(setAutoRevealToolbar).toHaveBeenCalledWith(false);
    });

    it('saves the selected theme mode verbatim', async () => {
        const settings = TestBed.inject(SettingsService) as unknown as SettingsServiceMock;
        const setThemeName = vi.spyOn(settings, 'setThemeName');
        component['themeMode'].set('system');
        component['saveAllSettings']();
        await flushPromises();
        await flushPromises();
        expect(setThemeName).toHaveBeenCalledWith('system');
    });

    it('shows single warning prompt with Ok action when plugin is installed but not enabled/configured', async () => {
        // Toggle auto night mode on
        component['isAutoNightModeSupported']({ checked: true, source: {} as MatSlideToggle });
        expect(component['autoNightMode']()).toBe(true);

        // Trigger save which validates
        component['saveAllSettings']();
        await flushPromises();

        expect(toast.show).toHaveBeenCalledWith("To enable Automatic Night Mode, the Derived Data plugin must be enabled and the environment.sun path must be set to true. Do you wish to enable & and activate the path?", 0, false, 'warn', 'Ok');
    });

    it('shows prompt for enabling plugin only when plugin is disabled but sun flag is true', async () => {
        const pluginService = TestBed.inject(PluginConfigClientService) as unknown as PluginConfigClientServiceMock;
        pluginService.getPlugin.mockResolvedValue({
            ok: true,
            data: {
                id: 'derived-data',
                state: {
                    enabled: false,
                    configuration: { sun: true },
                    enableLogging: false,
                    enableDebug: false
                }
            }
        });

        // Toggle auto night mode on
        component['isAutoNightModeSupported']({ checked: true, source: {} as MatSlideToggle });
        expect(component['autoNightMode']()).toBe(true);

        // Trigger save which validates
        component['saveAllSettings']();
        await flushPromises();

        expect(toast.show).toHaveBeenCalledWith("To enable Automatic Night Mode, the Derived Data plugin must be enabled. Do you wish to enable the plugin?", 0, false, 'warn', 'Ok');
    });

    it('shows the success toast when saving with automatic night mode off', async () => {
        // Auto night mode is off -> straight to applyAndSaveSettings (pure local settings write).
        component['saveAllSettings']();
        await flushPromises();
        await flushPromises();

        expect(toast.show).toHaveBeenCalledWith('Configuration saved', 1000, true, 'message');
    });

    describe('a refused automatic-night-mode request (#498)', () => {
        // The plugin is absent, so the dependency check fails outright.
        function withMissingPlugin(): void {
            const pluginService = TestBed.inject(PluginConfigClientService) as unknown as PluginConfigClientServiceMock;
            pluginService.getPlugin.mockResolvedValue({
                ok: false,
                error: { reason: 'not-found', message: 'Plugin derived-data not found' }
            });
        }

        async function saveWithNightModeRequested(): Promise<void> {
            component['isAutoNightModeSupported']({ checked: true, source: {} as MatSlideToggle });
            component['saveAllSettings']();
            await flushPromises();
            await flushPromises();
        }

        it('still persists the settings the check has no bearing on', async () => {
            withMissingPlugin();
            const settings = TestBed.inject(SettingsService) as unknown as SettingsServiceMock;
            const setThemeName = vi.spyOn(settings, 'setThemeName');
            const setBrowserTabTitle = vi.spyOn(settings, 'setBrowserTabTitle');
            component['themeMode'].set('system');
            component['browserTabTitle'].set('Helm');

            await saveWithNightModeRequested();

            expect(setThemeName).toHaveBeenCalledWith('system');
            expect(setBrowserTabTitle).toHaveBeenCalledWith('Helm');
        });

        it('writes back the stored night mode rather than the refused request', async () => {
            withMissingPlugin();
            const settings = TestBed.inject(SettingsService) as unknown as SettingsServiceMock;
            const setAutoNightMode = vi.spyOn(settings, 'setAutoNightMode');
            const setRedNightMode = vi.spyOn(settings, 'setRedNightMode');

            await saveWithNightModeRequested();

            expect(setRedNightMode).toHaveBeenCalled(); // the save ran at all
            expect(setAutoNightMode).toHaveBeenCalledWith(false); // stored value, not the request
            expect(component['autoNightMode']()).toBe(false);
        });

        it('keeps a working night-mode setup on through a transient plugin-API failure', async () => {
            // The scenario the refusal path exists for: night mode is already on and stored, and
            // the check fails for a reason that says nothing about the requirement being unmet.
            const settings = TestBed.inject(SettingsService) as unknown as SettingsServiceMock;
            vi.spyOn(settings, 'getAutoNightMode').mockReturnValue(true);
            const pluginService = TestBed.inject(PluginConfigClientService) as unknown as PluginConfigClientServiceMock;
            pluginService.getPlugin.mockResolvedValue({
                ok: false,
                error: { reason: 'server-error', message: 'upstream timeout' }
            });
            const fx = TestBed.createComponent(SettingsDisplayComponent);
            fx.detectChanges();
            const setAutoNightMode = vi.spyOn(settings, 'setAutoNightMode');

            fx.componentInstance['saveAllSettings']();
            await flushPromises();
            await flushPromises();

            // Neither this save nor the next one may turn it off: the toggle still agrees with the
            // store, so a following save re-runs the check instead of writing an off state.
            expect(setAutoNightMode).toHaveBeenCalledWith(true);
            expect(setAutoNightMode).not.toHaveBeenCalledWith(false);
            expect(fx.componentInstance['autoNightMode']()).toBe(true);
        });

        it('leaves the refusal on screen instead of replacing it with a success toast', async () => {
            withMissingPlugin();
            const settings = TestBed.inject(SettingsService) as unknown as SettingsServiceMock;
            const setThemeName = vi.spyOn(settings, 'setThemeName');

            await saveWithNightModeRequested();

            expect(setThemeName).toHaveBeenCalled(); // the save ran at all
            // MatSnackBar shows one at a time, so a success toast would dismiss the persistent
            // explanation of what was refused and then vanish on its own timer.
            expect(toast.show).toHaveBeenCalledWith(expect.stringContaining('Derived Data'), 0, false, 'error');
            expect(toast.show).not.toHaveBeenCalledWith('Configuration saved', 1000, true, 'message');
        });

        it('persists the unrelated settings when the user declines the enable prompt', async () => {
            // Plugin present but not configured -> prompt; the toast mock reports a dismissal
            // without action, so the request is declined rather than failed.
            const settings = TestBed.inject(SettingsService) as unknown as SettingsServiceMock;
            const setThemeName = vi.spyOn(settings, 'setThemeName');
            component['themeMode'].set('system');

            await saveWithNightModeRequested();

            expect(setThemeName).toHaveBeenCalledWith('system');
        });

        it('confirms the save when the prompt was merely declined, since nothing else is on screen', async () => {
            // Declining closes the prompt snackbar, so unlike a failure there is no persistent
            // message left to protect — suppressing the confirmation would leave no feedback at all.
            await saveWithNightModeRequested();

            expect(toast.show).toHaveBeenCalledWith('Configuration saved', 1000, true, 'message');
        });
    });

    describe('an accepted automatic-night-mode prompt', () => {
        it('stores night mode on once the plugin has been enabled and configured', async () => {
            toast.acceptNextPrompt();
            const settings = TestBed.inject(SettingsService) as unknown as SettingsServiceMock;
            const pluginService = TestBed.inject(PluginConfigClientService) as unknown as PluginConfigClientServiceMock;
            const setAutoNightMode = vi.spyOn(settings, 'setAutoNightMode');

            component['isAutoNightModeSupported']({ checked: true, source: {} as MatSlideToggle });
            component['saveAllSettings']();
            await flushPromises();
            await flushPromises();

            expect(pluginService.savePluginConfig).toHaveBeenCalledWith('derived-data', {
                configuration: { sun: true },
                enabled: true
            });
            expect(setAutoNightMode).toHaveBeenCalledWith(true);
        });

        it('holds night mode back, but still saves the rest, when enabling the plugin fails', async () => {
            toast.acceptNextPrompt();
            const settings = TestBed.inject(SettingsService) as unknown as SettingsServiceMock;
            const pluginService = TestBed.inject(PluginConfigClientService) as unknown as PluginConfigClientServiceMock;
            pluginService.savePluginConfig.mockResolvedValue({
                ok: false,
                error: { reason: 'server-error', message: 'write rejected' }
            });
            const setAutoNightMode = vi.spyOn(settings, 'setAutoNightMode');
            const setBrowserTabTitle = vi.spyOn(settings, 'setBrowserTabTitle');
            component['browserTabTitle'].set('Helm');

            component['isAutoNightModeSupported']({ checked: true, source: {} as MatSlideToggle });
            component['saveAllSettings']();
            await flushPromises();
            await flushPromises();

            expect(setBrowserTabTitle).toHaveBeenCalledWith('Helm');
            expect(setAutoNightMode).toHaveBeenCalledWith(false);
            expect(toast.show).not.toHaveBeenCalledWith('Configuration saved', 1000, true, 'message');
        });
    });

    it('shows prompt for configuring sun flag only when plugin is enabled but sun flag is false', async () => {
        const pluginService = TestBed.inject(PluginConfigClientService) as unknown as PluginConfigClientServiceMock;
        pluginService.getPlugin.mockResolvedValue({
            ok: true,
            data: {
                id: 'derived-data',
                state: {
                    enabled: true,
                    configuration: { sun: false },
                    enableLogging: false,
                    enableDebug: false
                }
            }
        });

        // Toggle auto night mode on
        component['isAutoNightModeSupported']({ checked: true, source: {} as MatSlideToggle });
        expect(component['autoNightMode']()).toBe(true);

        // Trigger save which validates
        component['saveAllSettings']();
        await flushPromises();

        expect(toast.show).toHaveBeenCalledWith("To enable Automatic Night Mode, the environment.sun path in the Derived Data plugin must be activated. Do you wish to activate the path?", 0, false, 'warn', 'Ok');
    });
});
