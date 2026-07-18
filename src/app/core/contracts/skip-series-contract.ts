/**
 * Ownership: authoritative Skip series schema for the app's History-API consumers.
 *
 * Kept in `core/contracts` so the dashboard series sync and the chart widgets share one series
 * definition. Formerly re-exported from the bundled kip-plugin; that provider was retired, so the
 * schema now lives here.
 */
export type THistoryMethod = 'min' | 'max' | 'avg' | 'sma' | 'ema' | 'last';

export type TElectricalFamilyKey = 'batteries' | 'solar' | 'chargers' | 'inverters' | 'alternators' | 'ac';
export type TElectricalExpansionMode = 'bms-battery-tree' | 'solar-tree' | 'charger-tree' | 'inverter-tree' | 'alternator-tree' | 'ac-tree';

export interface IElectricalTrackedDeviceRef {
  id: string;
  source: string;
}

interface ISkipSeriesDefinitionBase {
  seriesId: string;
  datasetUuid: string;
  ownerWidgetUuid: string;
  ownerWidgetSelector: string | null;
  path: string;
  source?: string | null;
  context?: string | null;
  timeScale?: string | null;
  period?: number | null;
  retentionDurationMs?: number | null;
  sampleTime?: number | null;
  enabled: boolean;
  methods?: readonly THistoryMethod[];
  reconcileTs?: number;
}

export interface ISkipConcreteSeriesDefinition extends ISkipSeriesDefinitionBase {
  expansionMode?: null;
  familyKey?: null;
  allowedIds?: null;
  trackedDevices?: null;
}

export interface IElectricalTemplateSeriesDefinition extends ISkipSeriesDefinitionBase {
  ownerWidgetSelector:
  | 'widget-bms'
  | 'widget-solar-charger'
  | 'widget-charger'
  | 'widget-inverter'
  | 'widget-alternator'
  | 'widget-ac';
  expansionMode: TElectricalExpansionMode;
  familyKey?: TElectricalFamilyKey | null;
  allowedIds?: readonly string[] | null;
  trackedDevices?: readonly IElectricalTrackedDeviceRef[] | null;
}

export type ISkipTemplateSeriesDefinition = IElectricalTemplateSeriesDefinition;

/** @deprecated Use IElectricalTemplateSeriesDefinition */
export type IBmsTemplateSeriesDefinition = IElectricalTemplateSeriesDefinition;
/** @deprecated Use IElectricalTemplateSeriesDefinition */
export type ISolarTemplateSeriesDefinition = IElectricalTemplateSeriesDefinition;

export type ISkipSeriesDefinition = ISkipConcreteSeriesDefinition | ISkipTemplateSeriesDefinition;

export function isSkipTemplateSeriesDefinition(series: ISkipSeriesDefinition): series is ISkipTemplateSeriesDefinition {
  return series.expansionMode === 'bms-battery-tree'
    || series.expansionMode === 'solar-tree'
    || series.expansionMode === 'charger-tree'
    || series.expansionMode === 'inverter-tree'
    || series.expansionMode === 'alternator-tree'
    || series.expansionMode === 'ac-tree';
}

export function isSkipElectricalTemplateSeriesDefinition(series: ISkipSeriesDefinition): series is IElectricalTemplateSeriesDefinition {
  return isSkipTemplateSeriesDefinition(series);
}

export function isSkipBmsTemplateSeriesDefinition(series: ISkipSeriesDefinition): series is IBmsTemplateSeriesDefinition {
  return series.expansionMode === 'bms-battery-tree' && (series.familyKey == null || series.familyKey === 'batteries');
}

export function isSkipSolarTemplateSeriesDefinition(series: ISkipSeriesDefinition): series is ISolarTemplateSeriesDefinition {
  return series.expansionMode === 'solar-tree' && (series.familyKey == null || series.familyKey === 'solar');
}

export function isSkipConcreteSeriesDefinition(series: ISkipSeriesDefinition): series is ISkipConcreteSeriesDefinition {
  return series.expansionMode == null;
}

export function isSkipSeriesEnabled(series: Pick<ISkipSeriesDefinitionBase, 'enabled'>): boolean {
  return series.enabled;
}
