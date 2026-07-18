import { Component, effect, inject, input, signal, untracked, OnDestroy, computed, ChangeDetectionStrategy } from '@angular/core';
import { Subscription } from 'rxjs';
import { SignalkRequestsService } from '../../core/services/signalk-requests.service';
import { ITheme } from '../../core/services/app-service';
import { ToastService } from '../../core/services/toast.service';
import { IWidgetSvcConfig, IDynamicControl, IWidgetPath, IDimensions } from '../../core/interfaces/widgets-interface';
import { SvgBooleanLightComponent } from '../svg-boolean-light/svg-boolean-light.component';
import { SvgBooleanButtonComponent } from '../svg-boolean-button/svg-boolean-button.component';
import { SvgBooleanSwitchComponent } from '../svg-boolean-switch/svg-boolean-switch.component';
import { DashboardService } from '../../core/services/dashboard.service';
import { WidgetTitleComponent } from '../../core/components/widget-title/widget-title.component';
import { getColors } from '../../core/utils/themeColors.utils';
import { WidgetRuntimeDirective } from '../../core/directives/widget-runtime.directive';
import { WidgetStreamsDirective } from '../../core/directives/widget-streams.directive';
import { SkipResizeObserverDirective } from '../../core/directives/skip-resize-observer.directive';
import { CanvasService } from '../../core/services/canvas.service';
import { measureBooleanControlsHeight } from './boolean-control-layout.util';

@Component({
  selector: 'widget-boolean-switch',
  templateUrl: './widget-boolean-switch.component.html',
  styleUrls: ['./widget-boolean-switch.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SkipResizeObserverDirective, SvgBooleanSwitchComponent, SvgBooleanButtonComponent, SvgBooleanLightComponent, WidgetTitleComponent]
})
export class WidgetBooleanSwitchComponent implements OnDestroy {
  // Host2 functional inputs (provided by widget-host2 wrapper)
  public id = input.required<string>();
  public type = input.required<string>();
  public theme = input.required<ITheme | null>();

  // Static default config consumed by runtime merge
  public static readonly DEFAULT_CONFIG: IWidgetSvcConfig = {
    displayName: 'Switch Panel Label',
    showLabel: true,
    filterSelfPaths: true,
    // Each control uses a matching path entry by pathID. For Host2 we preserve existing shape.
    paths: [],
    enableTimeout: false,
    dataTimeout: 5,
    color: 'contrast',
    zonesOnlyPaths: false,
    putEnable: true,
    putMomentary: false,
    multiChildCtrls: []
  };

  protected readonly runtime = inject(WidgetRuntimeDirective, { optional: true });
  private readonly streams = inject(WidgetStreamsDirective, { optional: true });

  // Services / directives
  protected dashboard = inject(DashboardService);
  private readonly signalkRequestsService = inject(SignalkRequestsService);
  private readonly toast = inject(ToastService);
  private readonly canvas = inject(CanvasService);

  // Reactive state
  public switchControls = signal<IDynamicControl[]>([]);
  protected labelColor = signal<string | undefined>(undefined);
  protected noTitleClass = computed<string>(() => {
    const cfg = this.runtime?.options();
    return (cfg?.showLabel === false) ? 'widgets-container-no-title' : 'widgets-container';
  });
  protected readonly ctrlDimensions = signal<IDimensions>({ width: 0, height: 0 });
  private hostSize: IDimensions = { width: 0, height: 0 };
  private skRequestSub = new Subscription();

  constructor() {
    // Effect: theme / label color
    effect(() => {
      const theme = this.theme();
      const cfg = this.runtime?.options();
      if (!theme || !cfg) return;
      untracked(() => {
        this.labelColor.set(getColors(cfg.color ?? 'contrast', theme).dim);
      });
    });

    // Effect: rebuild controls & register streams when config changes
    effect(() => {
      const cfg = this.runtime?.options();
      if (!cfg) return;
      const controls = (cfg.multiChildCtrls || []).map(c => ({ ...c, isNumeric: c.isNumeric ?? false }));
      untracked(() => {
        this.switchControls.set(controls);
        this.updateCtrlDimensions();
        // Register path observers for each control (idempotent via directive)
        const streams = this.streams;
        if (!streams) return;
        controls.forEach(ctrl => {
          const pathsArr = cfg.paths as IWidgetPath[] | undefined;
          if (!pathsArr?.length) return;
          const idx = pathsArr.findIndex(p => p.pathID === ctrl.pathID);
          if (idx < 0) return; // no matching path entry
          const pathEntry = pathsArr[idx];
          if (!pathEntry?.path) return; // guard empty path
          // NOTE: WidgetStreamsDirective.observe expects the logical key of cfg.paths.
          // Since cfg.paths is an array here, keys are '0', '1', ... Use the index as string.
          streams.observe(String(idx), pkt => {
            // packet shape: pkt.data.value
            const val = pkt?.data?.value;
            const nextVal = ctrl.isNumeric
              ? ([0, 1, null].includes(val) ? Boolean(val) : ctrl.value)
              : val;

            this.switchControls.update(list => {
              const i = list.findIndex(c => c.pathID === ctrl.pathID);
              if (i === -1) return list;
              const updated = { ...list[i], value: nextVal };
              return [...list.slice(0, i), updated, ...list.slice(i + 1)];
            });
          });
        });
      });
    });

    // Label width is canvas-measured; a cold boot measures against fallback-font
    // metrics until the web font settles, and nothing else re-measures on a static
    // dashboard — so re-measure once fonts are ready.
    this.canvas.whenFontsReady()
      .then(() => this.updateCtrlDimensions())
      .catch(() => { /* fonts.ready settling failed; keep the fallback-font metrics */ });
  }

  onResized(event: ResizeObserverEntry): void {
    this.hostSize = {
      width: event.contentRect.width,
      height: event.contentRect.height,
    };
    this.updateCtrlDimensions();
  }

  private updateCtrlDimensions(): void {
    const width = this.hostSize.width;
    const height = this.hostSize.height;
    const controls = this.switchControls();

    if (!width || !height || !controls.length) {
      this.ctrlDimensions.set({ width, height: 0 });
      return;
    }

    const measuredHeight = measureBooleanControlsHeight(width, height, controls, (text, fontSize) =>
      this.canvas.measureTextWidth(text, `700 ${fontSize}px ${this.canvas.DEFAULT_FONT}`));

    this.ctrlDimensions.set({ width, height: measuredHeight });
  }

  public toggle(ctrl: IDynamicControl): void {
    const cfg = this.runtime?.options();
    if (!cfg?.putEnable) return;
    const paths = cfg.paths as IWidgetPath[] | undefined;
    if (!paths) return;
    const i = paths.findIndex(p => p.pathID === ctrl.pathID);
    if (i < 0) return;
    const targetPath = paths[i].path;
    if (!targetPath) return;
    if (ctrl.isNumeric) {
      this.signalkRequestsService.putRequest(targetPath, ctrl.value ? 1 : 0, this.id());
    } else {
      this.signalkRequestsService.putRequest(targetPath, ctrl.value, this.id());
    }
  }

  ngOnDestroy(): void {
    this.skRequestSub?.unsubscribe();
  }
}
