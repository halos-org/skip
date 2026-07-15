import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { WidgetHost2Component } from './widget-host2.component';
import { DialogService } from '../../services/dialog.service';
import { DashboardService } from '../../services/dashboard.service';
import { WidgetService } from '../../services/widget.service';
import { AppService } from '../../services/app-service';
import { DashboardHistorySeriesSyncService } from '../../services/dashboard-history-series-sync.service';
import { uiEventService } from '../../services/uiEvent.service';
import { UnitsService } from '../../services/units.service';
import { IWidget } from '../../interfaces/widgets-interface';

class DashboardServiceStub {
    public readonly isDashboardStatic = signal<boolean>(true);
    public readonly layoutEditCanceled = signal<number>(0);
    public readonly dashboards = signal([]);
    public readonly activeDashboard = signal(0);
    public deleteWidget = vi.fn();
    public duplicateWidget = vi.fn();
    public copyWidget = vi.fn();
    public cutWidget = vi.fn();
}

describe('WidgetHost2Component', () => {
    let fixture: ComponentFixture<WidgetHost2Component>;
    let component: WidgetHost2Component;
    let dashboard: DashboardServiceStub;
    let dialogServiceMock: {
        openWidgetOptions: Mock;
        openWidgetHistoryDialog: Mock;
    };
    let historySyncMock: {
        resolveSeriesForWidget: Mock;
    };
    let testWidget: IWidget;

    beforeEach(async () => {
        dashboard = new DashboardServiceStub();
        dialogServiceMock = {
            openWidgetOptions: vi.fn().mockReturnValue({ afterClosed: () => of(null) }),
            openWidgetHistoryDialog: vi.fn().mockReturnValue({ afterClosed: () => of(null) })
        };
        historySyncMock = {
            resolveSeriesForWidget: vi.fn().mockReturnValue([
                {
                    seriesId: 'widget-1:auto:navigation-speedthroughwater:default',
                    datasetUuid: 'widget-1:navigation-speedthroughwater:default',
                    ownerWidgetUuid: 'widget-1',
                    ownerWidgetSelector: 'widget-numeric',
                    path: 'navigation.speedThroughWater',
                    source: 'default',
                    timeScale: 'minute',
                    period: 10,
                    sampleTime: 1000,
                    enabled: true
                }
            ])
        };

        await TestBed.configureTestingModule({
            imports: [WidgetHost2Component],
            providers: [
                { provide: DashboardService, useValue: dashboard },
                { provide: DialogService, useValue: dialogServiceMock },
                {
                    provide: UnitsService,
                    useValue: {
                        convertToUnit: (_unit: string, value: number) => value
                    }
                },
                {
                    provide: WidgetService,
                    useValue: {
                        getComponentType: vi.fn().mockReturnValue(undefined),
                        getWidgetName: vi.fn().mockReturnValue(undefined)
                    }
                },
                {
                    provide: AppService,
                    useValue: {
                        cssThemeColorRoles$: of({})
                    }
                },
                {
                    provide: uiEventService,
                    useValue: {
                        isDragging: signal(false)
                    }
                },
                { provide: DashboardHistorySeriesSyncService, useValue: historySyncMock }
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(WidgetHost2Component);
        component = fixture.componentInstance;
        testWidget = {
            uuid: 'widget-1',
            type: 'widget-numeric',
            config: {
                displayName: 'STW',
                timeScale: 'minute',
                period: 10,
                paths: {
                    numericPath: {
                        description: 'Speed Through Water',
                        path: 'navigation.speedThroughWater',
                        source: 'default',
                        pathType: 'number',
                        isPathConfigurable: true,
                        sampleTime: 1000
                    }
                }
            }
        } as unknown as IWidget;
        (component as unknown as {
            widgetProperties: IWidget;
        }).widgetProperties = testWidget;
    });

    it('opens history dialog on long-press when dashboard is locked', async () => {
        dashboard.isDashboardStatic.set(true);

        component.onWidgetLongPress(new CustomEvent('press'));
        await Promise.resolve();

        expect(historySyncMock.resolveSeriesForWidget).toHaveBeenCalledWith(testWidget);
        expect(dialogServiceMock.openWidgetHistoryDialog).toHaveBeenCalledTimes(1);
        expect(dialogServiceMock.openWidgetHistoryDialog).toHaveBeenCalledWith(expect.objectContaining({
            title: 'STW',
            widget: testWidget
        }));
    });

    it('does not open history dialog on long-press when dashboard is unlocked', async () => {
        dashboard.isDashboardStatic.set(false);

        component.onWidgetLongPress(new CustomEvent('press'));
        await Promise.resolve();

        expect(historySyncMock.resolveSeriesForWidget).not.toHaveBeenCalled();
        expect(dialogServiceMock.openWidgetHistoryDialog).not.toHaveBeenCalled();
    });

    it('ignores options dialog open request when dashboard is locked', () => {
        dashboard.isDashboardStatic.set(true);

        component.openWidgetOptions(new Event('dblclick'));

        expect(dialogServiceMock.openWidgetOptions).not.toHaveBeenCalled();
    });

    it('opens the action menu on single-tap when the dashboard is unlocked', () => {
        dashboard.isDashboardStatic.set(false);
        const openMenu = vi.spyOn(component as unknown as { openActionMenu: (x: number, y: number) => void }, 'openActionMenu').mockImplementation(() => undefined);

        component.onSingleTap(new CustomEvent('tap', { detail: { center: { x: 30, y: 40 } } }));

        expect(openMenu).toHaveBeenCalledWith(30, 40);
    });

    it('does not open the action menu on single-tap when the dashboard is locked', () => {
        dashboard.isDashboardStatic.set(true);
        const openMenu = vi.spyOn(component as unknown as { openActionMenu: (x: number, y: number) => void }, 'openActionMenu').mockImplementation(() => undefined);

        component.onSingleTap(new CustomEvent('tap', { detail: { center: { x: 30, y: 40 } } }));

        expect(openMenu).not.toHaveBeenCalled();
    });

    it('does not open the action menu on single-tap while a drag is in flight', () => {
        dashboard.isDashboardStatic.set(false);
        TestBed.inject(uiEventService).isDragging.set(true);
        const openMenu = vi.spyOn(component as unknown as { openActionMenu: (x: number, y: number) => void }, 'openActionMenu').mockImplementation(() => undefined);

        component.onSingleTap(new CustomEvent('tap', { detail: { center: { x: 30, y: 40 } } }));

        expect(openMenu).not.toHaveBeenCalled();
    });

    it('routes the Settings action to the widget options dialog', () => {
        dashboard.isDashboardStatic.set(false);

        (component as unknown as { onWidgetAction: (id: string) => void }).onWidgetAction('settings');

        expect(dialogServiceMock.openWidgetOptions).toHaveBeenCalledTimes(1);
    });

    it('routes the Delete action to the dashboard service', () => {
        (component as unknown as { onWidgetAction: (id: string) => void }).onWidgetAction('delete');

        expect(dashboard.deleteWidget).toHaveBeenCalledWith('widget-1');
    });

    it('does not open history dialog when widget has no numeric paths', async () => {
        dashboard.isDashboardStatic.set(true);
        testWidget.config.paths = {
            textPath: {
                description: 'State',
                path: 'navigation.state',
                source: null,
                pathType: 'string',
                isPathConfigurable: true,
                sampleTime: 1000
            }
        };

        component.onWidgetLongPress(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        await Promise.resolve();

        expect(dialogServiceMock.openWidgetHistoryDialog).not.toHaveBeenCalled();
    });

    it('does not open history dialog when supportAutomaticHistoricalSeries is false', async () => {
        dashboard.isDashboardStatic.set(true);
        testWidget.config.supportAutomaticHistoricalSeries = false;

        component.onWidgetLongPress(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        await Promise.resolve();

        expect(dialogServiceMock.openWidgetHistoryDialog).not.toHaveBeenCalled();
    });

    it('does not open history dialog when resolved series is inactive', async () => {
        dashboard.isDashboardStatic.set(true);
        historySyncMock.resolveSeriesForWidget.mockReturnValue([
            {
                seriesId: 'widget-1:auto:navigation-speedthroughwater:default',
                datasetUuid: 'widget-1:navigation-speedthroughwater:default',
                ownerWidgetUuid: 'widget-1',
                ownerWidgetSelector: 'widget-numeric',
                path: 'navigation.speedThroughWater',
                source: 'default',
                sampleTime: 1000,
                enabled: false
            }
        ]);

        component.onWidgetLongPress(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        await Promise.resolve();

        expect(dialogServiceMock.openWidgetHistoryDialog).not.toHaveBeenCalled();
    });

    it('opens history dialog for widget-bms with the unexpanded template series', async () => {
        dashboard.isDashboardStatic.set(true);
        testWidget.type = 'widget-bms';
        testWidget.config = {
            displayName: 'BMS',
        };

        const templateSeries = [
            {
                seriesId: 'widget-1:bms-template',
                datasetUuid: 'widget-1:bms-template',
                ownerWidgetUuid: 'widget-1',
                ownerWidgetSelector: 'widget-bms',
                path: 'self.electrical.batteries.*',
                expansionMode: 'bms-battery-tree',
                enabled: true
            }
        ];
        historySyncMock.resolveSeriesForWidget.mockReturnValue(templateSeries);

        component.onWidgetLongPress(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        await Promise.resolve();

        expect(historySyncMock.resolveSeriesForWidget).toHaveBeenCalledWith(testWidget);
        expect(dialogServiceMock.openWidgetHistoryDialog).toHaveBeenCalledTimes(1);
        expect(dialogServiceMock.openWidgetHistoryDialog).toHaveBeenCalledWith(expect.objectContaining({
            title: 'BMS',
            widget: testWidget,
            seriesDefinitions: templateSeries
        }));
    });

    it('opens history dialog for widget-solar-charger with the unexpanded template series', async () => {
        dashboard.isDashboardStatic.set(true);
        testWidget.type = 'widget-solar-charger';
        testWidget.config = {
            displayName: 'Solar Charger',
            solarCharger: {
                trackedDevices: [],
                optionsById: {}
            }
        } as IWidget['config'];

        const templateSeries = [
            {
                seriesId: 'widget-1:solar-template',
                datasetUuid: 'widget-1:solar-template',
                ownerWidgetUuid: 'widget-1',
                ownerWidgetSelector: 'widget-solar-charger',
                path: 'self.electrical.solar.*',
                expansionMode: 'solar-tree',
                enabled: true
            }
        ];
        historySyncMock.resolveSeriesForWidget.mockReturnValue(templateSeries);

        component.onWidgetLongPress(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        await Promise.resolve();

        expect(historySyncMock.resolveSeriesForWidget).toHaveBeenCalledWith(testWidget);
        expect(dialogServiceMock.openWidgetHistoryDialog).toHaveBeenCalledTimes(1);
        expect(dialogServiceMock.openWidgetHistoryDialog).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Solar Charger',
            widget: testWidget,
            seriesDefinitions: templateSeries
        }));
    });


    it('auto-opens options once on init for brand-new widgets', async () => {
        dashboard.isDashboardStatic.set(false);
        testWidget.autoOpenOptionsOnCreate = true;

        fixture.detectChanges();
        await Promise.resolve();
        await Promise.resolve();

        expect(dialogServiceMock.openWidgetOptions).toHaveBeenCalledTimes(1);
        expect(testWidget.autoOpenOptionsOnCreate).toBeUndefined();
    });

    it('does not auto-open options on init when create flag is absent (duplicate/paste flows)', async () => {
        dashboard.isDashboardStatic.set(false);

        fixture.detectChanges();
        await Promise.resolve();

        expect(dialogServiceMock.openWidgetOptions).not.toHaveBeenCalled();
    });

    it('keeps widget config unchanged when auto-open options dialog is canceled', async () => {
        dashboard.isDashboardStatic.set(false);
        testWidget.autoOpenOptionsOnCreate = true;
        const configSnapshot = JSON.parse(JSON.stringify(testWidget.config));

        dialogServiceMock.openWidgetOptions.mockReturnValue({ afterClosed: () => of(null) });

        fixture.detectChanges();
        await Promise.resolve();
        await Promise.resolve();

        expect(dialogServiceMock.openWidgetOptions).toHaveBeenCalledTimes(1);
        expect(testWidget.config).toEqual(configSnapshot);
    });
});
