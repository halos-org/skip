import {
  AfterViewInit,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  signal,
  untracked,
  viewChild
} from '@angular/core';
import { ChangeDetectionStrategy } from '@angular/core';
import {WidgetRuntimeDirective} from '../../core/directives/widget-runtime.directive';
import {WidgetStreamsDirective} from '../../core/directives/widget-streams.directive';
import {IPathArray, IWidgetSvcConfig} from '../../core/interfaces/widgets-interface';
import {CanvasService} from '../../core/services/canvas.service';
import {getColors} from '../../core/utils/themeColors.utils';
import {DashboardService} from '../../core/services/dashboard.service';
import {SignalkRequestsService} from '../../core/services/signalk-requests.service';
import {UnitsService} from '../../core/services/units.service';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {MatButtonModule} from '@angular/material/button';
import {ITheme} from '../../core/services/app-service';
import {MatTooltipModule} from '@angular/material/tooltip';

// DTS colour thresholds in m: warn below the first, alert below the second, alarm (OCS) below 0.
const DTS_WARN_M = 10;
const DTS_ALERT_M = 20;

@Component({
  selector: 'widget-racer-line',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Any interaction anywhere in the widget restarts the idle countdown back to mode 0.
  // Bound on the host so no press can be missed as modes are added, and so no plain
  // container has to be made an interaction target.
  host: { '(click)': 'touchMode()' },
  templateUrl: './widget-racer-line.component.html',
  styleUrls: ['./widget-racer-line.component.scss'],
  imports: [MatButtonModule, MatTooltipModule]
})
export class WidgetRacerLineComponent implements AfterViewInit, OnDestroy {
  // Functional inputs (Host2 contract)
  public id = input.required<string>();
  public type = input.required<string>();
  public theme = input.required<ITheme | null>();

  // Host2 directives/services
  protected readonly runtime = inject(WidgetRuntimeDirective);
  private readonly streams = inject(WidgetStreamsDirective);
  private readonly canvas = inject(CanvasService);
  protected readonly dashboard = inject(DashboardService);
  private readonly signalk = inject(SignalkRequestsService);
  private readonly unitsService = inject(UnitsService);
  private readonly destroyRef = inject(DestroyRef);

  // Static config from legacy defaultConfig
  public static readonly DEFAULT_CONFIG: IWidgetSvcConfig = {
    supportAutomaticHistoricalSeries: false,
    displayName: 'DTS',
    filterSelfPaths: true,
    playBeeps: true,
    numDecimal: 0,
    ignoreZones: true,
    color: 'contrast',
    modeTimeout: 10,
    updateInterval: 500,
    paths: {
      dtsPath: {
        description: 'Distance to Start Line',
        path: 'self.navigation.racing.distanceStartline',
        source: 'default',
        pathType: 'number',
        pathRequired: false,
        isPathConfigurable: false,
        convertUnitTo: 'm',
        showPathSkUnitsFilter: true,
        pathSkUnitsFilter: 'm',
        // Published continuously while the plugin is computing it, so it takes the
        // stale-data TTL: a frozen number here reads as a live one.
        enableTimeout: true
      },
      lineLengthPath: {
        description: 'Length of the start line',
        path: 'self.navigation.racing.startLineLength',
        source: 'default',
        pathType: 'number',
        pathRequired: false,
        isPathConfigurable: false,
        convertUnitTo: 'm',
        showPathSkUnitsFilter: true,
        pathSkUnitsFilter: 'm',
        enableTimeout: false
      },
      lineBiasPath: {
        description: 'Bias of the start line to starboard end',
        path: 'self.navigation.racing.stbLineBias',
        source: 'default',
        pathType: 'number',
        pathRequired: false,
        isPathConfigurable: false,
        convertUnitTo: 'm',
        showPathSkUnitsFilter: true,
        pathSkUnitsFilter: 'm',
        enableTimeout: false
      },
      // One object at navigation.racing.lines carries both the current line's name and
      // the list of known lines, so both keys point at it and pick their field out with
      // observe()'s RFC 6901 pointer ('/lines'). It is published when the lines change and
      // not again, so it also opts out of the stale-data timeout.
      startLineNamePath: {
        description: 'The current named start line',
        path: 'self.navigation.racing.lines',
        source: 'default',
        pathType: 'object',
        pathRequired: false,
        isPathConfigurable: false,
        enableTimeout: false,
        showPathSkUnitsFilter: false,
        pathSkUnitsFilter: null
      },
      linesPath: {
        description: 'The known named lines',
        path: 'self.navigation.racing.lines',
        source: 'default',
        pathType: 'object',
        pathRequired: false,
        isPathConfigurable: false,
        enableTimeout: false,
        showPathSkUnitsFilter: false,
        pathSkUnitsFilter: null
      },
      ttlPath: {
        description: 'Time to sail to the start line in seconds',
        path: 'self.navigation.racing.timeToLine',
        source: 'default',
        pathType: 'number',
        pathRequired: false,
        isPathConfigurable: false,
        convertUnitTo: 's',
        showConvertUnitTo: false,
        showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 's',
        // Published continuously while the plugin is computing it, so it takes the
        // stale-data TTL: a frozen number here reads as a live one.
        enableTimeout: true
      },
      ttbPath: {
        description: 'Time to delay before sailing to the start line in seconds',
        path: 'self.navigation.racing.timeToBurn',
        source: 'default',
        pathType: 'number',
        pathRequired: false,
        isPathConfigurable: false,
        convertUnitTo: 's',
        showConvertUnitTo: false,
        showPathSkUnitsFilter: false,
        pathSkUnitsFilter: 's',
        // Published continuously while the plugin is computing it, so it takes the
        // stale-data TTL: a frozen number here reads as a live one.
        enableTimeout: true
      },
    }
  };

  // Canvas refs
  private canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvasMainRef');
  private canvasElement: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private cssWidth = 0;
  private cssHeight = 0;
  private titleBitmap: HTMLCanvasElement | null = null;
  private titleBitmapText: string | null = null;
  private titleBitmapColor: string | null = null;

  // State. Distances are in m and times in s; distances convert to their measure only for display.
  private dtsValue: number | null = null;
  private lengthValue: number | null = null;
  private biasValue: number | null = null;
  private ttlValue: number | null = null;
  private ttbValue: number | null = null;
  private dtsUnit = signal<string>('');
  private lineLengthUnit = signal<string>('');
  private lineBiasUnit = signal<string>('');
  protected labelColor = signal<string>('');
  private valueColor = '';
  private dtsColor = '';
  private maxValueTextWidth = 0;
  private maxValueTextHeight = 0;
  private displayLineIndex = 0;
  private lines: string[] = [];
  private startLineName: string | null = null;
  protected portBiasValue = signal<string>('');
  protected lineLengthValue = signal<string>('');
  protected stbBiasValue = signal<string>('');
  protected mode = signal<number>(0);

  constructor() {
    // Theme/palette effect
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

    // Observe dtsPath
    effect(() => {
      const cfg = this.runtime.options(); if (!cfg) return;
      const pathCfg = (cfg.paths as IPathArray | undefined)?.['dtsPath'];
      if (!pathCfg?.path) return;
      untracked(() => this.streams.observe('dtsPath', pkt => {
        this.dtsValue = pkt?.data?.value ?? null;
        this.dtsUnit.set(pkt?.data?.measure ?? '');
        this.updateDtsColor();
        this.draw();
      }));
    });

    // Observe lineLengthPath
    effect(() => {
      const cfg = this.runtime.options(); if (!cfg) return;
      const pathCfg = (cfg.paths as IPathArray | undefined)?.['lineLengthPath'];
      if (!pathCfg?.path) return;
      untracked(() => this.streams.observe('lineLengthPath', pkt => {
        this.lengthValue = pkt?.data?.value ?? null;
        this.lineLengthUnit.set(pkt?.data?.measure ?? '');
        this.setLenBias();
        this.draw();
      }));
    });

    // Observe lineBiasPath
    effect(() => {
      const cfg = this.runtime.options(); if (!cfg) return;
      const pathCfg = (cfg.paths as IPathArray | undefined)?.['lineBiasPath'];
      if (!pathCfg?.path) return;
      untracked(() => this.streams.observe('lineBiasPath', pkt => {
        this.biasValue = pkt?.data?.value ?? null;
        this.lineBiasUnit.set(pkt?.data?.measure ?? '');
        this.setLenBias();
      }));
    });

    // Observe Start Line Name
    effect(() => {
      const cfg = this.runtime.options(); if (!cfg) return;
      const pathCfg = (cfg.paths as IPathArray | undefined)?.['startLineNamePath'];
      if (!pathCfg?.path) return;
      untracked(() => this.streams.observe('startLineNamePath', pkt => {
        this.startLineName = pkt?.data?.value ?? null;
        this.displayLineIndex = 0;
        for (let i = 0; i < this.lines.length; i++) {
          if (this.lines[i] === this.startLineName) {
            this.displayLineIndex = i;
            break;
          }
        }
        this.draw();
      }, '/startLineName'));
    });

    // Observe lines
    effect(() => {
      const cfg = this.runtime.options(); if (!cfg) return;
      const pathCfg = (cfg.paths as IPathArray | undefined)?.['linesPath'];
      if (!pathCfg?.path) return;
      untracked(() => this.streams.observe('linesPath', pkt => {
        this.lines = ['Default'];
        this.displayLineIndex = 0;
        if (pkt?.data?.value && Array.isArray(pkt.data.value)) {
          for (const line of pkt.data.value) {
            if (line.startLineName) {
              if (line.startLineName === this.startLineName)
                this.displayLineIndex = this.lines.length;
              this.lines.push(line.startLineName);
            }
          }
        }
      }, '/lines'));
    });

    // Stream: TTL
    effect(() => {
      const cfg = this.runtime.options();
      if (!cfg) {
        return;
      }
      const paths = cfg.paths as IPathArray | undefined;
      const path = paths?.['ttlPath']?.path;
      if (!path) {
        return;
      }
      untracked(() => this.streams.observe('ttlPath', pkt => {
        this.ttlValue = pkt?.data?.value ?? null;
        this.draw();
      }));
    });

    // Stream: TTB
    effect(() => {
      const cfg = this.runtime.options();
      if (!cfg) {
        return;
      }
      const paths = cfg.paths as IPathArray | undefined;
      const path = paths?.['ttbPath']?.path;
      if (!path) {
        return;
      }
      untracked(() => this.streams.observe('ttbPath', pkt => {
        this.ttbValue = pkt?.data?.value ?? null;
        this.draw();
      }));
    });

    // Request feedback beep
    this.signalk.subscribeRequest().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(result => {
      if (result.widgetUUID === this.id()) {
        if (result.statusCode === 200) this.beep(600, 20);
      }
    });
  }

  // Canvas lifecycle
  ngAfterViewInit(): void {
    this.canvasElement = this.canvasRef().nativeElement;
    this.ctx = this.canvasElement.getContext('2d');
    this.canvas.registerCanvas(this.canvasElement, {
      autoRelease: true,
      onResize: (w, h) => {
        this.cssWidth = w; this.cssHeight = h;
        this.maxValueTextWidth = Math.floor(this.cssWidth * 0.95);
        this.maxValueTextHeight = Math.floor(this.cssHeight * 0.95);
        this.draw();
      }
    });
    this.cssHeight = Math.round(this.canvasElement.getBoundingClientRect().height);
    this.cssWidth = Math.round(this.canvasElement.getBoundingClientRect().width);
    this.maxValueTextWidth = Math.floor(this.cssWidth * 0.95);
    this.maxValueTextHeight = Math.floor(this.cssHeight * 0.95);
    this.draw();
  }

  protected readonly modeTimeout = computed<number>(() =>
    (this.runtime.options() ?? WidgetRacerLineComponent.DEFAULT_CONFIG).modeTimeout ?? 10);

  /** Pending revert to the default display, if a control mode is showing. */
  private modeTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Restart the idle countdown after a button press.
   *
   * The control modes are meant to be used and left, and a widget parked on one is a
   * widget not showing its numbers - easily done on a boat, where the last press before
   * a start is rarely followed by a deliberate press back.
   */
  protected touchMode(): void {
    if (this.modeTimer) {
      clearTimeout(this.modeTimer);
      this.modeTimer = null;
    }
    const seconds = this.modeTimeout();
    if (this.mode() === 0 || !(seconds > 0)) return;
    this.modeTimer = setTimeout(() => {
      this.modeTimer = null;
      this.mode.set(0);
      this.draw();
    }, seconds * 1000);
  }

  // Interaction methods
  public toggleMode(): void {
    this.mode.update(v => (v + 1) % 5);
    this.touchMode();
    this.draw();
  }

  public setLineEnd(end: string): string | null {
    return this.signalk.putRequest('navigation.racing.setStartLine', {end, position: 'bow'}, this.id());
  }

  public adjustLineEnd(end: string, delta: number, rotateRadians: number | null): string | null {
    return this.signalk.putRequest('navigation.racing.setStartLine', {end, delta, rotate: rotateRadians || null}, this.id());
  }

  public nextDisplayLineName() {
    if (++this.displayLineIndex >= this.lines.length)
      this.displayLineIndex = 0;
  }

  public getDisplayLineName(): string {
    return this.lines[this.displayLineIndex] || 'Default';
  }

  public isDisplayLineCurrent(): boolean {
    return this.getDisplayLineName() === (this.startLineName || 'Default');
  }

  public setStartLine(name: string) {
    const startLineName = (name === 'Default' || !name) ? null : name;
    this.signalk.putRequest(
      'navigation.racing.setStartLineName',
      { startLineName },
      this.id()
    );
    this.mode.set(0);
    this.draw();
  }

  public toRadians(deg: number): number | null {
    return deg ? deg * (Math.PI / 180) : null;
  }
  private draw(): void {
    if (!this.ctx || !this.canvasElement) return;
    const cfg = this.runtime.options();
    const name = cfg?.displayName || 'DTS';
    const haloColor = this.theme()?.cardColor || undefined;
    const titleColor = this.labelColor();
    if (!this.titleBitmap || !cfg || this.titleBitmap.width !== this.canvasElement.width || this.titleBitmap.height !== this.canvasElement.height || this.titleBitmapText !== name || this.titleBitmapColor !== titleColor) {
      this.titleBitmap = this.canvas.createTitleBitmap(name, titleColor, 'normal', this.cssWidth, this.cssHeight, 0.1, haloColor, this.canvas.MIN_LABEL_PX);
      this.titleBitmapText = name;
      this.titleBitmapColor = titleColor;
    }
    this.canvas.clearCanvas(this.ctx, this.cssWidth, this.cssHeight);

    this.canvas.drawText(
      this.ctx,
      this.getValueText(),
      Math.floor(this.cssWidth * 0.5),
      Math.floor(this.cssHeight * 0.325),
      Math.floor(this.cssWidth * 0.95),
      Math.floor(this.cssHeight * 0.55),
      'bold',
      this.dtsColor,
      'center',
      'middle'
    );

    this.canvas.drawText(
      this.ctx,
      this.unitsService.getUnitDisplaySymbol(this.dtsUnit()),
      Math.floor(this.cssWidth * 0.975),
      Math.floor(this.cssHeight * 0.60),
      Math.floor(this.cssWidth * 0.95),
      Math.floor(this.cssHeight * 0.15),
      'normal',
      this.dtsColor,
      'right',
      'bottom',
      haloColor,
      this.canvas.MIN_UNIT_PX
    );

    this.canvas.drawText(
      this.ctx,
      'TTL',
      Math.floor(this.cssWidth * 0.025),
      Math.floor(this.cssHeight * 0.7),
      Math.floor(this.cssWidth * 0.10),
      Math.floor(this.cssHeight * 0.15),
      'normal',
      this.dtsColor,
      'left',
      'middle'
    );

    this.canvas.drawText(
      this.ctx,
      this.getTimeToLineText(),
      Math.floor(this.cssWidth * 0.15),
      Math.floor(this.cssHeight - 0.80),
      Math.floor(this.cssWidth * 0.35),
      Math.floor(this.cssHeight * 0.35),
      'bold',
      this.dtsColor,
      'left',
      'bottom'
    );

    this.canvas.drawText(
      this.ctx,
      'TTB',
      Math.floor(this.cssWidth * 0.525),
      Math.floor(this.cssHeight * 0.7),
      Math.floor(this.cssWidth * 0.10),
      Math.floor(this.cssHeight * 0.15),
      'normal',
      this.dtsColor,
      'left',
      'middle'
    );

    this.canvas.drawText(
      this.ctx,
      this.getTimeToBurnText(),
      Math.floor(this.cssWidth * 0.65),
      Math.floor(this.cssHeight - 0.80),
      Math.floor(this.cssWidth * 0.35),
      Math.floor(this.cssHeight * 0.35),
      'bold',
      this.dtsColor,
      'left',
      'bottom'
    );

    // Label composites last so its background-color halo can knock the values out behind it.
    this.canvas.drawTextBitmap(this.ctx, this.titleBitmap, this.cssWidth, this.cssHeight);

    this.setLenBias();
  }

  private getValueText(): string {
    const dts = this.dtsValue === null ? null : this.toPresentation(this.dtsUnit(), this.dtsValue);
    if (dts === null) return '--';
    const cfg = this.runtime.options();
    return dts.toFixed(cfg?.numDecimal ?? 0);
  }

  // A distance in its presentation measure; null for a measure the units table does not know.
  private toPresentation(measure: string, metres: number): number | null {
    return measure ? this.unitsService.convertToUnit(measure, metres) : metres;
  }

  private toHHMMSS(totalSeconds: number | null): string {
    if (totalSeconds == null || isNaN(totalSeconds)) return '-:--';
    const negative = totalSeconds < 0;
    if (negative) totalSeconds = -totalSeconds;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const sign = negative ? '-' : '';
    if (hours === 0)
      return `${sign}${minutes.toString().padStart(1, '0')}:${seconds.toString().padStart(2, '0')}`;
    return `${sign}${hours.toString().padStart(1, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  private getTimeToLineText(): string {
    return this.toHHMMSS(this.ttlValue);
  }

  private getTimeToBurnText(): string {
    return this.toHHMMSS(this.ttbValue);
  }
  private setLenBias(): void {
    const cfg = this.runtime.options(); if (!cfg) return;
    const length = this.lengthValue == null ? null : this.toPresentation(this.lineLengthUnit(), this.lengthValue);
    if ((cfg.paths as IPathArray)['lineLengthPath'].path && length != null) {
      const measure = this.lineLengthUnit();
      const unit = measure === 'feet' ? '′' : this.unitsService.getUnitDisplaySymbol(measure);
      this.lineLengthValue.set(`―${this.applyDecorations(length.toFixed(cfg.numDecimal))}${unit}―`);
    }
    const bias = this.biasValue == null ? null : this.toPresentation(this.lineBiasUnit(), this.biasValue);
    if ((cfg.paths as IPathArray)['lineBiasPath'].path && bias != null) {
      const measure = this.lineBiasUnit();
      const unit = measure === 'feet' ? '′' : this.unitsService.getUnitDisplaySymbol(measure);
      if (bias < 0) {
        this.portBiasValue.set('+' + (-bias).toFixed(cfg.numDecimal) + unit);
        this.stbBiasValue.set(bias.toFixed(cfg.numDecimal) + unit);
      } else {
        this.portBiasValue.set(' ' + (-bias).toFixed(cfg.numDecimal) + unit);
        this.stbBiasValue.set(' +' + bias.toFixed(cfg.numDecimal) + unit);
      }
    }
  }

  private applyDecorations(txt: string): string {
    switch ((this.runtime.options()?.paths as IPathArray | undefined)?.['dtsPath']?.convertUnitTo) {
      case 'percent':
      case 'percentraw':
        return txt + '%';
      default:
        return txt;
    }
  }

  private updateDtsColor(): void {
    const theme = this.theme(); const cfg = this.runtime.options();
    if (!theme || !cfg) return;
    if (cfg.ignoreZones) {
      if (!this.dtsValue) this.dtsColor = this.valueColor;
      else if (this.dtsValue < 0) this.dtsColor = theme.zoneAlarm;
      else if (this.dtsValue < DTS_WARN_M) this.dtsColor = theme.zoneWarn;
      else if (this.dtsValue < DTS_ALERT_M) this.dtsColor = theme.zoneAlert;
      else this.dtsColor = this.valueColor;
    } else {
      // Placeholder for potential state-driven colors (legacy used path states)
      this.dtsColor = this.valueColor;
    }
  }

  private beep(frequency = 440, duration = 100) {
    if (!this.runtime.options()?.playBeeps) return;
    const AudioCtx = (window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    const audioCtx = new AudioCtx();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gainNode.gain.value = 0.1;
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + duration / 1000);
  }

  ngOnDestroy(): void {
    if (this.modeTimer) {
      clearTimeout(this.modeTimer);
      this.modeTimer = null;
    }
    try {
      if (this.canvasElement) this.canvas.unregisterCanvas(this.canvasElement);
    } catch { /* ignore */ }
  }
}
