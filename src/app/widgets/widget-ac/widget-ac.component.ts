import { AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import type { Selection } from 'd3-selection';
import { DataService } from '../../core/services/data.service';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import type { ITheme } from '../../core/services/app-service';
import { TState } from '../../core/interfaces/signalk-interfaces';
import type { ElectricalTrackedDevice, IWidgetSvcConfig } from '../../core/interfaces/widgets-interface';
import { UnitsService } from '../../core/services/units.service';
import { getColors, resolveZoneAwareColor } from '../../core/utils/themeColors.utils';
import { getElectricalWidgetFamilyDescriptor } from '../../core/contracts/electrical-widget-family.contract';
import type { ElectricalCardDisplayMode } from '../../core/contracts/electrical-topology-card.contract';
import { normalizeOptionalString, normalizeStringList } from '../shared/electrical-config.util';
import { setValue, setMetricValue, toStringValue, resolveMostSevereState } from '../shared/electrical-apply.util';
import { ElectricalIngestScheduler } from '../shared/electrical-ingest-scheduler';
import { ElectricalTopologyStore, type ElectricalTopologyEntry } from '../shared/electrical-topology-store';
import { drawDirectCards, initDirectCardSvg } from '../shared/electrical-direct-card-draw';
import type { AcDisplayModel, AcSnapshot, AcWidgetConfig, ElectricalCardModeConfig } from './widget-ac.types';
import { WidgetTitleComponent } from '../../core/components/widget-title/widget-title.component';

interface AcRenderSnapshot {
  buses: AcSnapshot[];
  displayModels: Record<string, AcDisplayModel>;
  widgetColors: ReturnType<typeof getColors>;
}

@Component({
  selector: 'widget-ac',
  templateUrl: './widget-ac.component.html',
  styleUrl: './widget-ac.component.scss',
  imports: [WidgetTitleComponent],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WidgetAcComponent implements AfterViewInit {
  private static readonly AC_DESCRIPTOR = getElectricalWidgetFamilyDescriptor('widget-ac');
  private static readonly SELF_ROOT_PATH = (() => {
    const root = WidgetAcComponent.AC_DESCRIPTOR?.selfRootPath;
    if (!root) throw new Error('[WidgetAcComponent] Descriptor missing or selfRootPath not set; check widget registration.');
    return root;
  })();
  private static readonly ROOT_PATTERN = `${WidgetAcComponent.SELF_ROOT_PATH}.*`;
  private static readonly ROOT_PREFIX = `${WidgetAcComponent.SELF_ROOT_PATH}.`;
  private static readonly PATH_BATCH_WINDOW_MS = 500;
  private static readonly RESERVED_AC_AGGREGATE_IDS = new Set(['totalCurrent', 'totalPower']);

  public static readonly DEFAULT_CONFIG: IWidgetSvcConfig = {
    color: 'contrast',
    ignoreZones: false,
    ac: {
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

  private readonly svgRef = viewChild.required<ElementRef<SVGSVGElement>>('acSvg');
  private svg?: Selection<SVGSVGElement, unknown, null, undefined>;
  private layer?: Selection<SVGGElement, unknown, null, undefined>;

  private readonly store = new ElectricalTopologyStore<AcSnapshot>({
    createSnapshot: seed => ({ id: seed.id, source: seed.source, deviceKey: seed.deviceKey }),
    applyValue: (snapshot, key, value, state) => this.applyValue(snapshot, key, value, state)
  });

  private readonly scheduler = new ElectricalIngestScheduler<ElectricalTopologyEntry, AcRenderSnapshot>({
    data: this.data,
    destroyRef: this.destroyRef,
    rootPattern: WidgetAcComponent.ROOT_PATTERN,
    batchWindowMs: WidgetAcComponent.PATH_BATCH_WINDOW_MS,
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
        buses: this.visibleBuses(),
        displayModels: this.displayModels(),
        widgetColors
      };
    },
    draw: snapshot => this.render(snapshot)
  });

  protected readonly optionsById = signal<AcWidgetConfig['optionsById']>({});
  protected readonly cardMode = signal<ElectricalCardModeConfig>({
    displayMode: 'full',
    metrics: ['line1Voltage', 'line1Current', 'line1Frequency', 'line2Voltage']
  });

  protected readonly busesByKey = this.store.store;
  protected readonly discoveredBusIds = this.store.discoveredIds;
  protected readonly trackedDevices = this.store.trackedDevices;
  protected readonly visibleBusKeys = this.store.visibleKeys;
  protected readonly visibleBuses = this.store.visibleSnapshots;

  protected readonly hasBuses = computed(() => this.visibleBuses().length > 0);
  protected readonly activeDisplayMode = computed<ElectricalCardDisplayMode>(() => this.renderMode() ?? this.cardMode().displayMode ?? 'full');
  protected readonly isCompactCardMode = computed(() => this.activeDisplayMode() === 'compact');
  protected readonly colorRole = computed(() => this.runtime.options()?.color ?? 'contrast');
  protected readonly ignoreZones = computed(() => this.runtime.options()?.ignoreZones ?? false);
  protected readonly displayLabel = computed(() => {
    const buses = this.visibleBuses();
    if (buses.length !== 1) {
      return 'AC Buses';
    }

    return this.resolveTitleText(buses[0]);
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

  protected readonly displayModels = computed<Record<string, AcDisplayModel>>(() => {
    const buses = this.visibleBuses();
    const theme = this.theme();
    const widgetColors = this.widgetColors();
    const ignoreZones = this.ignoreZones();

    const idCount = new Map<string, number>();
    buses.forEach(bus => idCount.set(bus.id, (idCount.get(bus.id) ?? 0) + 1));
    const duplicateIds = new Set<string>(
      [...idCount.entries()].filter(([, count]) => count > 1).map(([id]) => id)
    );

    const models: Record<string, AcDisplayModel> = {};
    for (const bus of buses) {
      const modelKey = bus.deviceKey ?? bus.id;
      const showSource = !!bus.source && duplicateIds.has(bus.id);
      const aggregateState = resolveMostSevereState(
        bus.line1VoltageState ?? null,
        bus.line1CurrentState ?? null,
        bus.line2VoltageState ?? null,
        bus.line2CurrentState ?? null,
        bus.line3VoltageState ?? null,
        bus.line3CurrentState ?? null,
        bus.modeState ?? null
      );
      const primaryState = resolveMostSevereState(
        bus.line1VoltageState ?? null,
        bus.line1CurrentState ?? null,
        bus.line1FrequencyState ?? null
      );
      const secondaryState = resolveMostSevereState(
        bus.line2VoltageState ?? null,
        bus.line2CurrentState ?? null,
        bus.line3VoltageState ?? null,
        bus.line3CurrentState ?? null
      );
      const [metricsLineOne, metricsLineTwo] = this.buildMetricRows(bus);

      models[modelKey] = {
        id: bus.id,
        titleText: this.resolveTitleText(bus),
        modeText: this.isCompactCardMode() ? '' : this.resolveModeText(bus),
        busText: this.isCompactCardMode() ? '' : (
          showSource ? (bus.source ?? '-') : (bus.associatedBus || bus.location || '-')
        ),
        metricsLineOne,
        metricsLineTwo,
        stateBarColor: resolveZoneAwareColor(aggregateState, widgetColors?.dim ?? 'var(--skip-contrast-color)', theme, ignoreZones),
        titleTextColor: resolveZoneAwareColor(aggregateState, 'var(--skip-contrast-color)', theme, ignoreZones),
        metaTextColor: resolveZoneAwareColor(bus.modeState ?? null, 'var(--skip-contrast-dim-color)', theme, ignoreZones),
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
      const buses = this.visibleBuses();
      const widgetColors = this.widgetColors();
      if (!this.svg || !widgetColors) return;
      this.scheduler.requestRender({ buses, displayModels: models, widgetColors });
    });
  }

  ngAfterViewInit(): void {
    this.initializeSvg();
    this.scheduler.requestRender();
  }

  private initializeSvg(): void {
    const { svg, layer } = initDirectCardSvg(this.svgRef().nativeElement, {
      ariaLabel: 'AC View',
      classPrefix: 'ac'
    });
    this.svg = svg;
    this.layer = layer;
  }

  private applyConfig(cfg: IWidgetSvcConfig): void {
    const acCfg = this.resolveAcConfig(cfg);
    this.store.applyConfig(acCfg.trackedDevices ?? []);
    this.optionsById.set(acCfg.optionsById);
    this.cardMode.set(this.normalizeCardMode(acCfg.cardMode));
  }

  private resolveAcConfig(cfg: IWidgetSvcConfig): AcWidgetConfig {
    const ac = cfg.ac;
    return {
      trackedDevices: this.normalizeAcTrackedDevices(ac?.trackedDevices),
      optionsById: this.normalizeOptionsById(ac?.optionsById),
      cardMode: this.normalizeCardMode(ac?.cardMode)
    };
  }

  private normalizeAcTrackedDevices(value: unknown): ElectricalTrackedDevice[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const devices = new Map<string, ElectricalTrackedDevice>();
    value.forEach(item => {
      if (!item || typeof item !== 'object') {
        return;
      }

      const candidate = item as { id?: unknown; source?: unknown; key?: unknown };
      const id = normalizeOptionalString(candidate.id);
      const source = normalizeOptionalString(candidate.source);
      if (!id || !source) {
        return;
      }

      if (WidgetAcComponent.RESERVED_AC_AGGREGATE_IDS.has(id)) {
        return;
      }

      const key = normalizeOptionalString(candidate.key) ?? `${id}||${source}`;
      devices.set(key, { id, source, key });
    });

    return [...devices.values()].sort((left, right) => left.key.localeCompare(right.key));
  }

  private normalizeCardMode(value: unknown): ElectricalCardModeConfig {
    const candidate = (value && typeof value === 'object') ? value as { displayMode?: unknown; metrics?: unknown } : null;
    const metrics = normalizeStringList(candidate?.metrics);
    return {
      displayMode: candidate?.displayMode === 'compact' ? 'compact' : 'full',
      metrics: metrics.length ? metrics : ['line1Voltage', 'line1Current', 'line1Frequency', 'line2Voltage']
    };
  }

  private normalizeOptionsById(value: unknown): AcWidgetConfig['optionsById'] {
    if (!value || typeof value !== 'object') return {};
    const next: AcWidgetConfig['optionsById'] = {};
    Object.entries(value as Record<string, unknown>).forEach(([id]) => {
      const normalizedId = normalizeOptionalString(id);
      if (normalizedId) next[normalizedId] = {};
    });
    return next;
  }

  private parsePath(path: string): { id: string; key: string } | null {
    if (!path.startsWith(WidgetAcComponent.ROOT_PREFIX)) return null;

    const relative = path.slice(WidgetAcComponent.ROOT_PREFIX.length);

    const firstDot = relative.indexOf('.');
    if (firstDot <= 0 || firstDot === relative.length - 1) return null;

    return {
      id: relative.slice(0, firstDot),
      key: relative.slice(firstDot + 1)
    };
  }

  private normalizeMetricKey(key: string): string | null {
    const phaseMatch = key.match(/^phase\.([^.]+)\.(current|frequency|lineNeutralVoltage|realPower)$/);
    if (phaseMatch) {
      const line = this.resolveLineKey(phaseMatch[1]);
      if (!line) return null;

      const metric = phaseMatch[2];
      if (metric === 'current') return `${line}.current`;
      if (metric === 'frequency') return `${line}.frequency`;
      if (metric === 'lineNeutralVoltage') return `${line}.voltage`;
      return `${line}.realPower`;
    }

    if (key === 'total.realPower') {
      return 'power';
    }

    return key;
  }

  private resolveLineKey(phase: string): 'line1' | 'line2' | 'line3' | null {
    const normalized = phase.trim().toLowerCase();

    if (['0', '1', 'l1', 'line1', 'phase1', 'a'].includes(normalized)) return 'line1';
    if (['2', 'l2', 'line2', 'phase2', 'b'].includes(normalized)) return 'line2';
    if (['3', 'l3', 'line3', 'phase3', 'c'].includes(normalized)) return 'line3';

    return null;
  }

  private applyValue(snapshot: AcSnapshot, key: string, value: unknown, state: TState | null): boolean {
    const normalizedKey = this.normalizeMetricKey(key);
    if (!normalizedKey) {
      return false;
    }

    switch (normalizedKey) {
      case 'name': return setValue(snapshot, 'name', toStringValue(value));
      case 'location': return setValue(snapshot, 'location', toStringValue(value));
      case 'associatedBus': return setValue(snapshot, 'associatedBus', toStringValue(value));
      case 'mode': return setMetricValue(snapshot, 'mode', 'modeState', toStringValue(value), state);
      // Backward-compatible flat AC keys map to line 1 when source data is single-phase per id.
      case 'voltage': return setMetricValue(snapshot, 'line1Voltage', 'line1VoltageState', this.toNumber(value, 'V'), state);
      case 'current': return setMetricValue(snapshot, 'line1Current', 'line1CurrentState', this.toNumber(value, 'A'), state);
      case 'frequency': return setMetricValue(snapshot, 'line1Frequency', 'line1FrequencyState', this.toNumber(value, 'Hz'), state);
      case 'line1.voltage': return setMetricValue(snapshot, 'line1Voltage', 'line1VoltageState', this.toNumber(value, 'V'), state);
      case 'line1.current': return setMetricValue(snapshot, 'line1Current', 'line1CurrentState', this.toNumber(value, 'A'), state);
      case 'line1.frequency': return setMetricValue(snapshot, 'line1Frequency', 'line1FrequencyState', this.toNumber(value, 'Hz'), state);
      case 'line1.realPower': return setMetricValue(snapshot, 'power', 'line1CurrentState', this.toNumber(value, 'W'), state);
      case 'line2.voltage': return setMetricValue(snapshot, 'line2Voltage', 'line2VoltageState', this.toNumber(value, 'V'), state);
      case 'line2.current': return setMetricValue(snapshot, 'line2Current', 'line2CurrentState', this.toNumber(value, 'A'), state);
      case 'line2.frequency': return setMetricValue(snapshot, 'line2Frequency', 'line2FrequencyState', this.toNumber(value, 'Hz'), state);
      case 'line2.realPower': return setMetricValue(snapshot, 'power', 'line2CurrentState', this.toNumber(value, 'W'), state);
      case 'line3.voltage': return setMetricValue(snapshot, 'line3Voltage', 'line3VoltageState', this.toNumber(value, 'V'), state);
      case 'line3.current': return setMetricValue(snapshot, 'line3Current', 'line3CurrentState', this.toNumber(value, 'A'), state);
      case 'line3.frequency': return setMetricValue(snapshot, 'line3Frequency', 'line3FrequencyState', this.toNumber(value, 'Hz'), state);
      case 'line3.realPower': return setMetricValue(snapshot, 'power', 'line3CurrentState', this.toNumber(value, 'W'), state);
      case 'power': return setMetricValue(snapshot, 'power', 'line1CurrentState', this.toNumber(value, 'W'), state);
      default:
        return false;
    }
  }

  private render(snapshot: AcRenderSnapshot): void {
    if (!this.layer || !this.svg) return;

    drawDirectCards<AcSnapshot>({
      svg: this.svg,
      layer: this.layer,
      entities: snapshot.buses,
      displayModels: snapshot.displayModels,
      widgetColors: snapshot.widgetColors,
      compact: this.isCompactCardMode(),
      descriptor: {
        classPrefix: 'ac',
        includeCardBg: false,
        titleFallback: entity => this.resolveTitleText(entity)
      }
    });
  }

  private displayName(bus: AcSnapshot): string {
    return bus.name?.trim() || bus.id;
  }

  private resolveTitleText(bus: AcSnapshot): string {
    return bus.name || `AC ${bus.id}`;
  }

  private resolveModeText(bus: AcSnapshot): string {
    if (bus.mode) return `Mode ${bus.mode}`;
    return 'Mode -';
  }

  private buildMetricRows(bus: AcSnapshot): [string, string] {
    const mode = this.cardMode();
    const metricLabels = (mode.metrics.length ? mode.metrics : WidgetAcComponent.DEFAULT_CONFIG.ac?.cardMode?.metrics ?? [])
      .map(metric => this.toMetricLabel(metric, bus))
      .filter((label): label is string => !!label);

    if (!metricLabels.length) {
      return ['L1 - - -', 'L2 - -  L3 - -'];
    }

    const first = metricLabels.slice(0, 2).join('   ');
    const second = metricLabels.slice(2, 4).join('   ');
    return [first || ' ', second || ' '];
  }

  private toMetricLabel(metric: string, bus: AcSnapshot): string | null {
    switch (metric) {
      case 'line1Voltage': return `L1V ${this.formatValue(bus.line1Voltage, 'V')}`;
      case 'line1Current': return `L1A ${this.formatValue(bus.line1Current, 'A')}`;
      case 'line1Frequency': return `L1Hz ${this.formatValue(bus.line1Frequency, 'Hz')}`;
      case 'line2Voltage': return `L2V ${this.formatValue(bus.line2Voltage, 'V')}`;
      case 'line2Current': return `L2A ${this.formatValue(bus.line2Current, 'A')}`;
      case 'line2Frequency': return `L2Hz ${this.formatValue(bus.line2Frequency, 'Hz')}`;
      case 'line3Voltage': return `L3V ${this.formatValue(bus.line3Voltage, 'V')}`;
      case 'line3Current': return `L3A ${this.formatValue(bus.line3Current, 'A')}`;
      case 'line3Frequency': return `L3Hz ${this.formatValue(bus.line3Frequency, 'Hz')}`;
      default: return null;
    }
  }

  private formatValue(value: number | null | undefined, unit: string): string {
    if (value == null || Number.isNaN(value)) return '-';
    return `${value.toFixed(1)} ${unit}`;
  }

  private toNumber(value: unknown, unitHint: string): number | null {
    if (value == null || typeof value === 'boolean') return null;

    const rawNumber = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(rawNumber)) return null;

    const converted = this.units.convertToUnit(unitHint, rawNumber);
    return typeof converted === 'number' && Number.isFinite(converted) ? converted : null;
  }
}
