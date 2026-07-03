/**
 * Shared dataset/chart data contracts.
 *
 * These types describe the time-windowed datapoints, dataset configuration, and sampling metadata
 * consumed by both chart engines (the History-API engine and the legacy recorder) plus the config
 * and persistence layers. They live in a neutral module so they survive the recorder's removal.
 */

export interface IDatasetServiceDatapoint {
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

export interface IDatasetServiceDatasetConfig {
  uuid: string;
  path: string;
  pathSource: string;
  baseUnit: string;         // The path's Signal K base unit type
  timeScaleFormat: TimeScaleFormat;  // Dataset time scale measure.
  period: number;           // Window size expressed in units of timeScaleFormat (ignored for "Last *" presets).
  label: string;           // label of the historicalData
  editable?: boolean;       // Whether the dataset is editable, or created with Widgets and not editable by user
  angleDomainOverride?: 'signed' | 'direction'; // Optional override for how radian angles are wrapped: signed (-PI..PI) or direction (0..2PI). Undefined uses the path allowlist.
}

export interface IDatasetServiceDataSourceInfo {
  sampleTime: number;       // DataSource Observer's path value sampling rate in milliseconds. ie. How often we get data from Signal K.
  maxDataPoints: number;    // How many data points do we keep for that timescale
  smoothingPeriod: number;  // Number of previous plus current value to use as the moving average
}
