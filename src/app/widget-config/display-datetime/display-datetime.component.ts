import { Component, DestroyRef, OnInit, inject, input } from '@angular/core';
import { AbstractControl, UntypedFormControl, ValidationErrors, ValidatorFn, Validators, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { Observable, Subscription, debounceTime, map, startWith } from 'rxjs';
import { MatOption } from '@angular/material/core';
import { MatIconButton } from '@angular/material/button';
import { AsyncPipe } from '@angular/common';
import { MatAutocompleteTrigger, MatAutocomplete } from '@angular/material/autocomplete';
import { MatInput } from '@angular/material/input';
import { MatFormField, MatLabel, MatSuffix } from '@angular/material/form-field';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

export interface ITzDefinition {
  offset: string;
  label: string;
}

function requireMatch(tz: ITzDefinition[]): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const pathFound = tz.some(array => array.label === control.value);
    return pathFound ? null : { requireMatch: true };
  };
}

export const getDynamicTimeZones = (): ITzDefinition[] => {
  const timeZones = Intl.supportedValuesOf('timeZone'); // Get all supported time zones
  const now = new Date();

  return timeZones.map((timeZone) => {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
    });
    const parts = formatter.formatToParts(now);
    const offset = parts.find((part) => part.type === 'timeZoneName')?.value || '';
    return { offset, label: timeZone };
  });
};

@Component({
    selector: 'display-datetime-options',
    templateUrl: './display-datetime.component.html',
    imports: [MatFormField, MatLabel, MatInput, FormsModule, ReactiveFormsModule, MatAutocompleteTrigger, MatIconButton, MatSuffix, MatAutocomplete, MatOption, AsyncPipe]
})
export class DisplayDatetimeComponent implements OnInit {
  private readonly _destroyRef = inject(DestroyRef);
  readonly dateFormat = input<UntypedFormControl>(undefined);
  readonly dateTimezone = input<UntypedFormControl>(undefined);
  private tz: ITzDefinition[] = [];
  public filteredTZ: Observable<ITzDefinition[]>;
  private filteredTZSubscription: Subscription = null;

  constructor() { }

  ngOnInit(): void {
    this.tz = getDynamicTimeZones().sort((a, b) => this.compareOffsets(a.offset, b.offset));

    this.tz.unshift({ offset: "", label: "System Timezone -" });
    this.dateTimezone().setValidators([Validators.required, requireMatch(this.tz)]);

    // add autocomplete filtering
    this.filteredTZ = this.dateTimezone().valueChanges.pipe(
      debounceTime(500),
      startWith(''),
      map(value => this.filterTZ(value || ''))
    );

    this.filteredTZSubscription = this.filteredTZ.pipe(takeUntilDestroyed(this._destroyRef)).subscribe();
  }

  private filterTZ( value: string ): ITzDefinition[] {
    const filterValue = value.toLowerCase();
    return this.tz.filter(val => val.label.toLowerCase().includes(filterValue));
  }

  private compareOffsets(offsetA: string, offsetB: string): number {
    const parseOffset = (offset: string): number => {
      const match = offset.match(/([+-]?)(\d+)(?::(\d+))?/); // Match offsets like "+5:30", "-3", etc.
      if (!match) return 0;

      const sign = match[1] === '-' ? -1 : 1;
      const hours = parseInt(match[2], 10);
      const minutes = match[3] ? parseInt(match[3], 10) : 0;

      return sign * (hours * 60 + minutes); // Convert to total minutes
    };

    return parseOffset(offsetA) - parseOffset(offsetB);
  }
}
