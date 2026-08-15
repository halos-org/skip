import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MatDialog, MatDialogConfig } from '@angular/material/dialog';
import { DialogService } from './dialog.service';

describe('DialogService', () => {
  let service: DialogService;
  let open: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    open = vi.fn(() => ({ afterClosed: () => ({ subscribe: () => undefined }) }));
    TestBed.configureTestingModule({
      providers: [{ provide: MatDialog, useValue: { open, openDialogs: [] } }]
    });
    service = TestBed.inject(DialogService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('leaves closeOnNavigation to the Back guard (#393)', () => {
    // Material disposes the overlay from its own location listener, ahead of the guard's popstate
    // handler, and the guard entry left behind then unwinds into a Back that changes the page. A
    // per-call `closeOnNavigation: true` overrides the global default and silently restores that.
    service.openWidgetOptions({ config: {} } as Parameters<DialogService['openWidgetOptions']>[0]);

    const config = open.mock.calls[0][1] as MatDialogConfig;
    expect(config.closeOnNavigation).toBeUndefined();
  });
});
