import {
  AfterViewInit,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  model,
  OnDestroy,
  signal,
  untracked,
  viewChild
} from '@angular/core';
import { ChangeDetectionStrategy } from '@angular/core';
import {WidgetRuntimeDirective} from '../../core/directives/widget-runtime.directive';
import {WidgetStreamsDirective} from '../../core/directives/widget-streams.directive';
import {IPathArray, IWidgetSvcConfig} from '../../core/interfaces/widgets-interface';
import {ITheme} from '../../core/services/app-service';
import {SignalkRequestsService} from '../../core/services/signalk-requests.service';
import {ToastService} from '../../core/services/toast.service';
import {DashboardService} from '../../core/services/dashboard.service';
import {CanvasService} from '../../core/services/canvas.service';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {getColors} from '../../core/utils/themeColors.utils';
import {FormsModule} from '@angular/forms';
import {MatButtonModule} from '@angular/material/button';
import {MatTooltipModule} from '@angular/material/tooltip';

/** A helm needs to know quickly that a start time did not take. */
const PENDING_START_TIME_TIMEOUT_MS = 5000;

/**
 * Local wall-clock time as `input[type=time]` requires it. `toLocaleTimeString` gives "05:30:45 PM"
 * under en-US and "17.30.45" under fi-FI; the control accepts neither and silently blanks itself.
 */
function toTimeInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

@Component({
  selector: 'widget-racer-timer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './widget-racer-timer.component.html',
  styleUrls: ['./widget-racer-timer.component.scss'],
  imports: [FormsModule, MatButtonModule, MatTooltipModule]
})
export class WidgetRacerTimerComponent implements AfterViewInit, OnDestroy {
  // Functional inputs
  public id = input.required<string>();
  public type = input.required<string>();
  public theme = input.required<ITheme | null>();

  // Static config
  public static readonly DEFAULT_CONFIG: IWidgetSvcConfig = {
    supportAutomaticHistoricalSeries: false,
    displayName: 'TTS',
    nextDashboard: 0,
    playBeeps: true,
    filterSelfPaths: true,
    paths: {
      ttsPath: { description: 'Time to the Start in seconds', path: 'self.navigation.racing.timeToStart', source: 'default', pathType: 'number', pathRequired: false, isPathConfigurable: false, convertUnitTo: 's', showConvertUnitTo: false, showPathSkUnitsFilter: false, pathSkUnitsFilter: 's' },
      startTimePath: { description: 'Time of the start', path: 'self.navigation.racing.startTime', source: 'default', pathType: 'Date', pathRequired: false, isPathConfigurable: false },
      dtsPath: { description: 'Distance to Start Line path, used to determine OCS', path: 'self.navigation.racing.distanceStartline', source: 'default', pathType: 'number', pathRequired: false, isPathConfigurable: false, convertUnitTo: 'm', showConvertUnitTo: false, showPathSkUnitsFilter: false, pathSkUnitsFilter: 'm' }
    },
    color: 'contrast',
    updateInterval: 500,
    enableTimeout: true,
    dataTimeout: 5,
    ignoreZones: true
  };

  // Injected directives/services
  protected readonly runtime = inject(WidgetRuntimeDirective);
  private readonly streams = inject(WidgetStreamsDirective);
  private readonly signalk = inject(SignalkRequestsService);
  private readonly toast = inject(ToastService);
  protected readonly dashboard = inject(DashboardService);
  private readonly canvas = inject(CanvasService);
  private readonly destroyRef = inject(DestroyRef);

  // Canvas refs
  private canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvasMainRef');
  private canvasElement: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private cssWidth = 0;
  private cssHeight = 0;
  private titleBitmap: HTMLCanvasElement | null = null;
  private titleBitmapText: string | null = null;
  private titleBitmapColor: string | null = null;

  // Signals
  protected labelColor = signal<string>('');
  protected mode = signal<number>(1); // mimic legacy mode state machine
  /** The mode whose @case renders the absolute start-time form. */
  private static readonly SET_START_TIME_MODE = 4;
  private ttsValue: number | null = null;
  private dtsValue: number | null = null;
  private valueColor = '';
  private valueStateColor = '';
  protected startAtTime = signal<string>('00:00:00');
  protected startAtTimeEdit = model<string>('');
  /** The setStartTime request we are waiting on, so an unrelated widget's reply cannot resolve it. */
  private pendingStartTimeRequest: string | null = null;
  private pendingStartTimeTimer: ReturnType<typeof setTimeout> | null = null;

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
        this.valueStateColor = palette.color;
        this.draw();
      });
    });

    // Stream: TTS
    effect(() => {
      const cfg = this.runtime.options();
      if (!cfg) return;
      const paths = cfg.paths as IPathArray | undefined;
      const path = paths?.['ttsPath']?.path;
      if (!path) return;
      untracked(() => this.streams.observe('ttsPath', pkt => {
        const lastTts = this.ttsValue;
        this.ttsValue = pkt?.data?.value ?? null;
        this.updateValueColor();
        this.draw();
        if (this.shouldBeep(lastTts, this.ttsValue)) this.beepForValue(this.ttsValue!);
        if (cfg.nextDashboard != null && cfg.nextDashboard >= 0 && lastTts === 1 && this.ttsValue === 0 && (!this.dtsValue || this.dtsValue >= 0)) {
          // Navigation handled externally (legacy used router) – could inject Router if needed
        }
      }));
    });

    // Stream: start time
    effect(() => {
      const cfg = this.runtime.options();
      if (!cfg) return;
      const paths = cfg.paths as IPathArray | undefined;
      const path = paths?.['startTimePath']?.path;
      if (!path) return;
      untracked(() => this.streams.observe('startTimePath', pkt => {
        const v = pkt?.data?.value as string | null;
        // The edit field is the user's, not the stream's, while the form is open. A data timeout
        // emits null every few seconds when no start time is set, which otherwise blanks what they
        // typed.
        const editing = this.mode() === WidgetRacerTimerComponent.SET_START_TIME_MODE;
        if (!v) {
          this.startAtTime.set('HH:MM:SS');
          if (!editing) { this.startAtTimeEdit.set(''); }
          if (this.mode() === 2) this.mode.set(1);
        } else {
          const iso = new Date(v);
          if (!editing) { this.startAtTimeEdit.set(toTimeInputValue(iso)); }
          this.startAtTime.set(iso.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        }
        this.draw();
      }));
    });

    // Stream: distance to start line
    effect(() => {
      const cfg = this.runtime.options();
      if (!cfg) return;
      const paths = cfg.paths as IPathArray | undefined;
      const path = paths?.['dtsPath']?.path;
      if (!path) return;
      untracked(() => this.streams.observe('dtsPath', pkt => {
        this.dtsValue = pkt?.data?.value ?? null;
      }));
    });

    // Request subscription (PUT feedback)
    this.signalk.subscribeRequest().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(result => {
      if (result.widgetUUID !== this.id()) return;
      if (result.statusCode === 200) this.beep(600, 20);
      if (result.requestId === this.pendingStartTimeRequest) {
        this.settlePendingStartTime(result.statusCode === 200
          ? null
          : result.message ?? result.statusCodeDescription ?? `Start time refused (${result.statusCode})`);
      }
    });
  }

  // Canvas lifecycle
  ngAfterViewInit() {
    this.canvasElement = this.canvasRef().nativeElement;
    this.ctx = this.canvasElement.getContext('2d');
    this.canvas.registerCanvas(this.canvasElement, {
      autoRelease: true, onResize: (w, h) => {
        this.cssWidth = w;
        this.cssHeight = h;
        this.draw();
      }
    });
    // initial dims
    this.cssHeight = Math.round(this.canvasElement.getBoundingClientRect().height);
    this.cssWidth = Math.round(this.canvasElement.getBoundingClientRect().width);
    this.draw();
  }

  ngOnDestroy() {
    this.clearPendingStartTimeTimer();
    try { if (this.canvasElement) this.canvas.unregisterCanvas(this.canvasElement); } catch { /* ignore */ }
  }

  // Interaction methods (mapped from legacy)
  public toggleMode(): void {
    this.mode.update(v => (v + 1) % 5);
    const tts = this.ttsValue;
    if (this.mode() === 1 && this.isStartTimerRunning()) this.mode.set(2);
    if (this.mode() === 2 && tts !== 0 && !this.isStartTimerRunning()) this.mode.set(3);
    this.draw();
  }

  public sendStartTimerCommand(command: string): void {
    this.signalk.putRequest('navigation.racing.setStartTime', { command }, this.id());
    if (command === 'start') this.mode.set(0);
    if (command === 'reset') { this.startAtTime.set('HH:MM:SS'); this.mode.set(1); }
  }

  public adjustStartTime(delta: number): void {
    this.signalk.putRequest('navigation.racing.setStartTime', { command: 'adjust', delta }, this.id());
  }

  /**
   * The only commit paths are the Set button and Enter. `change` is unusable: a time input fires it
   * as soon as the value is complete, which on Chromium is mid-entry — typing 20 then 4 of "20:40"
   * makes "20:04" complete. Blur is unusable too: a touch wheel picker leaves nowhere obvious to
   * tap, so a value would look entered and never be sent.
   */
  public setStartTime(): void {
    const entered = this.startAtTimeEdit();
    const parts = entered.split(':').map(Number);
    // A time field reads as empty until every segment is filled, so a half-entered value arrives
    // here as ''. Say so: with an explicit button, a silent return is indistinguishable from a
    // broken control.
    if (parts.length < 2 || parts.some(part => !Number.isFinite(part))) {
      this.toast.show('Enter a complete time first', 4000, false, 'error');
      return;
    }
    const [hours, minutes] = parts;
    const seconds = parts.length >= 3 ? parts[2] : 0;
    const now = new Date();
    const date = new Date(now); date.setHours(hours, minutes, seconds, 0); if (date <= now) date.setDate(date.getDate() + 1);
    // The widget holds no start time of its own — the readout shows what the race plugin publishes
    // back. Switching to it before the server answers shows a placeholder that is indistinguishable
    // from a set timer, so stay on the form until the request is settled.
    this.clearPendingStartTimeTimer();
    this.pendingStartTimeRequest =
      this.signalk.putRequest('navigation.racing.setStartTime', { command: 'set', startTime: date.toISOString() }, this.id());
    this.pendingStartTimeTimer = setTimeout(
      () => this.settlePendingStartTime('No reply from the race plugin; start time not set'),
      PENDING_START_TIME_TIMEOUT_MS);
  }

  /** Leave the form only once the request landed; otherwise say why and stay put. */
  private settlePendingStartTime(error: string | null): void {
    this.clearPendingStartTimeTimer();
    this.pendingStartTimeRequest = null;
    if (error) {
      this.toast.show(error, 5000, false, 'error');
      return;
    }
    this.mode.set(0);
    this.draw();
  }

  private clearPendingStartTimeTimer(): void {
    if (this.pendingStartTimeTimer) {
      clearTimeout(this.pendingStartTimeTimer);
      this.pendingStartTimeTimer = null;
    }
  }

  // Helpers
  private isStartTimerRunning(): boolean {
    return (this.ttsValue ?? 0) > 0 && this.startAtTime() !== null && this.startAtTime() !== 'HH:MM:SS';
  }

  private shouldBeep(lastVal: number | null, current: number | null): boolean {
    if (current == null) return false;
    if (this.startAtTime() === 'HH:MM:SS') return false;
    if (!this.runtime.options()?.playBeeps) return false;
    if (current === 0 && lastVal !== 0) return true;
    if (current < 10 && current >= 0) return true;
    if (current < 60 && current % 10 === 0) return true;
    return current % 60 === 0;
  }

  private beepForValue(v: number) {
    if (v === 0) this.beep(500, 1000);
    else if (v < 10) this.beep(450, 100);
    else if (v < 60 && v % 10 === 0) this.beep(400, 150);
    else if (v % 60 === 0) this.beep(350, 200);
  }

  private updateValueColor() {
    const theme = this.theme(); const cfg = this.runtime.options();
    if (!theme || !cfg) return;
    if (cfg.ignoreZones) {
      if (!this.ttsValue) this.valueStateColor = this.valueColor;
      else if (this.ttsValue === 0) this.valueStateColor = this.valueColor;
      else if (this.ttsValue < 10) this.valueStateColor = (this.dtsValue ?? 0) < 0 ? theme.zoneAlarm : theme.zoneWarn;
      else if (this.ttsValue < 60) this.valueStateColor = theme.zoneAlert;
      else this.valueStateColor = this.valueColor;
    } else {
      this.valueStateColor = this.valueColor; // states path not used; kept for future
    }
    if (this.ttsValue === 0) {
      this.mode.set(2);
      if ((this.dtsValue ?? 0) < 0) this.valueStateColor = theme.zoneAlarm;
    } else if (this.mode() === 1 && this.isStartTimerRunning()) this.mode.set(2);
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

  private getValueText(): string {
    return this.toHHMMSS(this.ttsValue);
  }

  private draw() {
    if (!this.ctx || !this.canvasElement) return;
    const cfg = this.runtime.options();
    const name = cfg?.displayName || 'TTS';
    const haloColor = this.theme()?.cardColor || undefined;
    const titleColor = this.labelColor();
    if (!this.titleBitmap || this.titleBitmap.width !== this.canvasElement.width || this.titleBitmap.height !== this.canvasElement.height || this.titleBitmapText !== name || this.titleBitmapColor !== titleColor) {
      this.titleBitmap = this.canvas.createTitleBitmap(name, titleColor, 'normal', this.cssWidth, this.cssHeight, 0.1, haloColor, this.canvas.MIN_LABEL_PX);
      this.titleBitmapText = name;
      this.titleBitmapColor = titleColor;
    }
    this.canvas.clearCanvas(this.ctx, this.cssWidth, this.cssHeight);
    this.canvas.drawText(
      this.ctx,
      this.getValueText(),
      Math.floor(this.cssWidth * 0.5),
      Math.floor(this.cssHeight * 0.55),
      Math.floor(this.cssWidth * 0.95),
      Math.floor(this.cssHeight * 0.90),
      'bold',
      this.valueStateColor,
      'center',
      'middle'
    );

    // Label composites last so its background-color halo can knock the value out behind it.
    this.canvas.drawTextBitmap(this.ctx, this.titleBitmap, this.cssWidth, this.cssHeight);
  }

  private beep(frequency = 440, duration = 100) {
    if (!this.runtime.options()?.playBeeps) return;
    // Audio is a courtesy, and it is blocked often enough — autoplay policy, no output device, a
    // sandboxed embed — that it must not take down the caller. This runs from the PUT-result
    // handler, where a throw would have swallowed the command's outcome.
    try {
      const AudioCtx = (window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
      const audioCtx = new AudioCtx();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.connect(gainNode); gainNode.connect(audioCtx.destination);
      oscillator.type = 'sine'; oscillator.frequency.value = frequency; gainNode.gain.value = 0.1;
      oscillator.start(); oscillator.stop(audioCtx.currentTime + duration / 1000);
    } catch {
      /* no audio available */
    }
  }
}
