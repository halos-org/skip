import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { GNSS_POLL_INTERVAL_MS, GnssAntennaService } from './gnss-antenna.service';
import { SignalKConnectionService } from '../../core/services/signalk-connection.service';

describe('GnssAntennaService', () => {
  const GNSS_URL = 'http://boat/signalk/v2/api/vessels/self/sensors/gnss';
  const SOURCES_URL = 'http://boat/signalk/v1/api/sources';
  let service: GnssAntennaService;
  let http: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [{
        provide: SignalKConnectionService,
        useValue: {
          serverServiceEndpoint$: new BehaviorSubject({ httpServiceUrl: 'http://boat/signalk/v1/api', httpServiceUrlV2: 'http://boat/signalk/v2/api' }),
          serverVersion$: new BehaviorSubject('2.35.0'),
          signalKURL: { url: null }
        }
      }]
    });
    service = TestBed.inject(GnssAntennaService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  it('reads the configuration, and the source map once antennas are configured', () => {
    service.ensureStarted();
    vi.advanceTimersByTime(0);
    const config = { correction: 'replace', sensors: [{ $source: 'n2k.c1', fromBow: 1.5, fromCenter: 0 }], status: { mode: 'replace', active: true } };
    http.expectOne(GNSS_URL).flush(config);
    http.expectOne(SOURCES_URL).flush({ n2k: { label: 'n2k', 0: { n2k: { canName: 'c1' } } } });
    expect(service.config()).toEqual(config);
    expect(service.canonical('n2k.0')).toBe('n2k.c1');
    expect(service.canonical('other.1')).toBe('other.1');
    expect(service.serverVersion()).toBe('2.35.0');
  });

  it('reads a missing API as no configuration, and polls again', () => {
    service.ensureStarted();
    vi.advanceTimersByTime(0);
    http.expectOne(GNSS_URL).flush('not found', { status: 404, statusText: 'Not Found' });
    expect(service.config()).toBeNull();
    http.expectNone(SOURCES_URL);
    vi.advanceTimersByTime(GNSS_POLL_INTERVAL_MS);
    http.expectOne(GNSS_URL).flush({ correction: 'off', sensors: [], status: { mode: 'off', active: false } });
    expect(service.config()?.correction).toBe('off');
  });

  it('drops the source map when a later poll cannot read it', () => {
    service.ensureStarted();
    vi.advanceTimersByTime(0);
    const config = { correction: 'replace', sensors: [{ $source: 'n2k.c1', fromBow: 1.5, fromCenter: 0 }], status: { mode: 'replace', active: true } };
    http.expectOne(GNSS_URL).flush(config);
    http.expectOne(SOURCES_URL).flush({ n2k: { label: 'n2k', 0: { n2k: { canName: 'c1' } } } });
    expect(service.canonical('n2k.0')).toBe('n2k.c1');
    vi.advanceTimersByTime(GNSS_POLL_INTERVAL_MS);
    const changed = { ...config, correction: 'off', status: { mode: 'off', active: false } };
    http.expectOne(GNSS_URL).flush(changed);
    http.expectOne(SOURCES_URL).flush('error', { status: 500, statusText: 'Server Error' });
    expect(service.config()).toEqual(changed);
    expect(service.canonical('n2k.0')).toBe('n2k.0');
  });
});
