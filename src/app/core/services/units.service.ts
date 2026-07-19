import { DataService } from './data.service';
import { Injectable, effect, inject } from '@angular/core';
import Qty from 'js-quantities';

import { SettingsService } from './settings.service';

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
  /** Display-only label rendered next to values; falls back to `measure` when absent. */
  symbol?: string;
}

/**
 * Interface for defaults Units per unit Groups to be applied
 */
export type IUnitDefaults = Record<string, string>;

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
 * measure key, for the cases where the two differ. Keys are the strings the plugin actually EMITS in
 * `meta.displayUnits.targetUnit` (verified from live path meta — e.g. temperature emits the bare `C`,
 * time emits `hour`), NOT the plugin's internal preset/definition keys. Server targets that already
 * equal a Skip measure (A, V, W, J, mbar, liter, percent, rpm, Ah, deg/s, ...) need no entry — an
 * unmapped target is used as-is and, when it is not a resolvable conversion for the path's group,
 * the caller degrades gracefully to Skip's own default. Extend as other presets/units are adopted.
 */
const SERVER_TARGET_UNIT_ALIASES: Record<string, string> = {
  kn: 'knots',
  'naut-mile': 'nm',
  degree: 'deg',
  hour: 'Hours',
  C: 'celsius',
};

@Injectable()

export class UnitsService {
  private SettingsService = inject(SettingsService);
  private data = inject(DataService);


  /**
   * Definition of available Skip units to be used for conversion.
   * Measure property has to match one Unit Conversion Function for proper operation.
   * Description is human readable property.
   */
  private readonly _conversionList: IUnitGroup[] = [
    { group: 'Unitless', units: [
      { measure: 'unitless', description: "As-Is numeric value" },
      { measure: ' ', description: "No unit label - As-Is numeric value" }
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
      { measure: 'g/h', symbol: 'gal/h', description: "Gallons per hour"}
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

  private _defaultUnits: IUnitDefaults = {};

  constructor() {
    // Seed synchronously (the former BehaviorSubject replayed its value on subscribe), then keep
    // it current. The effect's initial run re-assigns the same value, which is a harmless no-op.
    this._defaultUnits = this.SettingsService.unitDefaults();
    effect(() => {
      this._defaultUnits = this.SettingsService.unitDefaults();
    });
  }

  private unitConversionFunctions: Record<string, UnitConverter> = {

    'unitless': function(v) { return v; },
    ' ': function(v) { return v; },
//  speed
    'knots': Qty.swiftConverter("m/s", "kn"),
    'kph': Qty.swiftConverter("m/s", "kph"),
    'm/s': function(v) { return v; },
    'mph': Qty.swiftConverter("m/s", "mph"),
// volume
    "liter": Qty.swiftConverter('m^3', 'liter'),
    "gallon": Qty.swiftConverter('m^3', 'gallon'),
    "m3": function(v) { return v; },
//  flow
    'm3/s': function(v) { return v; },
    'l/min': Qty.swiftConverter("m^3/s", "liter/minute"),
    'l/h': Qty.swiftConverter("m^3/s", "liter/hour"),
    'g/min': Qty.swiftConverter("m^3/s", "gallon/minute"),
    'g/h': Qty.swiftConverter("m^3/s", "gallon/hour"),
//  fuel consumption
    'm/m3': function(v) { return v; },
    'nm/l': Qty.swiftConverter('m/m^3', 'naut-mile/liter'),
    'nm/g': Qty.swiftConverter('m/m^3', 'naut-mile/gallon'),
    'km/l': Qty.swiftConverter('m/m^3', 'km/liter'),
    'mpg': Qty.swiftConverter('m/m^3', 'mile/gallon'),
//  energy consumption
    'm/J': function(v) { return v; },
    'nm/J': Qty.swiftConverter('m/J', 'naut-mile/J'),
    'km/J': Qty.swiftConverter('km/J', 'km/J'),
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
   * Re-express a value already in `fromMeasure` as `toMeasure` within the same conversion group,
   * for the case where a stored number is in one display unit while the value it must line up with
   * is now converted to another (e.g. a gauge's user-set displayScale bounds after the server unit
   * preference flip). Recovers the SI base from two forward evaluations of the affine
   * `convertToUnit(fromMeasure, ·)` and forward-converts to the target, so no inverse table is needed.
   *
   * Returns the value unchanged (a safe no-op) whenever the round-trip is not a valid affine numeric
   * conversion: identical measures, an unknown or cross-group pair (same-group is asserted, never
   * assumed), a string-format measure (position/duration produce non-numeric output), a degenerate
   * span, or a non-finite input.
   */
  public convertBetweenMeasures(fromMeasure: string, toMeasure: string, value: number): number {
    if (!Number.isFinite(value)) { return value; }
    if (fromMeasure === toMeasure) { return value; }
    const group = this.measureGroup(fromMeasure);
    if (!group || group !== this.measureGroup(toMeasure)) { return value; }
    const f0 = this.convertToUnit(fromMeasure, 0);
    const f1 = this.convertToUnit(fromMeasure, 1);
    if (typeof f0 !== 'number' || typeof f1 !== 'number' || !Number.isFinite(f0) || !Number.isFinite(f1)) { return value; }
    const span = f1 - f0;
    if (span === 0 || !Number.isFinite(span)) { return value; }
    const base = (value - f0) / span;
    const out = this.convertToUnit(toMeasure, base);
    return (typeof out === 'number' && Number.isFinite(out)) ? out : value;
  }

  /** The conversion group a measure belongs to, or undefined when it is not a known measure. */
  private measureGroup(measure: string): string | undefined {
    for (const group of this._conversionList) {
      if (group.units.some(unit => unit.measure === measure)) { return group.group; }
    }
    return undefined;
  }

  /**
   * Returns the list Skip configured preferred unit conversion settings.
   * as configured by user in Skip's Units configuration.
   *
   * Ex: If a Signal K path's meta Units is set to 'm/s', Skip can automatically
   * convert to a given unit, says 'knots'. Received Signal K data is always
   * in SI units.
   *
   * @return {*}  {IUnitDefaults}
   * @memberof UnitsService
   */
  public getDefaults(): IUnitDefaults {
    return this._defaultUnits;
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
   * Return the list of possible conversions matrix by unit groups. Useful
   * to present possible conversion or select a conversation units that are
   * related.
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
    let defaultUnit = "unitless";

    if (pathUnitType === null || pathUnitType === 'RFC 3339 (UTC)') {
      return { base: UNITLESS, conversions: this._conversionList };
    } else {
      const groupList = this._conversionList.filter(unitGroup => {
        if (unitGroup.group == 'Position' && (path.includes('position.latitude') || path.includes('position.longitude'))) {
          return true;
        }

        const unitExists = unitGroup.units.find(unit => unit.measure == pathUnitType);
        if (unitExists) {
          defaultUnit = this._defaultUnits[unitGroup.group];
          return true;
        }

        return false;
      });

      if (groupList.length > 0) {
        const serverDefault = this.resolveServerDefaultMeasure(path, groupList);
        return { base: serverDefault ?? defaultUnit, conversions: groupList };
      }

      console.log("[Units Service] Unit type: " + pathUnitType + ", found for path: " + path + "\nbut Skip does not support it.");
      return { base: UNITLESS, conversions: this._conversionList };
    }
  }

  /**
   * The measure Skip applies to a path's value — the single source of BOTH the conversion
   * (convertToUnit) and its display symbol (getUnitDisplaySymbol), so the rendered label always
   * matches the applied conversion. Resolves to the server's honourable displayUnits preference when
   * present, else Skip's per-group default, else 'unitless'. This is the Phase-2 seam (#347) that
   * display widgets and the streams directive read in place of a stored per-widget convertUnitTo;
   * structural (fixed-unit) paths bypass it and keep their widget-owned unit.
   */
  public resolvePathMeasure(path: string): string {
    return this.getConversionsForPath(path).base;
  }

  /** Map a server displayUnits.targetUnit onto a Skip conversion measure key (identity when no alias). */
  private mapServerTargetToMeasure(targetUnit: string): string {
    return SERVER_TARGET_UNIT_ALIASES[targetUnit] ?? targetUnit;
  }

  /**
   * The server's preferred display measure for a path (Signal K unit-preferences plugin), used as the
   * default conversion target when present. Returns a measure only when the server's targetUnit maps
   * to a Skip measure that is valid for the path's own conversion group — so the resolved measure
   * drives BOTH the conversion and the label from one source (the "label matches conversion"
   * invariant). Undefined when there is no server preference or it is not honourable (unit-less path,
   * or an unmapped/unsupported target), in which case the caller falls back to Skip's group default.
   * Per-widget overrides are unaffected: this only supplies the default a fresh path selection seeds.
   */
  private resolveServerDefaultMeasure(path: string, groupList: IUnitGroup[]): string | undefined {
    const targetUnit = this.data.getPathDisplayUnits(path)?.targetUnit;
    if (!targetUnit) return undefined;
    const measure = this.mapServerTargetToMeasure(targetUnit);
    // Honour the server preference only when the mapped measure is a member of the path's group.
    // Every conversion-list measure has a conversion function (pinned by a table-integrity test), so a
    // group-valid measure is guaranteed to drive both a real conversion and a matching symbol — the
    // label-matches-conversion invariant. Anything else degrades gracefully to Skip's group default.
    return groupList.some(group => group.units.some(unit => unit.measure === measure)) ? measure : undefined;
  }

}
