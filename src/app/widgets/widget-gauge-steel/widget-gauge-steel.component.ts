import { Component, effect, signal, input, inject, untracked, computed, ChangeDetectionStrategy } from '@angular/core';
import { IWidgetSvcConfig } from '../../core/interfaces/widgets-interface';
import { GaugeSteelComponent } from '../gauge-steel/gauge-steel.component';
import { ISkZone } from '../../core/interfaces/signalk-interfaces';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective } from '../../core/directives/widget-streams.directive';
import { WidgetMetadataDirective } from '../../core/directives/widget-metadata.directive';
import { UnitsService } from '../../core/services/units.service';
import { ITheme } from '../../core/services/app-service';
import { gaugeScaleMeasure, presentationValue, presentedScaleBounds } from '../../core/utils/si-presentation.util';

@Component({
  selector: 'widget-gauge-steel',
  templateUrl: './widget-gauge-steel.component.html',
  styleUrls: ['./widget-gauge-steel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GaugeSteelComponent],
})
export class WidgetSteelGaugeComponent {
  // Functional Host2 inputs
  public id = input.required<string>();
  public type = input.required<string>();
  public theme = input.required<ITheme | null>();

  // Inject host directives
  protected readonly runtime = inject(WidgetRuntimeDirective);
  private readonly streams = inject(WidgetStreamsDirective);
  private readonly metadata = inject(WidgetMetadataDirective);
  private readonly unitsService = inject(UnitsService);

  // Static default config (parity with legacy defaultConfig)
  public static readonly DEFAULT_CONFIG: IWidgetSvcConfig = {
    supportAutomaticHistoricalSeries: true,
    displayName: 'Gauge Label',
    filterSelfPaths: true,
    paths: {
      gaugePath: {
        description: 'Numeric Data',
        path: null,
        source: null,
        pathType: 'number',
        isPathConfigurable: true,
        showPathSkUnitsFilter: true,
        pathSkUnitsFilter: null,
        convertUnitTo: 'unitless'
      }
    },
    displayScale: { type: 'linear', lower: null, upper: null },
    gauge: {
      type: 'steel',
      subType: 'radial',
      backgroundColor: 'carbon',
      faceColor: 'anthracite',
      radialSize: 'full',
      rotateFace: false,
      digitalMeter: false
    },
    numDecimal: 2,
    updateInterval: 500,
    enableTimeout: false,
    dataTimeout: 5,
    ignoreZones: false
  };

  /** Options stored in a unit their value alone does not show; published in the dashboard schema. */
  public static readonly OPTION_UNITS: Record<string, string> = {
    'displayScale.lower': 'SI unit of gaugePath',
    'displayScale.upper': 'SI unit of gaugePath'
  };

  // Reactive state
  /** null until the first packet: a gauge built before any data arrives must not be seeded with a
   *  zero that reads as a live measurement on a scale whose minimum is negative. */
  protected readonly dataValue = signal<number | null>(null);
  protected readonly zones = signal<ISkZone[]>([]);
  protected readonly displayName = computed(() => this.runtime.options()?.displayName || 'Gauge Label');

  /** Measure the value is presented in (server-resolved for this display path). '' = boot placeholder. */
  protected readonly effectiveUnit = signal<string>('');

  /** Measure the scale is presented in: the tagged one, else the stored convertUnitTo before the first update. */
  private readonly effectiveMeasure = computed<string>(() =>
    gaugeScaleMeasure(this.effectiveUnit(), this.runtime.options()?.paths?.['gaugePath']?.convertUnitTo)
  );
  /** The scale bounds in the presentation measure, which the clamp shares. */
  private readonly scaleBounds = computed(() => presentedScaleBounds(
    this.unitsService,
    this.effectiveMeasure(),
    this.runtime.options()?.displayScale,
    this.metadata.displayScale(),
    { lower: 0, upper: 100 }
  ));
  protected readonly effectiveMinValue = computed<number>(() => this.scaleBounds().lower);
  protected readonly effectiveMaxValue = computed<number>(() => this.scaleBounds().upper);

  constructor() {
    // Data path effect
    effect(() => {
      const cfg = this.runtime.options();
      if (!cfg) return;
      const pathCfg = cfg.paths?.['gaugePath'];
      if (!pathCfg?.path) return;
      untracked(() => {
        // Reset the tagged measure so a stale unit never paints the new subscription's value.
        this.effectiveUnit.set('');
        this.streams.observe('gaugePath', pkt => {
          const si = (pkt?.data?.value as number) ?? null;
          const measure = pkt?.data?.measure ?? '';
          this.effectiveUnit.set(measure);
          const { lower, upper } = this.scaleBounds();
          if (si == null) {
            this.dataValue.set(lower);
          } else {
            const clamped = Math.min(Math.max(presentationValue(this.unitsService, measure, si), lower), upper);
            this.dataValue.set(clamped);
          }
        });
      });
    });

    // Metadata observation: zones, and the meta scale for bounds that are not set
    effect(() => {
      const cfg = this.runtime.options();
      if (!cfg) return;
      const pathCfg = cfg.paths?.['gaugePath'];
      if (!pathCfg?.path) {
        this.zones.set([]);
        return;
      }
      // Establish metadata subscription (idempotent internally)
      untracked(() => this.metadata.observe('gaugePath'));
      this.zones.set(cfg.ignoreZones ? [] : this.metadata.zones());
    });
  }
}
