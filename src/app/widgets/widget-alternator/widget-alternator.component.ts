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
import type { AlternatorDisplayModel, AlternatorSnapshot, AlternatorWidgetConfig, ElectricalCardModeConfig } from './widget-alternator.types';
import { WidgetTitleComponent } from '../../core/components/widget-title/widget-title.component';
import { normalizeOptionalString, normalizeStringList, normalizeTrackedDevices } from '../shared/electrical-config.util';
import { setValue, setMetricValue, toStringValue, resolveMostSevereState } from '../shared/electrical-apply.util';
import { ElectricalIngestScheduler } from '../shared/electrical-ingest-scheduler';
import { ElectricalTopologyStore, type ElectricalTopologyEntry } from '../shared/electrical-topology-store';
import { drawDirectCards, initDirectCardSvg } from '../shared/electrical-direct-card-draw';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface AlternatorRenderSnapshot {
  alternators: AlternatorSnapshot[];
  displayModels: Record<string, AlternatorDisplayModel>;
  widgetColors: ReturnType<typeof getColors>;
}

@Component({
  selector: 'widget-alternator',
  templateUrl: './widget-alternator.component.html',
  styleUrl: './widget-alternator.component.scss',
  imports: [WidgetTitleComponent],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WidgetAlternatorComponent implements AfterViewInit {
  private static readonly ALTERNATOR_DESCRIPTOR = getElectricalWidgetFamilyDescriptor('widget-alternator');
  private static readonly SELF_ROOT_PATH = (() => {
    const root = WidgetAlternatorComponent.ALTERNATOR_DESCRIPTOR?.selfRootPath;
    if (!root) throw new Error('[WidgetAlternatorComponent] Descriptor missing or selfRootPath not set; check widget registration.');
    return root;
  })();
  private static readonly ROOT_PATTERN = `${WidgetAlternatorComponent.SELF_ROOT_PATH}.*`;
  private static readonly PATH_REGEX = new RegExp(`^${escapeRegex(WidgetAlternatorComponent.SELF_ROOT_PATH)}\\.([^.]+)\\.(.+)$`);
  private static readonly PATH_BATCH_WINDOW_MS = 500;

  public static readonly DEFAULT_CONFIG: IWidgetSvcConfig = {
    color: 'contrast',
    ignoreZones: false,
    alternator: {
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

  private readonly svgRef = viewChild.required<ElementRef<SVGSVGElement>>('alternatorSvg');
  private svg?: Selection<SVGSVGElement, unknown, null, undefined>;
  private layer?: Selection<SVGGElement, unknown, null, undefined>;

  private readonly store = new ElectricalTopologyStore<AlternatorSnapshot>({
    createSnapshot: seed => ({ id: seed.id, source: seed.source, deviceKey: seed.deviceKey }),
    applyValue: (snapshot, key, value, state) => this.applyValue(snapshot, key, value, state),
    derive: snapshot => this.derivePower(snapshot)
  });

  private readonly metaVersion = signal(0);

  private readonly scheduler = new ElectricalIngestScheduler<ElectricalTopologyEntry, AlternatorRenderSnapshot>({
    data: this.data,
    destroyRef: this.destroyRef,
    rootPattern: WidgetAlternatorComponent.ROOT_PATTERN,
    batchWindowMs: WidgetAlternatorComponent.PATH_BATCH_WINDOW_MS,
    watchMeta: update => update.path.endsWith('.temperature') || update.path.endsWith('.regulatorTemperature'),
    onMetaChange: () => this.metaVersion.update(v => v + 1),
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
        alternators: this.visibleAlternators(),
        displayModels: this.displayModels(),
        widgetColors
      };
    },
    draw: snapshot => this.render(snapshot)
  });

  protected readonly optionsById = signal<AlternatorWidgetConfig['optionsById']>({});
  protected readonly cardMode = signal<ElectricalCardModeConfig>({
    displayMode: 'full',
    metrics: ['voltage', 'current', 'power', 'revolutions']
  });

  protected readonly alternatorsByKey = this.store.store;
  protected readonly discoveredAlternatorIds = this.store.discoveredIds;
  protected readonly trackedDevices = this.store.trackedDevices;
  protected readonly visibleAlternatorKeys = this.store.visibleKeys;
  protected readonly visibleAlternators = this.store.visibleSnapshots;

  protected readonly hasAlternators = computed(() => this.visibleAlternators().length > 0);
  protected readonly activeDisplayMode = computed<ElectricalCardDisplayMode>(() => this.renderMode() ?? this.cardMode().displayMode ?? 'full');
  protected readonly isCompactCardMode = computed(() => this.activeDisplayMode() === 'compact');
  protected readonly colorRole = computed(() => this.runtime.options()?.color ?? 'contrast');
  protected readonly ignoreZones = computed(() => this.runtime.options()?.ignoreZones ?? false);
  protected readonly displayLabel = computed(() => {
    const alternators = this.visibleAlternators();
    if (alternators.length !== 1) {
      return 'Alternators';
    }

    return this.resolveTitleText(alternators[0]);
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

  protected readonly displayModels = computed<Record<string, AlternatorDisplayModel>>(() => {
    this.metaVersion(); // re-resolve when a watched path's displayUnits meta lands late/changes
    const alternators = this.visibleAlternators();
    const theme = this.theme();
    const widgetColors = this.widgetColors();
    const ignoreZones = this.ignoreZones();

    const idCount = new Map<string, number>();
    alternators.forEach(alternator => idCount.set(alternator.id, (idCount.get(alternator.id) ?? 0) + 1));
    const duplicateIds = new Set<string>(
      [...idCount.entries()].filter(([, count]) => count > 1).map(([id]) => id)
    );

    const models: Record<string, AlternatorDisplayModel> = {};
    for (const alternator of alternators) {
      const modelKey = alternator.deviceKey ?? alternator.id;
      const showSource = !!alternator.source && duplicateIds.has(alternator.id);
      const aggregateState = resolveMostSevereState(
        alternator.powerState ?? null,
        alternator.currentState ?? null,
        alternator.voltageState ?? null,
        alternator.temperatureState ?? null,
        alternator.chargingModeState ?? null,
        alternator.revolutionsState ?? null,
        alternator.fieldDriveState ?? null,
        alternator.regulatorTemperatureState ?? null
      );
      const primaryState = resolveMostSevereState(alternator.voltageState ?? null, alternator.currentState ?? null);
      const secondaryState = resolveMostSevereState(
        alternator.powerState ?? null,
        alternator.revolutionsState ?? null,
        alternator.temperatureState ?? null,
        alternator.regulatorTemperatureState ?? null
      );
      const [metricsLineOne, metricsLineTwo] = this.buildMetricRows(alternator);

      models[modelKey] = {
        id: alternator.id,
        titleText: this.resolveTitleText(alternator),
        modeText: this.isCompactCardMode() ? '' : this.resolveModeText(alternator),
        busText: this.isCompactCardMode() ? '' : (
          showSource ? (alternator.source ?? '-') : (alternator.associatedBus || alternator.location || '-')
        ),
        metricsLineOne,
        metricsLineTwo,
        stateBarColor: resolveZoneAwareColor(aggregateState, widgetColors?.dim ?? 'var(--skip-contrast-color)', theme, ignoreZones),
        titleTextColor: resolveZoneAwareColor(aggregateState, 'var(--skip-contrast-color)', theme, ignoreZones),
        metaTextColor: resolveZoneAwareColor(
          resolveMostSevereState(alternator.chargingModeState ?? null, alternator.fieldDriveState ?? null),
          'var(--skip-contrast-dim-color)',
          theme,
          ignoreZones
        ),
        primaryMetricsTextColor: resolveZoneAwareColor(primaryState, 'var(--skip-contrast-color)', theme, ignoreZones),
        secondaryMetricsTextColor: resolveZoneAwareColor(secondaryState, 'var(--skip-contrast-color)', theme, ignoreZones)
      };
    }

    return models;
  });

  constructor() {
    effect(() => {
      const cfg = this.runtime.options();
      if (!cfg) {
        return;
      }

      untracked(() => this.applyConfig(cfg));
    });

    effect(() => {
      const models = this.displayModels();
      const alternators = this.visibleAlternators();
      const widgetColors = this.widgetColors();
      if (!this.svg || !widgetColors) return;
      this.scheduler.requestRender({ alternators, displayModels: models, widgetColors });
    });
  }

  ngAfterViewInit(): void {
    this.initializeSvg();
    this.scheduler.requestRender();
  }

  private initializeSvg(): void {
    const { svg, layer } = initDirectCardSvg(this.svgRef().nativeElement, {
      ariaLabel: 'Alternator View',
      classPrefix: 'alternator'
    });
    this.svg = svg;
    this.layer = layer;
  }

  private applyConfig(cfg: IWidgetSvcConfig): void {
    const alternatorCfg = this.resolveAlternatorConfig(cfg);
    this.store.applyConfig(alternatorCfg.trackedDevices ?? []);
    this.optionsById.set(alternatorCfg.optionsById);
    this.cardMode.set(this.normalizeCardMode(alternatorCfg.cardMode));
  }

  private resolveAlternatorConfig(cfg: IWidgetSvcConfig): AlternatorWidgetConfig {
    const alternator = cfg.alternator;
    const optionsById = this.normalizeOptionsById(
      (alternator as { optionsById?: unknown; alternatorOptionsById?: unknown } | undefined)?.optionsById
      ?? (alternator as { alternatorOptionsById?: unknown } | undefined)?.alternatorOptionsById
    );

    return {
      trackedDevices: normalizeTrackedDevices(alternator?.trackedDevices),
      optionsById,
      cardMode: this.normalizeCardMode(alternator?.cardMode)
    };
  }

  private normalizeCardMode(value: unknown): ElectricalCardModeConfig {
    const candidate = (value && typeof value === 'object') ? value as { displayMode?: unknown; metrics?: unknown } : null;
    if (!candidate) {
      return {
        displayMode: 'full',
        metrics: ['voltage', 'current', 'power', 'revolutions']
      };
    }

    const metrics = normalizeStringList(candidate?.metrics);
    return {
      displayMode: candidate?.displayMode === 'compact' ? 'compact' : 'full',
      metrics: metrics.length ? metrics : ['voltage', 'current', 'power', 'revolutions']
    };
  }

  private normalizeOptionsById(value: unknown): AlternatorWidgetConfig['optionsById'] {
    if (!value || typeof value !== 'object') {
      return {};
    }

    const next: AlternatorWidgetConfig['optionsById'] = {};
    Object.entries(value as Record<string, unknown>).forEach(([id]) => {
      const normalizedId = normalizeOptionalString(id);
      if (!normalizedId) {
        return;
      }

      next[normalizedId] = {};
    });

    return next;
  }

  private parsePath(path: string): { id: string; key: string } | null {
    const match = path.match(WidgetAlternatorComponent.PATH_REGEX);
    if (!match) return null;
    return { id: match[1], key: match[2] };
  }

  private applyValue(snapshot: AlternatorSnapshot, key: string, value: unknown, state: TState | null): boolean {
    switch (key) {
      case 'name':
        return setValue(snapshot, 'name', toStringValue(value));
      case 'location':
        return setValue(snapshot, 'location', toStringValue(value));
      case 'associatedBus':
        return setValue(snapshot, 'associatedBus', toStringValue(value));
      case 'chargingMode':
        return setMetricValue(snapshot, 'chargingMode', 'chargingModeState', toStringValue(value), state);
      case 'voltage':
        return setMetricValue(snapshot, 'voltage', 'voltageState', this.toNumber(value, 'V'), state);
      case 'current':
        return setMetricValue(snapshot, 'current', 'currentState', this.toNumber(value, 'A'), state);
      case 'power':
      case 'realPower':
        return setMetricValue(snapshot, 'rawPower', 'powerState', this.toNumber(value, 'W'), state);
      case 'temperature':
        return setMetricValue(snapshot, 'temperature', 'temperatureState', this.toNumber(value, 'K'), state);
      case 'revolutions':
        return setMetricValue(snapshot, 'revolutions', 'revolutionsState', this.toNumber(value, 'Hz'), state);
      case 'fieldDrive':
        return setMetricValue(snapshot, 'fieldDrive', 'fieldDriveState', this.toNumber(value, '%'), state);
      case 'regulatorTemperature':
        return setMetricValue(snapshot, 'regulatorTemperature', 'regulatorTemperatureState', this.toNumber(value, 'K'), state);
      case 'setpointVoltage':
        return setMetricValue(snapshot, 'setpointVoltage', 'setpointVoltageState', this.toNumber(value, 'V'), state);
      case 'setpointCurrent':
        return setMetricValue(snapshot, 'setpointCurrent', 'setpointCurrentState', this.toNumber(value, 'A'), state);
      default:
        return false;
    }
  }

  private derivePower(snapshot: AlternatorSnapshot): void {
    const derivedPower = snapshot.rawPower != null
      ? snapshot.rawPower
      : (snapshot.voltage != null && snapshot.current != null ? snapshot.voltage * snapshot.current : null);
    if (derivedPower != null) {
      snapshot.power = Number.isFinite(derivedPower) ? derivedPower : null;
    } else {
      snapshot.power = null;
    }

    if (snapshot.rawPower == null) {
      snapshot.powerState = resolveMostSevereState(snapshot.voltageState ?? null, snapshot.currentState ?? null);
    }
  }

  private render(snapshot: AlternatorRenderSnapshot): void {
    if (!this.layer || !this.svg) {
      return;
    }

    drawDirectCards<AlternatorSnapshot>({
      svg: this.svg,
      layer: this.layer,
      entities: snapshot.alternators,
      displayModels: snapshot.displayModels,
      widgetColors: snapshot.widgetColors,
      compact: this.isCompactCardMode(),
      descriptor: {
        classPrefix: 'alternator',
        includeCardBg: true,
        titleFallback: entity => this.resolveTitleText(entity)
      }
    });
  }

  private displayName(alternator: AlternatorSnapshot): string {
    return alternator.name?.trim() || alternator.id;
  }

  private resolveTitleText(alternator: AlternatorSnapshot): string {
    return alternator.name || `Alternator ${alternator.id}`;
  }

  private resolveModeText(alternator: AlternatorSnapshot): string {
    if (alternator.chargingMode) {
      return `Mode ${alternator.chargingMode}`;
    }

    if (alternator.fieldDrive != null) {
      return `Field ${alternator.fieldDrive.toFixed(0)} %`;
    }

    return 'Mode -';
  }

  private buildMetricRows(alternator: AlternatorSnapshot): [string, string] {
    const mode = this.cardMode();
    if (this.activeDisplayMode() === 'full') {
      return [
        `V ${this.formatValue(alternator.voltage, 'V')}   A ${this.formatValue(alternator.current, 'A')}`,
        `P ${this.formatValue(alternator.power, 'W')}   RPM ${this.formatRevolutions(alternator.revolutions)}`
      ];
    }

    const metricLabels = mode.metrics
      .map(metric => this.toMetricLabel(metric, alternator))
      .filter((label): label is string => !!label);

    if (!metricLabels.length) {
      return ['V -   A -', 'P -   RPM -'];
    }

    const first = metricLabels.slice(0, 2).join('   ');
    const second = metricLabels.slice(2, 4).join('   ');
    return [first || ' ', second || ' '];
  }

  private toMetricLabel(metric: string, alternator: AlternatorSnapshot): string | null {
    switch (metric) {
      case 'voltage':
        return `V ${this.formatValue(alternator.voltage, 'V')}`;
      case 'current':
        return `A ${this.formatValue(alternator.current, 'A')}`;
      case 'power':
        return `P ${this.formatValue(alternator.power, 'W')}`;
      case 'temperature':
        return `T ${this.formatTemperature(alternator.temperature, `${WidgetAlternatorComponent.SELF_ROOT_PATH}.${alternator.id}.temperature`)}`;
      case 'revolutions':
        return `RPM ${this.formatRevolutions(alternator.revolutions)}`;
      case 'fieldDrive':
        return `FD ${this.formatPercent(alternator.fieldDrive)}`;
      case 'regulatorTemperature':
        return `RT ${this.formatTemperature(alternator.regulatorTemperature, `${WidgetAlternatorComponent.SELF_ROOT_PATH}.${alternator.id}.regulatorTemperature`)}`;
      default:
        return null;
    }
  }

  private formatValue(value: number | null | undefined, unit: string): string {
    if (value == null || Number.isNaN(value)) {
      return '-';
    }

    return `${value.toFixed(1)} ${unit}`;
  }

  private formatTemperature(value: number | null | undefined, path: string): string {
    if (value == null || Number.isNaN(value)) {
      return '-';
    }

    const measure = this.units.resolvePathMeasure(path);
    const converted = this.units.convertToUnit(measure, value);
    if (converted == null || !Number.isFinite(converted)) {
      return '-';
    }

    return `${converted.toFixed(1)} ${this.units.getUnitDisplaySymbol(measure)}`;
  }

  private formatRevolutions(value: number | null | undefined): string {
    if (value == null || Number.isNaN(value)) {
      return '-';
    }

    return Math.round(value * 60).toString();
  }

  private formatPercent(value: number | null | undefined): string {
    if (value == null || Number.isNaN(value)) {
      return '-';
    }

    return `${value.toFixed(0)} %`;
  }

  private toNumber(value: unknown, unitHint: string): number | null {
    if (value == null || typeof value === 'boolean') {
      return null;
    }

    const rawNumber = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(rawNumber)) {
      return null;
    }

    const converted = this.units.convertToUnit(unitHint, rawNumber);
    return Number.isFinite(converted) ? converted : rawNumber;
  }
}
