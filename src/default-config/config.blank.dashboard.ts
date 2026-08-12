// New-user / new-profile default dashboards.
//
// Extracted from a live Signal K applicationData config, then made
// vessel-agnostic so the pages work on any boat: every widget binds to the
// server's default $source, and the electrical widgets carry an empty
// trackedDevices list, which makes them auto-discover whatever the vessel
// reports instead of pinning one boat's device ids. Each widget's gridstack
// `id` equals its widgetProperties.uuid. Page ids here are placeholders: both
// seed paths (DashboardService and buildDefaultConfig) regenerate
// a fresh page id per instance.
// To refresh, re-export a good dashboard config and replace the array below.
// A live export carries the source vessel in more than its $sources, so strip
// all four kinds before committing: identity (sources, trackedDevices,
// optionsById, autopilot instanceId), calibration (display scales pinned to one
// boat's tank size or engine range), behavior (page auto-switch triggers), and
// stray whitespace in names. The seed guards in config.blank.dashboard.spec.ts
// and dashboard.service.spec.ts fail on each of these — run them, don't
// eyeball it.
import { Dashboard } from '../app/core/services/dashboard.service';

export const DefaultDashboard: Dashboard[] = [
  {
    "id": "2cfb533e-14e2-4a3c-a05a-3fec41d39e49",
    "name": "Demo",
    "icon": "dashboard-dashboard1",
    "configuration": [
      {
        "x": 0,
        "y": 0,
        "w": 8,
        "h": 3,
        "minW": 1,
        "minH": 2,
        "id": "9ff7ae6b-cfb3-483b-b426-2c0be949ce7c",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-numeric",
            "uuid": "9ff7ae6b-cfb3-483b-b426-2c0be949ce7c",
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
                  "pathSkUnitsFilter": null
                }
              },
              "showMax": false,
              "showMin": false,
              "numDecimal": 1,
              "showMiniChart": true,
              "yScaleMin": 0,
              "yScaleMax": 10,
              "inverseYAxis": false,
              "verticalChart": false,
              "color": "green",
              "updateInterval": 500,
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
        "w": 8,
        "h": 3,
        "minW": 1,
        "minH": 2,
        "id": "946b0c4e-8d0b-4e42-970b-54a4b08ff64c",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-numeric",
            "uuid": "946b0c4e-8d0b-4e42-970b-54a4b08ff64c",
            "config": {
              "supportAutomaticHistoricalSeries": true,
              "displayName": "Depth",
              "filterSelfPaths": true,
              "paths": {
                "numericPath": {
                  "description": "Numeric Data",
                  "path": "self.environment.depth.belowSurface",
                  "source": "default",
                  "pathType": "number",
                  "suppressBootstrapNull": true,
                  "isPathConfigurable": true,
                  "convertUnitTo": "m",
                  "showPathSkUnitsFilter": true,
                  "pathSkUnitsFilter": null
                }
              },
              "showMax": false,
              "showMin": false,
              "numDecimal": 1,
              "showMiniChart": true,
              "yScaleMin": 0,
              "yScaleMax": 10,
              "inverseYAxis": false,
              "verticalChart": false,
              "color": "blue",
              "updateInterval": 500,
              "enableTimeout": false,
              "dataTimeout": 5,
              "ignoreZones": false
            }
          }
        }
      },
      {
        "x": 16,
        "y": 0,
        "w": 8,
        "h": 3,
        "minW": 1,
        "minH": 2,
        "id": "881b74e1-2db6-4497-b3a7-05433b83a543",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-numeric",
            "uuid": "881b74e1-2db6-4497-b3a7-05433b83a543",
            "config": {
              "supportAutomaticHistoricalSeries": true,
              "displayName": "Course Over Ground (True)",
              "filterSelfPaths": true,
              "paths": {
                "numericPath": {
                  "description": "Numeric Data",
                  "path": "self.navigation.courseOverGroundTrue",
                  "source": "default",
                  "pathType": "number",
                  "suppressBootstrapNull": true,
                  "isPathConfigurable": true,
                  "convertUnitTo": "deg",
                  "showPathSkUnitsFilter": true,
                  "pathSkUnitsFilter": null
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
              "updateInterval": 500,
              "enableTimeout": false,
              "dataTimeout": 5,
              "ignoreZones": false
            }
          }
        }
      },
      {
        "x": 0,
        "y": 3,
        "w": 12,
        "h": 8,
        "minW": 1,
        "minH": 2,
        "id": "987a7fea-1a58-4ed2-9956-91155aa45203",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-gauge-ng-radial",
            "uuid": "987a7fea-1a58-4ed2-9956-91155aa45203",
            "config": {
              "supportAutomaticHistoricalSeries": true,
              "displayName": "Engine",
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
                  "convertUnitTo": "rpm"
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
              "updateInterval": 500,
              "enableTimeout": false,
              "color": "contrast",
              "dataTimeout": 5,
              "ignoreZones": false
            }
          }
        }
      },
      {
        "x": 12,
        "y": 3,
        "w": 12,
        "h": 11,
        "minW": 1,
        "minH": 2,
        "id": "1bef6637-fcd2-470b-b7dd-679e2600ff2f",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-wind-steer",
            "uuid": "1bef6637-fcd2-470b-b7dd-679e2600ff2f",
            "config": {
              "supportAutomaticHistoricalSeries": false,
              "filterSelfPaths": true,
              "paths": {
                "headingPath": {
                  "description": "Heading",
                  "pathOptions": [
                    {
                      "label": "True",
                      "path": "self.navigation.headingTrue"
                    },
                    {
                      "label": "Magnetic",
                      "path": "self.navigation.headingMagnetic"
                    }
                  ],
                  "path": "self.navigation.headingTrue",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": true,
                  "pathRequired": true,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "rad",
                  "convertUnitTo": "deg",
                  "showConvertUnitTo": false
                },
                "appWindAngle": {
                  "description": "Apparent Wind Angle",
                  "path": "self.environment.wind.angleApparent",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": false,
                  "pathRequired": true,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "rad",
                  "convertUnitTo": "deg",
                  "showConvertUnitTo": false
                },
                "appWindSpeed": {
                  "description": "Apparent Wind Speed",
                  "path": "self.environment.wind.speedApparent",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": false,
                  "pathRequired": true,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "m/s",
                  "convertUnitTo": "knots"
                },
                "trueWindAngle": {
                  "description": "Wind Angle",
                  "pathOptions": [
                    {
                      "label": "Water",
                      "path": "self.environment.wind.angleTrueWater"
                    },
                    {
                      "label": "Ground",
                      "path": "self.environment.wind.angleTrueGround"
                    }
                  ],
                  "path": "self.environment.wind.angleTrueWater",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": true,
                  "pathRequired": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "rad",
                  "convertUnitTo": "deg",
                  "showConvertUnitTo": false
                },
                "trueWindSpeed": {
                  "description": "True Wind Speed",
                  "path": "self.environment.wind.speedTrue",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": false,
                  "pathRequired": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "m/s",
                  "convertUnitTo": "knots"
                },
                "courseOverGround": {
                  "description": "Course Over Ground",
                  "pathOptions": [
                    {
                      "label": "True",
                      "path": "self.navigation.courseOverGroundTrue"
                    },
                    {
                      "label": "Magnetic",
                      "path": "self.navigation.courseOverGroundMagnetic"
                    }
                  ],
                  "path": "self.navigation.courseOverGroundTrue",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": true,
                  "pathRequired": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "rad",
                  "showConvertUnitTo": false,
                  "convertUnitTo": "deg"
                },
                "speedOverGround": {
                  "description": "Speed Over Ground",
                  "path": "self.navigation.speedOverGround",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": false,
                  "hideFromConfig": true,
                  "pathRequired": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "m/s",
                  "convertUnitTo": "knots"
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
                  "showConvertUnitTo": false
                },
                "set": {
                  "description": "True Drift Set",
                  "path": "self.environment.current.setTrue",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": false,
                  "pathRequired": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "rad",
                  "convertUnitTo": "deg",
                  "showConvertUnitTo": false
                },
                "drift": {
                  "description": "Drift Speed Impact",
                  "path": "self.environment.current.drift",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": false,
                  "pathRequired": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "m/s",
                  "convertUnitTo": "knots"
                },
                "rudderAngle": {
                  "description": "Rudder Angle",
                  "path": "self.steering.rudderAngle",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": true,
                  "pathRequired": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "rad",
                  "convertUnitTo": "deg",
                  "showConvertUnitTo": false
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
              "rudderEnable": true,
              "invertRudder": false,
              "updateInterval": 1000,
              "enableTimeout": false,
              "dataTimeout": 5
            }
          }
        }
      },
      {
        "x": 0,
        "y": 11,
        "w": 12,
        "h": 3,
        "minW": 1,
        "minH": 2,
        "id": "a08547b0-2eb7-4eab-9c4f-93c02b0a2847",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-simple-linear",
            "uuid": "a08547b0-2eb7-4eab-9c4f-93c02b0a2847",
            "config": {
              "supportAutomaticHistoricalSeries": true,
              "displayName": "Fuel",
              "filterSelfPaths": true,
              "paths": {
                "gaugePath": {
                  "description": "Numeric Data",
                  "path": "self.tanks.fuel.main.currentLevel",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": true,
                  "showPathSkUnitsFilter": true,
                  "pathSkUnitsFilter": "V",
                  "convertUnitTo": "percent"
                }
              },
              "displayScale": {
                "lower": 0,
                "upper": 100,
                "type": "linear"
              },
              "gauge": {
                "type": "simpleLinear",
                "unitLabelFormat": "full"
              },
              "numInt": 1,
              "numDecimal": 0,
              "ignoreZones": false,
              "color": "purple",
              "updateInterval": 500,
              "enableTimeout": false,
              "dataTimeout": 5
            }
          }
        }
      },
      {
        "x": 0,
        "y": 14,
        "w": 12,
        "h": 3,
        "minW": 1,
        "minH": 2,
        "id": "109484e3-a1c9-4f1f-b020-b2a6c0c069c2",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-gauge-ng-linear",
            "uuid": "109484e3-a1c9-4f1f-b020-b2a6c0c069c2",
            "config": {
              "supportAutomaticHistoricalSeries": true,
              "displayName": "Coolant Temperature",
              "filterSelfPaths": true,
              "paths": {
                "gaugePath": {
                  "description": "Numeric Data",
                  "path": "self.propulsion.main.coolantTemperature",
                  "source": "default",
                  "pathType": "number",
                  "suppressBootstrapNull": true,
                  "isPathConfigurable": true,
                  "showPathSkUnitsFilter": true,
                  "pathSkUnitsFilter": null,
                  "convertUnitTo": "celsius"
                }
              },
              "displayScale": {
                "lower": 0,
                "upper": 120,
                "type": "linear"
              },
              "gauge": {
                "type": "ngLinear",
                "subType": "horizontal",
                "highlightsWidth": 5,
                "enableTicks": true,
                "enableNeedle": false
              },
              "numInt": 1,
              "numDecimal": 0,
              "color": "blue",
              "updateInterval": 500,
              "enableTimeout": false,
              "dataTimeout": 5,
              "ignoreZones": false
            }
          }
        }
      },
      {
        "x": 12,
        "y": 14,
        "w": 12,
        "h": 6,
        "minW": 1,
        "minH": 2,
        "id": "6faced05-3f6b-4bed-8bc4-7c21d343cdf0",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-heel-gauge",
            "uuid": "6faced05-3f6b-4bed-8bc4-7c21d343cdf0",
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
                  "showConvertUnitTo": false,
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
              "updateInterval": 250,
              "enableTimeout": true,
              "dataTimeout": 5
            }
          }
        }
      },
      {
        "x": 0,
        "y": 17,
        "w": 12,
        "h": 3,
        "minW": 2,
        "minH": 2,
        "id": "d18bc4ba-9864-4359-8bdb-f8b51125c726",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-bms",
            "uuid": "d18bc4ba-9864-4359-8bdb-f8b51125c726",
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
      },
      {
        "x": 0,
        "y": 20,
        "w": 8,
        "h": 4,
        "minW": 2,
        "minH": 2,
        "id": "1d80d89d-c29b-434d-903e-dd35fbfda44f",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-solar-charger",
            "uuid": "1d80d89d-c29b-434d-903e-dd35fbfda44f",
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
        "w": 8,
        "h": 4,
        "id": "ac80f808-19e6-454d-8e60-54b335e0e84f",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-data-chart",
            "uuid": "ac80f808-19e6-454d-8e60-54b335e0e84f",
            "config": {
              "displayName": "Barometer",
              "color": "grey",
              "filterSelfPaths": true,
              "datachartPath": "self.environment.outside.pressure",
              "datachartSource": "default",
              "datachartAngleRange": null,
              "timeScale": "hour",
              "period": 24,
              "numDecimal": 1,
              "inverseYAxis": false,
              "datasetAverageArray": "sma",
              "showDataPoints": false,
              "showAverageData": false,
              "trackAgainstAverage": false,
              "showDatasetMinimumValueLine": false,
              "showDatasetMaximumValueLine": false,
              "showDatasetAverageValueLine": false,
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
              "yScaleMax": null,
              "convertUnitTo": "mbar"
            }
          }
        },
        "x": 8,
        "y": 20
      },
      {
        "x": 16,
        "y": 20,
        "w": 8,
        "h": 4,
        "minW": 1,
        "minH": 2,
        "id": "2f3849e7-1196-4ee2-824f-7382aa97025c",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-position",
            "uuid": "2f3849e7-1196-4ee2-824f-7382aa97025c",
            "config": {
              "supportAutomaticHistoricalSeries": false,
              "displayName": "Position",
              "filterSelfPaths": true,
              "paths": {
                "positionPath": {
                  "description": "Position",
                  "path": "self.navigation.position",
                  "source": "default",
                  "pathType": "object",
                  "isPathConfigurable": true,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": null
                }
              },
              "color": "contrast",
              "updateInterval": 500,
              "enableTimeout": false,
              "dataTimeout": 5
            }
          }
        }
      }
    ]
  },
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
              "displayName": "True Wind Speed",
              "color": "orange",
              "filterSelfPaths": true,
              "datachartPath": "self.environment.wind.speedOverGround",
              "datachartSource": "default",
              "datachartAngleRange": null,
              "timeScale": "hour",
              "period": 3,
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
              "yScaleMax": null,
              "convertUnitTo": "m/s"
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
              "timeScale": "hour",
              "period": 24,
              "numDecimal": 1,
              "inverseYAxis": false,
              "datasetAverageArray": "sma",
              "showDataPoints": false,
              "showAverageData": false,
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
              "yScaleMax": null,
              "convertUnitTo": "celsius"
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
              "timeScale": "hour",
              "period": 24,
              "numDecimal": 1,
              "inverseYAxis": false,
              "datasetAverageArray": "sma",
              "showDataPoints": false,
              "showAverageData": false,
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
              "yScaleMax": null,
              "convertUnitTo": "celsius"
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
              "timeScale": "hour",
              "period": 24,
              "numDecimal": 1,
              "inverseYAxis": false,
              "datasetAverageArray": "sma",
              "showDataPoints": false,
              "showAverageData": false,
              "trackAgainstAverage": false,
              "showDatasetMinimumValueLine": false,
              "showDatasetMaximumValueLine": false,
              "showDatasetAverageValueLine": false,
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
              "yScaleMax": null,
              "convertUnitTo": "mbar"
            }
          }
        }
      },
      {
        "w": 7,
        "h": 2,
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
                  "isPathConfigurable": true
                }
              },
              "color": "pink",
              "updateInterval": 500,
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
                  "pathSkUnitsFilter": null
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
              "updateInterval": 500,
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
              "timeScale": "hour",
              "period": 24,
              "numDecimal": 1,
              "inverseYAxis": false,
              "datasetAverageArray": "sma",
              "showDataPoints": false,
              "showAverageData": false,
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
              "yScaleMax": null,
              "convertUnitTo": "celsius"
            }
          }
        }
      },
      {
        "x": 0,
        "y": 22,
        "w": 7,
        "minW": 1,
        "minH": 2,
        "id": "37b8d3de-3666-455f-a6fc-ad98b5428ff0",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-text",
            "uuid": "37b8d3de-3666-455f-a6fc-ad98b5428ff0",
            "config": {
              "displayName": "Engine State",
              "filterSelfPaths": true,
              "paths": {
                "stringPath": {
                  "description": "String Data",
                  "path": "self.propulsion.main.state",
                  "source": "default",
                  "pathType": "string",
                  "isPathConfigurable": true
                }
              },
              "color": "orange",
              "updateInterval": 500,
              "enableTimeout": false,
              "dataTimeout": 5
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
        "w": 8,
        "h": 10,
        "minW": 1,
        "minH": 2,
        "id": "9ee51443-079f-4829-be4b-884a581934b6",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-gauge-steel",
            "uuid": "9ee51443-079f-4829-be4b-884a581934b6",
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
                  "isPathConfigurable": true,
                  "showPathSkUnitsFilter": true,
                  "pathSkUnitsFilter": null,
                  "convertUnitTo": "rpm"
                }
              },
              "displayScale": {
                "type": "linear",
                "lower": 0,
                "upper": 3600
              },
              "gauge": {
                "type": "steel",
                "subType": "radial",
                "backgroundColor": "darkGray",
                "faceColor": "blackMetal",
                "radialSize": "full",
                "rotateFace": false,
                "digitalMeter": false
              },
              "numDecimal": 2,
              "updateInterval": 500,
              "enableTimeout": false,
              "dataTimeout": 5,
              "ignoreZones": false
            }
          }
        }
      },
      {
        "w": 8,
        "h": 4,
        "id": "28e2ceeb-16f2-425a-8839-aa225425a0b4",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-numeric",
            "uuid": "28e2ceeb-16f2-425a-8839-aa225425a0b4",
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
                  "pathSkUnitsFilter": null
                }
              },
              "showMax": false,
              "showMin": false,
              "numDecimal": 1,
              "showMiniChart": true,
              "yScaleMin": 0,
              "yScaleMax": 10,
              "inverseYAxis": false,
              "verticalChart": false,
              "color": "contrast",
              "updateInterval": 500,
              "enableTimeout": false,
              "dataTimeout": 5,
              "ignoreZones": false
            }
          }
        },
        "x": 8,
        "y": 0
      },
      {
        "w": 8,
        "h": 6,
        "id": "edffc5bd-c02b-4195-9d79-1aa73df4c97c",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-numeric",
            "uuid": "edffc5bd-c02b-4195-9d79-1aa73df4c97c",
            "config": {
              "supportAutomaticHistoricalSeries": true,
              "displayName": "Depth",
              "filterSelfPaths": true,
              "paths": {
                "numericPath": {
                  "description": "Numeric Data",
                  "path": "self.environment.depth.belowSurface",
                  "source": "default",
                  "pathType": "number",
                  "suppressBootstrapNull": true,
                  "isPathConfigurable": true,
                  "convertUnitTo": "m",
                  "showPathSkUnitsFilter": true,
                  "pathSkUnitsFilter": null
                }
              },
              "showMax": false,
              "showMin": false,
              "numDecimal": 1,
              "showMiniChart": true,
              "yScaleMin": 0,
              "yScaleMax": 10,
              "inverseYAxis": false,
              "verticalChart": false,
              "color": "blue",
              "updateInterval": 500,
              "enableTimeout": false,
              "dataTimeout": 5,
              "ignoreZones": false
            }
          }
        },
        "x": 16,
        "y": 0
      },
      {
        "x": 8,
        "y": 4,
        "w": 8,
        "h": 4,
        "minW": 1,
        "minH": 2,
        "id": "8ca6edc8-88c1-44e4-857d-b65f536497f3",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-numeric",
            "uuid": "8ca6edc8-88c1-44e4-857d-b65f536497f3",
            "config": {
              "supportAutomaticHistoricalSeries": true,
              "displayName": "Course Over Ground",
              "filterSelfPaths": true,
              "paths": {
                "numericPath": {
                  "description": "Numeric Data",
                  "path": "self.navigation.courseOverGroundTrue",
                  "source": "default",
                  "pathType": "number",
                  "suppressBootstrapNull": true,
                  "isPathConfigurable": true,
                  "convertUnitTo": "deg",
                  "showPathSkUnitsFilter": true,
                  "pathSkUnitsFilter": null
                }
              },
              "showMax": false,
              "showMin": false,
              "numDecimal": 0,
              "showMiniChart": false,
              "yScaleMin": 0,
              "yScaleMax": 10,
              "inverseYAxis": false,
              "verticalChart": false,
              "color": "green",
              "updateInterval": 500,
              "enableTimeout": false,
              "dataTimeout": 5,
              "ignoreZones": false
            }
          }
        }
      },
      {
        "x": 16,
        "y": 6,
        "w": 8,
        "h": 13,
        "minW": 3,
        "minH": 9,
        "id": "7cdb8ef5-9bab-46f0-be4c-17b37a5e9fdb",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-autopilot",
            "uuid": "7cdb8ef5-9bab-46f0-be4c-17b37a5e9fdb",
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
                  "convertUnitTo": ""
                },
                "autopilotMode": {
                  "description": "Autopilot Mode",
                  "path": "self.steering.autopilot.mode",
                  "source": "default",
                  "pathType": "string",
                  "isPathConfigurable": false,
                  "showPathSkUnitsFilter": false,
                  "convertUnitTo": ""
                },
                "autopilotEngaged": {
                  "description": "Autopilot Engaged",
                  "path": "self.steering.autopilot.engaged",
                  "source": "default",
                  "pathType": "boolean",
                  "isPathConfigurable": false,
                  "showPathSkUnitsFilter": false,
                  "convertUnitTo": ""
                },
                "autopilotV2Target": {
                  "description": "Autopilot API v2 Target",
                  "path": "self.steering.autopilot.target",
                  "source": "default",
                  "pathType": "number",
                  "convertUnitTo": "deg",
                  "showConvertUnitTo": false,
                  "isPathConfigurable": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "rad"
                },
                "autopilotTargetHeading": {
                  "description": "Autopilot Target Magnetic Heading",
                  "path": "self.steering.autopilot.target.headingMagnetic",
                  "source": "default",
                  "pathType": "number",
                  "convertUnitTo": "deg",
                  "showConvertUnitTo": false,
                  "isPathConfigurable": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "rad"
                },
                "autopilotTargetWindHeading": {
                  "description": "Autopilot Target Apparent Wind Angle",
                  "path": "self.steering.autopilot.target.windAngleApparent",
                  "source": "default",
                  "pathType": "number",
                  "convertUnitTo": "deg",
                  "showConvertUnitTo": false,
                  "isPathConfigurable": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "rad"
                },
                "rudderAngle": {
                  "description": "Rudder Angle",
                  "path": "self.steering.rudderAngle",
                  "source": "default",
                  "pathType": "number",
                  "convertUnitTo": "deg",
                  "showConvertUnitTo": false,
                  "isPathConfigurable": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "rad"
                },
                "courseXte": {
                  "description": "Cross Track Error",
                  "path": "self.navigation.course.calcValues.crossTrackError",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": false,
                  "convertUnitTo": "m",
                  "showConvertUnitTo": false,
                  "showPathSkUnitsFilter": true,
                  "pathRequired": false,
                  "pathSkUnitsFilter": "m"
                },
                "headingMag": {
                  "description": "Magnetic Heading",
                  "path": "self.navigation.headingMagnetic",
                  "source": "default",
                  "pathType": "number",
                  "convertUnitTo": "deg",
                  "isPathConfigurable": false,
                  "pathRequired": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "rad",
                  "showConvertUnitTo": false
                },
                "headingTrue": {
                  "description": "True Heading",
                  "path": "self.navigation.headingTrue",
                  "source": "default",
                  "pathType": "number",
                  "convertUnitTo": "deg",
                  "isPathConfigurable": false,
                  "pathRequired": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "rad",
                  "showConvertUnitTo": false
                },
                "windAngleApparent": {
                  "description": "Apparent Wind Angle",
                  "path": "self.environment.wind.angleApparent",
                  "source": "default",
                  "pathType": "number",
                  "convertUnitTo": "deg",
                  "isPathConfigurable": false,
                  "pathRequired": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "rad",
                  "showConvertUnitTo": false
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
              "updateInterval": 500,
              "enableTimeout": false,
              "dataTimeout": 5
            }
          }
        }
      },
      {
        "x": 8,
        "y": 8,
        "w": 8,
        "h": 3,
        "minW": 1,
        "minH": 2,
        "id": "c453242c-9fe7-45a6-9679-93eef6306f33",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-numeric",
            "uuid": "c453242c-9fe7-45a6-9679-93eef6306f33",
            "config": {
              "supportAutomaticHistoricalSeries": true,
              "displayName": "Bearing To Waypoint",
              "filterSelfPaths": true,
              "paths": {
                "numericPath": {
                  "description": "Numeric Data",
                  "path": "self.navigation.course.calcValues.bearingTrue",
                  "source": "default",
                  "pathType": "number",
                  "suppressBootstrapNull": true,
                  "isPathConfigurable": true,
                  "convertUnitTo": "deg",
                  "showPathSkUnitsFilter": true,
                  "pathSkUnitsFilter": null
                }
              },
              "showMax": false,
              "showMin": false,
              "numDecimal": 0,
              "showMiniChart": false,
              "yScaleMin": 0,
              "yScaleMax": 10,
              "inverseYAxis": false,
              "verticalChart": false,
              "color": "grey",
              "updateInterval": 500,
              "enableTimeout": false,
              "dataTimeout": 5,
              "ignoreZones": false
            }
          }
        }
      },
      {
        "x": 0,
        "y": 10,
        "w": 8,
        "minW": 1,
        "minH": 2,
        "id": "89ea8182-7aad-4c20-9e13-ac256c77ca18",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-simple-linear",
            "uuid": "89ea8182-7aad-4c20-9e13-ac256c77ca18",
            "config": {
              "supportAutomaticHistoricalSeries": true,
              "displayName": "Oil Temperature",
              "filterSelfPaths": true,
              "paths": {
                "gaugePath": {
                  "description": "Numeric Data",
                  "path": "self.propulsion.main.oilTemperature",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": true,
                  "showPathSkUnitsFilter": true,
                  "pathSkUnitsFilter": "V",
                  "convertUnitTo": "celsius"
                }
              },
              "displayScale": {
                "lower": 0,
                "upper": 120,
                "type": "linear"
              },
              "gauge": {
                "type": "simpleLinear",
                "unitLabelFormat": "full"
              },
              "numInt": 1,
              "numDecimal": 0,
              "ignoreZones": false,
              "color": "orange",
              "updateInterval": 500,
              "enableTimeout": false,
              "dataTimeout": 5
            }
          }
        },
        "h": 3
      },
      {
        "x": 8,
        "y": 11,
        "w": 8,
        "h": 3,
        "minW": 1,
        "minH": 2,
        "id": "b05bbd64-1cc5-41c0-ad80-8317b1c8cd6c",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-numeric",
            "uuid": "b05bbd64-1cc5-41c0-ad80-8317b1c8cd6c",
            "config": {
              "supportAutomaticHistoricalSeries": true,
              "displayName": "Distance To Waypoint",
              "filterSelfPaths": true,
              "paths": {
                "numericPath": {
                  "description": "Numeric Data",
                  "path": "self.navigation.course.calcValues.distance",
                  "source": "default",
                  "pathType": "number",
                  "suppressBootstrapNull": true,
                  "isPathConfigurable": true,
                  "convertUnitTo": "nm",
                  "showPathSkUnitsFilter": true,
                  "pathSkUnitsFilter": null
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
              "updateInterval": 500,
              "enableTimeout": false,
              "dataTimeout": 5,
              "ignoreZones": false
            }
          }
        }
      },
      {
        "x": 0,
        "y": 13,
        "w": 8,
        "minW": 1,
        "minH": 2,
        "id": "1dd97db8-2317-4f12-aa99-2f2c78e447f7",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-simple-linear",
            "uuid": "1dd97db8-2317-4f12-aa99-2f2c78e447f7",
            "config": {
              "supportAutomaticHistoricalSeries": true,
              "displayName": "Coolant Temperature",
              "filterSelfPaths": true,
              "paths": {
                "gaugePath": {
                  "description": "Numeric Data",
                  "path": "self.propulsion.main.coolantTemperature",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": true,
                  "showPathSkUnitsFilter": true,
                  "pathSkUnitsFilter": "V",
                  "convertUnitTo": "celsius"
                }
              },
              "displayScale": {
                "lower": 0,
                "upper": 120,
                "type": "linear"
              },
              "gauge": {
                "type": "simpleLinear",
                "unitLabelFormat": "full"
              },
              "numInt": 1,
              "numDecimal": 0,
              "ignoreZones": false,
              "color": "blue",
              "updateInterval": 500,
              "enableTimeout": false,
              "dataTimeout": 5
            }
          }
        },
        "h": 3
      },
      {
        "x": 8,
        "y": 14,
        "w": 8,
        "h": 5,
        "minW": 1,
        "minH": 2,
        "id": "a685034f-26e5-4f06-885a-039956b11a75",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-position",
            "uuid": "a685034f-26e5-4f06-885a-039956b11a75",
            "config": {
              "supportAutomaticHistoricalSeries": false,
              "displayName": "Position",
              "filterSelfPaths": true,
              "paths": {
                "positionPath": {
                  "description": "Position",
                  "path": "self.navigation.position",
                  "source": "default",
                  "pathType": "object",
                  "isPathConfigurable": true,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": null
                }
              },
              "color": "contrast",
              "updateInterval": 500,
              "enableTimeout": false,
              "dataTimeout": 5
            }
          }
        }
      },
      {
        "x": 0,
        "y": 16,
        "w": 8,
        "minW": 1,
        "minH": 2,
        "id": "301ca337-18b9-4134-94b9-c94b238e3387",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-simple-linear",
            "uuid": "301ca337-18b9-4134-94b9-c94b238e3387",
            "config": {
              "supportAutomaticHistoricalSeries": true,
              "displayName": "Fuel",
              "filterSelfPaths": true,
              "paths": {
                "gaugePath": {
                  "description": "Numeric Data",
                  "path": "self.tanks.fuel.main.currentLevel",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": true,
                  "showPathSkUnitsFilter": true,
                  "pathSkUnitsFilter": "V",
                  "convertUnitTo": "percent"
                }
              },
              "displayScale": {
                "lower": 0,
                "upper": 100,
                "type": "linear"
              },
              "gauge": {
                "type": "simpleLinear",
                "unitLabelFormat": "full"
              },
              "numInt": 1,
              "numDecimal": 0,
              "ignoreZones": false,
              "color": "purple",
              "updateInterval": 500,
              "enableTimeout": false,
              "dataTimeout": 5
            }
          }
        },
        "h": 3
      },
      {
        "x": 0,
        "y": 19,
        "w": 8,
        "h": 5,
        "minW": 2,
        "minH": 2,
        "id": "8ea1c467-05ce-4033-87b2-18a9054a18f6",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-alternator",
            "uuid": "8ea1c467-05ce-4033-87b2-18a9054a18f6",
            "config": {
              "color": "grey",
              "ignoreZones": false,
              "alternator": {
                "trackedDevices": [],
                "optionsById": {}
              }
            }
          }
        }
      },
      {
        "x": 8,
        "y": 19,
        "w": 8,
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
        "x": 16,
        "y": 19,
        "w": 8,
        "h": 5,
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
        "h": 3,
        "minW": 1,
        "minH": 2,
        "id": "481f6f65-417a-4bb7-a5a2-5ba2b83f751f",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-numeric",
            "uuid": "481f6f65-417a-4bb7-a5a2-5ba2b83f751f",
            "config": {
              "supportAutomaticHistoricalSeries": true,
              "displayName": "Depth",
              "filterSelfPaths": true,
              "paths": {
                "numericPath": {
                  "description": "Numeric Data",
                  "path": "self.environment.depth.belowSurface",
                  "source": "default",
                  "pathType": "number",
                  "suppressBootstrapNull": true,
                  "isPathConfigurable": true,
                  "convertUnitTo": "m",
                  "showPathSkUnitsFilter": true,
                  "pathSkUnitsFilter": null
                }
              },
              "showMax": false,
              "showMin": false,
              "numDecimal": 1,
              "showMiniChart": true,
              "yScaleMin": 0,
              "yScaleMax": 10,
              "inverseYAxis": false,
              "verticalChart": false,
              "color": "blue",
              "updateInterval": 500,
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
                  "description": "Heading",
                  "pathOptions": [
                    {
                      "label": "True",
                      "path": "self.navigation.headingTrue"
                    },
                    {
                      "label": "Magnetic",
                      "path": "self.navigation.headingMagnetic"
                    }
                  ],
                  "path": "self.navigation.headingTrue",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": true,
                  "pathRequired": true,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "rad",
                  "convertUnitTo": "deg",
                  "showConvertUnitTo": false
                },
                "appWindAngle": {
                  "description": "Apparent Wind Angle",
                  "path": "self.environment.wind.angleApparent",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": false,
                  "pathRequired": true,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "rad",
                  "convertUnitTo": "deg",
                  "showConvertUnitTo": false
                },
                "appWindSpeed": {
                  "description": "Apparent Wind Speed",
                  "path": "self.environment.wind.speedApparent",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": false,
                  "pathRequired": true,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "m/s",
                  "convertUnitTo": "knots"
                },
                "trueWindAngle": {
                  "description": "Wind Angle",
                  "pathOptions": [
                    {
                      "label": "Water",
                      "path": "self.environment.wind.angleTrueWater"
                    },
                    {
                      "label": "Ground",
                      "path": "self.environment.wind.angleTrueGround"
                    }
                  ],
                  "path": "self.environment.wind.angleTrueWater",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": true,
                  "pathRequired": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "rad",
                  "convertUnitTo": "deg",
                  "showConvertUnitTo": false
                },
                "trueWindSpeed": {
                  "description": "True Wind Speed",
                  "path": "self.environment.wind.speedTrue",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": false,
                  "pathRequired": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "m/s",
                  "convertUnitTo": "knots"
                },
                "courseOverGround": {
                  "description": "Course Over Ground",
                  "pathOptions": [
                    {
                      "label": "True",
                      "path": "self.navigation.courseOverGroundTrue"
                    },
                    {
                      "label": "Magnetic",
                      "path": "self.navigation.courseOverGroundMagnetic"
                    }
                  ],
                  "path": "self.navigation.courseOverGroundTrue",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": true,
                  "pathRequired": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "rad",
                  "showConvertUnitTo": false,
                  "convertUnitTo": "deg"
                },
                "speedOverGround": {
                  "description": "Speed Over Ground",
                  "path": "self.navigation.speedOverGround",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": false,
                  "hideFromConfig": true,
                  "pathRequired": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "m/s",
                  "convertUnitTo": "knots"
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
                  "showConvertUnitTo": false
                },
                "set": {
                  "description": "True Drift Set",
                  "path": "self.environment.current.setTrue",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": false,
                  "pathRequired": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "rad",
                  "convertUnitTo": "deg",
                  "showConvertUnitTo": false
                },
                "drift": {
                  "description": "Drift Speed Impact",
                  "path": "self.environment.current.drift",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": false,
                  "pathRequired": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "m/s",
                  "convertUnitTo": "knots"
                },
                "rudderAngle": {
                  "description": "Rudder Angle",
                  "path": "self.steering.rudderAngle",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": true,
                  "pathRequired": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "rad",
                  "convertUnitTo": "deg",
                  "showConvertUnitTo": false
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
              "rudderEnable": true,
              "invertRudder": false,
              "updateInterval": 1000,
              "enableTimeout": false,
              "dataTimeout": 5
            }
          }
        }
      },
      {
        "x": 0,
        "y": 3,
        "w": 8,
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
                  "pathSkUnitsFilter": null
                }
              },
              "showMax": false,
              "showMin": false,
              "numDecimal": 1,
              "showMiniChart": true,
              "yScaleMin": 0,
              "yScaleMax": 10,
              "inverseYAxis": false,
              "verticalChart": false,
              "color": "contrast",
              "updateInterval": 500,
              "enableTimeout": false,
              "dataTimeout": 5,
              "ignoreZones": false
            }
          }
        },
        "h": 3
      },
      {
        "x": 0,
        "y": 6,
        "w": 8,
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
              "displayName": "Speed Through Water",
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
                  "pathSkUnitsFilter": null
                }
              },
              "showMax": false,
              "showMin": false,
              "numDecimal": 1,
              "showMiniChart": true,
              "yScaleMin": 0,
              "yScaleMax": 10,
              "inverseYAxis": false,
              "verticalChart": false,
              "color": "blue",
              "updateInterval": 500,
              "enableTimeout": false,
              "dataTimeout": 5,
              "ignoreZones": false
            }
          }
        },
        "h": 3
      },
      {
        "x": 0,
        "y": 9,
        "w": 8,
        "h": 3,
        "minW": 1,
        "minH": 2,
        "id": "3377c5c3-4285-4cb5-b8a8-39fead2d6f3b",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-numeric",
            "uuid": "3377c5c3-4285-4cb5-b8a8-39fead2d6f3b",
            "config": {
              "supportAutomaticHistoricalSeries": true,
              "displayName": "Velocity Made Good",
              "filterSelfPaths": true,
              "paths": {
                "numericPath": {
                  "description": "Numeric Data",
                  "path": "self.performance.velocityMadeGood",
                  "source": "default",
                  "pathType": "number",
                  "suppressBootstrapNull": true,
                  "isPathConfigurable": true,
                  "convertUnitTo": "knots",
                  "showPathSkUnitsFilter": true,
                  "pathSkUnitsFilter": null
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
              "color": "pink",
              "updateInterval": 500,
              "enableTimeout": false,
              "dataTimeout": 5,
              "ignoreZones": false
            }
          }
        }
      },
      {
        "x": 8,
        "y": 10,
        "w": 16,
        "h": 14,
        "minW": 8,
        "minH": 6,
        "id": "601984a5-0327-4732-b145-a7a295c21ea6",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-windtrends-chart",
            "uuid": "601984a5-0327-4732-b145-a7a295c21ea6",
            "config": {
              "filterSelfPaths": true,
              "color": "contrast",
              "timeScale": "Last 30 Minutes",
              "updateInterval": 500,
              "paths": {
                "trueWindDirection": {
                  "description": "Wind Direction",
                  "pathOptions": [
                    {
                      "label": "True",
                      "path": "self.environment.wind.directionTrue"
                    },
                    {
                      "label": "Magnetic",
                      "path": "self.environment.wind.directionMagnetic"
                    }
                  ],
                  "path": "self.environment.wind.directionTrue",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": true,
                  "pathRequired": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "rad",
                  "convertUnitTo": "deg",
                  "showConvertUnitTo": false
                },
                "trueWindSpeed": {
                  "description": "True Wind Speed",
                  "path": "self.environment.wind.speedTrue",
                  "source": "default",
                  "pathType": "number",
                  "isPathConfigurable": false,
                  "pathRequired": false,
                  "showPathSkUnitsFilter": false,
                  "pathSkUnitsFilter": "m/s",
                  "convertUnitTo": "knots"
                }
              }
            }
          }
        }
      },
      {
        "x": 0,
        "y": 12,
        "w": 8,
        "h": 3,
        "minW": 1,
        "minH": 2,
        "id": "77a9347b-eb7e-4382-8a28-c23c956070af",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-numeric",
            "uuid": "77a9347b-eb7e-4382-8a28-c23c956070af",
            "config": {
              "supportAutomaticHistoricalSeries": true,
              "displayName": "Bearing To Waypoint",
              "filterSelfPaths": true,
              "paths": {
                "numericPath": {
                  "description": "Numeric Data",
                  "path": "self.navigation.course.calcValues.bearingTrue",
                  "source": "default",
                  "pathType": "number",
                  "suppressBootstrapNull": true,
                  "isPathConfigurable": true,
                  "convertUnitTo": "deg",
                  "showPathSkUnitsFilter": true,
                  "pathSkUnitsFilter": null
                }
              },
              "showMax": false,
              "showMin": false,
              "numDecimal": 0,
              "showMiniChart": false,
              "yScaleMin": 0,
              "yScaleMax": 10,
              "inverseYAxis": false,
              "verticalChart": false,
              "color": "grey",
              "updateInterval": 500,
              "enableTimeout": false,
              "dataTimeout": 5,
              "ignoreZones": false
            }
          }
        }
      },
      {
        "x": 0,
        "y": 15,
        "w": 8,
        "h": 3,
        "minW": 1,
        "minH": 2,
        "id": "b2d2b84d-e514-469a-bb83-3e2f32f13d9e",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-numeric",
            "uuid": "b2d2b84d-e514-469a-bb83-3e2f32f13d9e",
            "config": {
              "supportAutomaticHistoricalSeries": true,
              "displayName": "Distance To Waypoint",
              "filterSelfPaths": true,
              "paths": {
                "numericPath": {
                  "description": "Numeric Data",
                  "path": "self.navigation.course.calcValues.distance",
                  "source": "default",
                  "pathType": "number",
                  "suppressBootstrapNull": true,
                  "isPathConfigurable": true,
                  "convertUnitTo": "nm",
                  "showPathSkUnitsFilter": true,
                  "pathSkUnitsFilter": null
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
              "updateInterval": 500,
              "enableTimeout": false,
              "dataTimeout": 5,
              "ignoreZones": false
            }
          }
        }
      },
      {
        "x": 0,
        "y": 18,
        "w": 8,
        "h": 6,
        "minW": 1,
        "minH": 2,
        "id": "8d4bd7c2-d070-4478-a7ce-0b540c61fd47",
        "selector": "widget-host2",
        "input": {
          "widgetProperties": {
            "type": "widget-heel-gauge",
            "uuid": "8d4bd7c2-d070-4478-a7ce-0b540c61fd47",
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
                  "showConvertUnitTo": false,
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
              "updateInterval": 250,
              "enableTimeout": true,
              "dataTimeout": 5
            }
          }
        }
      }
    ]
  }
];
