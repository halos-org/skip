// New-user / new-profile default dashboards.
//
// Extracted from a live Signal K applicationData config (user scope, "default"
// profile), then made vessel-agnostic: every widget binds to the server's
// default $source — no boat-specific source or device ids — so the pages work
// on any vessel. Each widget's gridstack `id` equals its widgetProperties.uuid.
// Page ids here are placeholders: both seed paths (DashboardService and
// ProfileService.buildBlankConfig) regenerate a fresh page id per instance.
// To refresh, re-export a good dashboard config, reset any non-'default'
// source/device fields, and replace the array below.
import { Dashboard } from '../app/core/services/dashboard.service';

export const DefaultDashboard: Dashboard[] = [
  {
    "id": "b839eafd-d617-49a7-bc20-d186fa6e63d3",
    "name": "Environment",
    "icon": "dashboard-chart",
    "configuration": [
      {
        "x": 0,
        "y": 0,
        "w": 24,
        "minW": 2,
        "minH": 3,
        "id": "7ba92365-4d4c-4f79-ab16-6633ff964a52",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-data-chart",
            "uuid": "7ba92365-4d4c-4f79-ab16-6633ff964a52",
            "config": {
              "displayName": "AWS",
              "color": "orange",
              "filterSelfPaths": true,
              "datachartPath": "self.environment.wind.speedApparent",
              "datachartSource": "default",
              "datachartAngleRange": null,
              "convertUnitTo": "m/s",
              "timeScale": "hour",
              "period": 6,
              "numDecimal": 1,
              "inverseYAxis": false,
              "datasetAverageArray": "sma",
              "showDataPoints": false,
              "showAverageData": true,
              "trackAgainstAverage": false,
              "showDatasetMinimumValueLine": false,
              "showDatasetMaximumValueLine": false,
              "showDatasetAverageValueLine": true,
              "showDatasetAngleAverageValueLine": false,
              "showLabel": true,
              "showTimeScale": true,
              "startScaleAtZero": false,
              "verticalChart": false,
              "showYScale": true,
              "yScaleSuggestedMin": null,
              "yScaleSuggestedMax": null,
              "enableMinMaxScaleLimit": false,
              "yScaleMin": null,
              "yScaleMax": null
            }
          }
        },
        "h": 4
      },
      {
        "x": 0,
        "y": 4,
        "w": 24,
        "h": 5,
        "minW": 2,
        "minH": 3,
        "id": "2f298899-8195-4610-833f-3e9c9cef6770",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-data-chart",
            "uuid": "2f298899-8195-4610-833f-3e9c9cef6770",
            "config": {
              "displayName": "Outside temperature",
              "color": "contrast",
              "filterSelfPaths": true,
              "datachartPath": "self.environment.outside.temperature",
              "datachartSource": "default",
              "datachartAngleRange": null,
              "convertUnitTo": "celsius",
              "timeScale": "hour",
              "period": 24,
              "numDecimal": 1,
              "inverseYAxis": false,
              "datasetAverageArray": "sma",
              "showDataPoints": false,
              "showAverageData": true,
              "trackAgainstAverage": false,
              "showDatasetMinimumValueLine": false,
              "showDatasetMaximumValueLine": false,
              "showDatasetAverageValueLine": true,
              "showDatasetAngleAverageValueLine": false,
              "showLabel": true,
              "showTimeScale": true,
              "startScaleAtZero": false,
              "verticalChart": false,
              "showYScale": true,
              "yScaleSuggestedMin": null,
              "yScaleSuggestedMax": null,
              "enableMinMaxScaleLimit": false,
              "yScaleMin": null,
              "yScaleMax": null
            }
          }
        }
      },
      {
        "x": 0,
        "y": 9,
        "w": 24,
        "h": 5,
        "minW": 2,
        "minH": 3,
        "id": "1c05e838-d28b-4216-9737-38b47c77b394",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-data-chart",
            "uuid": "1c05e838-d28b-4216-9737-38b47c77b394",
            "config": {
              "displayName": "Seawater temperature",
              "color": "blue",
              "filterSelfPaths": true,
              "datachartPath": "self.environment.water.temperature",
              "datachartSource": "default",
              "datachartAngleRange": null,
              "convertUnitTo": "celsius",
              "timeScale": "hour",
              "period": 6,
              "numDecimal": 1,
              "inverseYAxis": false,
              "datasetAverageArray": "sma",
              "showDataPoints": false,
              "showAverageData": true,
              "trackAgainstAverage": false,
              "showDatasetMinimumValueLine": false,
              "showDatasetMaximumValueLine": false,
              "showDatasetAverageValueLine": true,
              "showDatasetAngleAverageValueLine": false,
              "showLabel": true,
              "showTimeScale": true,
              "startScaleAtZero": false,
              "verticalChart": false,
              "showYScale": true,
              "yScaleSuggestedMin": null,
              "yScaleSuggestedMax": null,
              "enableMinMaxScaleLimit": false,
              "yScaleMin": null,
              "yScaleMax": null
            }
          }
        }
      },
      {
        "x": 0,
        "y": 14,
        "w": 24,
        "h": 6,
        "minW": 2,
        "minH": 3,
        "id": "69e6dfc2-705e-437f-b7b4-d381d305bb88",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-data-chart",
            "uuid": "69e6dfc2-705e-437f-b7b4-d381d305bb88",
            "config": {
              "displayName": "Barometer",
              "color": "grey",
              "filterSelfPaths": true,
              "datachartPath": "self.environment.outside.pressure",
              "datachartSource": "default",
              "datachartAngleRange": null,
              "convertUnitTo": "mbar",
              "timeScale": "hour",
              "period": 24,
              "numDecimal": 1,
              "inverseYAxis": false,
              "datasetAverageArray": "sma",
              "showDataPoints": false,
              "showAverageData": true,
              "trackAgainstAverage": false,
              "showDatasetMinimumValueLine": false,
              "showDatasetMaximumValueLine": false,
              "showDatasetAverageValueLine": true,
              "showDatasetAngleAverageValueLine": false,
              "showLabel": true,
              "showTimeScale": true,
              "startScaleAtZero": false,
              "verticalChart": false,
              "showYScale": true,
              "yScaleSuggestedMin": null,
              "yScaleSuggestedMax": null,
              "enableMinMaxScaleLimit": false,
              "yScaleMin": null,
              "yScaleMax": null
            }
          }
        }
      },
      {
        "w": 7,
        "h": 4,
        "id": "8ed8b9fe-2de3-40c1-8cf0-78ec907da5ee",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-text",
            "uuid": "8ed8b9fe-2de3-40c1-8cf0-78ec907da5ee",
            "config": {
              "displayName": "Navigation state",
              "filterSelfPaths": true,
              "paths": {
                "stringPath": {
                  "description": "String Data",
                  "path": "self.navigation.state",
                  "source": "default",
                  "pathType": "string",
                  "isPathConfigurable": true,
                  "sampleTime": 500
                }
              },
              "color": "pink",
              "enableTimeout": false,
              "dataTimeout": 5
            }
          }
        },
        "x": 0,
        "y": 20
      },
      {
        "x": 7,
        "y": 20,
        "w": 6,
        "h": 4,
        "minW": 1,
        "minH": 2,
        "id": "6b50c99d-7325-4af3-a412-5e4f017c7f30",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-numeric",
            "uuid": "6b50c99d-7325-4af3-a412-5e4f017c7f30",
            "config": {
              "supportAutomaticHistoricalSeries": true,
              "displayName": "Cabin temperature",
              "filterSelfPaths": true,
              "paths": {
                "numericPath": {
                  "description": "Numeric Data",
                  "path": "self.environment.inside.mainCabin.temperature",
                  "source": "default",
                  "pathType": "number",
                  "suppressBootstrapNull": true,
                  "isPathConfigurable": true,
                  "convertUnitTo": "celsius",
                  "showPathSkUnitsFilter": true,
                  "pathSkUnitsFilter": null,
                  "sampleTime": 500
                }
              },
              "showMax": false,
              "showMin": false,
              "numDecimal": 1,
              "showMiniChart": false,
              "yScaleMin": 0,
              "yScaleMax": 10,
              "inverseYAxis": false,
              "verticalChart": false,
              "color": "green",
              "enableTimeout": false,
              "dataTimeout": 5,
              "ignoreZones": false
            }
          }
        }
      },
      {
        "x": 13,
        "y": 20,
        "w": 11,
        "h": 4,
        "minW": 2,
        "minH": 3,
        "id": "c0205b09-fe37-4370-8141-fbedcd4b3d32",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-data-chart",
            "uuid": "c0205b09-fe37-4370-8141-fbedcd4b3d32",
            "config": {
              "displayName": "Fridge temperature",
              "color": "purple",
              "filterSelfPaths": true,
              "datachartPath": "self.environment.inside.refridgerator.temperature",
              "datachartSource": "default",
              "datachartAngleRange": null,
              "convertUnitTo": "celsius",
              "timeScale": "hour",
              "period": 24,
              "numDecimal": 1,
              "inverseYAxis": false,
              "datasetAverageArray": "sma",
              "showDataPoints": false,
              "showAverageData": true,
              "trackAgainstAverage": false,
              "showDatasetMinimumValueLine": false,
              "showDatasetMaximumValueLine": false,
              "showDatasetAverageValueLine": true,
              "showDatasetAngleAverageValueLine": false,
              "showLabel": true,
              "showTimeScale": true,
              "startScaleAtZero": false,
              "verticalChart": false,
              "showYScale": true,
              "yScaleSuggestedMin": null,
              "yScaleSuggestedMax": null,
              "enableMinMaxScaleLimit": false,
              "yScaleMin": null,
              "yScaleMax": null
            }
          }
        }
      }
    ]
  },
  {
    "id": "069056c9-d9d0-4a25-8895-51dc609bf127",
    "name": "Motoring",
    "icon": "dashboard-propeller",
    "configuration": [
      {
        "x": 0,
        "y": 0,
        "w": 10,
        "h": 6,
        "minW": 1,
        "minH": 2,
        "id": "3d7675dd-156f-43af-8ae2-35d2916f9297",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-gauge-ng-radial",
            "uuid": "3d7675dd-156f-43af-8ae2-35d2916f9297",
            "config": {
              "supportAutomaticHistoricalSeries": true,
              "displayName": "RPM",
              "filterSelfPaths": true,
              "paths": {
                "gaugePath": {
                  "description": "Numeric Data",
                  "path": "self.propulsion.main.revolutions",
                  "source": "default",
                  "pathType": "number",
                  "suppressBootstrapNull": true,
                  "isPathConfigurable": true,
                  "showPathSkUnitsFilter": true,
                  "pathSkUnitsFilter": null,
                  "convertUnitTo": "rpm",
                  "sampleTime": 500
                }
              },
              "displayScale": {
                "lower": 0,
                "upper": 3600,
                "type": "linear"
              },
              "gauge": {
                "type": "ngRadial",
                "subType": "measuring",
                "highlightsWidth": 5,
                "scaleStart": 180,
                "barStartPosition": "left",
                "enableTicks": true,
                "enableProgressbar": true,
                "enableNeedle": true
              },
              "numInt": 1,
              "numDecimal": 0,
              "enableTimeout": false,
              "color": "contrast",
              "dataTimeout": 5,
              "ignoreZones": false
            }
          }
        }
      },
      {
        "x": 10,
        "y": 0,
        "w": 7,
        "h": 3,
        "minW": 1,
        "minH": 2,
        "id": "0c535217-8446-4f22-b491-5942bbb379f1",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-numeric",
            "uuid": "0c535217-8446-4f22-b491-5942bbb379f1",
            "config": {
              "supportAutomaticHistoricalSeries": true,
              "displayName": "Coolant Temp",
              "filterSelfPaths": true,
              "paths": {
                "numericPath": {
                  "description": "Numeric Data",
                  "path": "self.propulsion.main.coolantTemperature",
                  "source": "default",
                  "pathType": "number",
                  "suppressBootstrapNull": true,
                  "isPathConfigurable": true,
                  "convertUnitTo": "celsius",
                  "showPathSkUnitsFilter": true,
                  "pathSkUnitsFilter": null,
                  "sampleTime": 500
                }
              },
              "showMax": false,
              "showMin": false,
              "numDecimal": 1,
              "showMiniChart": false,
              "yScaleMin": 0,
              "yScaleMax": 10,
              "inverseYAxis": false,
              "verticalChart": false,
              "color": "orange",
              "enableTimeout": false,
              "dataTimeout": 5,
              "ignoreZones": false
            }
          }
        }
      },
      {
        "x": 17,
        "y": 0,
        "w": 7,
        "h": 3,
        "minW": 1,
        "minH": 2,
        "id": "438eee2d-1b6b-4a0f-b733-024d956eed0d",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-numeric",
            "uuid": "438eee2d-1b6b-4a0f-b733-024d956eed0d",
            "config": {
              "supportAutomaticHistoricalSeries": true,
              "displayName": "Alternator Temp",
              "filterSelfPaths": true,
              "paths": {
                "numericPath": {
                  "description": "Numeric Data",
                  "path": "self.electrical.alternators.main.temperature",
                  "source": "default",
                  "pathType": "number",
                  "suppressBootstrapNull": true,
                  "isPathConfigurable": true,
                  "convertUnitTo": "celsius",
                  "showPathSkUnitsFilter": true,
                  "pathSkUnitsFilter": null,
                  "sampleTime": 500
                }
              },
              "showMax": false,
              "showMin": false,
              "numDecimal": 1,
              "showMiniChart": false,
              "yScaleMin": 0,
              "yScaleMax": 10,
              "inverseYAxis": false,
              "verticalChart": false,
              "color": "orange",
              "enableTimeout": false,
              "dataTimeout": 5,
              "ignoreZones": false
            }
          }
        }
      },
      {
        "x": 10,
        "y": 3,
        "w": 7,
        "h": 3,
        "minW": 1,
        "minH": 2,
        "id": "e569342b-a84d-48d6-8e4b-ea3ecd5c116c",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-numeric",
            "uuid": "e569342b-a84d-48d6-8e4b-ea3ecd5c116c",
            "config": {
              "supportAutomaticHistoricalSeries": true,
              "displayName": "Oil Temp",
              "filterSelfPaths": true,
              "paths": {
                "numericPath": {
                  "description": "Numeric Data",
                  "path": "self.propulsion.main.oilTemperature",
                  "source": "default",
                  "pathType": "number",
                  "suppressBootstrapNull": true,
                  "isPathConfigurable": true,
                  "convertUnitTo": "celsius",
                  "showPathSkUnitsFilter": true,
                  "pathSkUnitsFilter": null,
                  "sampleTime": 500
                }
              },
              "showMax": false,
              "showMin": false,
              "numDecimal": 1,
              "showMiniChart": false,
              "yScaleMin": 0,
              "yScaleMax": 10,
              "inverseYAxis": false,
              "verticalChart": false,
              "color": "orange",
              "enableTimeout": false,
              "dataTimeout": 5,
              "ignoreZones": false
            }
          }
        }
      },
      {
        "x": 17,
        "y": 3,
        "w": 7,
        "h": 3,
        "minW": 1,
        "minH": 2,
        "id": "4728e9db-ad10-4b35-bf29-c43dd58942db",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-numeric",
            "uuid": "4728e9db-ad10-4b35-bf29-c43dd58942db",
            "config": {
              "supportAutomaticHistoricalSeries": true,
              "displayName": "Fuel Remaining",
              "filterSelfPaths": true,
              "paths": {
                "numericPath": {
                  "description": "Numeric Data",
                  "path": "self.tanks.fuel.main.currentVolume",
                  "source": "default",
                  "pathType": "number",
                  "suppressBootstrapNull": true,
                  "isPathConfigurable": true,
                  "convertUnitTo": "liter",
                  "showPathSkUnitsFilter": true,
                  "pathSkUnitsFilter": null,
                  "sampleTime": 500
                }
              },
              "showMax": false,
              "showMin": false,
              "numDecimal": 1,
              "showMiniChart": false,
              "yScaleMin": 0,
              "yScaleMax": 10,
              "inverseYAxis": false,
              "verticalChart": false,
              "color": "purple",
              "enableTimeout": false,
              "dataTimeout": 5,
              "ignoreZones": false
            }
          }
        }
      },
      {
        "x": 0,
        "y": 6,
        "w": 24,
        "h": 4,
        "minW": 2,
        "minH": 3,
        "id": "83b50db0-85c1-451f-84a1-28355f23829a",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-data-chart",
            "uuid": "83b50db0-85c1-451f-84a1-28355f23829a",
            "config": {
              "displayName": "Depth",
              "color": "blue",
              "filterSelfPaths": true,
              "datachartPath": "self.environment.depth.belowSurface",
              "datachartSource": "default",
              "datachartAngleRange": null,
              "convertUnitTo": "m",
              "timeScale": "minute",
              "period": 5,
              "numDecimal": 1,
              "inverseYAxis": true,
              "datasetAverageArray": "sma",
              "showDataPoints": false,
              "showAverageData": false,
              "trackAgainstAverage": false,
              "showDatasetMinimumValueLine": false,
              "showDatasetMaximumValueLine": false,
              "showDatasetAverageValueLine": true,
              "showDatasetAngleAverageValueLine": false,
              "showLabel": true,
              "showTimeScale": false,
              "startScaleAtZero": false,
              "verticalChart": false,
              "showYScale": true,
              "yScaleSuggestedMin": 0,
              "yScaleSuggestedMax": null,
              "enableMinMaxScaleLimit": false,
              "yScaleMin": null,
              "yScaleMax": null
            }
          }
        }
      },
      {
        "x": 0,
        "y": 10,
        "w": 24,
        "h": 4,
        "minW": 2,
        "minH": 3,
        "id": "9053d08a-7473-4003-b155-33ff4cffc425",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-data-chart",
            "uuid": "9053d08a-7473-4003-b155-33ff4cffc425",
            "config": {
              "displayName": "SOG",
              "color": "contrast",
              "filterSelfPaths": true,
              "datachartPath": "self.navigation.speedOverGround",
              "datachartSource": "default",
              "datachartAngleRange": null,
              "convertUnitTo": "knots",
              "timeScale": "minute",
              "period": 5,
              "numDecimal": 1,
              "inverseYAxis": false,
              "datasetAverageArray": "sma",
              "showDataPoints": false,
              "showAverageData": true,
              "trackAgainstAverage": false,
              "showDatasetMinimumValueLine": false,
              "showDatasetMaximumValueLine": false,
              "showDatasetAverageValueLine": true,
              "showDatasetAngleAverageValueLine": false,
              "showLabel": true,
              "showTimeScale": false,
              "startScaleAtZero": false,
              "verticalChart": false,
              "showYScale": true,
              "yScaleSuggestedMin": null,
              "yScaleSuggestedMax": null,
              "enableMinMaxScaleLimit": false,
              "yScaleMin": null,
              "yScaleMax": null
            }
          }
        }
      },
      {
        "x": 0,
        "y": 14,
        "w": 24,
        "h": 5,
        "minW": 2,
        "minH": 3,
        "id": "b6fd34bc-d2f1-4daf-afb7-a9e631ae6d70",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-data-chart",
            "uuid": "b6fd34bc-d2f1-4daf-afb7-a9e631ae6d70",
            "config": {
              "displayName": "Oil Temp",
              "color": "orange",
              "filterSelfPaths": true,
              "datachartPath": "self.propulsion.main.oilTemperature",
              "datachartSource": "default",
              "datachartAngleRange": null,
              "convertUnitTo": "celsius",
              "timeScale": "minute",
              "period": 30,
              "numDecimal": 1,
              "inverseYAxis": false,
              "datasetAverageArray": "sma",
              "showDataPoints": false,
              "showAverageData": true,
              "trackAgainstAverage": false,
              "showDatasetMinimumValueLine": false,
              "showDatasetMaximumValueLine": false,
              "showDatasetAverageValueLine": true,
              "showDatasetAngleAverageValueLine": false,
              "showLabel": true,
              "showTimeScale": false,
              "startScaleAtZero": false,
              "verticalChart": false,
              "showYScale": true,
              "yScaleSuggestedMin": null,
              "yScaleSuggestedMax": null,
              "enableMinMaxScaleLimit": false,
              "yScaleMin": null,
              "yScaleMax": null
            }
          }
        }
      },
      {
        "x": 0,
        "y": 19,
        "w": 11,
        "h": 5,
        "minW": 2,
        "minH": 2,
        "id": "6b26c483-fd2c-4270-94a3-db01945465bc",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-solar-charger",
            "uuid": "6b26c483-fd2c-4270-94a3-db01945465bc",
            "config": {
              "color": "yellow",
              "ignoreZones": false,
              "solarCharger": {
                "trackedDevices": [],
                "optionsById": {}
              }
            }
          }
        }
      },
      {
        "w": 7,
        "h": 2,
        "id": "3282bb32-3bdf-4ef3-a7b3-17eb4bc5211c",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-text",
            "uuid": "3282bb32-3bdf-4ef3-a7b3-17eb4bc5211c",
            "config": {
              "displayName": "Engine state",
              "filterSelfPaths": true,
              "paths": {
                "stringPath": {
                  "description": "String Data",
                  "path": "self.propulsion.main.state",
                  "source": "default",
                  "pathType": "string",
                  "isPathConfigurable": true,
                  "sampleTime": 500
                }
              },
              "color": "contrast",
              "enableTimeout": false,
              "dataTimeout": 5
            }
          }
        },
        "x": 17,
        "y": 19
      },
      {
        "x": 13,
        "y": 21,
        "w": 11,
        "h": 3,
        "minW": 2,
        "minH": 2,
        "id": "f5778f99-6753-4859-a13f-71dc7a0fe375",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-bms",
            "uuid": "f5778f99-6753-4859-a13f-71dc7a0fe375",
            "config": {
              "color": "blue",
              "ignoreZones": false,
              "bms": {
                "trackedDevices": [],
                "groups": [],
                "banks": []
              }
            }
          }
        }
      }
    ]
  },
  {
    "id": "93a553df-f227-4c9d-ba39-b1940c9d7b5f",
    "name": "Sailing",
    "icon": "dashboard-beating-starboard",
    "configuration": [
      {
        "x": 0,
        "y": 0,
        "w": 8,
        "minW": 1,
        "minH": 2,
        "id": "759f150f-2ea7-4c4d-9f47-7d4cb1b5285a",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-numeric",
            "uuid": "759f150f-2ea7-4c4d-9f47-7d4cb1b5285a",
            "config": {
              "supportAutomaticHistoricalSeries": true,
              "displayName": "AWA",
              "filterSelfPaths": true,
              "paths": {
                "numericPath": {
                  "description": "Numeric Data",
                  "path": "self.environment.wind.angleApparent",
                  "source": "default",
                  "pathType": "number",
                  "suppressBootstrapNull": true,
                  "isPathConfigurable": true,
                  "convertUnitTo": "deg",
                  "showPathSkUnitsFilter": true,
                  "pathSkUnitsFilter": null,
                  "sampleTime": 500
                }
              },
              "showMax": false,
              "showMin": false,
              "numDecimal": 1,
              "showMiniChart": false,
              "yScaleMin": 0,
              "yScaleMax": 10,
              "inverseYAxis": false,
              "verticalChart": false,
              "color": "orange",
              "enableTimeout": false,
              "dataTimeout": 5,
              "ignoreZones": false
            }
          }
        }
      },
      {
        "x": 8,
        "y": 0,
        "w": 16,
        "h": 10,
        "minW": 1,
        "minH": 2,
        "id": "f79df858-8076-40a3-8e00-9b0bcae635b9",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-wind-steer",
            "uuid": "f79df858-8076-40a3-8e00-9b0bcae635b9",
            "config": {
              "supportAutomaticHistoricalSeries": false,
              "filterSelfPaths": true,
              "paths": {
                "headingPath": {
                  "description": "True Heading",
                  "path": "self.navigation.headingTrue",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": true,
                  "pathRequired": true,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "rad",
                  "convertUnitTo": "deg",
                  "showConvertUnitTo": false,
                  "sampleTime": 100
                },
                "appWindAngle": {
                  "description": "Apparent Wind Angle",
                  "path": "self.environment.wind.angleApparent",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": true,
                  "pathRequired": true,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "rad",
                  "convertUnitTo": "deg",
                  "showConvertUnitTo": false,
                  "sampleTime": 100
                },
                "appWindSpeed": {
                  "description": "Apparent Wind Speed",
                  "path": "self.environment.wind.speedApparent",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": true,
                  "pathRequired": true,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "m/s",
                  "convertUnitTo": "m/s",
                  "sampleTime": 100
                },
                "trueWindAngle": {
                  "description": "True Wind Angle",
                  "path": "self.environment.wind.angleTrueGround",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": true,
                  "pathRequired": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "rad",
                  "convertUnitTo": "deg",
                  "showConvertUnitTo": false,
                  "sampleTime": 100
                },
                "trueWindSpeed": {
                  "description": "True Wind Speed",
                  "path": "self.environment.wind.speedOverGround",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": true,
                  "pathRequired": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "m/s",
                  "convertUnitTo": "m/s",
                  "sampleTime": 100
                },
                "courseOverGround": {
                  "description": "True Course Over Ground",
                  "path": "self.navigation.courseOverGroundTrue",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": true,
                  "pathRequired": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "rad",
                  "showConvertUnitTo": false,
                  "convertUnitTo": "deg",
                  "sampleTime": 100
                },
                "nextWaypointBearing": {
                  "description": "Next Waypoint True Bearing",
                  "path": "self.navigation.course.calcValues.bearingTrue",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": false,
                  "pathRequired": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "rad",
                  "convertUnitTo": "deg",
                  "showConvertUnitTo": false,
                  "sampleTime": 1000
                },
                "set": {
                  "description": "True Drift Set",
                  "path": "self.environment.current.setTrue",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": true,
                  "pathRequired": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "rad",
                  "convertUnitTo": "deg",
                  "showConvertUnitTo": false,
                  "sampleTime": 100
                },
                "drift": {
                  "description": "Drift Speed Impact",
                  "path": "self.environment.current.drift",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": true,
                  "pathRequired": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "m/s",
                  "convertUnitTo": "knots",
                  "sampleTime": 100
                }
              },
              "compassModeEnabled": true,
              "windSectorEnable": true,
              "windSectorWindowSeconds": 5,
              "laylineEnable": true,
              "laylineAngle": 40,
              "waypointEnable": true,
              "courseOverGroundEnable": true,
              "driftEnable": true,
              "awsEnable": true,
              "twsEnable": true,
              "twaEnable": true,
              "sailSetupEnable": false,
              "enableTimeout": false,
              "dataTimeout": 5
            }
          }
        }
      },
      {
        "x": 0,
        "y": 2,
        "w": 8,
        "minW": 1,
        "minH": 2,
        "id": "0cb0de9c-0395-4ae5-9ea3-44ef7b3b0629",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-numeric",
            "uuid": "0cb0de9c-0395-4ae5-9ea3-44ef7b3b0629",
            "config": {
              "supportAutomaticHistoricalSeries": true,
              "displayName": "TWA",
              "filterSelfPaths": true,
              "paths": {
                "numericPath": {
                  "description": "Numeric Data",
                  "path": "self.environment.wind.angleTrueGround",
                  "source": "default",
                  "pathType": "number",
                  "suppressBootstrapNull": true,
                  "isPathConfigurable": true,
                  "convertUnitTo": "deg",
                  "showPathSkUnitsFilter": true,
                  "pathSkUnitsFilter": null,
                  "sampleTime": 500
                }
              },
              "showMax": false,
              "showMin": false,
              "numDecimal": 1,
              "showMiniChart": false,
              "yScaleMin": 0,
              "yScaleMax": 10,
              "inverseYAxis": false,
              "verticalChart": false,
              "color": "yellow",
              "enableTimeout": false,
              "dataTimeout": 5,
              "ignoreZones": false
            }
          }
        }
      },
      {
        "x": 0,
        "y": 4,
        "w": 8,
        "h": 3,
        "minW": 1,
        "minH": 2,
        "id": "59252266-304a-4ffe-889d-25548b1887f7",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-numeric",
            "uuid": "59252266-304a-4ffe-889d-25548b1887f7",
            "config": {
              "supportAutomaticHistoricalSeries": true,
              "displayName": "Speed Over Ground",
              "filterSelfPaths": true,
              "paths": {
                "numericPath": {
                  "description": "Numeric Data",
                  "path": "self.navigation.speedOverGround",
                  "source": "default",
                  "pathType": "number",
                  "suppressBootstrapNull": true,
                  "isPathConfigurable": true,
                  "convertUnitTo": "knots",
                  "showPathSkUnitsFilter": true,
                  "pathSkUnitsFilter": null,
                  "sampleTime": 500
                }
              },
              "showMax": false,
              "showMin": false,
              "numDecimal": 1,
              "showMiniChart": false,
              "yScaleMin": 0,
              "yScaleMax": 10,
              "inverseYAxis": false,
              "verticalChart": false,
              "color": "contrast",
              "enableTimeout": false,
              "dataTimeout": 5,
              "ignoreZones": false
            }
          }
        }
      },
      {
        "x": 0,
        "y": 7,
        "w": 8,
        "h": 3,
        "minW": 1,
        "minH": 2,
        "id": "7d79218a-58f0-4db6-ac38-d7207cb044c1",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-numeric",
            "uuid": "7d79218a-58f0-4db6-ac38-d7207cb044c1",
            "config": {
              "supportAutomaticHistoricalSeries": true,
              "displayName": "STW",
              "filterSelfPaths": true,
              "paths": {
                "numericPath": {
                  "description": "Numeric Data",
                  "path": "self.navigation.speedThroughWater",
                  "source": "default",
                  "pathType": "number",
                  "suppressBootstrapNull": true,
                  "isPathConfigurable": true,
                  "convertUnitTo": "knots",
                  "showPathSkUnitsFilter": true,
                  "pathSkUnitsFilter": null,
                  "sampleTime": 500
                }
              },
              "showMax": false,
              "showMin": false,
              "numDecimal": 1,
              "showMiniChart": false,
              "yScaleMin": 0,
              "yScaleMax": 10,
              "inverseYAxis": false,
              "verticalChart": false,
              "color": "blue",
              "enableTimeout": false,
              "dataTimeout": 5,
              "ignoreZones": false
            }
          }
        }
      },
      {
        "w": 24,
        "h": 5,
        "id": "2bf732a1-14f2-4e18-8311-5c96c53b07f4",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-data-chart",
            "uuid": "2bf732a1-14f2-4e18-8311-5c96c53b07f4",
            "config": {
              "displayName": "SOG",
              "color": "contrast",
              "filterSelfPaths": true,
              "datachartPath": "self.navigation.speedOverGround",
              "datachartSource": "default",
              "datachartAngleRange": null,
              "convertUnitTo": "knots",
              "timeScale": "minute",
              "period": 5,
              "numDecimal": 1,
              "inverseYAxis": false,
              "datasetAverageArray": "sma",
              "showDataPoints": false,
              "showAverageData": true,
              "trackAgainstAverage": false,
              "showDatasetMinimumValueLine": false,
              "showDatasetMaximumValueLine": false,
              "showDatasetAverageValueLine": true,
              "showDatasetAngleAverageValueLine": false,
              "showLabel": true,
              "showTimeScale": false,
              "startScaleAtZero": false,
              "verticalChart": false,
              "showYScale": true,
              "yScaleSuggestedMin": null,
              "yScaleSuggestedMax": null,
              "enableMinMaxScaleLimit": false,
              "yScaleMin": null,
              "yScaleMax": null
            }
          }
        },
        "x": 0,
        "y": 10
      },
      {
        "w": 24,
        "h": 4,
        "id": "e7569e25-2671-4bcc-b8d4-a5c23f896530",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-data-chart",
            "uuid": "e7569e25-2671-4bcc-b8d4-a5c23f896530",
            "config": {
              "displayName": "Depth",
              "color": "blue",
              "filterSelfPaths": true,
              "datachartPath": "self.environment.depth.belowSurface",
              "datachartSource": "default",
              "datachartAngleRange": null,
              "convertUnitTo": "m",
              "timeScale": "minute",
              "period": 5,
              "numDecimal": 1,
              "inverseYAxis": true,
              "datasetAverageArray": "sma",
              "showDataPoints": false,
              "showAverageData": false,
              "trackAgainstAverage": false,
              "showDatasetMinimumValueLine": false,
              "showDatasetMaximumValueLine": false,
              "showDatasetAverageValueLine": true,
              "showDatasetAngleAverageValueLine": false,
              "showLabel": true,
              "showTimeScale": false,
              "startScaleAtZero": false,
              "verticalChart": false,
              "showYScale": true,
              "yScaleSuggestedMin": 0,
              "yScaleSuggestedMax": null,
              "enableMinMaxScaleLimit": false,
              "yScaleMin": null,
              "yScaleMax": null
            }
          }
        },
        "x": 0,
        "y": 15
      },
      {
        "x": 0,
        "y": 19,
        "w": 24,
        "h": 5,
        "minW": 2,
        "minH": 3,
        "id": "05530288-dbf2-4144-bc20-e43ce6684928",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-data-chart",
            "uuid": "05530288-dbf2-4144-bc20-e43ce6684928",
            "config": {
              "displayName": "TWS",
              "color": "yellow",
              "filterSelfPaths": true,
              "datachartPath": "self.environment.wind.speedOverGround",
              "datachartSource": "default",
              "datachartAngleRange": null,
              "convertUnitTo": "m/s",
              "timeScale": "minute",
              "period": 30,
              "numDecimal": 1,
              "inverseYAxis": false,
              "datasetAverageArray": "sma",
              "showDataPoints": false,
              "showAverageData": true,
              "trackAgainstAverage": false,
              "showDatasetMinimumValueLine": false,
              "showDatasetMaximumValueLine": false,
              "showDatasetAverageValueLine": true,
              "showDatasetAngleAverageValueLine": false,
              "showLabel": true,
              "showTimeScale": false,
              "startScaleAtZero": false,
              "verticalChart": false,
              "showYScale": true,
              "yScaleSuggestedMin": null,
              "yScaleSuggestedMax": null,
              "enableMinMaxScaleLimit": false,
              "yScaleMin": null,
              "yScaleMax": null
            }
          }
        }
      }
    ]
  },
  {
    "id": "93ea1cd5-0b1a-4963-bd63-d34f047eb5a1",
    "name": "Page 4",
    "icon": "dashboard-sailing",
    "configuration": [
      {
        "x": 0,
        "y": 0,
        "w": 11,
        "h": 8,
        "minW": 1,
        "minH": 2,
        "id": "84f7b83c-2fd9-4de6-88e8-a032a18048cd",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-heel-gauge",
            "uuid": "84f7b83c-2fd9-4de6-88e8-a032a18048cd",
            "config": {
              "supportAutomaticHistoricalSeries": false,
              "displayName": "Heel",
              "filterSelfPaths": true,
              "paths": {
                "angle": {
                  "description": "Heel / Roll Angle",
                  "path": "self.navigation.attitude",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": false,
                  "convertUnitTo": "deg",
                  "sampleTime": 1000,
                  "pathRequired": true
                }
              },
              "gauge": {
                "type": "angle",
                "invertAngle": false,
                "sideLabel": true
              },
              "numInt": 2,
              "numDecimal": 0,
              "color": "contrast",
              "enableTimeout": false,
              "dataTimeout": 5
            }
          }
        }
      },
      {
        "x": 13,
        "y": 0,
        "w": 11,
        "h": 8,
        "minW": 1,
        "minH": 2,
        "id": "119f2f65-e9f9-4c1d-ae93-2ac9ad12b313",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-horizon",
            "uuid": "119f2f65-e9f9-4c1d-ae93-2ac9ad12b313",
            "config": {
              "supportAutomaticHistoricalSeries": false,
              "displayName": "Horizon",
              "filterSelfPaths": true,
              "paths": {
                "gaugePitchPath": {
                  "description": "Attitude Pitch Data",
                  "path": "self.navigation.attitude",
                  "source": "default",
                  "pathType": "number",
                  "pathRequired": false,
                  "isPathConfigurable": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "rad",
                  "convertUnitTo": "deg",
                  "sampleTime": 1000
                },
                "gaugeRollPath": {
                  "description": "Attitude Roll Data",
                  "path": "self.navigation.attitude",
                  "source": "default",
                  "pathType": "number",
                  "pathRequired": false,
                  "isPathConfigurable": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "rad",
                  "convertUnitTo": "deg",
                  "sampleTime": 1000
                }
              },
              "gauge": {
                "type": "horizon",
                "noFrameVisible": false,
                "faceColor": "anthracite",
                "invertPitch": false,
                "invertRoll": false
              },
              "enableTimeout": false,
              "dataTimeout": 5
            }
          }
        }
      },
      {
        "x": 0,
        "y": 8,
        "w": 11,
        "h": 6,
        "minW": 1,
        "minH": 2,
        "id": "78a1195f-ef62-49ad-aadd-25dee5bc2fd1",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-position",
            "uuid": "78a1195f-ef62-49ad-aadd-25dee5bc2fd1",
            "config": {
              "supportAutomaticHistoricalSeries": false,
              "displayName": "Position",
              "filterSelfPaths": true,
              "paths": {
                "longPath": {
                  "description": "Longitude",
                  "path": "self.navigation.position",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": false,
                  "convertUnitTo": "longitudeMin",
                  "showPathSkUnitsFilter": true,
                  "pathSkUnitsFilter": null,
                  "sampleTime": 500
                },
                "latPath": {
                  "description": "Latitude",
                  "path": "self.navigation.position",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": false,
                  "convertUnitTo": "latitudeMin",
                  "showPathSkUnitsFilter": true,
                  "pathSkUnitsFilter": null,
                  "sampleTime": 500
                }
              },
              "color": "contrast",
              "enableTimeout": false,
              "dataTimeout": 5
            }
          }
        }
      },
      {
        "x": 13,
        "y": 8,
        "w": 11,
        "minW": 3,
        "minH": 9,
        "id": "1c1fe74e-139d-45b2-aac2-f397a40315e0",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-autopilot",
            "uuid": "1c1fe74e-139d-45b2-aac2-f397a40315e0",
            "config": {
              "supportAutomaticHistoricalSeries": false,
              "filterSelfPaths": true,
              "paths": {
                "autopilotState": {
                  "description": "Autopilot State",
                  "path": "self.steering.autopilot.state",
                  "source": "default",
                  "pathType": "string",
                  "isPathConfigurable": false,
                  "showPathSkUnitsFilter": false,
                  "convertUnitTo": "",
                  "sampleTime": 500
                },
                "autopilotMode": {
                  "description": "Autopilot Mode",
                  "path": "self.steering.autopilot.mode",
                  "source": "default",
                  "pathType": "string",
                  "isPathConfigurable": false,
                  "showPathSkUnitsFilter": false,
                  "convertUnitTo": "",
                  "sampleTime": 500
                },
                "autopilotEngaged": {
                  "description": "Autopilot Engaged",
                  "path": "self.steering.autopilot.engaged",
                  "source": "default",
                  "pathType": "boolean",
                  "isPathConfigurable": false,
                  "showPathSkUnitsFilter": false,
                  "convertUnitTo": "",
                  "sampleTime": 500
                },
                "autopilotV2Target": {
                  "description": "Autopilot API v2 Target",
                  "path": "self.steering.autopilot.target",
                  "source": "default",
                  "pathType": "number",
                  "convertUnitTo": "deg",
                  "isPathConfigurable": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "rad",
                  "sampleTime": 500
                },
                "autopilotTargetHeading": {
                  "description": "Autopilot Target Magnetic Heading",
                  "path": "self.steering.autopilot.target.headingMagnetic",
                  "source": "default",
                  "pathType": "number",
                  "convertUnitTo": "deg",
                  "isPathConfigurable": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "rad",
                  "sampleTime": 500
                },
                "autopilotTargetWindHeading": {
                  "description": "Autopilot Target Apparent Wind Angle",
                  "path": "self.steering.autopilot.target.windAngleApparent",
                  "source": "default",
                  "pathType": "number",
                  "convertUnitTo": "deg",
                  "isPathConfigurable": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "rad",
                  "sampleTime": 500
                },
                "rudderAngle": {
                  "description": "Rudder Angle",
                  "path": "self.steering.rudderAngle",
                  "source": "default",
                  "pathType": "number",
                  "convertUnitTo": "deg",
                  "isPathConfigurable": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "rad",
                  "sampleTime": 500
                },
                "courseXte": {
                  "description": "Cross Track Error",
                  "path": "self.navigation.course.calcValues.crossTrackError",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": false,
                  "convertUnitTo": "m",
                  "showPathSkUnitsFilter": true,
                  "pathRequired": false,
                  "pathSkUnitsFilter": "m",
                  "sampleTime": 500
                },
                "headingMag": {
                  "description": "Magnetic Heading",
                  "path": "self.navigation.headingMagnetic",
                  "source": "default",
                  "pathType": "number",
                  "convertUnitTo": "deg",
                  "isPathConfigurable": true,
                  "pathRequired": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "rad",
                  "showConvertUnitTo": false,
                  "sampleTime": 500
                },
                "headingTrue": {
                  "description": "True Heading",
                  "path": "self.navigation.headingTrue",
                  "source": "default",
                  "pathType": "number",
                  "convertUnitTo": "deg",
                  "isPathConfigurable": true,
                  "pathRequired": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "rad",
                  "showConvertUnitTo": false,
                  "sampleTime": 500
                },
                "windAngleApparent": {
                  "description": "Apparent Wind Angle",
                  "path": "self.environment.wind.angleApparent",
                  "source": "default",
                  "pathType": "number",
                  "convertUnitTo": "deg",
                  "isPathConfigurable": true,
                  "pathRequired": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "rad",
                  "showConvertUnitTo": false,
                  "sampleTime": 500
                },
                "windAngleTrueWater": {
                  "description": "Wind Angle True Water",
                  "path": "self.environment.wind.angleTrueGround",
                  "source": "default",
                  "pathType": "number",
                  "convertUnitTo": "deg",
                  "isPathConfigurable": true,
                  "pathRequired": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "rad",
                  "showConvertUnitTo": false,
                  "sampleTime": 500
                }
              },
              "autopilot": {
                "invertRudder": true,
                "headingDirectionTrue": true,
                "courseDirectionTrue": false,
                "apiVersion": "v2",
                "instanceId": null,
                "pluginId": "autopilot",
                "modes": []
              },
              "enableTimeout": false,
              "dataTimeout": 5
            }
          }
        }
      }
    ]
  }
];
