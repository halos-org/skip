import { Component, OnInit, input, inject } from '@angular/core';
import { AppService } from '../../core/services/app-service';
import { MatCardModule } from '@angular/material/card';
import { MatOptionModule } from '@angular/material/core';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule, MatLabel } from '@angular/material/form-field';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxChange, MatCheckboxModule } from '@angular/material/checkbox';
import { MatRadioChange, MatRadioModule } from '@angular/material/radio';

@Component({
  selector: 'config-display-chart-options',
  standalone: true,
  templateUrl: './display-chart-options.component.html',
  styleUrl: './display-chart-options.component.scss',
  imports: [MatCardModule, MatFormFieldModule, MatCheckboxModule, MatSelectModule, MatOptionModule, MatLabel, MatInputModule, MatRadioModule, ReactiveFormsModule]
})
export class DisplayChartOptionsComponent implements OnInit {
  private app = inject(AppService);

  readonly convertUnitTo = input.required<FormControl<string | null>>();
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
  protected colors = [];

  ngOnInit(): void {
    this.colors = this.app.configurableThemeColors;
    if (this.showAverageData() && !this.showAverageData()?.value) {
      this.trackAgainstAverage().disable();
    }

    if (this.enableMinMaxScaleLimit()) {
      this.setValueScaleOptionsControls(this.enableMinMaxScaleLimit().value);
    }
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
