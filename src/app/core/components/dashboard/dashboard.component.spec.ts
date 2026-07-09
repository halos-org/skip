import type { Mock } from "vitest";
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Subject, of } from 'rxjs';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';

import { DashboardComponent } from './dashboard.component';
import { DashboardService } from '../../services/dashboard.service';
import { ToastService } from '../../services/toast.service';
import { PluginConfigClientService } from '../../services/plugin-config-client.service';
import { DialogService } from '../../services/dialog.service';
import { uiEventService } from '../../services/uiEvent.service';

interface DashboardComponentPrivateApi {
    saveDashboard: () => void;
    _gridstack: () => {
        grid: {
            save: (saveContent: boolean, saveGridOpt: boolean) => unknown;
            offAll: () => void;
            destroy: () => void;
        };
    };
}

describe('DashboardComponent', () => {
    let fixture: ComponentFixture<DashboardComponent>;
    let component: DashboardComponent;
    let privateApi: DashboardComponentPrivateApi;
    let mockDashboardService: DashboardService;
    let gridMock: {
        grid: {
            save: Mock;
            offAll: Mock;
            destroy: Mock;
            load: Mock;
            batchUpdate: Mock;
            addWidget: Mock;
            willItFit: Mock;
            isAreaEmpty: Mock;
            getGridItems: Mock;
            getRow: Mock;
            cellHeight: Mock;
            setStatic: Mock;
            on: Mock;
            removeWidget: Mock;
            getCellFromPixel: Mock;
        };
    };

    beforeEach(async () => {
        mockDashboardService = {
            updateConfiguration: vi.fn().mockName("DashboardService.updateConfiguration"),
            setStaticDashboard: vi.fn().mockName("DashboardService.setStaticDashboard"),
            notifyLayoutEditSaved: vi.fn().mockName("DashboardService.notifyLayoutEditSaved"),
            notifyLayoutEditCanceled: vi.fn().mockName("DashboardService.notifyLayoutEditCanceled"),
            navigateToNextDashboard: vi.fn().mockName("DashboardService.navigateToNextDashboard"),
            navigateToPreviousDashboard: vi.fn().mockName("DashboardService.navigateToPreviousDashboard"),
            consumePendingPageDirection: vi.fn().mockName("DashboardService.consumePendingPageDirection").mockReturnValue(null),
            beginPageTransition: vi.fn().mockName("DashboardService.beginPageTransition"),
            endPageTransition: vi.fn().mockName("DashboardService.endPageTransition"),
            isPageTransitioning: signal(false),
            setWidgetClipboardFromNode: vi.fn().mockName("DashboardService.setWidgetClipboardFromNode"),
            clearWidgetClipboard: vi.fn().mockName("DashboardService.clearWidgetClipboard"),
            isDashboardStatic: signal(true),
            activeDashboard: signal(0),
            dashboards: signal([{ id: 'd-0', configuration: [] }]),
            widgetClipboard: signal(null),
            widgetAction$: new Subject()
        } as unknown as DashboardService;

        const mockToastService = {
            show: vi.fn().mockName("ToastService.show")
        };
        const mockPluginConfigService = {
            getPlugin: vi.fn().mockName("PluginConfigClientService.getPlugin"),
            setPluginEnabled: vi.fn().mockName("PluginConfigClientService.setPluginEnabled")
        };
        const mockDialogService = {
            openFrameDialog: vi.fn().mockName("DialogService.openFrameDialog")
        };
        mockDialogService.openFrameDialog.mockReturnValue(of(null));
        const mockUiEventService = {
            addHotkeyListener: vi.fn().mockName("uiEventService.addHotkeyListener"),
            removeHotkeyListener: vi.fn().mockName("uiEventService.removeHotkeyListener"),
            isDragging: signal(false)
        };

        await TestBed.configureTestingModule({
            imports: [DashboardComponent],
            providers: [
                provideRouter([]),
                { provide: DashboardService, useValue: mockDashboardService },
                { provide: ToastService, useValue: mockToastService },
                { provide: PluginConfigClientService, useValue: mockPluginConfigService },
                { provide: DialogService, useValue: mockDialogService },
                { provide: uiEventService, useValue: mockUiEventService }
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(DashboardComponent);
        component = fixture.componentInstance;
        privateApi = component as unknown as DashboardComponentPrivateApi;
        vi.spyOn(component, 'ngOnDestroy').mockImplementation(() => undefined);

        gridMock = {
            grid: {
                save: vi.fn().mockReturnValue([]),
                offAll: vi.fn(),
                destroy: vi.fn(),
                load: vi.fn(),
                batchUpdate: vi.fn(),
                addWidget: vi.fn().mockReturnValue({ gridstackNode: { subGrid: null, subGridOpts: {} } }),
                willItFit: vi.fn().mockReturnValue(true),
                isAreaEmpty: vi.fn().mockReturnValue(true),
                getGridItems: vi.fn().mockReturnValue([]),
                getRow: vi.fn().mockReturnValue(24),
                cellHeight: vi.fn(),
                setStatic: vi.fn(),
                on: vi.fn(),
                removeWidget: vi.fn(),
                getCellFromPixel: vi.fn().mockReturnValue({ x: 1, y: 1 })
            }
        };

        vi.spyOn(privateApi, '_gridstack').mockReturnValue(gridMock);
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should save dashboard configuration', () => {
        privateApi.saveDashboard();

        expect(privateApi._gridstack().grid.save).toHaveBeenCalledWith(false, false);
        expect(mockDashboardService.updateConfiguration).toHaveBeenCalledWith(0, []);
    });

    it('should mark newly added host widget to auto-open options on create', () => {
        const widget = {
            name: 'Numeric',
            selector: 'widget-numeric',
            minWidth: 1,
            minHeight: 2,
            defaultWidth: 4,
            defaultHeight: 6
        };

        (component as unknown as {
            addWidgetToGrid: (w: unknown, x: number, y: number) => void;
        }).addWidgetToGrid(widget, 1, 1);

        const addedWidget = vi.mocked(gridMock.grid.addWidget).mock.lastCall[0];
        expect(addedWidget.input.widgetProperties.autoOpenOptionsOnCreate).toBe(true);
    });

    it('should mark newly added group widget to auto-open options on create', () => {
        const widget = {
            name: 'Group Widget',
            selector: 'group-widget',
            minWidth: 1,
            minHeight: 2,
            defaultWidth: 3,
            defaultHeight: 4
        };

        (component as unknown as {
            addWidgetToGrid: (w: unknown, x: number, y: number) => void;
        }).addWidgetToGrid(widget, 1, 1);

        const addedWidget = vi.mocked(gridMock.grid.addWidget).mock.lastCall[0];
        expect(addedWidget.input.widgetProperties.autoOpenOptionsOnCreate).toBe(true);
    });

    it('should not mark duplicated widget for auto-open options', () => {
        const sourceConfig = { displayName: 'Source' };
        const item = {
            gridstackNode: {
                w: 2,
                h: 2,
                selector: 'widget-host2',
                input: {
                    widgetProperties: {
                        type: 'widget-numeric',
                        config: sourceConfig
                    }
                }
            }
        };

        (component as unknown as {
            duplicateWidget: (node: unknown) => void;
        }).duplicateWidget(item);

        const duplicatedWidget = vi.mocked(gridMock.grid.addWidget).mock.lastCall[0];
        expect(duplicatedWidget.input.widgetProperties.autoOpenOptionsOnCreate).toBeUndefined();
    });

    it('should not mark pasted widget for auto-open options', () => {
        mockDashboardService.isDashboardStatic.set(false);
        mockDashboardService.widgetClipboard.set({
            w: 2,
            h: 3,
            selector: 'widget-host2',
            input: {
                widgetProperties: {
                    type: 'widget-numeric',
                    config: { displayName: 'Clipboard' }
                }
            }
        });

        (component as unknown as {
            pasteCopiedWidget: (x?: number, y?: number) => void;
        }).pasteCopiedWidget(1, 1);

        const pastedWidget = vi.mocked(gridMock.grid.addWidget).mock.lastCall[0];
        expect(pastedWidget.input.widgetProperties.autoOpenOptionsOnCreate).toBeUndefined();
    });

    it('should not add a widget when add-widget dialog is canceled', () => {
        vi.spyOn(component as unknown as {
            addWidgetToGrid: () => void;
        }, 'addWidgetToGrid');

        (component as unknown as {
            openAddWidgetDialog: (x: number, y: number) => void;
        }).openAddWidgetDialog(1, 1);

        expect((component as unknown as {
            addWidgetToGrid: Mock;
        }).addWidgetToGrid).not.toHaveBeenCalled();
    });

    it('should copy widget without creating a new grid item', () => {
        const actionStream = mockDashboardService.widgetAction$ as Subject<{
            id: string;
            operation: string;
        }>;
        const existingNode = { id: 'widget-copy-id' };
        gridMock.grid.getGridItems.mockReturnValue([
            { gridstackNode: existingNode }
        ]);

        component.ngAfterViewInit();
        actionStream.next({ id: 'widget-copy-id', operation: 'copy' });

        expect(mockDashboardService.setWidgetClipboardFromNode).toHaveBeenCalledWith(existingNode);
        expect(gridMock.grid.addWidget).not.toHaveBeenCalled();
    });

    it('should render empty dashboard static state with customize action and help action', () => {
        mockDashboardService.isDashboardStatic.set(true);
        gridMock.grid.getGridItems.mockReturnValue([]);

        fixture.detectChanges();

        const root = fixture.nativeElement as HTMLElement;
        const emptyState = root.querySelector('.dashboard-empty-state-container');
        const customizeButton = root.querySelector('.empty-state-button');
        const helpButton = root.querySelector('.empty-state-help-button');

        expect(emptyState).toBeTruthy();
        expect(customizeButton?.textContent).toContain('Unlock and Customize');
        expect(helpButton?.textContent).toContain('Get Help');
    });

    it('should render empty dashboard edit state tap guidance and hide customize button', () => {
        mockDashboardService.isDashboardStatic.set(false);
        gridMock.grid.getGridItems.mockReturnValue([]);

        fixture.detectChanges();

        const root = fixture.nativeElement as HTMLElement;
        const guidance = root.textContent ?? '';
        const customizeButton = root.querySelector('.empty-state-button');

        expect(guidance).toContain('Tap anywhere');
        expect(customizeButton).toBeFalsy();
    });

    it('opens the action menu at the tapped cell on empty-area single-tap in edit mode', () => {
        mockDashboardService.isDashboardStatic.set(false);
        const openMenu = vi.spyOn(component as unknown as {
            openActionMenu: (x: number, y: number) => void;
        }, 'openActionMenu').mockImplementation(() => undefined);

        (component as unknown as { onEmptyAreaTap: (e: Event) => void })
            .onEmptyAreaTap(new CustomEvent('tap', { detail: { center: { x: 120, y: 240 } } }));

        expect(openMenu).toHaveBeenCalledWith(120, 240);
    });

    it('ignores empty-area single-tap in static mode', () => {
        mockDashboardService.isDashboardStatic.set(true);
        const openMenu = vi.spyOn(component as unknown as {
            openActionMenu: (x: number, y: number) => void;
        }, 'openActionMenu').mockImplementation(() => undefined);

        (component as unknown as { onEmptyAreaTap: (e: Event) => void })
            .onEmptyAreaTap(new CustomEvent('tap', { detail: { center: { x: 12, y: 24 } } }));

        expect(openMenu).not.toHaveBeenCalled();
    });

    it('routes the Add Widget menu action to the add dialog at the pending cell', () => {
        mockDashboardService.isDashboardStatic.set(false);
        const openAddWidgetDialogSpy = vi.spyOn(component as unknown as {
            openAddWidgetDialog: (x: number, y: number) => void;
        }, 'openAddWidgetDialog').mockImplementation(() => undefined);

        const api = component as unknown as {
            onEmptyAreaTap: (e: Event) => void;
            onEmptyAreaAction: (id: string) => void;
        };
        api.onEmptyAreaTap(new CustomEvent('tap', { detail: { center: { x: 120, y: 240 } } }));
        api.onEmptyAreaAction('add');

        expect(openAddWidgetDialogSpy).toHaveBeenCalledWith(1, 1);
    });

    describe('runPageChange (page transition)', () => {
        interface RunPageChangeApi {
            runPageChange: (dashboardId: number) => Promise<void>;
            animatePhase: (el: HTMLElement, from: number, to: number, easing: string) => Promise<void>;
            loadDashboard: (dashboardId: number) => void;
            prefersReducedMotion: () => boolean;
        }

        // Drive the sequence without real Web Animations: record phase/load ordering
        // and stub loadDashboard so it does not touch the mocked grid.
        function instrument(): { api: RunPageChangeApi; order: string[] } {
            const api = component as unknown as RunPageChangeApi;
            const order: string[] = [];
            const slide = document.createElement('div');
            vi.spyOn(component as unknown as { _pageSlide: () => unknown }, '_pageSlide')
                .mockReturnValue({ nativeElement: slide });
            vi.spyOn(api, 'animatePhase').mockImplementation((_el, from, to) => {
                order.push(`animate:${from}->${to}`);
                return Promise.resolve();
            });
            vi.spyOn(api, 'loadDashboard').mockImplementation(() => { order.push('load'); });
            return { api, order };
        }

        it('slides out then in, loading off-screen at the midpoint, for a next navigation', async () => {
            (mockDashboardService.consumePendingPageDirection as Mock).mockReturnValue('next');
            const { api, order } = instrument();

            await api.runPageChange(1);

            expect(order).toEqual(['animate:0->-100', 'load', 'animate:100->0']);
            expect(mockDashboardService.beginPageTransition).toHaveBeenCalledTimes(1);
            expect(mockDashboardService.endPageTransition).toHaveBeenCalledTimes(1);
        });

        it('mirrors the slide direction for a previous navigation', async () => {
            (mockDashboardService.consumePendingPageDirection as Mock).mockReturnValue('prev');
            const { api, order } = instrument();

            await api.runPageChange(1);

            expect(order).toEqual(['animate:0->100', 'load', 'animate:-100->0']);
        });

        it('swaps instantly without animating when no travel direction is pending', async () => {
            (mockDashboardService.consumePendingPageDirection as Mock).mockReturnValue(null);
            const { api, order } = instrument();

            await api.runPageChange(1);

            expect(order).toEqual(['load']);
            expect(api.animatePhase).not.toHaveBeenCalled();
            expect(mockDashboardService.beginPageTransition).not.toHaveBeenCalled();
        });

        it('swaps instantly under prefers-reduced-motion', async () => {
            (mockDashboardService.consumePendingPageDirection as Mock).mockReturnValue('next');
            const { api, order } = instrument();
            vi.spyOn(api, 'prefersReducedMotion').mockReturnValue(true);

            await api.runPageChange(1);

            expect(order).toEqual(['load']);
            expect(api.animatePhase).not.toHaveBeenCalled();
            expect(mockDashboardService.beginPageTransition).not.toHaveBeenCalled();
        });

        it('clears the transition flag even if a phase fails', async () => {
            (mockDashboardService.consumePendingPageDirection as Mock).mockReturnValue('next');
            const { api } = instrument();
            vi.spyOn(api, 'animatePhase').mockRejectedValue(new Error('boom'));

            await expect(api.runPageChange(1)).rejects.toThrow('boom');
            expect(mockDashboardService.endPageTransition).toHaveBeenCalledTimes(1);
        });
    });
});
