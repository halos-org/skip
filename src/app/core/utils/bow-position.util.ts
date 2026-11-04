/**
 * Where the bow is, given `navigation.position`.
 *
 * Since Signal K server 2.31 the position is not necessarily at the GPS antenna: the server's
 * GNSS correction can move it to the Consistent Common Reference Point (CCRP), midships on the
 * centreline. signalk-racer (1.3.7+) measures every line distance from the bow, and works the bow
 * out with the process here; anything that draws the boat against its line has to follow the
 * same process, or the drawing and racer's numbers disagree by metres. The process is described
 * in signalk-racer's wiki page "Bow position", and mirrors its `positionOffsets()`.
 */

/** A GNSS antenna as the server's `sensors/gnss` API lists it. */
export interface IGnssSensor {
  sensorId?: string;
  $source?: string;
  fromBow?: number | null;
  fromCenter?: number | null;
}

/** The server's GNSS antenna configuration and correction state (2.31+). */
export interface IGnssConfig {
  correction?: 'off' | 'replace' | 'both' | string;
  sensors?: IGnssSensor[];
  status?: { mode?: string; active?: boolean; blocked?: unknown };
}

/** Where a position is on the hull: metres aft of the bow, and metres from the centreline, positive to starboard. */
export interface IHullOffsets {
  fromBow: number | null;
  fromCenter: number | null;
}

export interface IBowInputs {
  /** The `$source` of the position, when known. */
  source: string | null;
  /** `design.length.overall`, metres. */
  length: number | null;
  /** The server's GNSS configuration, or null when absent (before 2.31, or unreadable). */
  gnss: IGnssConfig | null;
  /** The server's version, e.g. '2.33.0'. */
  serverVersion: string | null;
  /** Maps an N2K address source (`n2k.0`) to its CAN name form, as the server does; identity when unknown. */
  canonical: (ref: string) => string;
  /** `sensors.gps.fromBow` and `sensors.gps.fromCenter`. */
  gpsFromBow: number | null;
  gpsFromCenter: number | null;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Servers before 2.34 took a GNSS antenna's fromCenter as positive to port. */
export function antennaFromCenterIsPortPositive(version: string | null): boolean {
  const [major, minor] = String(version ?? '').split('.').map(Number);
  return Number.isFinite(major) && Number.isFinite(minor) && (major < 2 || (major === 2 && minor < 34));
}

/** The configured antenna that produced a position from `source`, compared raw and in canonical form. */
function configuredAntenna(inputs: IBowInputs, source: string): IHullOffsets | null {
  const antennas = inputs.gnss?.sensors;
  if (!Array.isArray(antennas)) return null;
  const ref = inputs.canonical(source);
  const antenna = antennas.find(a => a?.$source && (a.$source === source || inputs.canonical(a.$source) === ref));
  if (!antenna || !finite(antenna.fromBow)) return null;
  let fromCenter = finite(antenna.fromCenter) ? antenna.fromCenter : 0;
  if (antennaFromCenterIsPortPositive(inputs.serverVersion)) fromCenter = -fromCenter;
  return { fromBow: antenna.fromBow, fromCenter };
}

/**
 * Where `navigation.position` is on the hull:
 *  1. A position corrected by the server is at the CCRP: from a `.ccrp` source (the `both`
 *     mode), or from a configured antenna while `replace` is active.
 *  2. A position from a configured antenna that is not being corrected is at that antenna.
 *  3. Otherwise `sensors.gps.fromBow` and `fromCenter`.
 *  4. Otherwise the CCRP, or the bow itself when there is no length either.
 */
export function positionOffsets(inputs: IBowInputs): IHullOffsets {
  const length = finite(inputs.length) && inputs.length > 0 ? inputs.length : null;
  const ccrp: IHullOffsets | null = length ? { fromBow: length / 2, fromCenter: 0 } : null;
  const source = inputs.source;
  if (source) {
    if (source.endsWith('.ccrp') && ccrp) return ccrp;
    const antenna = configuredAntenna(inputs, source);
    if (antenna) {
      const status = inputs.gnss?.status;
      if (status?.mode === 'replace' && status.active === true && ccrp) return ccrp;
      return antenna;
    }
  }

  const fromBow = finite(inputs.gpsFromBow) ? inputs.gpsFromBow : null;
  const fromCenter = finite(inputs.gpsFromCenter) ? inputs.gpsFromCenter : null;
  if (fromBow != null || fromCenter != null) return { fromBow, fromCenter };
  return ccrp ?? { fromBow: null, fromCenter: null };
}

const EARTH_RADIUS = 6371000;

/** The point `distance` metres from (lat, lon) on `bearing` radians: a great-circle step. */
function destination(lat: number, lon: number, distance: number, bearing: number): { latitude: number; longitude: number } {
  const d = distance / EARTH_RADIUS;
  const lat1 = lat * Math.PI / 180;
  const lon1 = lon * Math.PI / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing));
  const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { latitude: lat2 * 180 / Math.PI, longitude: ((lon2 * 180 / Math.PI) + 540) % 360 - 180 };
}

/**
 * The bow, from a position and where that position is on the hull: `fromBow` metres along the
 * heading, then `|fromCenter|` metres across to the centreline - to port when the position is to
 * starboard of it. Without a heading the position is returned unchanged, as racer does.
 *
 * @param heading True heading, else COG, in radians.
 */
export function bowPosition(lat: number, lon: number, heading: number | null, offsets: IHullOffsets): { latitude: number; longitude: number } {
  const { fromBow, fromCenter } = offsets;
  if (heading == null || (!fromBow && !fromCenter)) return { latitude: lat, longitude: lon };
  let bow = { latitude: lat, longitude: lon };
  if (fromBow) bow = destination(bow.latitude, bow.longitude, fromBow, heading);
  if (fromCenter) {
    bow = destination(bow.latitude, bow.longitude, Math.abs(fromCenter), heading + (fromCenter > 0 ? -Math.PI / 2 : Math.PI / 2));
  }
  return bow;
}

/**
 * The map from an N2K address source to its CAN name source, built from `GET /signalk/v1/api/sources`
 * the way the server's `buildSrcToCanonicalMap` does: for each provider `label` and each device key
 * `src`, `${label}.${src}` maps to `${label}.${canName}` where the device has a CAN name.
 */
export function canonicalSourceMap(sources: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (!sources || typeof sources !== 'object') return map;
  for (const [label, provider] of Object.entries(sources as Record<string, unknown>)) {
    if (!provider || typeof provider !== 'object') continue;
    for (const [src, device] of Object.entries(provider as Record<string, unknown>)) {
      if (src === 'type' || src === 'label') continue;
      const canName = (device as { n2k?: { canName?: unknown } } | null)?.n2k?.canName;
      if (typeof canName === 'string' && canName) map.set(`${label}.${src}`, `${label}.${canName}`);
    }
  }
  return map;
}
