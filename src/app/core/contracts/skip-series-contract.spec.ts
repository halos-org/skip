import { describe, expect, it } from 'vitest';
import { ISkipConcreteSeriesDefinition, ISkipSeriesDefinition, ISkipTemplateSeriesDefinition, isSkipConcreteSeriesDefinition, isSkipSeriesEnabled, isSkipTemplateSeriesDefinition, } from './skip-series-contract';

describe('skip-series-contract guards', () => {
    const concreteSeries: ISkipConcreteSeriesDefinition = {
        seriesId: 'widget-1:datachart',
        datasetUuid: 'widget-1',
        ownerWidgetUuid: 'widget-1',
        ownerWidgetSelector: 'widget-data-chart',
        path: 'navigation.speedThroughWater',
        expansionMode: null,
        allowedIds: null,
        context: 'vessels.self',
        source: 'default',
        timeScale: 'minute',
        period: 10,
        retentionDurationMs: null,
        sampleTime: 1000,
        enabled: true,
    };

    const templateSeries: ISkipTemplateSeriesDefinition = {
        seriesId: 'widget-2:bms-template',
        datasetUuid: 'widget-2:bms-template',
        ownerWidgetUuid: 'widget-2',
        ownerWidgetSelector: 'widget-bms',
        path: 'self.electrical.batteries.*',
        expansionMode: 'bms-battery-tree',
        familyKey: 'batteries',
        allowedIds: ['house', 'start'],
        context: 'vessels.self',
        source: 'default',
        timeScale: 'hour',
        period: 24,
        retentionDurationMs: 86400000,
        sampleTime: null,
        enabled: true,
    };

    const solarTemplateSeries: ISkipTemplateSeriesDefinition = {
        seriesId: 'widget-3:solar-template',
        datasetUuid: 'widget-3:solar-template',
        ownerWidgetUuid: 'widget-3',
        ownerWidgetSelector: 'widget-solar-charger',
        path: 'self.electrical.solar.*',
        expansionMode: 'solar-tree',
        familyKey: 'solar',
        allowedIds: ['port', 'starboard'],
        context: 'vessels.self',
        source: 'default',
        timeScale: 'hour',
        period: 24,
        retentionDurationMs: 86400000,
        sampleTime: null,
        enabled: true,
    };

    it('identifies concrete series definitions', () => {
        const value: ISkipSeriesDefinition = concreteSeries;

        expect(isSkipConcreteSeriesDefinition(value)).toBe(true);
        expect(isSkipTemplateSeriesDefinition(value)).toBe(false);
    });

    it('identifies template series definitions', () => {
        const value: ISkipSeriesDefinition = templateSeries;

        expect(isSkipTemplateSeriesDefinition(value)).toBe(true);
        expect(isSkipConcreteSeriesDefinition(value)).toBe(false);
    });

    it('treats enabled false as disabled', () => {
        expect(isSkipSeriesEnabled(concreteSeries)).toBe(true);
        expect(isSkipSeriesEnabled({ ...concreteSeries, enabled: false })).toBe(false);
    });

    it('preserves template allowedIds filters for battery templates', () => {
        const value: ISkipSeriesDefinition = templateSeries;

        if (!isSkipTemplateSeriesDefinition(value)) {
            throw new Error('Expected template series definition');
            return;
        }

        expect(value.allowedIds).toEqual(['house', 'start']);
    });

    it('preserves template allowedIds filters for solar templates', () => {
        const value: ISkipSeriesDefinition = solarTemplateSeries;

        if (!isSkipTemplateSeriesDefinition(value)) {
            throw new Error('Expected template series definition');
            return;
        }

        expect(value.allowedIds).toEqual(['port', 'starboard']);
    });

    it('keeps concrete series free of template expansion state', () => {
        const value: ISkipSeriesDefinition = concreteSeries;

        if (!isSkipConcreteSeriesDefinition(value)) {
            throw new Error('Expected concrete series definition');
            return;
        }

        expect(value.expansionMode ?? null).toBeNull();
        expect(value.allowedIds ?? null).toBeNull();
    });
});
