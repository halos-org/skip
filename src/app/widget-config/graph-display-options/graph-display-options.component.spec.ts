import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { UntypedFormControl } from '@angular/forms';
import { MatCheckboxChange } from '@angular/material/checkbox';
import { MatRadioChange } from '@angular/material/radio';
import { GraphDisplayOptionsComponent } from './graph-display-options.component';

describe('GraphDisplayOptionsComponent', () => {
    let component: GraphDisplayOptionsComponent;
    let fixture: ComponentFixture<GraphDisplayOptionsComponent>;

    const applyRequiredInputs = (targetFixture: ComponentFixture<GraphDisplayOptionsComponent>, overrides: Record<string, UntypedFormControl> = {}): Record<string, UntypedFormControl> => {
        const controls: Record<string, UntypedFormControl> = {
            datasetAverageArray: new UntypedFormControl([]),
            showAverageData: new UntypedFormControl(false),
            showDataPoints: new UntypedFormControl(false),
            trackAgainstAverage: new UntypedFormControl({ value: true, disabled: false }),
            showDatasetMinimumValueLine: new UntypedFormControl(false),
            showDatasetMaximumValueLine: new UntypedFormControl(false),
            showDatasetAverageValueLine: new UntypedFormControl(false),
            showDatasetAngleAverageValueLine: new UntypedFormControl(false),
            verticalChart: new UntypedFormControl(false),
            inverseYAxis: new UntypedFormControl(false),
            showTimeScale: new UntypedFormControl(true),
            showYScale: new UntypedFormControl(true),
            startScaleAtZero: new UntypedFormControl(true),
            yScaleSuggestedMin: new UntypedFormControl({ value: 1, disabled: false }),
            yScaleSuggestedMax: new UntypedFormControl({ value: 100, disabled: false }),
            enableMinMaxScaleLimit: new UntypedFormControl(false),
            yScaleMin: new UntypedFormControl({ value: 0, disabled: true }),
            yScaleMax: new UntypedFormControl({ value: 120, disabled: true }),
            numDecimal: new UntypedFormControl(2),
            color: new UntypedFormControl('contrast'),
            timeScale: new UntypedFormControl('minute'),
            period: new UntypedFormControl(10),
            ...overrides,
        };

        Object.entries(controls).forEach(([key, control]) => {
            targetFixture.componentRef.setInput(key, control);
        });

        return controls;
    };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [GraphDisplayOptionsComponent]
        })
            .compileComponents();

        fixture = TestBed.createComponent(GraphDisplayOptionsComponent);
        component = fixture.componentInstance;
        applyRequiredInputs(fixture);
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should disable trackAgainstAverage on init when moving average is disabled', () => {
        const localFixture = TestBed.createComponent(GraphDisplayOptionsComponent);
        const controls = applyRequiredInputs(localFixture, {
            showAverageData: new UntypedFormControl(false),
            trackAgainstAverage: new UntypedFormControl({ value: true, disabled: false })
        });

        localFixture.detectChanges();

        expect(controls.trackAgainstAverage.disabled).toBe(true);
    });

    it('drops a stored main-series choice that its own smoothing toggle contradicts (#600)', () => {
        // Otherwise the disabled group reads Smoothed Trend, and switching smoothing back on moves
        // the widget reading off the live value without the user choosing it.
        const localFixture = TestBed.createComponent(GraphDisplayOptionsComponent);
        const controls = applyRequiredInputs(localFixture, {
            showAverageData: new UntypedFormControl(false),
            trackAgainstAverage: new UntypedFormControl({ value: true, disabled: false })
        });

        localFixture.detectChanges();

        expect(controls.trackAgainstAverage.value).toBe(false);
    });

    it('should enable and disable fixed scale controls based on radio selection', () => {
        const yScaleMin = component.yScaleMin();
        const yScaleMax = component.yScaleMax();
        const yScaleSuggestedMin = component.yScaleSuggestedMin();
        const yScaleSuggestedMax = component.yScaleSuggestedMax();

        component.setScaleControls({ value: true } as MatRadioChange);
        expect(yScaleMin.disabled).toBe(false);
        expect(yScaleMax.disabled).toBe(false);
        expect(yScaleSuggestedMin.disabled).toBe(true);
        expect(yScaleSuggestedMax.disabled).toBe(true);

        component.setScaleControls({ value: false } as MatRadioChange);
        expect(yScaleMin.disabled).toBe(true);
        expect(yScaleMax.disabled).toBe(true);
        expect(yScaleSuggestedMin.disabled).toBe(false);
        expect(yScaleSuggestedMax.disabled).toBe(false);
    });

    it('states the smoothing span the graph actually averages over (#598)', () => {
        const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
        expect(text()).toContain('2.5 min');

        component.period().setValue(20);
        fixture.detectChanges();
        expect(text()).toContain('5 min');
    });

    it('keeps the series toggles and their reference lines in one card (#598)', () => {
        const cards = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.flex-item-rounded-card'));
        const seriesCards = cards.filter(card => (card.textContent ?? '').includes('Show Maximum Line'));
        expect(seriesCards).toHaveLength(1);
        expect(seriesCards[0].textContent).toContain('Display Data Points');
    });

    it('offers the main series as a choice between the live value and the smoothed trend (#598)', () => {
        const labels = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('mat-radio-button'))
            .map(button => (button.textContent ?? '').trim());
        expect(labels).toContain('Live Value');
        expect(labels).toContain('Smoothed Trend');
    });

    it('should enable and disable trackAgainstAverage from checkbox events', () => {
        const trackAgainstAverage = component.trackAgainstAverage();

        component.enableTrackAgainstMovingAverage({ checked: true } as MatCheckboxChange);
        expect(trackAgainstAverage.disabled).toBe(false);

        trackAgainstAverage.setValue(true);
        component.enableTrackAgainstMovingAverage({ checked: false } as MatCheckboxChange);
        expect(trackAgainstAverage.value).toBe(false);
        expect(trackAgainstAverage.disabled).toBe(true);
    });
});
