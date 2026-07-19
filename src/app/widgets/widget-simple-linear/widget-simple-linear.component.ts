import { Component, effect, signal, inject, input, untracked, computed } from '@angular/core';
import { ChangeDetectionStrategy } from '@angular/core';
import { SvgSimpleLinearGaugeComponent } from '../svg-simple-linear-gauge/svg-simple-linear-gauge.component';
import { IDataHighlight, IWidgetSvcConfig } from '../../core/interfaces/widgets-interface';
import { ITheme } from '../../core/services/app-service';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective } from '../../core/directives/widget-streams.directive';
import { WidgetMetadataDirective } from '../../core/directives/widget-metadata.directive';
import { getColors } from '../../core/utils/themeColors.utils';
import { getHighlights } from '../../core/utils/zones-highlight.utils';
import { UnitsService } from '../../core/services/units.service';
import { States } from '../../core/interfaces/signalk-interfaces';

@Component({
  selector: 'widget-simple-linear',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './widget-simple-linear.component.html',
  styleUrls: ['./widget-simple-linear.component.scss'],
  imports: [ SvgSimpleLinearGaugeComponent ]
})
export class WidgetSimpleLinearComponent {
  public id = input.required<string>();
  public type = input.required<string>();
  public theme = input.required<ITheme|null>();
  public static readonly DEFAULT_CONFIG: IWidgetSvcConfig = {
    supportAutomaticHistoricalSeries: true,
    displayName: 'Gauge Label',
    filterSelfPaths: true,
    paths: {
      'gaugePath': {
        description: 'Numeric Data',
        path: null,
        source: null,
        pathType: 'number',
        isPathConfigurable: true,
        showPathSkUnitsFilter: true,
        pathSkUnitsFilter: 'V',
        convertUnitTo: 'V',
        sampleTime: 500
      }
    },
    displayScale: { lower: 0, upper: 15, type: 'linear' },
    gauge: { type: 'simpleLinear', unitLabelFormat: 'full' },
    numInt: 1,
    numDecimal: 2,
    ignoreZones: false,
    color: 'contrast',
    enableTimeout: false,
    dataTimeout: 5
  };

  // Inject directives/services
  protected readonly runtime = inject(WidgetRuntimeDirective); // expose in template if needed later
  private readonly streams = inject(WidgetStreamsDirective);
  private readonly metadata = inject(WidgetMetadataDirective, { optional: true }); // Only used when ignoreZones=false
  private readonly unitsService = inject(UnitsService);

  // Signals (presentation state)
  private readonly effectiveUnit = signal<string>('');
  // Unit SYMBOL derives from the measure the streams directive applied to the value (server-resolved
  // for this display path), never the stored convertUnitTo, so the label and value cannot drift. An
  // empty measure yields an empty symbol — the neutral boot placeholder until displayUnits resolves.
  protected readonly unitsLabel = computed<string>(() => {
    const cfg = this.runtime.options();
    // Symbols are already compact; only truncate longer ones in 'abr' mode so short symbols that
    // share a first character (°C/°F, kn) stay distinct.
    const symbol = this.unitsService.getUnitDisplaySymbol(this.effectiveUnit());
    return cfg?.gauge?.unitLabelFormat === 'abr' && symbol.length > 2 ? symbol.substring(0, 1) : symbol;
  });
  protected readonly dataLabelValue = signal<string>('0');
  protected readonly dataValue = signal<number | null>(null);
  protected readonly barColor = signal<string>('');
  protected readonly barColorGradient = signal<string>('');
  protected readonly barColorBackground = signal<string>('');

  // Reinterpret the stored displayScale bounds (entered in the widget's stored convertUnitTo) into the
  // effective server-resolved measure, so the gauge scale, zone highlights and the converted value the
  // streams directive delivers all share one unit. A no-op when the measure equals the stored unit or
  // has not resolved yet (empty measure => bound returned unchanged).
  private reinterpretScaleBound(bound: number): number {
    const stored = this.runtime.options()?.paths?.['gaugePath']?.convertUnitTo ?? '';
    return this.unitsService.convertBetweenMeasures(stored, this.effectiveUnit(), bound);
  }
  protected readonly displayLower = computed<number>(() =>
    this.reinterpretScaleBound(this.runtime.options()?.displayScale?.lower ?? 0));
  protected readonly displayUpper = computed<number>(() =>
    this.reinterpretScaleBound(this.runtime.options()?.displayScale?.upper ?? 15));

  // Computed signal for highlights (zones)
  protected highlights = computed<IDataHighlight[]>(() => {
    const cfg = this.runtime.options();
    const theme = this.theme();
    if (!cfg || !theme) return [];
    if (cfg.ignoreZones || !this.metadata) return [];
    const zones = this.metadata.zones();
    if (!zones?.length) return [];

    // Zones (base SI units) convert to the effective measure; bounds are reinterpreted to match.
    // Before the measure resolves, fall back to the stored unit (like the ng gauges) so bands render
    // in the same unit as the still-stored-unit boot scale instead of vanishing until the first value.
    const zoneUnit = this.effectiveUnit() || (cfg.paths?.['gaugePath']?.convertUnitTo ?? '');
    return getHighlights(zones, theme, zoneUnit, this.unitsService, this.displayLower(), this.displayUpper());
  });
  private lastState: States | null = null; // simple cache to avoid redundant color sets

  constructor() {
    // Data stream registration
    effect(() => {
      const cfg = this.runtime.options();
      const path = cfg?.paths?.['gaugePath']?.path;
      if (!cfg || !path) return;
      untracked(() => {
        this.streams.observe('gaugePath', pkt => {
          const theme = this.theme();
          if (!cfg || !theme) return;
          this.effectiveUnit.set(pkt?.data?.measure ?? '');
          const raw = pkt?.data?.value as number | null;
            // Clamp & label formatting
          if (raw == null) {
            this.dataValue.set(this.displayLower());
            this.dataLabelValue.set('--');
          } else {
            const lower = this.displayLower();
            const upper = this.displayUpper();
            const clamped = Math.min(Math.max(raw, lower), upper);
            this.dataValue.set(clamped);
            this.dataLabelValue.set(clamped.toFixed(cfg.numDecimal));
          }

          if (!cfg.ignoreZones) {
            const s = pkt?.state as States | undefined;
            if (s && s !== this.lastState) {
              this.lastState = s;
              switch (s) {
                case States.Alarm: this.barColor.set(theme.zoneAlarm); break;
                case States.Warn: this.barColor.set(theme.zoneWarn); break;
                case States.Alert: this.barColor.set(theme.zoneAlert); break;
                case States.Nominal: this.barColor.set(theme.zoneNominal); break;
                default: this.barColor.set(getColors(cfg.color ?? 'contrast', theme).color); break;
              }
            }
          }
        });
      });
    });

    // Theme + base colors
    effect(() => {
      const cfg = this.runtime.options();
      const theme = this.theme();
      if (!cfg || !theme) return;
      untracked(() => {
        this.barColorBackground.set(theme.background);
        const palette = getColors(cfg.color ?? 'contrast', theme);
        // Set baseline colors (and recompute any zone-derived color on theme changes)
        if (cfg.ignoreZones) {
          this.barColor.set(palette.color);
        } else if (this.lastState) {
          switch (this.lastState) {
            case States.Alarm: this.barColor.set(theme.zoneAlarm); break;
            case States.Warn: this.barColor.set(theme.zoneWarn); break;
            case States.Alert: this.barColor.set(theme.zoneAlert); break;
            case States.Nominal: this.barColor.set(theme.zoneNominal); break;
            default: this.barColor.set(palette.color); break;
          }
        } else {
          // no state yet
          this.barColor.set(palette.color);
        }
        // Gradient: choose a dimmer role when available; fallback to same color
        this.barColorGradient.set(palette.dimmer || palette.dim || palette.color);
      });
    });

    // Zones metadata observation (only when needed)
    effect(() => {
      const cfg = this.runtime.options();
      const metadata = this.metadata;
      if (!cfg || cfg.ignoreZones || !metadata) return;
      untracked(() => metadata.observe('gaugePath'));
    });
  }
}
