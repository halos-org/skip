import { AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import type { Selection } from 'd3-selection';
import { DataService } from '../../core/services/data.service';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import type { ITheme } from '../../core/services/app-service';
import { TState } from '../../core/interfaces/signalk-interfaces';
import type { IWidgetSvcConfig } from '../../core/interfaces/widgets-interface';
import { UnitsService } from '../../core/services/units.service';
import { getColors, resolveZoneAwareColor } from '../../core/utils/themeColors.utils';
import { getElectricalWidgetFamilyDescriptor } from '../../core/contracts/electrical-widget-family.contract';
import type { ElectricalCardDisplayMode } from '../../core/contracts/electrical-topology-card.contract';
import type { InverterDisplayModel, InverterSnapshot, InverterWidgetConfig, ElectricalCardModeConfig } from './widget-inverter.types';
import { WidgetTitleComponent } from '../../core/components/widget-title/widget-title.component';
import { normalizeOptionalString, normalizeStringList, normalizeTrackedDevices } from '../shared/electrical-config.util';
import { setValue, setMetricValue, toStringValue, toBoolean, resolveMostSevereState } from '../shared/electrical-apply.util';
import { ElectricalIngestScheduler } from '../shared/electrical-ingest-scheduler';
import { ElectricalTopologyStore, type ElectricalTopologyEntry } from '../shared/electrical-topology-store';
import { drawDirectCards, initDirectCardSvg } from '../shared/electrical-direct-card-draw';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface InverterRenderSnapshot {
  inverters: InverterSnapshot[];
  displayModels: Record<string, InverterDisplayModel>;
  widgetColors: ReturnType<typeof getColors>;
}

@Component({
  selector: 'widget-inverter',
  templateUrl: './widget-inverter.component.html',
  styleUrl: './widget-inverter.component.scss',
  imports: [WidgetTitleComponent],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WidgetInverterComponent implements AfterViewInit {
  private static readonly INVERTER_DESCRIPTOR = getElectricalWidgetFamilyDescriptor('widget-inverter');
  private static readonly SELF_ROOT_PATH = (() => {
    const root = WidgetInverterComponent.INVERTER_DESCRIPTOR?.selfRootPath;
    if (!root) throw new Error('[WidgetInverterComponent] Descriptor missing or selfRootPath not set; check widget registration.');
    return root;
  })();
  private static readonly ROOT_PATTERN = `${WidgetInverterComponent.SELF_ROOT_PATH}.*`;
  private static readonly PATH_REGEX = new RegExp(`^${escapeRegex(WidgetInverterComponent.SELF_ROOT_PATH)}\\.([^.]+)\\.(.+)$`);
  private static readonly PATH_BATCH_WINDOW_MS = 500;

  public static readonly DEFAULT_CONFIG: IWidgetSvcConfig = {
    color: 'contrast',
    ignoreZones: false,
    inverter: {
      trackedDevices: [],
      optionsById: {}
    }
  };

  public id = input.required<string>();
  public type = input.required<string>();
  public theme = input.required<ITheme | null>();
  public renderMode = input<ElectricalCardDisplayMode | null>(null);

  private readonly runtime = inject(WidgetRuntimeDirective);
  private readonly data = inject(DataService);
  private readonly units = inject(UnitsService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly svgRef = viewChild.required<ElementRef<SVGSVGElement>>('inverterSvg');
  private svg?: Selection<SVGSVGElement, unknown, null, undefined>;
  private layer?: Selection<SVGGElement, unknown, null, undefined>;

  private readonly store = new ElectricalTopologyStore<InverterSnapshot>({
    createSnapshot: seed => ({ id: seed.id, source: seed.source, deviceKey: seed.deviceKey }),
    applyValue: (snapshot, key, value, state) => this.applyValue(snapshot, key, value, state),
    derive: snapshot => this.deriveDcPower(snapshot)
  });

  private readonly scheduler = new ElectricalIngestScheduler<ElectricalTopologyEntry, InverterRenderSnapshot>({
    data: this.data,
    destroyRef: this.destroyRef,
    rootPattern: WidgetInverterComponent.ROOT_PATTERN,
    batchWindowMs: WidgetInverterComponent.PATH_BATCH_WINDOW_MS,
    parseUpdate: update => {
      const parsed = this.parsePath(update.path);
      if (!parsed) return null;
      return {
        key: `${parsed.id}::${parsed.key}`,
        entry: {
          id: parsed.id,
          key: parsed.key,
          value: update.update?.data?.value ?? null,
          state: update.update?.state ?? null
        }
      };
    },
    onFlush: entries => this.store.processBatch(entries),
    resolveRenderSnapshot: explicit => {
      const widgetColors = this.widgetColors();
      if (!this.svg || !widgetColors) return null;
      return explicit ?? {
        inverters: this.visibleInverters(),
        displayModels: this.displayModels(),
        widgetColors
      };
    },
    draw: snapshot => this.render(snapshot)
  });

  protected readonly optionsById = signal<InverterWidgetConfig['optionsById']>({});
  protected readonly cardMode = signal<ElectricalCardModeConfig>({
    displayMode: 'full',
    metrics: ['dcVoltage', 'dcCurrent', 'acVoltage', 'acFrequency']
  });

  protected readonly invertersByKey = this.store.store;
  protected readonly discoveredInverterIds = this.store.discoveredIds;
  protected readonly trackedDevices = this.store.trackedDevices;
  protected readonly visibleInverterKeys = this.store.visibleKeys;
  protected readonly visibleInverters = this.store.visibleSnapshots;

  protected readonly hasInverters = computed(() => this.visibleInverters().length > 0);
  protected readonly activeDisplayMode = computed<ElectricalCardDisplayMode>(() => this.renderMode() ?? this.cardMode().displayMode ?? 'full');
  protected readonly isCompactCardMode = computed(() => this.activeDisplayMode() === 'compact');
  protected readonly colorRole = computed(() => this.runtime.options()?.color ?? 'contrast');
  protected readonly ignoreZones = computed(() => this.runtime.options()?.ignoreZones ?? false);
  protected readonly displayLabel = computed(() => {
    const inverters = this.visibleInverters();
    if (inverters.length !== 1) {
      return 'Inverters';
    }

    return this.resolveTitleText(inverters[0]);
  });
  protected readonly labelColor = computed(() => {
    const theme = this.theme();
    return theme ? getColors(this.colorRole(), theme).dim : 'var(--skip-contrast-dim-color)';
  });

  protected readonly widgetColors = computed(() => {
    const theme = this.theme();
    if (!theme) return null;
    return getColors(this.colorRole(), theme);
  });

  protected readonly displayModels = computed<Record<string, InverterDisplayModel>>(() => {
    const inverters = this.visibleInverters();
    const theme = this.theme();
    const widgetColors = this.widgetColors();
    const ignoreZones = this.ignoreZones();

    // Detect device ids that appear across multiple source-keyed snapshots
    const idCount = new Map<string, number>();
    inverters.forEach(inv => idCount.set(inv.id, (idCount.get(inv.id) ?? 0) + 1));
    const duplicateIds = new Set<string>(
      [...idCount.entries()].filter(([, n]) => n > 1).map(([id]) => id)
    );

    const models: Record<string, InverterDisplayModel> = {};
    for (const inverter of inverters) {
      const modelKey = inverter.deviceKey ?? inverter.id;
      const showSource = !!inverter.source && duplicateIds.has(inverter.id);
      const aggregateState = resolveMostSevereState(
        inverter.dcVoltageState ?? null,
        inverter.dcCurrentState ?? null,
        inverter.acVoltageState ?? null,
        inverter.acCurrentState ?? null,
        inverter.acFrequencyState ?? null,
        inverter.temperatureState ?? null,
        inverter.inverterModeState ?? null
      );
      const primaryState = resolveMostSevereState(inverter.dcVoltageState ?? null, inverter.dcCurrentState ?? null);
      const secondaryState = resolveMostSevereState(inverter.acVoltageState ?? null, inverter.acCurrentState ?? null, inverter.acFrequencyState ?? null);
      const [metricsLineOne, metricsLineTwo] = this.buildMetricRows(inverter);

      models[modelKey] = {
        id: inverter.id,
        source: inverter.source ?? null,
        deviceKey: inverter.deviceKey,
        titleText: this.resolveTitleText(inverter),
        modeText: this.isCompactCardMode() ? '' : (inverter.inverterMode ? `Mode ${inverter.inverterMode}` : 'Mode -'),
        busText: this.isCompactCardMode() ? '' : (
          showSource ? (inverter.source ?? '-') : (inverter.associatedBus || inverter.location || '-')
        ),
        metricsLineOne,
        metricsLineTwo,
        stateBarColor: resolveZoneAwareColor(aggregateState, widgetColors?.dim ?? 'var(--skip-contrast-color)', theme, ignoreZones),
        titleTextColor: resolveZoneAwareColor(aggregateState, 'var(--skip-contrast-color)', theme, ignoreZones),
        metaTextColor: resolveZoneAwareColor(inverter.inverterModeState ?? null, 'var(--skip-contrast-dim-color)', theme, ignoreZones),
        primaryMetricsTextColor: resolveZoneAwareColor(primaryState, 'var(--skip-contrast-color)', theme, ignoreZones),
        secondaryMetricsTextColor: resolveZoneAwareColor(secondaryState, 'var(--skip-contrast-color)', theme, ignoreZones)
      };
    }

    return models;
  });

  constructor() {
    effect(() => {
      const cfg = this.runtime.options();
      if (!cfg) return;
      untracked(() => this.applyConfig(cfg));
    });

    effect(() => {
      const models = this.displayModels();
      const inverters = this.visibleInverters();
      const widgetColors = this.widgetColors();
      if (!this.svg || !widgetColors) return;
      this.scheduler.requestRender({ inverters, displayModels: models, widgetColors });
    });
  }

  ngAfterViewInit(): void {
    this.initializeSvg();
    this.scheduler.requestRender();
  }

  private initializeSvg(): void {
    const { svg, layer } = initDirectCardSvg(this.svgRef().nativeElement, {
      ariaLabel: 'Inverter View',
      classPrefix: 'inverter'
    });
    this.svg = svg;
    this.layer = layer;
  }

  private applyConfig(cfg: IWidgetSvcConfig): void {
    const inverterCfg = this.resolveInverterConfig(cfg);
    this.store.applyConfig(inverterCfg.trackedDevices ?? []);
    this.optionsById.set(inverterCfg.optionsById);
    this.cardMode.set(this.normalizeCardMode(inverterCfg.cardMode));
  }

  private resolveInverterConfig(cfg: IWidgetSvcConfig): InverterWidgetConfig {
    const inverter = cfg.inverter;
    return {
      trackedDevices: normalizeTrackedDevices(inverter?.trackedDevices),
      optionsById: this.normalizeOptionsById(inverter?.optionsById),
      cardMode: this.normalizeCardMode(inverter?.cardMode)
    };
  }

  private normalizeCardMode(value: unknown): ElectricalCardModeConfig {
    const candidate = (value && typeof value === 'object') ? value as { displayMode?: unknown; metrics?: unknown } : null;
    const metrics = normalizeStringList(candidate?.metrics);
    return {
      displayMode: candidate?.displayMode === 'compact' ? 'compact' : 'full',
      metrics: metrics.length ? metrics : ['dcVoltage', 'dcCurrent', 'acVoltage', 'acFrequency']
    };
  }

  private normalizeOptionsById(value: unknown): InverterWidgetConfig['optionsById'] {
    if (!value || typeof value !== 'object') return {};
    const next: InverterWidgetConfig['optionsById'] = {};
    Object.entries(value as Record<string, unknown>).forEach(([id]) => {
      const normalizedId = normalizeOptionalString(id);
      if (normalizedId) next[normalizedId] = {};
    });
    return next;
  }

  private parsePath(path: string): { id: string; key: string } | null {
    const match = path.match(WidgetInverterComponent.PATH_REGEX);
    if (!match) return null;
    return { id: match[1], key: match[2] };
  }

  private applyValue(snapshot: InverterSnapshot, key: string, value: unknown, state: TState | null): boolean {
    switch (key) {
      case 'name': return setValue(snapshot, 'name', toStringValue(value));
      case 'location': return setValue(snapshot, 'location', toStringValue(value));
      case 'associatedBus': return setValue(snapshot, 'associatedBus', toStringValue(value));
      case 'dc.voltage': return setMetricValue(snapshot, 'dcVoltage', 'dcVoltageState', this.toNumber(value, 'V'), state);
      case 'dc.current': return setMetricValue(snapshot, 'dcCurrent', 'dcCurrentState', this.toNumber(value, 'A'), state);
      case 'acin.voltage': return setMetricValue(snapshot, 'acInVoltage', 'acInVoltageState', this.toNumber(value, 'V'), state);
      case 'acin.current': return setMetricValue(snapshot, 'acInCurrent', 'acInCurrentState', this.toNumber(value, 'A'), state);
      case 'acin.frequency': return setMetricValue(snapshot, 'acInFrequency', 'acInFrequencyState', this.toNumber(value, 'Hz'), state);
      case 'acin.power': return setMetricValue(snapshot, 'acInPower', 'acInPowerState', this.toNumber(value, 'W'), state);
      case 'acin.1.currentLimit': return setMetricValue(snapshot, 'acIn1CurrentLimit', 'acIn1CurrentLimitState', this.toNumber(value, 'A'), state);
      case 'acin.currentLimit': return setMetricValue(snapshot, 'acInCurrentLimit', 'acInCurrentLimitState', this.toNumber(value, 'A'), state);
      case 'acState.acIn1Available': return setMetricValue(snapshot, 'acIn1Available', 'acIn1AvailableState', toBoolean(value), state);
      case 'acState.ignoreAcIn1.state': return setMetricValue(snapshot, 'ignoreAcIn1', 'ignoreAcIn1State', toBoolean(value), state);
      case 'ac.voltage': return setMetricValue(snapshot, 'acVoltage', 'acVoltageState', this.toNumber(value, 'V'), state);
      case 'ac.current': return setMetricValue(snapshot, 'acCurrent', 'acCurrentState', this.toNumber(value, 'A'), state);
      case 'ac.frequency': return setMetricValue(snapshot, 'acFrequency', 'acFrequencyState', this.toNumber(value, 'Hz'), state);
      case 'acout.voltage': return setMetricValue(snapshot, 'acOutVoltage', 'acOutVoltageState', this.toNumber(value, 'V'), state);
      case 'acout.current': return setMetricValue(snapshot, 'acOutCurrent', 'acOutCurrentState', this.toNumber(value, 'A'), state);
      case 'acout.frequency': return setMetricValue(snapshot, 'acOutFrequency', 'acOutFrequencyState', this.toNumber(value, 'Hz'), state);
      case 'acout.power': return setMetricValue(snapshot, 'acOutPower', 'acOutPowerState', this.toNumber(value, 'W'), state);
      case 'inverterMode': return setMetricValue(snapshot, 'inverterMode', 'inverterModeState', toStringValue(value), state);
      case 'inverterModeNumber': return setMetricValue(snapshot, 'inverterModeNumber', 'inverterModeNumberState', this.toNumber(value, ''), state);
      case 'preferRenewableEnergy': return setMetricValue(snapshot, 'preferRenewableEnergy', 'preferRenewableEnergyState', toBoolean(value), state);
      case 'preferRenewableEnergyActive': return setMetricValue(snapshot, 'preferRenewableEnergyActive', 'preferRenewableEnergyActiveState', toBoolean(value), state);
      case 'temperature': return setMetricValue(snapshot, 'temperature', 'temperatureState', this.toNumber(value, 'K'), state);
      default: return false;
    }
  }

  private deriveDcPower(snapshot: InverterSnapshot): void {
    if (snapshot.dcVoltage != null && snapshot.dcCurrent != null) {
      const derived = snapshot.dcVoltage * snapshot.dcCurrent;
      snapshot.dcPower = Number.isFinite(derived) ? derived : null;
      snapshot.dcPowerState = resolveMostSevereState(snapshot.dcVoltageState ?? null, snapshot.dcCurrentState ?? null);
    } else {
      snapshot.dcPower = null;
      snapshot.dcPowerState = null;
    }
  }

  private render(snapshot: InverterRenderSnapshot): void {
    if (!this.layer || !this.svg) return;

    drawDirectCards<InverterSnapshot>({
      svg: this.svg,
      layer: this.layer,
      entities: snapshot.inverters,
      displayModels: snapshot.displayModels,
      widgetColors: snapshot.widgetColors,
      compact: this.isCompactCardMode(),
      descriptor: {
        classPrefix: 'inverter',
        includeCardBg: true,
        titleFallback: entity => this.resolveTitleText(entity)
      }
    });
  }

  private displayName(inverter: InverterSnapshot): string {
    return inverter.name?.trim() || inverter.id;
  }

  private resolveTitleText(inverter: InverterSnapshot): string {
    return inverter.name || `Inverter ${inverter.id}`;
  }

  private buildMetricRows(inverter: InverterSnapshot): [string, string] {
    const mode = this.cardMode();
    if (this.activeDisplayMode() === 'full') {
      // Show AC input metrics if available, otherwise show AC output metrics
      const hasAcInData = inverter.acInVoltage != null || inverter.acInCurrent != null;
      const acInVoltageStr = this.formatValue(inverter.acInVoltage, 'V');
      const acInCurrentStr = this.formatValue(inverter.acInCurrent, 'A');
      const acOutVoltageStr = this.formatValue(inverter.acOutVoltage ?? inverter.acVoltage, 'V');
      const acOutFreqStr = this.formatValue(inverter.acOutFrequency ?? inverter.acFrequency, 'Hz');

      return [
        `DC ${this.formatValue(inverter.dcVoltage, 'V')}  ${this.formatValue(inverter.dcCurrent, 'A')}`,
        hasAcInData
          ? `ACin ${acInVoltageStr}  ${acInCurrentStr}`
          : `AC ${acOutVoltageStr}  ${acOutFreqStr}`
      ];
    }

    const metricLabels = mode.metrics
      .map(metric => this.toMetricLabel(metric, inverter))
      .filter((label): label is string => !!label);

    if (!metricLabels.length) return ['DC -  -', 'AC -  -'];
    return [metricLabels.slice(0, 2).join('   ') || ' ', metricLabels.slice(2, 4).join('   ') || ' '];
  }

  private toMetricLabel(metric: string, inverter: InverterSnapshot): string | null {
    switch (metric) {
      case 'dcVoltage': return `DC V ${this.formatValue(inverter.dcVoltage, 'V')}`;
      case 'dcCurrent': return `DC A ${this.formatValue(inverter.dcCurrent, 'A')}`;
      case 'dcPower': return `DC P ${this.formatValue(inverter.dcPower, 'W')}`;
      case 'acVoltage': return `AC V ${this.formatValue(inverter.acVoltage, 'V')}`;
      case 'acCurrent': return `AC A ${this.formatValue(inverter.acCurrent, 'A')}`;
      case 'acFrequency': return `Hz ${this.formatValue(inverter.acFrequency, 'Hz')}`;
      case 'acInVoltage': return `ACin V ${this.formatValue(inverter.acInVoltage, 'V')}`;
      case 'acInCurrent': return `ACin A ${this.formatValue(inverter.acInCurrent, 'A')}`;
      case 'acInFrequency': return `ACin Hz ${this.formatValue(inverter.acInFrequency, 'Hz')}`;
      case 'acInPower': return `ACin P ${this.formatValue(inverter.acInPower, 'W')}`;
      case 'acOutVoltage': return `ACout V ${this.formatValue(inverter.acOutVoltage, 'V')}`;
      case 'acOutCurrent': return `ACout A ${this.formatValue(inverter.acOutCurrent, 'A')}`;
      case 'acOutFrequency': return `ACout Hz ${this.formatValue(inverter.acOutFrequency, 'Hz')}`;
      case 'acOutPower': return `ACout P ${this.formatValue(inverter.acOutPower, 'W')}`;
      case 'acIn1CurrentLimit': return `ACin1 Lim ${this.formatValue(inverter.acIn1CurrentLimit, 'A')}`;
      case 'acInCurrentLimit': return `ACin Lim ${this.formatValue(inverter.acInCurrentLimit, 'A')}`;
      case 'temperature': return `T ${this.formatTemperature(inverter.temperature, `${WidgetInverterComponent.SELF_ROOT_PATH}.${inverter.id}.temperature`)}`;
      case 'inverterModeNumber': return `Mode# ${inverter.inverterModeNumber?.toString() ?? '-'}`;
      default: return null;
    }
  }

  private formatValue(value: number | null | undefined, unit: string): string {
    if (value == null || Number.isNaN(value)) return '-';
    return `${value.toFixed(1)} ${unit}`;
  }

  private formatTemperature(value: number | null | undefined, path: string): string {
    if (value == null || Number.isNaN(value)) return '-';
    const measure = this.units.resolvePathMeasure(path);
    const converted = this.units.convertToUnit(measure, value);
    if (converted == null || !Number.isFinite(converted)) return '-';
    return `${converted.toFixed(1)} ${this.units.getUnitDisplaySymbol(measure)}`;
  }

  private toNumber(value: unknown, unitHint: string): number | null {
    if (value == null || typeof value === 'boolean') return null;
    const rawNumber = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(rawNumber)) return null;
    const converted = this.units.convertToUnit(unitHint, rawNumber);
    return typeof converted === 'number' && Number.isFinite(converted) ? converted : null;
  }

}
