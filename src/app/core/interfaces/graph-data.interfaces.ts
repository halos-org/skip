/**
 * Shared graph data contracts.
 *
 * These types describe the time-windowed datapoints and series configuration consumed by the
 * graph widgets and the config layer.
 */

export interface IGraphDatapoint {
  timestamp: number;
  data: {
    value: number;
    sma?: number; // Simple Moving Average
    ema?: number; // Exponential Moving Average - A better Moving Average calculation than Simple Moving Average
    doubleEma?: number; // Double Exponential Moving Average - Moving Average that is even more reactive to data variation then EMA. Suitable for wind and angle average calculations
    lastAverage?: number; // Computed from the latest historicalData.
    lastMinimum?: number;
    lastMaximum?: number;
  }
}

export type TimeScaleFormat = "day" | "hour" | "minute" | "second" | "Last Minute" | "Last 5 Minutes" | "Last 30 Minutes";

export interface IGraphSeriesConfig {
  uuid: string;
  path: string;
  pathSource: string;
  baseUnit: string;         // The path's Signal K base unit type
  timeScaleFormat: TimeScaleFormat;  // Series time scale measure.
  period: number;           // Window size expressed in units of timeScaleFormat (ignored for "Last *" presets).
  label: string;           // label of the historicalData
  editable?: boolean;       // Whether the series is editable, or created with Widgets and not editable by user
  angleDomainOverride?: 'signed' | 'direction'; // Optional override for how radian angles are wrapped: signed (-PI..PI) or direction (0..2PI). Undefined uses the path allowlist.
}
