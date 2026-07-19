import { Component, effect, signal, input, inject, untracked, computed, ChangeDetectionStrategy } from '@angular/core';
import { IWidgetSvcConfig } from '../../core/interfaces/widgets-interface';
import { GaugeSteelComponent } from '../gauge-steel/gauge-steel.component';
import { ISkZone } from '../../core/interfaces/signalk-interfaces';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective } from '../../core/directives/widget-streams.directive';
import { WidgetMetadataDirective } from '../../core/directives/widget-metadata.directive';
import { UnitsService } from '../../core/services/units.service';
import { ITheme } from '../../core/services/app-service';

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
        convertUnitTo: 'unitless',
        sampleTime: 500
      }
    },
    displayScale: { type: 'linear', lower: 0, upper: 100 },
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
    enableTimeout: false,
    dataTimeout: 5,
    ignoreZones: false
  };

  // Reactive state
  protected readonly dataValue = signal<number>(0);
  protected readonly zones = signal<ISkZone[]>([]);
  protected readonly displayName = computed(() => this.runtime.options()?.displayName || 'Gauge Label');

  /** Measure the incoming value was converted to (server-resolved for this display path). '' = boot placeholder. */
  protected readonly effectiveUnit = signal<string>('');

  // displayScale bounds are stored in the user-picked convertUnitTo; re-express them in the effective
  // (server-resolved) measure so the child gauge's scale lines up with the already-converted value.
  protected readonly effectiveMinValue = computed<number>(() => {
    const cfg = this.runtime.options();
    const stored = cfg?.paths?.['gaugePath']?.convertUnitTo ?? 'unitless';
    const lower = cfg?.displayScale?.lower ?? 0;
    return this.unitsService.convertBetweenMeasures(stored, this.effectiveUnit(), lower);
  });
  protected readonly effectiveMaxValue = computed<number>(() => {
    const cfg = this.runtime.options();
    const stored = cfg?.paths?.['gaugePath']?.convertUnitTo ?? 'unitless';
    const lower = cfg?.displayScale?.lower ?? 0;
    const upper = cfg?.displayScale?.upper ?? lower + 100;
    return this.unitsService.convertBetweenMeasures(stored, this.effectiveUnit(), upper);
  });

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
          const raw = (pkt?.data?.value as number) ?? null;
          const measure = pkt?.data?.measure ?? '';
          this.effectiveUnit.set(measure);
          // Clamp against the stored displayScale bounds re-expressed in the effective measure, so the
          // already-converted value and the reinterpreted scale share one unit space.
          const stored = pathCfg.convertUnitTo ?? 'unitless';
          const lowerBound = cfg.displayScale?.lower ?? 0;
          const lower = this.unitsService.convertBetweenMeasures(stored, measure, lowerBound);
          const upper = this.unitsService.convertBetweenMeasures(stored, measure, cfg.displayScale?.upper ?? lowerBound + 100);
          if (raw == null) {
            this.dataValue.set(lower);
          } else {
            const clamped = Math.min(Math.max(raw, lower), upper);
            this.dataValue.set(clamped);
          }
        });
      });
    });

    // Zones observation effect
    effect(() => {
      const cfg = this.runtime.options();
      if (!cfg) return;
      if (cfg.ignoreZones) {
        this.zones.set([]);
        return;
      }
      const pathCfg = cfg.paths?.['gaugePath'];
      if (!pathCfg?.path) {
        this.zones.set([]);
        return;
      }
      // Establish metadata subscription (idempotent internally)
      untracked(() => this.metadata.observe('gaugePath'));
      // Mirror metadata directive zones
      this.zones.set(this.metadata.zones());
    });
  }
}
