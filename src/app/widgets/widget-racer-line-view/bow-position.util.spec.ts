import { describe, expect, it } from 'vitest';
import { bowPosition, canonicalSourceMap, IBowInputs, IGnssConfig, positionOffsets } from './bow-position.util';

/**
 * The cases from signalk-racer's wiki page "Bow position" (its tests/racer-bow.test.js): heading
 * north, LOA 9.54m, and an antenna at fromBow 1.5 / fromCenter 0.45 (starboard) on
 * `n2k.c07891001cb84fb3`, which the sources list maps `n2k.0` to.
 */
describe('bow position', () => {
  const CAN = 'n2k.c07891001cb84fb3';
  const map = canonicalSourceMap({ n2k: { type: 'NMEA2000', label: 'n2k', 0: { n2k: { canName: 'c07891001cb84fb3' } } } });
  const antenna = (fromCenter = 0.45) => ({ sensorId: 'gps', $source: CAN, fromBow: 1.5, fromCenter });
  const gnss = (correction: string, active: boolean, fromCenter?: number): IGnssConfig =>
    ({ correction, sensors: [antenna(fromCenter)], status: { mode: correction, active } });
  const base: IBowInputs = {
    source: null, length: 9.54, gnss: null, serverVersion: '2.35.0',
    canonical: ref => map.get(ref) ?? ref, gpsFromBow: null, gpsFromCenter: null
  };
  const offsets = (over: Partial<IBowInputs>) => positionOffsets({ ...base, ...over });

  it('maps an N2K address to its CAN name the way the server does', () => {
    expect(map.get('n2k.0')).toBe(CAN);
    expect(map.size).toBe(1);
  });

  it('puts a replace-corrected position at midships, ignoring a stale sensors.gps', () => {
    expect(offsets({ source: CAN, gnss: gnss('replace', true), gpsFromBow: 2, gpsFromCenter: 0.2 }))
      .toEqual({ fromBow: 4.77, fromCenter: 0 });
  });

  it('puts a .ccrp source at midships', () => {
    expect(offsets({ source: 'Gps.ccrp', gnss: gnss('both', true) })).toEqual({ fromBow: 4.77, fromCenter: 0 });
  });

  it('puts an uncorrected position at its antenna, matched through the source map', () => {
    expect(offsets({ source: 'n2k.0', gnss: gnss('both', true) })).toEqual({ fromBow: 1.5, fromCenter: 0.45 });
  });

  it('puts a position at its antenna while replace is blocked', () => {
    expect(offsets({ source: CAN, gnss: gnss('replace', false) })).toEqual({ fromBow: 1.5, fromCenter: 0.45 });
  });

  it('negates the antenna fromCenter on a server before 2.34', () => {
    expect(offsets({ source: CAN, gnss: gnss('off', false, -0.45), serverVersion: '2.33.0' }))
      .toEqual({ fromBow: 1.5, fromCenter: 0.45 });
  });

  it('falls back to sensors.gps for an unconfigured source', () => {
    expect(offsets({ source: 'other.1', gnss: gnss('replace', true), gpsFromBow: 2, gpsFromCenter: 0.2 }))
      .toEqual({ fromBow: 2, fromCenter: 0.2 });
  });

  it('assumes midships with nothing configured, and the bow without a length', () => {
    expect(offsets({ length: 12 })).toEqual({ fromBow: 6, fromCenter: 0 });
    expect(offsets({ length: null })).toEqual({ fromBow: null, fromCenter: null });
  });

  describe('moving to the bow', () => {
    const M_PER_DEG_LAT = 6371000 * Math.PI / 180;

    it('steps forward along the heading, then to port from a starboard antenna', () => {
      const bow = bowPosition(0, 0, 0, { fromBow: 1.5, fromCenter: 0.45 });
      expect(bow.latitude * M_PER_DEG_LAT).toBeCloseTo(1.5, 3);
      expect(bow.longitude * M_PER_DEG_LAT).toBeCloseTo(-0.45, 3);
    });

    it('steps to starboard from a port antenna', () => {
      const bow = bowPosition(0, 0, 0, { fromBow: 2, fromCenter: -0.2 });
      expect(bow.longitude * M_PER_DEG_LAT).toBeCloseTo(0.2, 3);
    });

    it('follows the heading', () => {
      const bow = bowPosition(0, 0, Math.PI / 2, { fromBow: 6, fromCenter: 0 });
      expect(bow.longitude * M_PER_DEG_LAT).toBeCloseTo(6, 3);
      expect(bow.latitude).toBeCloseTo(0, 9);
    });

    it('leaves the position alone without a heading or an offset', () => {
      expect(bowPosition(10, 20, null, { fromBow: 6, fromCenter: 0 })).toEqual({ latitude: 10, longitude: 20 });
      expect(bowPosition(10, 20, 1, { fromBow: null, fromCenter: null })).toEqual({ latitude: 10, longitude: 20 });
    });
  });
});
