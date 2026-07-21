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
import { EmbedModeService } from '../../services/embed-mode.service';

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

interface DashboardEscApi {
    onEscapeKey: () => void;
    loadDashboard: (id: number | null) => void;
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
            layoutEditSaveRequested: signal(0),
            layoutEditCancelRequested: signal(0),
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

    describe('Esc cancels layout edit', () => {
        function escApi(): DashboardEscApi {
            const api = component as unknown as DashboardEscApi;
            vi.spyOn(api, 'loadDashboard').mockImplementation(() => undefined);
            return api;
        }

        it('cancels the edit (reloads + re-locks) when editing and no overlay is open', () => {
            mockDashboardService.isDashboardStatic.set(false);
            escApi().onEscapeKey();
            expect(mockDashboardService.setStaticDashboard).toHaveBeenCalledWith(true);
            expect(mockDashboardService.notifyLayoutEditCanceled).toHaveBeenCalledTimes(1);
        });

        it('does nothing when the dashboard is not in edit mode', () => {
            mockDashboardService.isDashboardStatic.set(true);
            escApi().onEscapeKey();
            expect(mockDashboardService.setStaticDashboard).not.toHaveBeenCalled();
            expect(mockDashboardService.notifyLayoutEditCanceled).not.toHaveBeenCalled();
        });

        it('yields to an open modal overlay (dialog / menu / select) so its own Esc wins', () => {
            mockDashboardService.isDashboardStatic.set(false);
            const backdrop = document.createElement('div');
            backdrop.className = 'cdk-overlay-backdrop';
            document.body.appendChild(backdrop);
            try {
                escApi().onEscapeKey();
                expect(mockDashboardService.notifyLayoutEditCanceled).not.toHaveBeenCalled();
            } finally {
                backdrop.remove();
            }
        });

        it('does not cancel while a widget drag is in progress', () => {
            mockDashboardService.isDashboardStatic.set(false);
            (TestBed.inject(uiEventService) as unknown as { isDragging: { set: (v: boolean) => void } }).isDragging.set(true);
            escApi().onEscapeKey();
            expect(mockDashboardService.notifyLayoutEditCanceled).not.toHaveBeenCalled();
        });

        it('cancels via a real Escape keydown (HostListener wiring)', () => {
            mockDashboardService.isDashboardStatic.set(false);
            vi.spyOn(component as unknown as DashboardEscApi, 'loadDashboard').mockImplementation(() => undefined);
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            expect(mockDashboardService.notifyLayoutEditCanceled).toHaveBeenCalledTimes(1);
        });
    });

    describe('toolbar-driven layout edit requests', () => {
        function stubLoad(): ReturnType<typeof vi.spyOn> {
            return vi.spyOn(component as unknown as DashboardEscApi, 'loadDashboard').mockImplementation(() => undefined);
        }

        it('ignores the initial (zero) request tick', () => {
            fixture.detectChanges();
            expect(mockDashboardService.notifyLayoutEditSaved).not.toHaveBeenCalled();
            expect(mockDashboardService.notifyLayoutEditCanceled).not.toHaveBeenCalled();
        });

        it('commits the edit when the toolbar requests a save', () => {
            mockDashboardService.isDashboardStatic.set(false);
            fixture.detectChanges();
            mockDashboardService.layoutEditSaveRequested.set(1);
            fixture.detectChanges();
            expect(privateApi._gridstack().grid.save).toHaveBeenCalledWith(false, false);
            expect(mockDashboardService.setStaticDashboard).toHaveBeenCalledWith(true);
            expect(mockDashboardService.notifyLayoutEditSaved).toHaveBeenCalledTimes(1);
        });

        it('re-commits on a second save request in the same session (counter 1 -> 2)', () => {
            mockDashboardService.isDashboardStatic.set(false);
            fixture.detectChanges();
            mockDashboardService.layoutEditSaveRequested.set(1);
            fixture.detectChanges();
            mockDashboardService.layoutEditSaveRequested.set(2);
            fixture.detectChanges();
            expect(mockDashboardService.notifyLayoutEditSaved).toHaveBeenCalledTimes(2);
        });

        it('discards the edit when the toolbar requests a cancel (reloads the persisted page)', () => {
            const loadSpy = stubLoad();
            mockDashboardService.isDashboardStatic.set(false);
            fixture.detectChanges();
            loadSpy.mockClear();
            mockDashboardService.layoutEditCancelRequested.set(1);
            fixture.detectChanges();
            expect(loadSpy).toHaveBeenCalledWith(0);
            expect(mockDashboardService.setStaticDashboard).toHaveBeenCalledWith(true);
            expect(mockDashboardService.notifyLayoutEditCanceled).toHaveBeenCalledTimes(1);
        });

        it('does not replay a stale request counter on a fresh mount (navigation remount)', () => {
            // A prior Done/Cancel this session left the root-scoped counters non-zero; the
            // component is recreated on navigation and must not auto-fire on construction.
            fixture.destroy();
            mockDashboardService.layoutEditSaveRequested.set(2);
            mockDashboardService.layoutEditCancelRequested.set(2);
            const fresh = TestBed.createComponent(DashboardComponent);
            vi.spyOn(fresh.componentInstance, 'ngOnDestroy').mockImplementation(() => undefined);
            vi.spyOn(fresh.componentInstance as unknown as DashboardComponentPrivateApi, '_gridstack').mockReturnValue(gridMock);
            vi.spyOn(fresh.componentInstance as unknown as DashboardEscApi, 'loadDashboard').mockImplementation(() => undefined);
            fresh.detectChanges();
            expect(mockDashboardService.notifyLayoutEditSaved).not.toHaveBeenCalled();
            expect(mockDashboardService.notifyLayoutEditCanceled).not.toHaveBeenCalled();
        });
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

        const addedWidget = vi.mocked(gridMock.grid.addWidget).mock.lastCall![0];
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

        const addedWidget = vi.mocked(gridMock.grid.addWidget).mock.lastCall![0];
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

        const duplicatedWidget = vi.mocked(gridMock.grid.addWidget).mock.lastCall![0];
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

        const pastedWidget = vi.mocked(gridMock.grid.addWidget).mock.lastCall![0];
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
            runPageChange: () => Promise<void>;
            animatePhase: (el: HTMLElement, from: number, to: number, easing: string) => Promise<void>;
            loadDashboard: (dashboardId: number) => void;
            prefersReducedMotion: () => boolean;
        }

        // Drive the sequence without real Web Animations: record phase/load ordering
        // (load carries the index) and stub loadDashboard so it does not touch the grid.
        function instrument(): { api: RunPageChangeApi; order: string[]; animate: Mock } {
            const api = component as unknown as RunPageChangeApi;
            const order: string[] = [];
            const slide = document.createElement('div');
            vi.spyOn(component as unknown as { _pageSlide: () => unknown }, '_pageSlide')
                .mockReturnValue({ nativeElement: slide });
            const animate = vi.spyOn(api, 'animatePhase').mockImplementation((_el, from, to) => {
                order.push(`animate:${from}->${to}`);
                return Promise.resolve();
            }) as unknown as Mock;
            vi.spyOn(api, 'loadDashboard').mockImplementation((id) => { order.push(`load:${id}`); });
            return { api, order, animate };
        }

        function deferred(): { promise: Promise<void>; resolve: () => void } {
            let resolve!: () => void;
            const promise = new Promise<void>((r) => { resolve = r; });
            return { promise, resolve };
        }

        it('slides out then in, loading the current page off-screen at the midpoint, for next', async () => {
            mockDashboardService.activeDashboard.set(1);
            (mockDashboardService.consumePendingPageDirection as Mock).mockReturnValue('next');
            const { api, order } = instrument();

            await api.runPageChange();

            expect(order).toEqual(['animate:0->-100', 'load:1', 'animate:100->0']);
            expect(mockDashboardService.beginPageTransition).toHaveBeenCalledTimes(1);
            expect(mockDashboardService.endPageTransition).toHaveBeenCalledTimes(1);
        });

        it('mirrors the slide direction for a previous navigation', async () => {
            (mockDashboardService.consumePendingPageDirection as Mock).mockReturnValue('prev');
            const { api, order } = instrument();

            await api.runPageChange();

            expect(order).toEqual(['animate:0->100', 'load:0', 'animate:-100->0']);
        });

        it('swaps instantly without animating when no travel direction is pending', async () => {
            (mockDashboardService.consumePendingPageDirection as Mock).mockReturnValue(null);
            const { api, order } = instrument();

            await api.runPageChange();

            expect(order).toEqual(['load:0']);
            expect(api.animatePhase).not.toHaveBeenCalled();
            expect(mockDashboardService.beginPageTransition).not.toHaveBeenCalled();
        });

        it('swaps instantly under prefers-reduced-motion', async () => {
            (mockDashboardService.consumePendingPageDirection as Mock).mockReturnValue('next');
            const { api, order } = instrument();
            vi.spyOn(api, 'prefersReducedMotion').mockReturnValue(true);

            await api.runPageChange();

            expect(order).toEqual(['load:0']);
            expect(api.animatePhase).not.toHaveBeenCalled();
            expect(mockDashboardService.beginPageTransition).not.toHaveBeenCalled();
        });

        it('swaps instantly, consuming the direction once, when the slide wrapper is not ready', async () => {
            (mockDashboardService.consumePendingPageDirection as Mock).mockReturnValue('next');
            const api = component as unknown as RunPageChangeApi;
            vi.spyOn(component as unknown as { _pageSlide: () => unknown }, '_pageSlide').mockReturnValue(undefined);
            const animateSpy = vi.spyOn(api, 'animatePhase');
            const loadSpy = vi.spyOn(api, 'loadDashboard').mockImplementation(() => undefined);

            await api.runPageChange();

            expect(loadSpy).toHaveBeenCalledTimes(1);
            expect(animateSpy).not.toHaveBeenCalled();
            expect(mockDashboardService.beginPageTransition).not.toHaveBeenCalled();
            expect(mockDashboardService.consumePendingPageDirection).toHaveBeenCalledTimes(1);
        });

        it('holds the transition flag for the whole slide so re-entrant navigation stays blocked', async () => {
            const flag = signal(false);
            (mockDashboardService.beginPageTransition as Mock).mockImplementation(() => flag.set(true));
            (mockDashboardService.endPageTransition as Mock).mockImplementation(() => flag.set(false));
            (mockDashboardService.consumePendingPageDirection as Mock).mockReturnValue('next');
            const { api, animate } = instrument();
            const gate = deferred();
            animate.mockImplementationOnce(() => gate.promise);

            const run = api.runPageChange();
            expect(flag()).toBe(true); // armed and held while the exit phase is in flight

            gate.resolve();
            await run;
            expect(flag()).toBe(false); // cleared once the slide finishes
        });

        it('ignores a re-entrant runPageChange while a slide is in flight', async () => {
            (mockDashboardService.consumePendingPageDirection as Mock).mockReturnValue('next');
            const { api, animate } = instrument();
            const gate = deferred();
            animate.mockImplementationOnce(() => gate.promise);

            const run = api.runPageChange();  // starts; suspended on the exit phase
            await api.runPageChange();         // re-entrant call must no-op

            expect(animate).toHaveBeenCalledTimes(1);
            expect(mockDashboardService.consumePendingPageDirection).toHaveBeenCalledTimes(1);

            gate.resolve();
            await run;
        });

        it('settles on the latest activeDashboard when it changes during the slide', async () => {
            mockDashboardService.activeDashboard.set(1);
            (mockDashboardService.consumePendingPageDirection as Mock).mockReturnValue('next');
            const { api, order, animate } = instrument();
            const gate = deferred();
            animate.mockImplementationOnce(() => gate.promise); // gate the exit phase

            const run = api.runPageChange();
            mockDashboardService.activeDashboard.set(4); // router-driven change mid-slide
            gate.resolve();
            await run;

            expect(order).toContain('load:4');   // midpoint loads the current index, not the start index
            expect(order).not.toContain('load:1');
        });

        it('clears the transition flag if loadDashboard throws between phases', async () => {
            (mockDashboardService.consumePendingPageDirection as Mock).mockReturnValue('next');
            const { api } = instrument();
            vi.spyOn(api, 'loadDashboard').mockImplementation(() => { throw new Error('boom'); });

            await expect(api.runPageChange()).rejects.toThrow('boom');
            expect(mockDashboardService.endPageTransition).toHaveBeenCalledTimes(1);
        });

        it('clears the transition flag on destroy so a torn-down slide cannot wedge navigation', () => {
            (vi.mocked(component.ngOnDestroy) as unknown as { mockRestore: () => void }).mockRestore();

            component.ngOnDestroy();

            expect(mockDashboardService.endPageTransition).toHaveBeenCalledTimes(1);
        });
    });
});

// Self-contained (no shared beforeEach): the empty-state "Unlock and Customize" button renders in
// the static branch, so the embed read-only pin leaves it visible-but-inert without an explicit
// !embed() gate. Under embed the button must be absent from the DOM. (#216 E6)
describe('DashboardComponent — embed mode empty state', () => {
    function buildDashboardMock(): DashboardService {
        return {
            updateConfiguration: vi.fn(),
            setStaticDashboard: vi.fn(),
            notifyLayoutEditSaved: vi.fn(),
            notifyLayoutEditCanceled: vi.fn(),
            layoutEditSaveRequested: signal(0),
            layoutEditCancelRequested: signal(0),
            navigateToNextDashboard: vi.fn(),
            navigateToPreviousDashboard: vi.fn(),
            consumePendingPageDirection: vi.fn().mockReturnValue(null),
            beginPageTransition: vi.fn(),
            endPageTransition: vi.fn(),
            isPageTransitioning: signal(false),
            setWidgetClipboardFromNode: vi.fn(),
            clearWidgetClipboard: vi.fn(),
            isDashboardStatic: signal(true),
            activeDashboard: signal(0),
            dashboards: signal([{ id: 'd-0', configuration: [] }]),
            widgetClipboard: signal(null),
            widgetAction$: new Subject()
        } as unknown as DashboardService;
    }

    async function render(embed: boolean): Promise<HTMLElement> {
        await TestBed.configureTestingModule({
            imports: [DashboardComponent],
            providers: [
                provideRouter([]),
                { provide: DashboardService, useValue: buildDashboardMock() },
                { provide: ToastService, useValue: { show: vi.fn() } },
                { provide: PluginConfigClientService, useValue: { getPlugin: vi.fn(), setPluginEnabled: vi.fn() } },
                { provide: DialogService, useValue: { openFrameDialog: vi.fn().mockReturnValue(of(null)) } },
                { provide: uiEventService, useValue: { addHotkeyListener: vi.fn(), removeHotkeyListener: vi.fn(), isDragging: signal(false) } },
                { provide: EmbedModeService, useValue: { embed: () => embed, profile: () => null } }
            ]
        }).compileComponents();

        const fixture = TestBed.createComponent(DashboardComponent);
        const component = fixture.componentInstance;
        vi.spyOn(component, 'ngOnDestroy').mockImplementation(() => undefined);
        const grid = {
            grid: {
                getGridItems: vi.fn().mockReturnValue([]),
                setStatic: vi.fn(),
                on: vi.fn(),
                save: vi.fn().mockReturnValue([]),
                offAll: vi.fn(),
                destroy: vi.fn(),
                load: vi.fn(),
                batchUpdate: vi.fn(),
                getRow: vi.fn().mockReturnValue(24),
                cellHeight: vi.fn()
            }
        };
        vi.spyOn(component as unknown as { _gridstack: () => unknown }, '_gridstack').mockReturnValue(grid);
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
    }

    it('hides the Unlock and Customize button under embed', async () => {
        const root = await render(true);
        expect(root.querySelector('.empty-state-button')).toBeNull();
    });

    it('shows the Unlock and Customize button when not embedded', async () => {
        const root = await render(false);
        expect(root.querySelector('.empty-state-button')?.textContent).toContain('Unlock and Customize');
    });
});
