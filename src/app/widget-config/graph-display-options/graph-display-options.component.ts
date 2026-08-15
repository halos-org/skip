import { Component, DestroyRef, OnInit, input, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { merge } from 'rxjs';
import { AppService } from '../../core/services/app-service';
import { describeSmoothingWindow } from '../../core/utils/graph-window.util';
import type { TimeScaleFormat } from '../../core/interfaces/graph-data.interfaces';
import { MatCardModule } from '@angular/material/card';
import { MatOptionModule } from '@angular/material/core';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule, MatLabel } from '@angular/material/form-field';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxChange, MatCheckboxModule } from '@angular/material/checkbox';
import { MatRadioChange, MatRadioModule } from '@angular/material/radio';

@Component({
  selector: 'config-graph-display-options',
  standalone: true,
  templateUrl: './graph-display-options.component.html',
  styleUrl: './graph-display-options.component.scss',
  imports: [MatCardModule, MatFormFieldModule, MatCheckboxModule, MatSelectModule, MatOptionModule, MatLabel, MatInputModule, MatRadioModule, ReactiveFormsModule]
})
export class GraphDisplayOptionsComponent implements OnInit {
  private app = inject(AppService);
  private readonly _destroyRef = inject(DestroyRef);

  readonly datasetAverageArray = input.required<FormControl<string>>();
  readonly showAverageData = input.required<FormControl<boolean>>();
  readonly showDataPoints = input.required<FormControl<boolean>>();
  readonly trackAgainstAverage = input.required<FormControl<boolean>>();
  readonly showDatasetMinimumValueLine = input.required<FormControl<boolean>>();
  readonly showDatasetMaximumValueLine = input.required<FormControl<boolean>>();
  readonly showDatasetAverageValueLine = input.required<FormControl<boolean>>();
  readonly showDatasetAngleAverageValueLine = input.required<FormControl<boolean>>();
  readonly verticalChart = input.required<FormControl<boolean>>();
  readonly inverseYAxis = input.required<FormControl<boolean>>();
  readonly showTimeScale = input.required<FormControl<boolean>>();

  readonly showYScale = input.required<FormControl<boolean>>();
  readonly startScaleAtZero = input.required<FormControl<boolean>>();
  readonly yScaleSuggestedMin = input.required<FormControl<number>>();
  readonly yScaleSuggestedMax = input.required<FormControl<number>>();

  readonly enableMinMaxScaleLimit = input.required<FormControl<boolean>>();
  readonly yScaleMin = input.required<FormControl<number>>();
  readonly yScaleMax = input.required<FormControl<number>>();

  readonly numDecimal = input.required<FormControl<number>>();
  readonly color = input.required<FormControl<string>>();
  /** The graph window the smoothing span is derived from; owned by the Data tab. */
  readonly timeScale = input.required<FormControl<string>>();
  readonly period = input.required<FormControl<number>>();
  protected colors: { label: string; value: string }[] = [];
  /** How far back the moving average reaches, phrased for the hint ('2.5 min'). */
  protected smoothingWindow = signal<string>('');

  ngOnInit(): void {
    this.colors = this.app.configurableThemeColors;
    if (this.showAverageData() && !this.showAverageData()?.value) {
      // Reset as well as disable: a stored choice of the smoothed trend, held while nothing smooths,
      // would otherwise take effect the moment smoothing is switched back on.
      this.trackAgainstAverage().setValue(false);
      this.trackAgainstAverage().disable();
    }

    this.refreshSmoothingWindow();
    // The span is a fraction of the graph window, so it follows edits made on the Data tab while
    // this dialog stays open.
    merge(this.timeScale().valueChanges, this.period().valueChanges)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe(() => this.refreshSmoothingWindow());

    if (this.enableMinMaxScaleLimit()) {
      this.setValueScaleOptionsControls(this.enableMinMaxScaleLimit().value);
    }
  }

  private refreshSmoothingWindow(): void {
    this.smoothingWindow.set(describeSmoothingWindow(this.timeScale().value as TimeScaleFormat, this.period().value));
  }

  private setValueScaleOptionsControls(enableMinMaxScaleLimit: boolean) {
    if (enableMinMaxScaleLimit) {
      this.yScaleMin()?.enable();
      this.yScaleMax()?.enable();
      this.yScaleSuggestedMin()?.disable();
      this.yScaleSuggestedMax()?.disable();
    } else {
      this.yScaleMin()?.disable();
      this.yScaleMax()?.disable();
      this.yScaleSuggestedMin()?.enable();
      this.yScaleSuggestedMax()?.enable();
    }
  }

  public setScaleControls(e: MatRadioChange) {
    this.setValueScaleOptionsControls(e.value);
  }

  public enableTrackAgainstMovingAverage(e: MatCheckboxChange): void {
    if (e.checked) {
      this.trackAgainstAverage().enable();
    } else {
      this.trackAgainstAverage().setValue(e.checked);
      this.trackAgainstAverage().disable();
    }
  }
}
