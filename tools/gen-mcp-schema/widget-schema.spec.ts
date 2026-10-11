import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { extractWidgetSchemas } from './generate';
import type { WidgetSchemaEntry } from './types';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const schemas = extractWidgetSchemas({ projectRoot });
const bySelector = (selector: string): WidgetSchemaEntry | undefined =>
  schemas.find((w) => w.selector === selector);

describe('extractWidgetSchemas', () => {
  it('extracts a DEFAULT_CONFIG object for every catalog widget', () => {
    expect(schemas.length).toBeGreaterThanOrEqual(30);
    for (const widget of schemas) {
      expect(widget.defaultConfig, widget.selector).toBeTypeOf('object');
      expect(widget.defaultConfig, widget.selector).not.toBeNull();
    }
  });

  it('classifies bindingKind structurally from DEFAULT_CONFIG', () => {
    expect(bySelector('widget-numeric')?.bindingKind).toBe('paths-record');
    expect(bySelector('widget-wind-steer')?.bindingKind).toBe('paths-record');
    expect(bySelector('widget-boolean-switch')?.bindingKind).toBe('paths-array');
    expect(bySelector('widget-zones-state-panel')?.bindingKind).toBe('paths-array');
    expect(bySelector('widget-data-chart')?.bindingKind).toBe('datachart');
    expect(bySelector('widget-windtrends-chart')?.bindingKind).toBe('paths-record');
    expect(bySelector('widget-bms')?.bindingKind).toBe('none');
  });

  it('captures the windtrends configurable wind slots', () => {
    const slots = bySelector('widget-windtrends-chart')?.pathSlots ?? [];
    expect(slots.map((s) => s.slot)).toEqual(['trueWindDirection', 'trueWindSpeed']);
    expect(slots.find((s) => s.slot === 'trueWindSpeed')).toMatchObject({
      defaultPath: 'self.environment.wind.speedTrue',
      expectedSkUnit: 'm/s',
      defaultConvertUnitTo: 'knots',
      isPathConfigurable: false, // now a fixed slot (Effort B); direction is the choice slot
      pathRequired: false,
    });
  });

  it('extracts path slots for a record-bound widget (numeric)', () => {
    const numericPath = bySelector('widget-numeric')?.pathSlots.find((s) => s.slot === 'numericPath');
    expect(numericPath).toMatchObject({
      slot: 'numericPath',
      defaultPath: null,
      pathType: 'number',
      isPathConfigurable: true,
      pathRequired: false,
      defaultConvertUnitTo: 'unitless',
      expectedSkUnit: null,
    });
  });

  // A general-purpose gauge that presets a unit filter shows the user a path picker narrowed to that
  // unit, so every path it is not filtered to disappears from the list (#541).
  it('leaves a general-purpose gauge unfiltered (simple-linear)', () => {
    const gaugePath = bySelector('widget-simple-linear')?.pathSlots.find((s) => s.slot === 'gaugePath');
    expect(gaugePath).toMatchObject({
      slot: 'gaugePath',
      defaultPath: null,
      isPathConfigurable: true,
      defaultConvertUnitTo: 'unitless',
      expectedSkUnit: null,
    });
  });

  it('captures default-bound, required slots (wind-steer heading)', () => {
    const heading = bySelector('widget-wind-steer')?.pathSlots.find((s) => s.slot === 'headingPath');
    expect(heading).toMatchObject({
      defaultPath: 'self.navigation.headingTrue',
      pathRequired: true,
      expectedSkUnit: 'rad',
      defaultConvertUnitTo: 'deg',
    });
  });

  it('conveys a choice slot\'s closed pathOptions set, and null for a fixed slot', () => {
    const heading = bySelector('widget-wind-steer')?.pathSlots.find((s) => s.slot === 'headingPath');
    expect(heading?.pathOptions).toEqual([
      { label: 'True', path: 'self.navigation.headingTrue' },
      { label: 'Magnetic', path: 'self.navigation.headingMagnetic' },
    ]);
    const appWind = bySelector('widget-wind-steer')?.pathSlots.find((s) => s.slot === 'appWindAngle');
    expect(appWind?.pathOptions).toBeNull();
  });

  it('drops the dead windAngleTrueWater slot and leaves autopilot with no configurable path (Effort C)', () => {
    const slots = bySelector('widget-autopilot')?.pathSlots ?? [];
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.some((s) => s.slot === 'windAngleTrueWater')).toBe(false);
    expect(slots.every((s) => s.isPathConfigurable === false)).toBe(true);
  });

  it('gives non-record widgets no path slots', () => {
    expect(bySelector('widget-data-chart')?.pathSlots).toEqual([]);
    expect(bySelector('widget-boolean-switch')?.pathSlots).toEqual([]);
    expect(bySelector('widget-bms')?.pathSlots).toEqual([]);
  });

  it('publishes the units of options a widget stores in SI (Wind Steer close-hauled angle in rad)', () => {
    const windsteer = bySelector('widget-wind-steer');
    expect(windsteer?.optionUnits).toEqual({ closeHauledLineAngle: 'rad' });
    expect(windsteer?.defaultConfig['closeHauledLineAngle']).toBeCloseTo(Math.PI / 4, 15);
    expect(bySelector('widget-boolean-switch')?.optionUnits).toBeUndefined();
  });

  it('publishes scale bounds as SI in the unit of the path they scale', () => {
    const gaugeBounds = { 'displayScale.lower': 'SI unit of gaugePath', 'displayScale.upper': 'SI unit of gaugePath' };
    for (const selector of ['widget-gauge-ng-radial', 'widget-gauge-ng-linear', 'widget-gauge-steel', 'widget-simple-linear']) {
      expect(bySelector(selector)?.optionUnits, selector).toEqual(gaugeBounds);
    }
    expect(bySelector('widget-numeric')?.optionUnits)
      .toEqual({ yScaleMin: 'SI unit of numericPath', yScaleMax: 'SI unit of numericPath' });
    const graphUnit = 'SI unit of datachartPath';
    expect(bySelector('widget-data-chart')?.optionUnits).toEqual({
      yScaleSuggestedMin: graphUnit, yScaleSuggestedMax: graphUnit, yScaleMin: graphUnit, yScaleMax: graphUnit
    });
  });

  it('names nested SI options by their dotted path (Sea Horizon heel angles, AIS radar ranges and COG time)', () => {
    const seaHorizon = bySelector('widget-sea-horizon');
    expect(seaHorizon?.optionUnits).toEqual({ 'gauge.heelCautionAngle': 'rad', 'gauge.heelAlarmAngle': 'rad' });
    const gauge = seaHorizon?.defaultConfig['gauge'] as Record<string, unknown>;
    expect(gauge['heelCautionAngle']).toBeCloseTo(20 * Math.PI / 180, 15);
    expect(gauge['heelAlarmAngle']).toBeCloseTo(30 * Math.PI / 180, 15);

    const ais = bySelector('widget-ais-radar');
    expect(ais?.optionUnits).toEqual({ 'ais.rangeRings': 'm', 'ais.cogVectorsSeconds': 's' });
    const aisConfig = ais?.defaultConfig['ais'] as Record<string, unknown>;
    expect(aisConfig['rangeRings']).toEqual([1, 3, 6, 12, 24, 48].map(nm => nm * 1852));
    expect(aisConfig['cogVectorsSeconds']).toBe(600);
    expect('cogVectorsMinutes' in aisConfig).toBe(false);
  });

  it('keeps a widget special config object verbatim (bms)', () => {
    const config = bySelector('widget-bms')?.defaultConfig as { bms?: unknown };
    expect(config.bms).toMatchObject({ trackedDevices: [], groups: [], banks: [] });
  });
});
