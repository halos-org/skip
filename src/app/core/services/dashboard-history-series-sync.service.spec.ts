import type { Mock } from "vitest";
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardHistorySeriesSyncService } from './dashboard-history-series-sync.service';
import { IKipSeriesDefinition } from '../contracts/kip-series-contract';
import { IWidget } from '../interfaces/widgets-interface';
import { WidgetService } from './widget.service';

function seriesIds(series: IKipSeriesDefinition[]): string[] {
    return series.map(item => item.seriesId).sort();
}

describe('DashboardHistorySeriesSyncService', () => {
    let widgetServiceMock: {
        getDefaultConfig: Mock;
    };

    beforeEach(() => {
        widgetServiceMock = {
            getDefaultConfig: vi.fn().mockReturnValue(undefined)
        };

        TestBed.configureTestingModule({
            providers: [
                DashboardHistorySeriesSyncService,
                { provide: WidgetService, useValue: widgetServiceMock }
            ]
        });
    });

    it('resolves dedicated data chart and wind trends mappings via public widget resolver', () => {
        const service = TestBed.inject(DashboardHistorySeriesSyncService);
        const dataChartWidget: IWidget = {
            uuid: 'widget-data-1',
            type: 'widget-data-chart',
            config: {
                datachartPath: 'navigation.speedThroughWater',
                datachartSource: 'default',
                timeScale: 'minute',
                period: 10,
            }
        };

        const windTrendsWidget: IWidget = {
            uuid: 'widget-wind-1',
            type: 'widget-windtrends-chart',
            config: {
                timeScale: 'Last 30 Minutes'
            }
        };

        const dataChartSeries = service.resolveSeriesForWidget(dataChartWidget);
        const windSeries = service.resolveSeriesForWidget(windTrendsWidget);

        expect(dataChartSeries.map(item => item.seriesId)).toEqual(['widget-data-1:datachart']);
        // Pin the fields the history dialog now consumes directly (path/source feed the SK history
        // query; period/timeScale feed the backfill window). seriesId alone would not catch a
        // mis-mapping that silently queries the wrong path or window.
        expect(dataChartSeries[0]).toMatchObject({
            path: 'navigation.speedThroughWater',
            source: 'default',
            timeScale: 'minute',
            period: 10,
        });
        expect(windSeries.map(item => item.seriesId).sort()).toEqual([
            'widget-wind-1:wind-direction',
            'widget-wind-1:wind-speed'
        ]);
        const windByPath = Object.fromEntries(windSeries.map(s => [s.seriesId, s.path]));
        expect(windByPath['widget-wind-1:wind-direction']).toBe('self.environment.wind.directionTrue');
        expect(windByPath['widget-wind-1:wind-speed']).toBe('self.environment.wind.speedTrue');
    });

    it('resolves widget-bms as an unexpanded battery template series (the dialog expands concretes)', () => {
        const service = TestBed.inject(DashboardHistorySeriesSyncService);
        const widget: IWidget = {
            uuid: 'widget-bms-1',
            type: 'widget-bms',
            config: {
                timeScale: 'minute',
                period: 15,
            }
        };

        const series = service.resolveSeriesForWidget(widget);
        expect(seriesIds(series)).toEqual([
          'widget-bms-1:batteries-template'
        ]);
        expect(series.every(item => item.expansionMode === 'bms-battery-tree')).toBe(true);
    });

    it('includes configured BMS battery scope in template series payload', () => {
        const service = TestBed.inject(DashboardHistorySeriesSyncService);
        const widget: IWidget = {
            uuid: 'widget-bms-2',
            type: 'widget-bms',
            config: {
                bms: {
                trackedDevices: [
                  { id: 'house', source: 'default', key: 'house||default' },
                  { id: 'starter', source: 'default', key: 'starter||default' }
                ],
                    banks: [
                        { id: 'bank-1', name: 'House', connectionMode: 'parallel', batteryIds: ['house', 'aux'] }
                    ]
                }
            } as IWidget['config']
        };

        const series = service.resolveSeriesForWidget(widget);
        expect(series.length).toBe(1);
      expect(series[0].allowedIds).toEqual(['house', 'starter']);
    });

  it('excludes stale bank members not present in trackedDevices', () => {
    const service = TestBed.inject(DashboardHistorySeriesSyncService);
    const widget: IWidget = {
      uuid: 'widget-bms-stale-1',
      type: 'widget-bms',
      config: {
        bms: {
          trackedDevices: [{ id: 'house', source: 'default', key: 'house||default' }],
          groups: [
            { id: 'bank-1', name: 'House', connectionMode: 'parallel', memberIds: ['house', 'starter'] }
          ]
        }
      } as IWidget['config']
    };

    const series = service.resolveSeriesForWidget(widget);
    expect(series.length).toBe(1);
    expect(series[0].allowedIds).toEqual(['house']);
    });

  it('uses all discovered batteries when trackedDevices is empty, even if banks exist', () => {
        const service = TestBed.inject(DashboardHistorySeriesSyncService);
        const widget: IWidget = {
            uuid: 'widget-bms-3',
            type: 'widget-bms',
            config: {
                bms: {
                trackedDevices: [],
                    banks: [
                        { id: 'bank-1', name: 'House', connectionMode: 'parallel', batteryIds: ['house'] }
                    ]
                }
            } as IWidget['config']
        };

        const series = service.resolveSeriesForWidget(widget);
        expect(series.length).toBe(1);
    expect(series[0].allowedIds).toBeNull();
    });

    it('resolves widget-solar-charger as an unexpanded charger template series (the dialog expands concretes)', () => {
        const service = TestBed.inject(DashboardHistorySeriesSyncService);
        const widget: IWidget = {
            uuid: 'widget-solar-1',
            type: 'widget-solar-charger',
            config: {
                timeScale: 'minute',
                period: 15,
            }
        };

        const series = service.resolveSeriesForWidget(widget);
        expect(seriesIds(series)).toEqual([
            'widget-solar-1:solar-template'
        ]);
        expect(series.every(item => item.expansionMode === 'solar-tree')).toBe(true);
    });

    it('includes configured Solar charger scope in template series payload', () => {
        const service = TestBed.inject(DashboardHistorySeriesSyncService);
        const widget: IWidget = {
            uuid: 'widget-solar-2',
            type: 'widget-solar-charger',
            config: {
                solarCharger: {
                trackedDevices: [
                  { id: 'port-array', source: 'default', key: 'port-array||default' },
                  { id: 'starboard-array', source: 'default', key: 'starboard-array||default' }
                ],
                optionsById: {}
                }
            } as IWidget['config']
        };

        const series = service.resolveSeriesForWidget(widget);
        expect(series.length).toBe(1);
      expect(series[0].allowedIds).toEqual(['port-array', 'starboard-array']);
      expect(series[0].trackedDevices).toEqual([
        { id: 'port-array', source: 'default' },
        { id: 'starboard-array', source: 'default' }
      ]);
    });

  it('emits source-qualified trackedDevices for same device id across multiple sources', () => {
    const service = TestBed.inject(DashboardHistorySeriesSyncService);
    const widget: IWidget = {
      uuid: 'widget-charger-source-1',
      type: 'widget-charger',
      config: {
        charger: {
          trackedDevices: [
            { id: 'mppt1', source: 'Renogy Rover', key: 'mppt1||Renogy Rover' },
            { id: 'mppt1', source: 'default', key: 'mppt1||default' }
          ],
          groups: [],
          optionsById: {}
        }
      }
    };

    const series = service.resolveSeriesForWidget(widget);
    expect(series.length).toBe(1);
    expect(series[0].allowedIds).toEqual(['mppt1']);
    expect(series[0].trackedDevices).toEqual([
      { id: 'mppt1', source: 'default' },
      { id: 'mppt1', source: 'Renogy Rover' }
    ]);
  });

  it('normalizes source-qualified group memberIds when building allowedIds', () => {
    const service = TestBed.inject(DashboardHistorySeriesSyncService);
    const widget: IWidget = {
      uuid: 'widget-charger-group-source-1',
      type: 'widget-charger',
      config: {
        charger: {
          trackedDevices: [
            { id: 'mppt1', source: 'Renogy Rover', key: 'mppt1||Renogy Rover' },
            { id: 'mppt2', source: 'default', key: 'mppt2||default' }
          ],
          groups: [
            {
              id: 'grp-1',
              name: 'House Chargers',
              memberIds: ['mppt1||Renogy Rover', 'stale||default']
            }
          ],
          optionsById: {}
        }
      } as IWidget['config']
    };

    const series = service.resolveSeriesForWidget(widget);
    expect(series.length).toBe(1);
    expect(series[0].allowedIds).toEqual(['mppt1', 'mppt2']);
    });

  it('resolves template mappings for all new electrical families', () => {
    const service = TestBed.inject(DashboardHistorySeriesSyncService);
    const widgets: IWidget[] = [
      {
        uuid: 'widget-charger-1',
        type: 'widget-charger',
        config: {
          charger: {
            trackedDevices: [
              { id: 'dc-a', source: 'default', key: 'dc-a||default' },
              { id: 'dc-b', source: 'default', key: 'dc-b||default' }
            ],
            groups: [],
            optionsById: {}
          }
        }
      },
      {
        uuid: 'widget-inverter-1',
        type: 'widget-inverter',
        config: {
          inverter: {
            trackedDevices: [{ id: 'inv-a', source: 'default', key: 'inv-a||default' }],
            groups: [],
            optionsById: {}
          }
        }
      },
      {
        uuid: 'widget-alternator-1',
        type: 'widget-alternator',
        config: {
          alternator: {
            trackedDevices: [{ id: 'alt-a', source: 'default', key: 'alt-a||default' }],
            groups: [],
            optionsById: {}
          }
        }
      },
      {
        uuid: 'widget-ac-1',
        type: 'widget-ac',
        config: {
          ac: {
            trackedDevices: [{ id: 'ac-main', source: 'default', key: 'ac-main||default' }],
            groups: [],
            optionsById: {}
          }
        }
      }
    ];

    const resolved = widgets.flatMap(widget => service.resolveSeriesForWidget(widget));

    expect(seriesIds(resolved)).toEqual([
      'widget-ac-1:ac-template',
      'widget-alternator-1:alternators-template',
      'widget-charger-1:chargers-template',
      'widget-inverter-1:inverters-template'
    ]);

    expect(resolved.find(item => item.seriesId === 'widget-charger-1:chargers-template')).toMatchObject({
      expansionMode: 'charger-tree',
      familyKey: 'chargers',
      allowedIds: ['dc-a', 'dc-b'],
      trackedDevices: [
        { id: 'dc-a', source: 'default' },
        { id: 'dc-b', source: 'default' }
      ]
    });

    expect(resolved.find(item => item.seriesId === 'widget-inverter-1:inverters-template')).toMatchObject({
      expansionMode: 'inverter-tree',
      familyKey: 'inverters',
      allowedIds: ['inv-a'],
      trackedDevices: [{ id: 'inv-a', source: 'default' }]
    });

    expect(resolved.find(item => item.seriesId === 'widget-alternator-1:alternators-template')).toMatchObject({
      expansionMode: 'alternator-tree',
      familyKey: 'alternators',
      allowedIds: ['alt-a'],
      trackedDevices: [{ id: 'alt-a', source: 'default' }]
    });

    expect(resolved.find(item => item.seriesId === 'widget-ac-1:ac-template')).toMatchObject({
      expansionMode: 'ac-tree',
      familyKey: 'ac',
      allowedIds: ['ac-main'],
      trackedDevices: [{ id: 'ac-main', source: 'default' }]
    });
  });

  it('uses all discovered solar units when trackedDevices is empty', () => {
        const service = TestBed.inject(DashboardHistorySeriesSyncService);
        const widget: IWidget = {
            uuid: 'widget-solar-3',
            type: 'widget-solar-charger',
            config: {
                solarCharger: {
                trackedDevices: [],
                optionsById: {}
                }
            } as IWidget['config']
        };

        const series = service.resolveSeriesForWidget(widget);
        expect(series.length).toBe(1);
    expect(series[0].allowedIds).toBeNull();
      expect(series[0].trackedDevices).toBeNull();
    });

    it('returns no widget series when supportAutomaticHistoricalSeries is explicitly false', () => {
        const service = TestBed.inject(DashboardHistorySeriesSyncService);
        const widget: IWidget = {
            uuid: 'widget-numeric-1',
            type: 'widget-numeric',
            config: {
                supportAutomaticHistoricalSeries: false,
                paths: {
                    numericPath: {
                        description: 'Numeric Data',
                        path: 'navigation.speedThroughWater',
                        source: null,
                        pathType: 'number',
                        isPathConfigurable: true,
                        sampleTime: 1000
                    }
                }
            }
        };

        expect(service.resolveSeriesForWidget(widget)).toEqual([]);
    });

    it('resolves numeric paths from widget DEFAULT_CONFIG when saved config is partial', () => {
        widgetServiceMock.getDefaultConfig.mockImplementation((selector: string) => {
            if (selector !== 'widget-horizon') {
                return undefined;
            }

            return {
                supportAutomaticHistoricalSeries: true,
                timeScale: 'minute',
                period: 30,
                paths: {
                    gaugePitchPath: {
                        description: 'Pitch',
                        path: 'self.navigation.attitude.pitch',
                        source: 'default',
                        pathType: 'number',
                        isPathConfigurable: true,
                        sampleTime: 1000
                    },
                    gaugeRollPath: {
                        description: 'Roll',
                        path: 'self.navigation.attitude.roll',
                        source: 'default',
                        pathType: 'number',
                        isPathConfigurable: true,
                        sampleTime: 1000
                    }
                }
            };
        });

        const service = TestBed.inject(DashboardHistorySeriesSyncService);
        const widget: IWidget = {
            uuid: 'widget-horizon-1',
            type: 'widget-horizon',
            config: {
                displayName: 'Horizon'
            }
        };

        const series = service.resolveSeriesForWidget(widget);
        expect(seriesIds(series)).toEqual([
            'widget-horizon-1:auto:self-navigation-attitude-pitch:default',
            'widget-horizon-1:auto:self-navigation-attitude-roll:default'
        ]);
        // Pin the query/window fields the history dialog consumes for automatic series.
        expect(series[0]).toMatchObject({
            path: 'self.navigation.attitude.pitch',
            source: 'default',
            timeScale: 'minute',
            period: 30,
            sampleTime: 1000,
        });
    });
});
