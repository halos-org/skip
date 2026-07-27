import { Component, AfterViewInit, OnDestroy, ElementRef, viewChild, inject, effect, signal, untracked, input } from '@angular/core';
import { ChangeDetectionStrategy } from '@angular/core';
import { CanvasService } from '../../core/services/canvas.service';
import { getColors } from '../../core/utils/themeColors.utils';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective } from '../../core/directives/widget-streams.directive';
import { UnitsService } from '../../core/services/units.service';
import { IWidgetSvcConfig } from '../../core/interfaces/widgets-interface';
import { ITheme } from '../../core/services/app-service';

@Component({
  selector: 'widget-position',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './widget-position.component.html',
  styleUrls: ['./widget-position.component.scss'],
  imports: []
})
export class WidgetPositionComponent implements AfterViewInit, OnDestroy {
  // Functional Host2 inputs provided by dashboard container
  public id = input.required<string>();
  public type = input.required<string>();
  public theme = input.required<ITheme | null>();

  // Directives/services
  protected readonly runtime = inject(WidgetRuntimeDirective);
  private readonly streams = inject(WidgetStreamsDirective);
  private readonly canvas = inject(CanvasService);
  private readonly units = inject(UnitsService);

  // Canvas refs
  private canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvasMainRef');
  private canvasElement: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private cssWidth = 0;
  private cssHeight = 0;
  private titleBitmap: HTMLCanvasElement | null = null;
  private titleBitmapText: string | null = null;
  private titleBitmapColor: string | null = null;

  // Render metrics
  private maxTextWidth = 0;
  private maxTextHeight = 0;
  private middle = 0;
  private center = 0;
  private fontSizeOffset = 0;

  // Value state
  private latPos = '';
  private longPos = '';
  protected labelColor = signal<string>('');
  private valueColor = '';

  public static readonly DEFAULT_CONFIG: IWidgetSvcConfig = {
    supportAutomaticHistoricalSeries: false,
    displayName: 'Position',
    filterSelfPaths: true,
    paths: {
      positionPath: {
        description: 'Position',
        path: 'self.navigation.position',
        source: 'default',
        pathType: 'object',
        isPathConfigurable: true,
        showPathSkUnitsFilter: false,
        pathSkUnitsFilter: null
      }
    },
    color: 'contrast',
    updateInterval: 500,
    enableTimeout: false,
    dataTimeout: 5
  };

  constructor() {
    // Theme / palette effect
    effect(() => {
      const cfg = this.runtime.options();
      const theme = this.theme();
      if (!cfg || !theme) return;
      untracked(() => {
        const palette = getColors(cfg.color ?? 'contrast', theme);
        this.labelColor.set(palette.dim);
        this.valueColor = palette.color;
        this.draw();
      });
    });

    // Observe the whole position object and render both coordinates from it. Signal K emits
    // navigation.position as a single {latitude, longitude} object (in degrees), so one path
    // drives both values — latitude and longitude are never independent paths.
    effect(() => {
      const cfg = this.runtime.options();
      if (!cfg) return;
      const pathCfg = cfg.paths?.['positionPath'];
      if (!pathCfg?.path) return;
      untracked(() => this.streams.observe('positionPath', pkt => {
        const pos = pkt?.data?.value as { latitude?: number | null; longitude?: number | null } | null;
        this.latPos = this.formatCoordinate('latitudeMin', pos?.latitude);
        this.longPos = this.formatCoordinate('longitudeMin', pos?.longitude);
        this.calculateFontSizeAndPositions();
        this.draw();
      }));
    });
  }

  private formatCoordinate(measure: 'latitudeMin' | 'longitudeMin', value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '';
    // The latitudeMin/longitudeMin conversions return a preformatted DMS string despite convertToUnit's
    // number|null signature, so the String() coercion is load-bearing — do not drop it or reformat here.
    return String(this.units.convertToUnit(measure, value) ?? '');
  }

  // Canvas lifecycle
  ngAfterViewInit(): void {
    this.canvasElement = this.canvasRef().nativeElement;
    this.ctx = this.canvasElement.getContext('2d');
    this.canvas.registerCanvas(this.canvasElement, {
      autoRelease: true,
      onResize: (w, h) => {
        this.cssWidth = w;
        this.cssHeight = h;
        this.calculateFontSizeAndPositions();
        this.draw();
      }
    });
    this.cssHeight = Math.round(this.canvasElement.getBoundingClientRect().height);
    this.cssWidth = Math.round(this.canvasElement.getBoundingClientRect().width);
    this.calculateFontSizeAndPositions();
    this.draw();
  }

  private calculateFontSizeAndPositions(): void {
    if (!this.cssWidth || !this.cssHeight) return;
    this.maxTextHeight = Math.floor(this.cssHeight * 0.6 / 2);
    this.maxTextWidth = Math.floor(this.cssWidth * 0.85);
    this.center = this.cssWidth / 2;
    this.middle = this.cssHeight * 0.57;
    const longestString = this.latPos.length > this.longPos.length ? this.latPos : this.longPos;
    if (this.ctx) {
      const size = this.canvas.calculateOptimalFontSize(this.ctx, longestString, this.maxTextWidth, this.maxTextHeight, 'bold');
      this.fontSizeOffset = Math.floor(size * 0.0005);
    }
  }

  private draw(): void {
    if (!this.ctx || !this.canvasElement) return;
    const cfg = this.runtime.options();
    if (!cfg) return;
    const haloColor = this.theme()?.cardColor || undefined;
    const name = cfg.displayName || 'Position';
    const titleColor = this.labelColor();
    if (
      !this.titleBitmap ||
      this.titleBitmap.width !== this.canvasElement.width ||
      this.titleBitmap.height !== this.canvasElement.height ||
      this.titleBitmapText !== name ||
      this.titleBitmapColor !== titleColor
    ) {
      this.titleBitmap = this.canvas.createTitleBitmap(name, titleColor, 'normal', this.cssWidth, this.cssHeight, 0.1, haloColor, this.canvas.MIN_LABEL_PX);
      this.titleBitmapText = name;
      this.titleBitmapColor = titleColor;
    }
    this.canvas.clearCanvas(this.ctx, this.cssWidth, this.cssHeight);
    // Latitude
    this.canvas.drawText(
      this.ctx,
      this.latPos,
      this.center,
      this.middle - this.fontSizeOffset,
      this.maxTextWidth,
      this.maxTextHeight,
      'bold',
      this.valueColor,
      'center',
      'bottom'
    );
    // Longitude
    this.canvas.drawText(
      this.ctx,
      this.longPos,
      this.center,
      this.middle + this.fontSizeOffset,
      this.maxTextWidth,
      this.maxTextHeight,
      'bold',
      this.valueColor,
      'center',
      'top'
    );

    // Label composites last so its background-color halo can knock the values out behind it.
    this.canvas.drawTextBitmap(this.ctx, this.titleBitmap, this.cssWidth, this.cssHeight);
  }

  ngOnDestroy(): void {
    try {
      if (this.canvasElement) this.canvas.unregisterCanvas(this.canvasElement);
    } catch { /* ignore */ }
  }
}
