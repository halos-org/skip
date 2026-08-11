import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionStatusComponent } from './connection-status.component';
import { EndpointStatus, SignalKConnectionService } from '../../services/signalk-connection.service';
import { SignalKDeltaService, StreamStatus } from '../../services/signalk-delta.service';
import { SsoRedirectService } from '../../services/sso-redirect.service';
import { AuthenticationService, ILoginStatus } from '../../services/authentication.service';

describe('ConnectionStatusComponent', () => {
  let component: ConnectionStatusComponent;
  let fixture: ComponentFixture<ConnectionStatusComponent>;

  const statusText = (): string =>
    (fixture.nativeElement as HTMLElement).querySelector('pre')?.textContent ?? '';

  const identityText = (): string =>
    (fixture.nativeElement as HTMLElement).querySelector('.sso-identity')?.textContent ?? '';

  const emitLoginStatus = (status: ILoginStatus): void => {
    const auth = TestBed.inject(AuthenticationService);
    (auth as unknown as { applyLoginStatus: (raw: unknown) => void }).applyLoginStatus(status);
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConnectionStatusComponent]
    })
      .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(ConnectionStatusComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should be created', () => {
    expect(component).toBeTruthy();
  });

  // This component is the sole sign-in entry point after the Connectivity tab was retired.
  it('routes Sign in through the SSO redirect service', () => {
    const sso = TestBed.inject(SsoRedirectService);
    const spy = vi.spyOn(sso, 'manualSignIn').mockImplementation(() => undefined);
    (component as unknown as { signIn: () => void }).signIn();
    expect(spy).toHaveBeenCalled();
  });

  // A session-less visitor on a server that grants anonymous read is connected and useful, not
  // locked out — the identity line must say so rather than read as a bare failure to sign in (#552).
  it('tells an anonymous visitor they are reading shared data, and still offers Sign in', () => {
    emitLoginStatus({ status: 'notLoggedIn', authenticationRequired: true, readOnlyAccess: true });

    expect(identityText()).toContain('reading shared data');
    expect((fixture.nativeElement as HTMLElement).querySelector('.sso-identity button')).toBeTruthy();
  });

  it('keeps the bare not-signed-in wording when the server grants no anonymous read', () => {
    emitLoginStatus({ status: 'notLoggedIn', authenticationRequired: true, readOnlyAccess: false });

    expect(identityText()).toContain('Not signed in.');
    expect(identityText()).not.toContain('reading shared data');
  });

  // The connection and delta services both re-emit the SAME mutated status object on each update.
  // These tests emit a same-reference mutation (not a fresh literal) so they stay red unless the
  // toSignal equal:()=>false override is present — a fresh-literal emit would pass either way.
  it('updates the endpoint line on a same-reference status re-emit', () => {
    const connection = TestBed.inject(SignalKConnectionService);
    const status = {
      state: EndpointStatus.Connected,
      message: 'Connected',
      serverDescription: 'signalk-server 2.5.0',
      httpServiceUrl: 'http://localhost:3000',
      WsServiceUrl: 'ws://localhost:3000'
    };
    connection.serverServiceEndpoint$.next(status);
    fixture.detectChanges();
    expect(statusText()).toContain('signalk-server 2.5.0');

    status.serverDescription = 'signalk-server 2.6.0';
    connection.serverServiceEndpoint$.next(status);
    fixture.detectChanges();
    expect(statusText()).toContain('signalk-server 2.6.0');
  });

  it('updates the stream line on a same-reference status re-emit', () => {
    const delta = TestBed.inject(SignalKDeltaService);
    const status = { state: StreamStatus.Connected, message: 'Connected' };
    delta.streamEndpoint$.next(status);
    fixture.detectChanges();
    expect(statusText()).toContain('Connected');

    status.message = 'WebSocket closed';
    delta.streamEndpoint$.next(status);
    fixture.detectChanges();
    expect(statusText()).toContain('WebSocket closed');
  });
});
