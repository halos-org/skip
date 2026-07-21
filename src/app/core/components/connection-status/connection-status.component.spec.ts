import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ConnectionStatusComponent } from './connection-status.component';
import { EndpointStatus, SignalKConnectionService } from '../../services/signalk-connection.service';
import { SignalKDeltaService, StreamStatus } from '../../services/signalk-delta.service';

describe('ConnectionStatusComponent', () => {
  let component: ConnectionStatusComponent;
  let fixture: ComponentFixture<ConnectionStatusComponent>;

  const statusText = (): string =>
    (fixture.nativeElement as HTMLElement).querySelector('pre')?.textContent ?? '';

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
