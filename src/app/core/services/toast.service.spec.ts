import { TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { MatSnackBar, MatSnackBarRef } from '@angular/material/snack-bar';

import { ToastService } from './toast.service';
import { SettingsService } from './settings.service';
import { SoundService } from './sound.service';
import { ToastSnackbarComponent } from '../components/toast-snackbar/toast-snackbar.component';

class MatSnackBarMock {
    public openFromComponent = vi.fn().mockImplementation(() => ({
        onAction: () => new BehaviorSubject<void>(undefined).asObservable()
    } as unknown as MatSnackBarRef<ToastSnackbarComponent>));
}

describe('ToastService', () => {
    let service: ToastService;
    let snackBar: MatSnackBarMock;
    let sound: { playOnce: ReturnType<typeof vi.fn> };
    let config: WritableSignal<{ sound: { disableSound: boolean } }>;

    beforeEach(() => {
        config = signal({ sound: { disableSound: false } });
        sound = { playOnce: vi.fn() };
        TestBed.configureTestingModule({
            providers: [
                ToastService,
                { provide: MatSnackBar, useClass: MatSnackBarMock },
                { provide: SettingsService, useValue: { notificationConfig: config } },
                { provide: SoundService, useValue: sound }
            ]
        });
        service = TestBed.inject(ToastService);
        snackBar = TestBed.inject(MatSnackBar) as unknown as MatSnackBarMock;
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('show passes action into snackbar data and returns MatSnackBarRef', () => {
        const ref = service.show('Plugin disabled', 0, true, 'warn', 'Enable Plugin');

        expect(snackBar.openFromComponent).toHaveBeenCalled();
        const openArgs = vi.mocked(snackBar.openFromComponent).mock.lastCall!;
        expect(openArgs[0]).toBe(ToastSnackbarComponent);
        expect(openArgs[1].data.action).toBe('Enable Plugin');
        expect(openArgs[1].data.message).toBe('Plugin disabled');
        expect(ref).toBeTruthy();
    });

    it('show updates lastSnack including action', () => {
        service.show('Plugin disabled', 0, true, 'warn', 'Enable Plugin');

        const lastSnack = service.lastSnack();
        expect(lastSnack).toBeTruthy();
        expect(lastSnack?.action).toBe('Enable Plugin');
        expect(lastSnack?.severity).toBe('warn');
    });

    it('plays the notification sound once when not silent and sound is enabled', () => {
        service.show('Anchor dragging', 5000, false, 'warn');
        expect(sound.playOnce).toHaveBeenCalledWith('notification', 0.3);
    });

    it('does not play sound when silent', () => {
        service.show('Saved', 1000, true);
        expect(sound.playOnce).not.toHaveBeenCalled();
    });

    it('does not play sound when sound is disabled', () => {
        config.set({ sound: { disableSound: true } });
        service.show('Anchor dragging', 5000, false, 'warn');
        expect(sound.playOnce).not.toHaveBeenCalled();
    });
});
