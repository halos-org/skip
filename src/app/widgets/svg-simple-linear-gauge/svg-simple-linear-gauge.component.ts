import { ElementRef, Component, input, viewChild, computed, signal, untracked, effect, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { IDataHighlight } from '../../core/interfaces/widgets-interface';
import { ISkipResizeEvent, SkipResizeObserverDirective } from '../../core/directives/skip-resize-observer.directive';

/** User-space height of the drawing; the width follows the tile so nothing is letterboxed. */
const VIEWBOX_HEIGHT = 50;
/** Width the artwork was drawn at, and the narrowest it is ever laid out at. */
const VIEWBOX_MIN_WIDTH = 205;
/** Share of the width the bar spans, matching the Linear gauge so the two line up side by side. */
const BAR_LENGTH_FRACTION = 0.9;

@Component({
  selector: 'svg-simple-linear-gauge',
  templateUrl: './svg-simple-linear-gauge.component.svg',
  styleUrl: './svg-simple-linear-gauge.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SkipResizeObserverDirective]
})
export class SvgSimpleLinearGaugeComponent implements OnDestroy {
  protected readonly gaugeBarAnimate = viewChild<ElementRef>('gaugeBarAnimate');
  protected readonly displayName = input.required<string>();
  protected readonly displayNameColor = input.required<string | undefined>();
  protected readonly dataValue = input.required<number | null>();
  protected readonly dataValueLabel = input.required<string>();
  protected readonly unitLabel = input.required<string>();
  protected readonly barColor = input.required<string>();
  protected readonly barColorGradient = input.required<string>();
  protected readonly barColorBackground = input.required<string>();
  protected readonly gaugeMinValue = input.required<number>();
  protected readonly gaugeMaxValue = input.required<number>();
  protected readonly highlights = input.required<IDataHighlight[]>();
  /**
   * The drawing is stretched to the tile's own proportions rather than fitted inside them: at a
   * fixed aspect the browser letterboxes it, and a wide tile ends up with the bar floating in the
   * middle of a mostly empty card. Never narrower than the width the artwork was drawn at, so a tall
   * tile letterboxes vertically instead of crushing the text together.
   */
  private readonly aspect = signal(VIEWBOX_MIN_WIDTH / VIEWBOX_HEIGHT);
  protected readonly viewBoxWidth = computed(() =>
    Math.max(VIEWBOX_MIN_WIDTH, VIEWBOX_HEIGHT * this.aspect()));
  protected readonly viewBox = computed(() => `0 0 ${this.viewBoxWidth()} ${VIEWBOX_HEIGHT}`);
  protected readonly barInset = computed(() => this.viewBoxWidth() * (1 - BAR_LENGTH_FRACTION) / 2);
  protected readonly barLength = computed(() => this.viewBoxWidth() * BAR_LENGTH_FRACTION);
  protected readonly textRightX = computed(() => this.viewBoxWidth() - this.barInset());
  protected readonly scaleSliceValue = computed(() => {
    const scaleRange =  this.gaugeMaxValue() - this.gaugeMinValue();
    return scaleRange !== 0 ? this.barLength() / scaleRange : 0;
  });
  protected readonly newGaugeValue = signal<number | null>(null);
  protected readonly oldGaugeValue = signal<number | null>(null);
  private firstRenderApplied = false;

  private scheduleRafId: number | null = null;

  constructor() {
    effect(() => {
      // Only run if required inputs are available
      const min = this.gaugeMinValue();
      let value = this.dataValue();

      if (value == null) {
        // Set initial values if not already set
        value = min;
      }

      const nextGaugeValue = (value - min) * this.scaleSliceValue();

      untracked(() => {
        const previousGaugeValue = this.newGaugeValue();
        if (!this.firstRenderApplied || previousGaugeValue === null) {
          this.oldGaugeValue.set(nextGaugeValue);
          this.newGaugeValue.set(nextGaugeValue);
          this.firstRenderApplied = true;
        } else {
          this.oldGaugeValue.set(previousGaugeValue);
          this.newGaugeValue.set(nextGaugeValue);
        }

        if (this.gaugeBarAnimate()?.nativeElement) {
          // Cancel any previous animation frame
          if (this.scheduleRafId !== null) {
            cancelAnimationFrame(this.scheduleRafId);
          }
          this.scheduleRafId = requestAnimationFrame(() => {
            const gaugeBarAnimate = this.gaugeBarAnimate();
            if (gaugeBarAnimate?.nativeElement) {
              gaugeBarAnimate.nativeElement.beginElement();
            }
            this.scheduleRafId = null;
          });
        }
      });
    });
  }

  protected onResize(event: ISkipResizeEvent): void {
    if (event.width <= 0 || event.height <= 0) return;
    this.aspect.set(event.width / event.height);
  }

  ngOnDestroy(): void {
    // Cancel any pending animation frame
    if (this.scheduleRafId !== null) {
      cancelAnimationFrame(this.scheduleRafId);
      this.scheduleRafId = null;
    }
  }
}
