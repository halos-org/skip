import { Injectable } from '@angular/core';
import { IHistoryValuesResponse } from './history-api-client.service';
import {
  ChartStatsDomain,
  circularMeanRad,
  circularMinMaxRad,
  normalizeDirectionRad,
  normalizeSignedRad
} from '../utils/chart-stats.util';

/**
 * Normalized historical datapoint shape used by chart-oriented consumers.
 */
export interface IHistoryChartDatapoint {
  timestamp: number;
  data: {
    value: number | null;
    sma?: number | null;
    ema?: number | null;
    doubleEma?: number | null;
    lastAverage?: number | null;
    lastMinimum?: number | null;
    lastMaximum?: number | null;
  };
}

/**
 * Shared adapter that converts Signal K History API responses into a normalized
 * chart-friendly datapoint layout.
 */
@Injectable({
  providedIn: 'root'
})
export class HistoryToChartMapperService {
  /**
   * Maps a History API response payload into normalized chart datapoints.
   *
   * - Detects the Value column (`last` preferred, else `avg`/`average`) and `sma` from `response.values`.
   * - Emits one datapoint per response row.
   * - Computes dataset-wide summary stats from mapped datapoint values and
   *   stores them on the final datapoint (`lastAverage`, `lastMinimum`, `lastMaximum`).
   *
   * Angular (`direction`/`signed`) domains use circular math from `chart-stats.util`, matching the
   * live-tail statistics so backfill and live tail agree; `scalar` uses arithmetic aggregates.
   *
   * @param {IHistoryValuesResponse} response Raw History API response.
   * @param {{ domain: ChartStatsDomain }} options Mapping options.
   * @param {ChartStatsDomain} options.domain Domain interpretation; `scalar` is plain numeric.
   * @returns {IHistoryChartDatapoint[]} Normalized datapoints ready for chart/data prefill pipelines.
   */
  public mapValuesToChartDatapoints(
    response: IHistoryValuesResponse,
    options: { domain: ChartStatsDomain }
  ): IHistoryChartDatapoint[] {
    const rows = response?.data;
    if (!rows || rows.length === 0) {
      return [];
    }

    let smaIndex = -1;
    let lastIndex = -1;
    let avgIndex = -1;
    if (response.values && Array.isArray(response.values)) {
      for (let i = 0; i < response.values.length; i++) {
        const rawMethod = response.values[i]?.method;
        const method = typeof rawMethod === 'string' ? rawMethod.toLowerCase() : rawMethod;
        if (!method) continue;
        const index = i + 1; // +1 because index 0 is timestamp
        if (method === 'sma') smaIndex = index;
        else if (method === 'last') lastIndex = index;
        else if (method === 'avg' || method === 'average') avgIndex = index;
      }

      // Single-column fallback: treat the lone column as the value only when it is not a
      // recognized non-value method. Guarding on smaIndex stops a provider that returns just an
      // `sma` column (e.g. one that silently drops an unsupported `:last`) from being plotted as
      // the raw Value series.
      if (lastIndex < 0 && avgIndex < 0 && smaIndex < 0 && response.values.length === 1) {
        avgIndex = 1;
      }
    } else if (rows[0]?.length > 1) {
      avgIndex = 1;
    }

    // The Value series prefers the raw per-bucket `last` sample: it is angle-safe at the 0/360° wrap
    // and seam-free against the client-stamped live tail. `avg`/`average` stays the fallback for
    // callers (e.g. the history-chart dialog) that still request bucket means.
    const valueIndex = lastIndex >= 0 ? lastIndex : avgIndex;

    const shouldNormalizeAngle = options.domain !== 'scalar';
    const normalizeAngle = shouldNormalizeAngle
      ? (options.domain === 'signed' ? normalizeSignedRad : normalizeDirectionRad)
      : null;

    const datapoints: IHistoryChartDatapoint[] = [];

    let scalarSum = 0;
    let scalarMin = Number.POSITIVE_INFINITY;
    let scalarMax = Number.NEGATIVE_INFINITY;
    let scalarCount = 0;

    const angleValues: number[] = [];

    for (const row of rows) {
      if (!Array.isArray(row) || row.length === 0) continue;

      const timestamp = Date.parse(row[0] as string);

      let smaValue = smaIndex >= 0 ? (row[smaIndex] as number | null) : null;
      let columnValue = valueIndex >= 0 ? (row[valueIndex] as number | null) : null;

      if (shouldNormalizeAngle) {
        smaValue = Number.isFinite(smaValue) ? normalizeAngle!(smaValue as number) : null;
        columnValue = Number.isFinite(columnValue) ? normalizeAngle!(columnValue as number) : null;
      } else {
        smaValue = Number.isFinite(smaValue) ? (smaValue as number) : null;
        columnValue = Number.isFinite(columnValue) ? (columnValue as number) : null;
      }

      if (Number.isFinite(columnValue)) {
        const value = columnValue as number;
        if (shouldNormalizeAngle) {
          angleValues.push(value);
        } else {
          scalarCount++;
          scalarSum += value;
          if (value < scalarMin) scalarMin = value;
          if (value > scalarMax) scalarMax = value;
        }
      }

      datapoints.push({
        timestamp,
        data: {
          value: columnValue,
          sma: smaValue,
          ema: null,
          doubleEma: null,
          lastAverage: null,
          lastMinimum: null,
          lastMaximum: null
        }
      });
    }

    if (datapoints.length > 0) {
      let datasetAverage: number | null = null;
      let datasetMinimum: number | null = null;
      let datasetMaximum: number | null = null;

      if (shouldNormalizeAngle && angleValues.length > 0) {
        const wrap = options.domain === 'signed' ? normalizeSignedRad : normalizeDirectionRad;
        const { min, max } = circularMinMaxRad(angleValues);
        datasetAverage = wrap(circularMeanRad(angleValues));
        datasetMinimum = wrap(min);
        datasetMaximum = wrap(max);
      } else if (!shouldNormalizeAngle && scalarCount > 0) {
        datasetAverage = scalarSum / scalarCount;
        datasetMinimum = scalarMin;
        datasetMaximum = scalarMax;
      }

      if (datasetAverage !== null && datasetMinimum !== null && datasetMaximum !== null) {
        const finalDatapoint = datapoints[datapoints.length - 1];
        finalDatapoint.data.lastAverage = datasetAverage;
        finalDatapoint.data.lastMinimum = datasetMinimum;
        finalDatapoint.data.lastMaximum = datasetMaximum;
      }
    }

    return datapoints;
  }
}
