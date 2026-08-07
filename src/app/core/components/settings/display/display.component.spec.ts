import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY, of } from 'rxjs';
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
    public show = vi.fn().mockReturnValue({
        onAction: () => EMPTY,
        afterDismissed: () => of({ dismissedByAction: false })
    });
}

class SettingsServiceMock {
    public getNightModeBrightness() { return 0.27; }
    public getAutoNightMode() { return false; }
    public getThemeName() { return ''; }
    public getRedNightMode() { return false; }
    public getIsRemoteControl() { return false; }
    public getInstanceName() { return ''; }
    public getBrowserTabTitle() { return 'Skip'; }
    public getDisablePathValidation() { return false; }
    public getKeepScreenAwake() { return true; }
    public getAutoRevealToolbar() { return true; }
    public setAutoNightMode(): void { }
    public setRedNightMode(): void { }
    public setNightModeBrightness(): void { }
    public setIsRemoteControl(): void { }
    public setInstanceName(): void { }
    public setThemeName(): void { }
    public setBrowserTabTitle(): void { }
    public setDisablePathValidation(): void { }
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

        it('leaves the stored automatic night mode untouched rather than writing the reset toggle', async () => {
            withMissingPlugin();
            const settings = TestBed.inject(SettingsService) as unknown as SettingsServiceMock;
            const setAutoNightMode = vi.spyOn(settings, 'setAutoNightMode');

            await saveWithNightModeRequested();

            expect(setAutoNightMode).not.toHaveBeenCalled();
            expect(component['autoNightMode']()).toBe(false);
        });

        it('leaves the refusal on screen instead of replacing it with a success toast', async () => {
            withMissingPlugin();

            await saveWithNightModeRequested();

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
