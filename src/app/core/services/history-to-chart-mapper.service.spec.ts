import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { HistoryToChartMapperService } from './history-to-chart-mapper.service';
import { IHistoryValuesResponse } from './history-api-client.service';

describe('HistoryToChartMapperService', () => {
  let service: HistoryToChartMapperService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [HistoryToChartMapperService]
    });

    service = TestBed.inject(HistoryToChartMapperService);
  });

  it('maps average method alias to datapoint value extraction', () => {
    const response: IHistoryValuesResponse = {
      context: 'vessels.self',
      range: {
        from: '2026-02-16T00:00:00.000Z',
        to: '2026-02-16T00:02:00.000Z'
      },
      values: [
        { path: 'environment.wind.angleApparent', method: 'average' }
      ],
      data: [
        ['2026-02-16T00:00:00.000Z', 0.5],
        ['2026-02-16T00:01:00.000Z', 0.6]
      ]
    };

    const datapoints = service.mapValuesToChartDatapoints(response, {
      domain: 'scalar'
    });

    expect(datapoints.length).toBe(2);
    expect(datapoints[0].data.value).toBe(0.5);
    expect(datapoints[1].data.value).toBe(0.6);
  });

  it('computes circular summary stats on final datapoint for rad direction domain', () => {
    const response: IHistoryValuesResponse = {
      context: 'vessels.self',
      range: {
        from: '2026-02-16T00:00:00.000Z',
        to: '2026-02-16T00:03:00.000Z'
      },
      values: [
        { path: 'environment.wind.angleTrueWater', method: 'avg' }
      ],
      data: [
        ['2026-02-16T00:00:00.000Z', 6.19591884457987],
        ['2026-02-16T00:01:00.000Z', 0.08726646259971647],
        ['2026-02-16T00:02:00.000Z', 0.05235987755982989]
      ]
    };

    const datapoints = service.mapValuesToChartDatapoints(response, {
      domain: 'direction'
    });

    expect(datapoints.length).toBe(3);
    expect(datapoints[0].data.lastAverage).toBeNull();
    expect(datapoints[1].data.lastAverage).toBeNull();

    const final = datapoints[2].data;
    expect(final.lastAverage).toBeCloseTo(0.0174959160, 6);
    expect(final.lastMinimum).toBeCloseTo(6.1959188446, 6);
    expect(final.lastMaximum).toBeCloseTo(0.0872664626, 6);
  });

  it('computes circular summary stats in the signed domain, mapping the ±π boundary to +π', () => {
    const response: IHistoryValuesResponse = {
      context: 'vessels.self',
      range: {
        from: '2026-02-16T00:00:00.000Z',
        to: '2026-02-16T00:02:00.000Z'
      },
      values: [
        { path: 'steering.rudderAngle', method: 'avg' }
      ],
      data: [
        ['2026-02-16T00:00:00.000Z', 3.0], // ~172°
        ['2026-02-16T00:01:00.000Z', -3.0] // ~-172°
      ]
    };

    const datapoints = service.mapValuesToChartDatapoints(response, {
      domain: 'signed'
    });

    // Circular mean of +172° and -172° is 180°, which the shared atan2 normalizer maps to +π
    // (the included end of (-π, π]), not the recorder's former mod-based -π.
    const final = datapoints[1].data;
    expect(final.lastAverage).toBeCloseTo(Math.PI, 5);
    expect(final.lastMinimum).toBeCloseTo(3.0, 5);
    expect(final.lastMaximum).toBeCloseTo(-3.0, 5);
  });

  it('prefers the :last column over :avg for the datapoint value', () => {
    const response: IHistoryValuesResponse = {
      context: 'vessels.self',
      range: {
        from: '2026-02-16T00:00:00.000Z',
        to: '2026-02-16T00:02:00.000Z'
      },
      values: [
        { path: 'navigation.headingTrue', method: 'avg' },
        { path: 'navigation.headingTrue', method: 'last' }
      ],
      data: [
        ['2026-02-16T00:00:00.000Z', 3.14, 6.2],
        ['2026-02-16T00:01:00.000Z', 3.1, 0.05]
      ]
    };

    const datapoints = service.mapValuesToChartDatapoints(response, {
      domain: 'scalar'
    });

    expect(datapoints[0].data.value).toBe(6.2);
    expect(datapoints[1].data.value).toBe(0.05);
  });

  it('does not plot a lone :sma column as the Value series', () => {
    const response: IHistoryValuesResponse = {
      context: 'vessels.self',
      range: {
        from: '2026-02-16T00:00:00.000Z',
        to: '2026-02-16T00:02:00.000Z'
      },
      values: [
        { path: 'navigation.headingTrue', method: 'sma' }
      ],
      data: [
        ['2026-02-16T00:00:00.000Z', 1.5],
        ['2026-02-16T00:01:00.000Z', 1.6]
      ]
    };

    const datapoints = service.mapValuesToChartDatapoints(response, {
      domain: 'scalar'
    });

    expect(datapoints[0].data.value).toBeNull();
    expect(datapoints[1].data.value).toBeNull();
    expect(datapoints[0].data.sma).toBe(1.5);
  });
});
