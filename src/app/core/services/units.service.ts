import { DataService } from './data.service';
import { splitPointerPath } from '../utils/pointer-path.util';
import { Injectable, inject } from '@angular/core';
import Qty from 'js-quantities';

/**
 * All valid Signal K numeric units supported by Skip.
 *
 * Allowed values:
 * - 's'        (seconds)
 * - 'Hz'       (hertz)
 * - 'm3'       (cubic meters)
 * - 'm3/s'     (cubic meters per second)
 * - 'kg/s'     (kilograms per second)
 * - 'kg/m3'    (kilograms per cubic meter)
 * - 'deg'      (degrees)
 * - 'rad'      (radians)
 * - 'rad/s'    (radians per second)
 * - 'A'        (amperes)
 * - 'C'        (coulombs)
 * - 'V'        (volts)
 * - 'W'        (watts)
 * - 'Nm'       (newton meters)
 * - 'J'        (joules)
 * - 'ohm'      (ohms)
 * - 'm'        (meters)
 * - 'm/s'      (meters per second)
 * - 'm2'       (square meters)
 * - 'K'        (kelvin)
 * - 'Pa'       (pascals)
 * - 'kg'       (kilograms)
 * - 'ratio'    (ratio, 0-1)
 * - 'm/s2'     (meters per second squared)
 * - 'rad/s2'   (radians per second squared)
 * - 'N'        (newtons)
 * - 'T'        (tesla)
 * - 'Lux'      (lux)
 * - 'Pa/s'     (pascals per second)
 * - 'Pa.s'     (pascal seconds)
 * - 'unitless' (no unit)
 * - null       (no filter)
 */
export type TValidSkUnits = 's' | 'Hz' | 'm3' | 'm3/s' | 'kg/s' | 'kg/m3' | 'deg' | 'rad' | 'rad/s' | 'A' | 'C' | 'V' | 'W' | 'Nm' | 'J' | 'ohm' | 'm' | 'm/s' | 'm2' | 'K' | 'Pa' | 'kg' | 'ratio' | 'm/s2' | 'rad/s2' | 'N' | 'T' | 'Lux' | 'Pa/s' | 'Pa.s' | 'unitless' | null;

/**
 * Interface for a list of possible Skip value type conversions for a given path.
 *
 * @export
 * @interface IConversionPathList
 */
export interface IConversionPathList {
  base: string;
  conversions: IUnitGroup[];
}
/**
 *  Group of Skip units array
 */
export interface IUnitGroup {
  group: string;
  units: IUnit[];
}

/**
 * Individual Skip units system measures definition
 */
export interface IUnit {
  measure: string;
  description: string;
  /**
   * Display-only label rendered next to values; falls back to `measure` when absent. An empty string
   * is a value, not an absence: it means render nothing beside the number (the Unitless measures).
   */
  symbol?: string;
}

/**
 * Interface for supported path value units provided by Signal K (schema v 1.7)
 * See: https://github.com/SignalK/specification/blob/master/schemas/definitions.json
 */
export interface ISkBaseUnit {
  unit: TValidSkUnits;
  properties: ISkUnitProperties;
}

/**
 * Interface describing units properties
 */
export interface ISkUnitProperties {
  display: string,
  quantity: string,
  quantityDisplay: string,
  description: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UnitConverter = (v: any) => any;

/**
 * Maps a Signal K unit-preferences `displayUnits.targetUnit` string onto Skip's internal conversion
 * measure key, for the cases where the two differ. Keys are the strings the server EMITS in
 * `meta.displayUnits.targetUnit`: the conversion keys of `unitpreferences/standard-units-definitions.json`,
 * of which the six built-in presets use a subset — a per-path override or a custom preset can select
 * any of the rest, so the reachable vocabulary is the definitions file, not the presets. Targets that
 * already equal a Skip measure (A, V, W, J, mbar, psi, inHg, liter, gallon, percent, rpm, Ah, deg/s,
 * mph, m3/s, ...) need no entry — those match ahead of this table.
 *
 * A target with no entry that is not a measure of the path's own group degrades to 'unitless': the
 * raw SI value with no label. That is how #536 surfaced — the metric presets emit `L/h` where Skip's
 * measure is `l/h`. Targets Skip genuinely has no conversion for (kW, horsepower, Wh, mAh, atm, torr,
 * Bf, fps, every dataSize target, and the mass and area targets outside the
 * kilogram/pound and square-metre/square-foot pairs — gram, ounce, stone, acre, hectare and the
 * rest) belong in that fallback and are deliberately absent here. The duration formats are not
 * aliases either: they resolve to seconds plus a separate format (DURATION_FORMATTERS). A units.service.spec case pins this table against the full built-in
 * preset vocabulary; extend both together.
 */
const SERVER_TARGET_UNIT_ALIASES: Record<string, string> = {
  kn: 'knots',
  'km/h': 'kph',
  'naut-mile': 'nm',
  kilometer: 'km',
  meter: 'm',
  mile: 'mi',
  foot: 'feet',
  pound: 'lbs',
  kilogram: 'kg',
  degree: 'deg',
  radian: 'rad',
  gradian: 'grad',
  hour: 'Hours',
  minute: 'Minutes',
  second: 's',
  day: 'Days',
  hertz: 'Hz',
  watt: 'W',
  C: 'celsius',
  F: 'fahrenheit',
  'L/h': 'l/h',
  'L/min': 'l/min',
  'gal/h': 'g/h',
};

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const pad2 = (n: number): string => n.toString().padStart(2, '0');

/**
 * A clock rendering that starts at its largest non-zero field, so 1800 s reads `30:00`. Whole-second
 * formats truncate toward zero; the millisecond formats round to the nearest millisecond, which
 * truncation of a float product would miss (0.57 * 1000 is 569.99…).
 */
function formatClock(seconds: number, opts: { days?: boolean; hours: boolean; millis?: boolean }): string {
  const totalMs = opts.millis ? Math.round(seconds * SECOND_MS) : Math.trunc(seconds) * SECOND_MS;
  let rest = Math.abs(totalMs);
  let text = totalMs < 0 ? '-' : '';
  let daysShown = false;
  if (opts.days && rest >= DAY_MS) {
    text += `${Math.floor(rest / DAY_MS)}d `;
    rest %= DAY_MS;
    daysShown = true;
  }
  const h = Math.floor(rest / HOUR_MS);
  const s = Math.floor(rest / SECOND_MS) % 60;
  if (opts.hours && (h > 0 || daysShown)) {
    text += `${h}:${pad2(Math.floor(rest / MINUTE_MS) % 60)}:${pad2(s)}`;
  } else {
    text += `${Math.floor(rest / MINUTE_MS)}:${pad2(s)}`;
  }
  return opts.millis ? `${text}.${(rest % SECOND_MS).toString().padStart(3, '0')}` : text;
}

const DURATION_UNITS: { ms: number; short: string; long: string }[] = [
  { ms: DAY_MS, short: 'd', long: 'day' },
  { ms: HOUR_MS, short: 'h', long: 'hour' },
  { ms: MINUTE_MS, short: 'm', long: 'minute' },
  { ms: SECOND_MS, short: 's', long: 'second' },
];

/** Splits whole seconds (truncated toward zero) into day/hour/minute/second counts, largest first. */
function durationParts(seconds: number): { sign: string; counts: number[] } {
  const totalMs = Math.trunc(seconds) * SECOND_MS;
  let rest = Math.abs(totalMs);
  const counts = DURATION_UNITS.map(unit => {
    const count = Math.floor(rest / unit.ms);
    rest %= unit.ms;
    return count;
  });
  return { sign: totalMs < 0 ? '-' : '', counts };
}

/** The two largest units from the first non-zero one, dropping the second when it is zero: `2h 30m`. */
function formatCompact(seconds: number): string {
  const { sign, counts } = durationParts(seconds);
  const first = counts.findIndex(count => count > 0);
  if (first === -1) { return '0s'; }
  const shown = [first, first + 1].filter(i => i < counts.length && (i === first || counts[i] > 0));
  return sign + shown.map(i => `${counts[i]}${DURATION_UNITS[i].short}`).join(' ');
}

/** Every non-zero unit spelled out: `2 hours 30 minutes 45 seconds`. */
function formatVerbose(seconds: number): string {
  const { sign, counts } = durationParts(seconds);
  const words = counts.flatMap((count, i) => count > 0 ? [`${count} ${DURATION_UNITS[i].long}${count === 1 ? '' : 's'}`] : []);
  return words.length > 0 ? sign + words.join(' ') : '0 seconds';
}

/**
 * Formatters for the Signal K unit-preferences duration targets (`standard-units-definitions.json`,
 * the `s` conversions whose formula calls a client-supplied `formatDuration*` helper). They render
 * text only: a path with one of these targets stays numeric in seconds through the data pipeline,
 * and a widget applies the format where it draws the value (#627).
 */
const DURATION_FORMATTERS = {
  'HH:MM:SS': (v: number) => formatClock(v, { hours: true }),
  'DD:HH:MM:SS': (v: number) => formatClock(v, { days: true, hours: true }),
  'MM:SS': (v: number) => formatClock(v, { hours: false }),
  'HH:MM:SS.mmm': (v: number) => formatClock(v, { hours: true, millis: true }),
  'MM:SS.mmm': (v: number) => formatClock(v, { hours: false, millis: true }),
  'duration-compact': formatCompact,
  'duration-verbose': formatVerbose,
} satisfies Record<string, (seconds: number) => string>;

export type TDurationFormat = keyof typeof DURATION_FORMATTERS;

const isDurationFormat = (target: string): target is TDurationFormat => Object.hasOwn(DURATION_FORMATTERS, target);

/**
 * Whether a path addresses the latitude or longitude of a position as `….position#/latitude`. Its
 * unit is `deg`, but it takes only the Position group: the Angle group's conversions assume a value
 * in radians.
 */
function isPositionCoordinate(path: string): boolean {
  const split = splitPointerPath(path);
  if (!split.valid || split.pointer?.length !== 1) return false;
  const field = String(split.pointer[0]);
  return (field === 'latitude' || field === 'longitude') && split.basePath.split('.').at(-1) === 'position';
}

@Injectable()

export class UnitsService {
  private data = inject(DataService);


  /**
   * Definition of available Skip units to be used for conversion.
   * Measure property has to match one Unit Conversion Function for proper operation.
   * Description is human readable property.
   */
  private readonly _conversionList: IUnitGroup[] = [
    { group: 'Unitless', units: [
      { measure: 'unitless', symbol: '', description: "As-Is numeric value" },
      { measure: ' ', symbol: '', description: "No unit label - As-Is numeric value" }
    ] },
    { group: 'Speed', units: [
      { measure: 'knots', symbol: 'kn', description: "Knots - Nautical miles per hour"},
      { measure: 'kph', symbol: 'km/h', description: "kph - Kilometers per hour"},
      { measure: 'mph', description: "mph - Miles per hour"},
      { measure: 'm/s', description: "m/s - Meters per second (base)"}
    ] },
    { group: 'Flow', units: [
      { measure: 'm3/s', symbol: 'm³/s', description: "Cubic meters per second (base)"},
      { measure: 'l/min', description: "Liters per minute"},
      { measure: 'l/h', description: "Liters per hour"},
      { measure: 'g/min', symbol: 'gal/min', description: "Gallons per minute"},
      { measure: 'g/h', symbol: 'gal/h', description: "Gallons per hour"},
      { measure: 'gal-imp/h', symbol: 'imp gal/h', description: "Imperial gallons per hour"}
    ] },
    { group: 'Fuel Distance', units: [
      { measure: 'm/m3', symbol: 'm/m³', description: "Meters per cubic meter (base)"},
      { measure: 'nm/l', description: "Nautical Miles per liter"},
      { measure: 'nm/g', symbol: 'nm/gal', description: "Nautical Miles per gallon"},
      { measure: 'km/l', description: "Kilometers per liter"},
      { measure: 'mpg', description: "Miles per Gallon"},
    ] },
    { group: 'Energy Distance', units: [
      { measure: 'm/J', description: "Meters per Joule (base)"},
      { measure: 'nm/J', description: "Nautical Miles per Joule"},
      { measure: 'km/J', description: "Kilometers per Joule"},
      { measure: 'nm/kWh', description: "Nautical Miles per Kilowatt-hour"},
      { measure: 'km/kWh', description: "Kilometers per Kilowatt-hour"},
    ] },
    { group: 'Temperature', units: [
      { measure: 'K', description: "Kelvin (base)"},
      { measure: 'celsius', symbol: '°C', description: "Celsius"},
      { measure: 'fahrenheit', symbol: '°F', description: "Fahrenheit"}
     ] },
    { group: 'Length', units: [
      { measure: 'm', description: "Meters (base)"},
      { measure: 'mm', description: "Millimeters"},
      { measure: 'fathom', symbol: 'ftm', description: "Fathoms"},
      { measure: 'nm', description: "Nautical Miles"},
      { measure: 'km', description: "Kilometers"},
      { measure: 'mi', description: "Miles"},
      { measure: 'feet', symbol: 'ft', description: "Feet"},
      { measure: 'inch', symbol: 'in', description: "Inches"},
    ] },
    { group: 'Volume', units: [
      { measure: 'liter', symbol: 'L', description: "Liters (base)"},
      { measure: 'm3', symbol: 'm³', description: "Cubic Meters"},
      { measure: 'gallon', symbol: 'gal', description: "Gallons"},
      { measure: 'gallon-imp', symbol: 'imp gal', description: "Imperial Gallons"},
     ] },
    { group: 'Current', units: [
      { measure: 'A', description: "Amperes (base)"},
      { measure: 'mA', description: "Milliamperes"}
    ] },
    { group: 'Potential', units: [
      { measure: 'V', description: "Volts (base)"},
      { measure: 'mV', description: "Millivolts"}
    ] },
    { group: 'Charge', units: [
      { measure: 'C', description: "Coulomb (base)"},
      { measure: 'Ah', description: "Ampere*Hours"},
    ] },
    { group: 'Power', units: [
      { measure: 'W', description: "Watts (base)"},
      { measure: 'mW', description: "Milliwatts"},
    ] },
    { group: 'Energy', units: [
      { measure: 'J', description: "Joules (base)"},
      { measure: 'kWh', description: "Kilowatt*Hours"},
      { measure: 'btu', symbol: 'BTU', description: "British Thermal Units"},
    ] },
    { group: 'Resistance', units: [
      { measure: 'ohm', symbol: "\u2126", description: "\u2126 (base)"},
      { measure: 'kiloohm', symbol: "k\u2126", description: "k\u2126"},
    ] },
    { group: 'Pressure', units: [
      { measure: 'Pa', description: "Pa (base)" },
      { measure: 'kPa', description: "kPa" },
      { measure: 'hPa', description: "hPa" },
      { measure: 'mbar', description: "mbar" },
      { measure: 'bar', description: "Bars" },
      { measure: 'psi', description: "psi" },
      { measure: 'mmHg', description: "mmHg" },
      { measure: 'inHg', description: "inHg" },
    ] },
    { group: 'Mass', units: [
      { measure: 'kg', description: "Kilograms (base)"},
      { measure: 'lbs', symbol: 'lb', description: "Pounds"},
    ] },
    { group: 'Area', units: [
      { measure: 'm2', symbol: 'm²', description: "Square Meters (base)"},
      { measure: 'sqft', symbol: 'ft²', description: "Square Feet"},
    ] },
    { group: 'Density', units: [ { measure: 'kg/m3', description: "Air density - kg/cubic meter (base)"} ] },
    { group: 'Time', units: [
      { measure: 's', description: "Seconds (base)" },
      { measure: 'Minutes', symbol: 'min', description: "Minutes" },
      { measure: 'Hours', symbol: 'h', description: "Hours" },
      { measure: 'Days', symbol: 'd', description: "Days" },
      { measure: 'D HH:MM:SS', description: "Day Hour:Minute:sec"}
    ] },
    { group: 'Angular Velocity', units: [
      { measure: 'rad/s', description: "Radians per second (base)" },
      { measure: 'deg/s', description: "Degrees per second" },
      { measure: 'deg/min', description: "Degrees per minute" },
    ] },
    { group: 'Angle', units: [
      { measure: 'rad', description: "Radians (base)" },
      { measure: 'deg', description: "Degrees" },
      { measure: 'grad', description: "Gradians" },
    ] },
    { group: 'Frequency', units: [
      { measure: 'rpm', description: "RPM - Rotations per minute" },
      { measure: 'Hz', description: "Hz - Hertz (base)" },
      { measure: 'KHz', description: "KHz - Kilohertz" },
      { measure: 'MHz', description: "MHz - Megahertz" },
      { measure: 'GHz', description: "GHz - Gigahertz" },
    ] },
    { group: 'Ratio', units: [
      { measure: 'percent', symbol: '%', description: "As percentage value" },
      { measure: 'percentraw', symbol: '%', description: "As ratio 0-1 with % sign" },
      { measure: 'ratio', description: "Ratio 0-1 (base)" }
    ] },
    { group: 'Position', units: [
      { measure: 'pdeg', symbol: '°', description: "Position Degrees" },
      { measure: 'latitudeMin', symbol: 'lat ′', description: "Latitude in minutes" },
      { measure: 'latitudeSec', symbol: 'lat ″', description: "Latitude in seconds" },
      { measure: 'longitudeMin', symbol: 'lon ′', description: "Longitude in minutes" },
      { measure: 'longitudeSec', symbol: 'lon ″', description: "Longitude in seconds" },
    ] },
  ];

  public readonly skBaseUnits: ISkBaseUnit[] =
    [
      { unit: "s", properties: {
          display: "s",
          quantity: "Time",
          quantityDisplay: "t",
          description: "Elapsed time (interval) in seconds"
        }
      },
      { unit: "Hz", properties: {
          display: "Hz",
          quantity: "Frequency",
          quantityDisplay: "f",
          description: "Frequency in Hertz"
        }
      },
      { unit: "m3", properties: {
          display: "m\u00b3",
          quantity: "Volume",
          quantityDisplay: "V",
          description: "Volume in cubic meters"
        }
      },
      { unit: "m3/s", properties: {
          display: "m\u00b3/s",
          quantity: "Flow",
          quantityDisplay: "Q",
          description: "Liquid or gas flow in cubic meters per second"
        }
      },
      { unit: "kg/s", properties: {
          display: "kg/s",
          quantity: "Mass flow rate",
          quantityDisplay: "\u1e41",
          description: "Liquid or gas flow in kilograms per second"
        }
      },
      { unit: "kg/m3", properties: {
          display: "kg/m\u00b3",
          quantity: "Density",
          quantityDisplay: "\u03c1",
          description: "Density in kg per cubic meter"
        }
      },
      { unit: "deg", properties: {
          display: "Position",
          quantity: "Angle",
          quantityDisplay: "\u2220",
          description: "Latitude or longitude in decimal degrees"
        }
      },
      { unit: "rad", properties: {
          display: "\u00b0",
          quantity: "Angle",
          quantityDisplay: "\u2220",
          description: "Angular arc in radians"
        }
      },
      { unit: "rad/s", properties: {
          display: "\u33ad/s",
          quantity: "Rotation",
          quantityDisplay: "\u03c9",
          description: "Angular rate in radians per second"
        }
      },
      { unit: "A", properties: {
          display: "A",
          quantity: "Current",
          quantityDisplay: "I",
          description: "Electrical current in ampere"
        }
      },
      { unit: "C", properties: {
          display: "C",
          quantity: "Charge",
          quantityDisplay: "Q",
          description: "Electrical charge in Coulomb"
        }
      },
      { unit: "V", properties: {
          display: "V",
          quantity: "Voltage",
          quantityDisplay: "V",
          description: "Electrical potential in volt"
        }
      },
      { unit: "W", properties: {
          display: "W",
          quantity: "Power",
          quantityDisplay: "P",
          description: "Power in watt"
        }
      },
      { unit: "Nm", properties: {
          display: "Nm",
          quantity: "Torque",
          quantityDisplay: "\u03c4",
          description: "Torque in Newton meter"
        }
      },
      { unit: "J", properties: {
          display: "J",
          quantity: "Energy",
          quantityDisplay: "E",
          description: "Electrical energy in joule"
        }
      },
      { unit: "ohm", properties: {
          display: "\u2126",
          quantity: "Resistance",
          quantityDisplay: "R",
          description: "Electrical resistance in ohm"
        }
      },
      { unit: "m", properties: {
          display: "m",
          quantity: "Distance",
          quantityDisplay: "d",
          description: "Distance in meters"
        }
      },
      { unit: "m/s", properties: {
          display: "m/s",
          quantity: "Speed",
          quantityDisplay: "v",
          description: "Speed in meters per second"
        }
      },
      { unit: "m2", properties: {
          display: "\u33a1",
          quantity: "Area",
          quantityDisplay: "A",
          description: "(Surface) area in square meters"
        }
      },
      { unit: "K", properties: {
          display: "K",
          quantity: "Temperature",
          quantityDisplay: "T",
          description: "Temperature in kelvin"
        }
      },
      { unit: "Pa", properties: {
          display: "Pa",
          quantity: "Pressure",
          quantityDisplay: "P",
          description: "Pressure in pascal"
        }
      },
      { unit: "kg", properties: {
          display: "kg",
          quantity: "Mass",
          quantityDisplay: "m",
          description: "Mass in kilogram"
        }
      },
      { unit: "ratio", properties: {
          display: "",
          quantity: "Ratio",
          quantityDisplay: "\u03c6",
          description: "Relative value compared to reference or normal value. 0 = 0%, 1 = 100%, 1e-3 = 1 ppt"
        }
      },
      { unit: "m/s2", properties: {
          display: "m/s\u00b2",
          quantity: "Acceleration",
          quantityDisplay: "a",
          description: "Acceleration in meters per second squared"
        }
      },
      { unit: "rad/s2", properties: {
          display: "rad/s\u00b2",
          quantity: "Angular acceleration",
          quantityDisplay: "a",
          description: "Angular acceleration in radians per second squared"
        }
      },
      { unit: "N", properties: {
          display: "N",
          quantity: "Force",
          quantityDisplay: "F",
          description: "Force in newton"
        }
      },
      { unit: "T", properties: {
          display: "T",
          quantity: "Magnetic field",
          quantityDisplay: "B",
          description: "Magnetic field strength in tesla"
        }
      },
      { unit: "Lux", properties: {
          display: "lx",
          quantity: "Light Intensity",
          quantityDisplay: "Ev",
          description: "Light Intensity in lux"
        }
      },
      { unit: "Pa/s", properties: {
          display: "Pa/s",
          quantity: "Pressure rate",
          quantityDisplay: "R",
          description: "Pressure change rate in pascal per second"
        }
      },
      { unit: "Pa.s", properties: {
          display: "Pa s",
          quantity: "Viscosity",
          quantityDisplay: "\u03bc",
          description: "Viscosity in pascal seconds"
        }
      }
    ];

  private unitConversionFunctions: Record<string, UnitConverter> = {

    'unitless': function(v) { return v; },
    ' ': function(v) { return v; },
//  speed
    'knots': Qty.swiftConverter("m/s", "kn"),
    'kph': Qty.swiftConverter("m/s", "kph"),
    'm/s': function(v) { return v; },
    'mph': Qty.swiftConverter("m/s", "mph"),
// mass
    'kg': function(v) { return v; },
    'lbs': Qty.swiftConverter('kg', 'lbs'),
// area
    'm2': function(v) { return v; },
    'sqft': Qty.swiftConverter('m^2', 'ft^2'),
// volume
    "liter": Qty.swiftConverter('m^3', 'liter'),
    "gallon": Qty.swiftConverter('m^3', 'gallon'),
    "gallon-imp": Qty.swiftConverter('m^3', 'gallon-imp'),
    "m3": function(v) { return v; },
//  flow
    'm3/s': function(v) { return v; },
    'l/min': Qty.swiftConverter("m^3/s", "liter/minute"),
    'l/h': Qty.swiftConverter("m^3/s", "liter/hour"),
    'g/min': Qty.swiftConverter("m^3/s", "gallon/minute"),
    // The server's own formulas for these two convert to gallons per SECOND — 3600x short, reported
    // as SignalK/signalk-server#2951. These factors are the correct ones (1 m³/s = 951019.39 US gal/h),
    // so Skip and the Signal K admin UI disagree on an imperial fuel rate until that lands. Do not
    // "reconcile" them with the server's numbers.
    'g/h': Qty.swiftConverter("m^3/s", "gallon/hour"),
    'gal-imp/h': Qty.swiftConverter("m^3/s", "gallon-imp/hour"),
//  fuel consumption
    'm/m3': function(v) { return v; },
    'nm/l': Qty.swiftConverter('m/m^3', 'naut-mile/liter'),
    'nm/g': Qty.swiftConverter('m/m^3', 'naut-mile/gallon'),
    'km/l': Qty.swiftConverter('m/m^3', 'km/liter'),
    'mpg': Qty.swiftConverter('m/m^3', 'mile/gallon'),
//  energy consumption
    'm/J': function(v) { return v; },
    'nm/J': Qty.swiftConverter('m/J', 'naut-mile/J'),
    'km/J': Qty.swiftConverter('m/J', 'km/J'),
    'nm/kWh': Qty.swiftConverter('m/J', 'naut-mile/kWh'),
    'km/kWh': Qty.swiftConverter('m/J', 'km/kWh'),
//  temp
    "K": function(v) { return v; },
    "celsius": Qty.swiftConverter("tempK", "tempC"),
    "fahrenheit": Qty.swiftConverter("tempK", "tempF"),
//  length
    "m": function(v) { return v; },
    "mm": function(v) { return v*1000; },
    "fathom": Qty.swiftConverter('m', 'fathom'),
    "feet": Qty.swiftConverter('m', 'foot'),
    "inch": Qty.swiftConverter('m', 'in'),
    "km": Qty.swiftConverter('m', 'km'),
    "nm": Qty.swiftConverter('m', 'nmi'),
    "mi": Qty.swiftConverter('m', 'mi'),
//  Potential
    "V": function(v) { return v; },
    "mV": function(v) { return v*1000; },
//  Current
    "A": function(v) { return v; },
    "mA": function(v) { return v*1000; },
// charge
    "C": function(v) { return v; },
    "Ah": Qty.swiftConverter('C', 'Ah'),
// Power
    "W": function(v) { return v; },
    "mW": function(v) { return v*1000; },
// Energy
    "J": function(v) { return v; },
    "kWh": Qty.swiftConverter('J', 'kWh'),
    "btu": Qty.swiftConverter('J', 'btu'),
// Resistance
    "ohm": function(v) { return v; },
    "kiloohm": function(v) { return v / 1000; },
//  pressure
    "Pa": function(v) { return v; },
    "bar": Qty.swiftConverter('Pa', 'bar'),
    "psi": Qty.swiftConverter('Pa', 'psi'),
    "mmHg": Qty.swiftConverter('Pa', 'mmHg'),
    "inHg": Qty.swiftConverter('Pa', 'inHg'),
    "hPa": Qty.swiftConverter('Pa', 'hPa'),
    "kPa": Qty.swiftConverter('Pa', 'kPa'),
    "mbar": Qty.swiftConverter('Pa', 'millibar'),
// Density - Description: Current outside air density
    "kg/m3": function(v) { return v; },
//  Time
    "s": function(v) { return v; },
    "Minutes": Qty.swiftConverter('s', 'minutes'),
    "Hours": Qty.swiftConverter('s', 'hours'),
    "Days": Qty.swiftConverter('s', 'days'),
    "D HH:MM:SS": function(v) {
      v = parseInt(v, 10);
      const isNegative = v < 0; // Check if the value is negative
      v = Math.abs(v); // Use the absolute value for calculations

      const days = Math.floor(v / 86400);
      const h = Math.floor((v % 86400) / 3600);
      const m = Math.floor((v % 3600) / 60);
      const s = Math.floor(v % 60);

      let result = (isNegative ? '-' : '');
      if (days > 0) {
        result += days + 'd ' + h.toString() + ':' + m.toString().padStart(2, '0') + ':' + s.toString().padStart(2, '0');
      } else {
        result += h.toString() + ':' +
                  m.toString().padStart(2, '0') + ':' +
                  s.toString().padStart(2, '0');
      }
      return result;
    },
//  angularVelocity
    "rad/s": function(v) { return v; },
    "deg/s": Qty.swiftConverter('rad/s', 'deg/s'),
    "deg/min": Qty.swiftConverter('rad/s', 'deg/min'),
//  frequency
    "rpm": function(v) { return v*60; },
    "Hz": function(v) { return v; },
    "KHz": function(v) { return v/1000; },
    "MHz": function(v) { return v/1000000; },
    "GHz": function(v) { return v/1000000000; },
//  angle
    "rad": function(v) { return v; },
    "deg": Qty.swiftConverter('rad', 'deg'),
    "grad": Qty.swiftConverter('rad', 'grad'),
//   ratio
    'percent': function(v) { return v * 100 },
    'percentraw': function(v) { return v },
    'ratio': function(v) { return v },
// Position Degrees lat/lon
    'pdeg': function(v) { return v; }, // Signal K uses degrees for lat/lon
    'latitudeMin': function(v) {
        let degree = Math.trunc(v);
        let s = 'N';
        if (v < 0) { s = 'S'; degree = degree * -1 }
        let r = (v % 1) * 60; // decimal part of input, * 60 to get minutes
        if (s == 'S') { r = r * -1 }
        return degree + '° ' + r.toFixed(2).padStart(5, '0') + '\' ' + s;
      },
    'latitudeSec': function(v) {
      let degree = Math.trunc(v);
      let s = 'N';
      if (v < 0) { s = 'S'; degree = degree * -1 }
      let r = (v % 1) * 60; // decimal part of input, * 60 to get minutes
      if (s == 'S') { r = r * -1 }
      const minutes = Math.trunc(r);
      const seconds = (r % 1) * 60;

      return degree + '° ' + minutes + '\' ' + seconds.toFixed(2).padStart(5, '0') + '" ' + s;
    },
    'longitudeMin': function(v) {
      let degree = Math.trunc(v);
      let s = 'E';
      if (v < 0) { s = 'W'; degree = degree * -1 }
      let r = (v % 1) * 60; // decimal part of input, * 60 to get minutes
      if (s == 'W') { r = r * -1 }
      return degree + '° ' + r.toFixed(2).padStart(5, '0') + '\' ' + s;
    },
    'longitudeSec': function(v) {
      let degree = Math.trunc(v);
      let s = 'E';
      if (v < 0) { s = 'W'; degree = degree * -1 }
      let r = (v % 1) * 60; // decimal part of input, * 60 to get minutes
      if (s == 'W') { r = r * -1 }
      const minutes = Math.trunc(r);
      const seconds = (r % 1) * 60;

      return degree + '° ' + minutes + '\' ' + seconds.toFixed(2).padStart(5, '0') + '" ' + s;
    },
  }

  /**
   * Converts any number to the specified unit. The function does not validate if
   * source and destination units are compatible, ie. kph to degrees will be converted
   * but will return meaningless results.
   *
   * If the unit is not know, or or the value is null, Null will be returned.
   *
   * @param {string} unit The conversion type unit
   * @param {number} value The source value
   * @return {*}  {number | null} The result of the conversion
   * @memberof UnitsService
   */
  public convertToUnit(unit: string, value: number): number | null {
    if (!(unit in this.unitConversionFunctions)) { return null; }
    if (value === null) { return null; }
    const num: number = +value; // sometime we get strings here. Weird! Lazy patch.
    return this.unitConversionFunctions[unit](num);
  }

  /**
   * Resolves the display-only label for a measure (the on-screen unit symbol), falling back to the
   * measure key itself when no dedicated symbol is defined. This is the single seam every render site
   * uses so units are labelled consistently (no spelled-out words), independent of the internal key.
   */
  public getUnitDisplaySymbol(measure: string | null | undefined): string {
    if (!measure) {
      return '';
    }
    for (const group of this._conversionList) {
      const unit = group.units.find(u => u.measure === measure);
      if (unit) {
        return unit.symbol ?? unit.measure;
      }
    }
    return measure;
  }

  /**
   * The symbol to render beside a value, or '' where there is nothing to render. Equivalent to
   * {@link getUnitDisplaySymbol} for every measure in the conversion table — the Unitless measures
   * carry an empty symbol there — and differs only for an unknown measure key, which this one
   * trims and blanks when it is whitespace or the bare word 'unitless'. Prefer it at a render site
   * that lays out around the symbol.
   */
  public getRenderableUnitSymbol(measure: string | null | undefined): string {
    if (!measure || measure === 'unitless') {
      return '';
    }
    return this.getUnitDisplaySymbol(measure).trim();
  }

  /**
   * Accessor for the full conversion-group table (`_conversionList`) — every unit group
   * and its member measures. Used by the conversion-table integrity test to enumerate
   * the measures Skip knows how to convert.
   *
   * @return {*}  {IUnitGroup[]} an array of units by groups
   * @memberof UnitsService
   */
  public getConversions(): IUnitGroup[] {
    return this._conversionList;
  }

  /**
   * Obtain a list of possible Skip value type conversions for a given path. ie,.: Speed conversion group
   * (kph, Knots, etc.). The conversion list will be trimmed to only the conversions for the group in question.
   * If a base value type (provided by server) for a path cannot be found,
   * the full list is returned and with 'unitless' as the base. Same goes if the value type exists,
   * but Skip does not handle it...yet.
   *
   * @param path The Signal K path of the value
   * @return conversions Full list array or subset of list array
   */
  public getConversionsForPath(path: string): IConversionPathList {
    const pathUnitType = this.data.getPathUnitType(path);
    const UNITLESS = 'unitless';

    if (pathUnitType === null || pathUnitType === 'RFC 3339 (UTC)') {
      return { base: UNITLESS, conversions: this._conversionList };
    } else {
      const coordinate = isPositionCoordinate(path);
      const groupList = this._conversionList.filter(unitGroup => coordinate
        ? unitGroup.group === 'Position'
        : unitGroup.units.some(unit => unit.measure == pathUnitType));

      if (groupList.length > 0) {
        // A coordinate's degrees take the preset's plain-degree target, which the Position group has no measure for.
        const serverDefault = coordinate ? undefined : this.resolveServerDefaultMeasure(path, groupList);
        return { base: serverDefault ?? UNITLESS, conversions: groupList };
      }

      console.log("[Units Service] Unit type: " + pathUnitType + ", found for path: " + path + "\nbut Skip does not support it.");
      return { base: UNITLESS, conversions: this._conversionList };
    }
  }

  /**
   * The measure Skip applies to a path's value — the single source of BOTH the conversion
   * (convertToUnit) and its display symbol (getUnitDisplaySymbol), so the rendered label always
   * matches the applied conversion. Resolves to the server's honourable displayUnits preference when
   * present, else 'unitless' (Skip owns no client-side unit default). This is the Phase-2 seam (#347)
   * that display widgets and the streams directive read in place of a stored per-widget convertUnitTo;
   * structural (fixed-unit) paths bypass it and keep their widget-owned unit.
   */
  public resolvePathMeasure(path: string): string {
    return this.getConversionsForPath(path).base;
  }

  /**
   * The server's duration format for a path, when its targetUnit is one and the path is in seconds.
   * The path's measure stays 's' (resolvePathMeasure), so numeric consumers keep working in seconds;
   * only a widget that draws the value as text applies the format, through formatDuration.
   */
  public resolvePathDurationFormat(path: string): TDurationFormat | undefined {
    const targetUnit = this.data.getPathDisplayUnits(path)?.targetUnit;
    if (!targetUnit || !isDurationFormat(targetUnit)) { return undefined; }
    return this.resolvePathMeasure(path) === 's' ? targetUnit : undefined;
  }

  /** Renders a duration in seconds as text in the given server duration format. */
  public formatDuration(format: TDurationFormat, seconds: number): string {
    return DURATION_FORMATTERS[format](seconds);
  }

  /**
   * The server's preferred display measure for a path (Signal K unit-preferences plugin), used as the
   * default conversion target when present. Returns a measure only when the server's targetUnit maps
   * to a Skip measure that is valid for the path's own conversion group — so the resolved measure
   * drives BOTH the conversion and the label from one source (the "label matches conversion"
   * invariant). Undefined when there is no server preference or it is not honourable (unit-less path,
   * or an unmapped/unsupported target), in which case the caller falls back to 'unitless'.
   * Per-widget overrides are unaffected: this only supplies the default a fresh path selection seeds.
   *
   * The target is matched against the path's own group BEFORE the alias table, so a target that is
   * already a measure keeps its own meaning: a charge path asking for `C` (Coulomb, the identity
   * target the server offers under the `base` category) must not be rewritten to Celsius by an alias
   * whose key it happens to share.
   */
  private resolveServerDefaultMeasure(path: string, groupList: IUnitGroup[]): string | undefined {
    const targetUnit = this.data.getPathDisplayUnits(path)?.targetUnit;
    if (!targetUnit) return undefined;
    // A group-valid measure is guaranteed to drive both a real conversion and a matching symbol —
    // every conversion-list measure has both, pinned by the table-integrity test.
    const inGroup = (measure: string) => groupList.some(group => group.units.some(unit => unit.measure === measure));
    if (inGroup(targetUnit)) { return targetUnit; }
    const aliased = SERVER_TARGET_UNIT_ALIASES[targetUnit];
    if (aliased && inGroup(aliased)) { return aliased; }
    if (isDurationFormat(targetUnit) && inGroup('s')) { return 's'; }
    this.warnUnmappableTarget(path, targetUnit);
    return undefined;
  }

  /**
   * Server targets Skip cannot honour degrade to 'unitless' — a raw SI value with no label, which is
   * indistinguishable on screen from a path the server states no preference for. #536 took a user's
   * bug report to find for exactly that reason, so name the target that was dropped. Once per target
   * per session: the resolver runs on every meta emission, and a repeating console line is noise the
   * next reader learns to scroll past.
   */
  private warnUnmappableTarget(path: string, targetUnit: string): void {
    if (this.unmappedTargets.has(targetUnit)) { return; }
    this.unmappedTargets.add(targetUnit);
    console.warn(`[Units Service] Server display unit '${targetUnit}' (path: ${path}) has no Skip conversion for this path's unit type. Showing the value in Signal K's own units instead.`);
  }
  private readonly unmappedTargets = new Set<string>();

}
