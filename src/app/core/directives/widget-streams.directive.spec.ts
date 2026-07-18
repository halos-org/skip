import { TestBed } from '@angular/core/testing';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Subject, BehaviorSubject, Observable } from 'rxjs';
import { WidgetStreamsDirective } from './widget-streams.directive';
import { DataService, IPathUpdate } from '../services/data.service';
import { UnitsService } from '../services/units.service';
import { IWidgetSvcConfig, IWidgetPath } from '../interfaces/widgets-interface';

class FakeDataService {
    calls: {
        path: string;
        source: string;
    }[] = [];
    releases: {
        path: string;
        source: string;
    }[] = [];
    subjects = new Map<string, Subject<IPathUpdate>>();
    timeoutCalls: {
        path: string;
        source: string;
        pathType: string;
        dataTimeoutMs: number;
    }[] = [];

    subscribePath(path: string, source?: string): Observable<IPathUpdate> {
        const src = (source?.trim() || 'default');
        const key = `${path}|${src}`;
        this.calls.push({ path, source: src });
        if (!this.subjects.has(key)) {
            this.subjects.set(key, new Subject<IPathUpdate>());
        }
        return this.subjects.get(key)!.asObservable();
    }

    // Mirrors the real DataService: acquirePath composes subscribePath (so `calls` still records the
    // base acquisition) and hands back an idempotent release that records the balanced teardown.
    acquirePath(path: string, source?: string): { data$: Observable<IPathUpdate>; release: () => void } {
        const src = (source?.trim() || 'default');
        const data$ = this.subscribePath(path, src);
        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            this.releases.push({ path, source: src });
        };
        return { data$, release };
    }

    timeoutPathObservable(path: string, source: string, pathType: string, dataTimeoutMs: number): void {
        this.timeoutCalls.push({ path, source, pathType, dataTimeoutMs });
    }
}

class FakeUnitsService {
    convertToUnit(unit: string, value: number): number {
        if (unit === 'x10')
            return value * 10;
        return value;
    }
}

function makeCfg(opts: {
    key?: string;
    path?: string | null;
    pathType?: 'number' | 'string' | 'Date' | 'boolean';
    sampleTime?: number;
    convertUnitTo?: string | null;
    source?: string | null;
    suppressBootstrapNull?: boolean;
    displayName?: string;
    enableTimeout?: boolean;
    dataTimeout?: number;
} = {}): IWidgetSvcConfig {
    const key = opts.key ?? 'p';
    const paths: Record<string, IWidgetPath> = {
        [key]: {
            description: 'Test path',
            path: opts.path ?? 'navigation.test',
            pathID: 'id-1',
            source: (opts.source ?? null),
            pathType: opts.pathType ?? 'string',
            suppressBootstrapNull: opts.suppressBootstrapNull ?? false,
            isPathConfigurable: true,
            showPathSkUnitsFilter: false,
            pathSkUnitsFilter: null,
            convertUnitTo: (opts.convertUnitTo ?? undefined) as unknown as string,
            sampleTime: opts.sampleTime ?? 1000,
            supportsPut: false
        }
    };
    return {
        displayName: opts.displayName ?? 'Test Widget',
        filterSelfPaths: true,
        paths,
        enableTimeout: opts.enableTimeout ?? false,
        dataTimeout: opts.dataTimeout ?? 5,
        color: 'contrast',
        putEnable: false,
        putMomentary: false,
        multiChildCtrls: []
    };
}

/** Build a config holding several distinct path bases so the multi-base release paths can be exercised. */
function makeMultiCfg(entries: { key: string; path: string }[]): IWidgetSvcConfig {
    const paths: Record<string, IWidgetPath> = {};
    for (const e of entries) {
        paths[e.key] = {
            description: 'Test path',
            path: e.path,
            pathID: `id-${e.key}`,
            source: null,
            pathType: 'string',
            suppressBootstrapNull: false,
            isPathConfigurable: true,
            showPathSkUnitsFilter: false,
            pathSkUnitsFilter: null,
            convertUnitTo: undefined as unknown as string,
            sampleTime: 1000,
            supportsPut: false
        };
    }
    return { ...makeCfg(), paths };
}

/** Read the directive's private held-handle map size to assert releaseAllBases emptied it. */
function heldBaseCount(directive: WidgetStreamsDirective): number {
    return (directive as unknown as { baseReleases: Map<string, unknown> }).baseReleases.size;
}

describe('WidgetStreamsDirective', () => {
    let directive: WidgetStreamsDirective;
    let dataSvc: FakeDataService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                WidgetStreamsDirective,
                { provide: DataService, useClass: FakeDataService },
                { provide: UnitsService, useClass: FakeUnitsService }
            ]
        });
        directive = TestBed.inject(WidgetStreamsDirective);
        dataSvc = TestBed.inject(DataService) as unknown as FakeDataService;
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('subscribes and receives updates for a valid path', async () => {
        const cfg = makeCfg({ path: 'env.test', source: null, pathType: 'string', sampleTime: 50 });
        directive.setStreamsConfig(cfg);

        const received: unknown[] = [];
        directive.observe('p', update => {
            received.push(update?.data?.value);
            if (received.length === 2) {
                expect(received).toEqual(['A', 'B']);
                ;
            }
        });

        const subj = dataSvc.subjects.get('env.test|default')!;
        subj.next({ data: { value: 'A', timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        subj.next({ data: { value: 'B', timestamp: new Date() }, state: 'normal' } as IPathUpdate);
    });

    it('extracts the configured sub-field from a whole compound-object value', () => {
        const cfg = makeCfg({ path: 'navigation.position', source: null, pathType: 'number', sampleTime: 50 });
        directive.setStreamsConfig(cfg);

        const received: unknown[] = [];
        directive.observe('p', u => received.push(u?.data?.value), 'latitude');

        const subj = dataSvc.subjects.get('navigation.position|default')!;
        subj.next({ data: { value: { latitude: 48.5, longitude: -123.25 }, timestamp: new Date() }, state: 'normal' } as IPathUpdate);

        expect(received).toEqual([48.5]);
    });

    it('applies unit conversion to the extracted sub-field (extraction precedes conversion)', () => {
        const cfg = makeCfg({ path: 'navigation.attitude', source: null, pathType: 'number', convertUnitTo: 'x10', sampleTime: 50 });
        directive.setStreamsConfig(cfg);

        const received: unknown[] = [];
        directive.observe('p', u => received.push(u?.data?.value), 'roll');

        const subj = dataSvc.subjects.get('navigation.attitude|default')!;
        subj.next({ data: { value: { roll: 0.2, pitch: 0.1 }, timestamp: new Date() }, state: 'normal' } as IPathUpdate);

        expect(received).toEqual([2]); // 0.2 extracted first, then the x10 conversion applied
    });

    it('passes a scalar value straight through when a sub-field is configured (customised scalar path stays working)', () => {
        const cfg = makeCfg({ path: 'steering.rudderAngle', source: null, pathType: 'number', sampleTime: 50 });
        directive.setStreamsConfig(cfg);

        const received: unknown[] = [];
        directive.observe('p', u => received.push(u?.data?.value), 'roll');

        const subj = dataSvc.subjects.get('steering.rudderAngle|default')!;
        subj.next({ data: { value: 0.42, timestamp: new Date() }, state: 'normal' } as IPathUpdate);

        expect(received).toEqual([0.42]);
    });

    it('emits null for a missing sub-field of a compound value', () => {
        const cfg = makeCfg({ path: 'navigation.position', source: null, pathType: 'number', sampleTime: 50 });
        directive.setStreamsConfig(cfg);

        const received: unknown[] = [];
        directive.observe('p', u => received.push(u?.data?.value), 'altitude');

        const subj = dataSvc.subjects.get('navigation.position|default')!;
        subj.next({ data: { value: { latitude: 48.5, longitude: -123.25 }, timestamp: new Date() }, state: 'normal' } as IPathUpdate);

        expect(received).toEqual([null]);
    });

    it('resubscribes to DataService when source changes', async () => {
        const cfg1 = makeCfg({ path: 'env.switch', source: null, pathType: 'string', sampleTime: 50 });
        directive.setStreamsConfig(cfg1);

        const hits: string[] = [];
        directive.observe('p', update => {
            hits.push(String(update?.data?.value));
            if (hits.length === 3) {
                expect(hits).toEqual(['A1', 'B2', 'B3']);
                const sources = dataSvc.calls.map(c => c.source);
                expect(sources).toContain('default');
                expect(sources).toContain('n2k');
                ;
            }
        });

        const subjDefault = dataSvc.subjects.get('env.switch|default')!;
        subjDefault.next({ data: { value: 'A1', timestamp: new Date() }, state: 'normal' } as IPathUpdate);

        const cfg2 = makeCfg({ path: 'env.switch', source: 'n2k', pathType: 'string', sampleTime: 50 });
        directive.applyStreamsConfigDiff(cfg2);

        // Old source should no longer be listened to
        subjDefault.next({ data: { value: 'A2', timestamp: new Date() }, state: 'normal' } as IPathUpdate);

        const subjN2k = dataSvc.subjects.get('env.switch|n2k')!;
        subjN2k.next({ data: { value: 'B2', timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        subjN2k.next({ data: { value: 'B3', timestamp: new Date() }, state: 'normal' } as IPathUpdate);
    });

    it('does not resubscribe within the default source cluster', () => {
        const cfg1 = makeCfg({ path: 'nav.x', source: undefined });
        directive.setStreamsConfig(cfg1);
        directive.observe('p', () => { });

        const initialCalls = dataSvc.calls.length;

        const cfg2 = makeCfg({ path: 'nav.x', source: '' });
        directive.applyStreamsConfigDiff(cfg2);

        const cfg3 = makeCfg({ path: 'nav.x', source: null });
        directive.applyStreamsConfigDiff(cfg3);

        expect(dataSvc.calls.length).toBe(initialCalls);
    });

    it('replaces observer when observe() is called with a new callback', async () => {
        const cfg = makeCfg({ path: 'env.obs', source: null });
        directive.setStreamsConfig(cfg);

        const hitsA: string[] = [];
        const hitsB: string[] = [];

        const cbA = (u: IPathUpdate) => hitsA.push(u?.data?.value);
        const cbB = (u: IPathUpdate) => {
            hitsB.push(u?.data?.value);
            if (hitsB.length === 2) {
                expect(hitsA).toEqual(['X1']);
                expect(hitsB).toEqual(['X2', 'X3']);
                ;
            }
        };

        directive.observe('p', cbA);
        const subj = dataSvc.subjects.get('env.obs|default')!;
        subj.next({ data: { value: 'X1', timestamp: new Date() }, state: 'normal' } as IPathUpdate);

        directive.observe('p', cbB);
        subj.next({ data: { value: 'X2', timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        subj.next({ data: { value: 'X3', timestamp: new Date() }, state: 'normal' } as IPathUpdate);
    });

    it('cleans up subscription when path becomes empty', () => {
        const cfg1 = makeCfg({ path: 'env.clean', source: null });
        directive.setStreamsConfig(cfg1);

        const received: unknown[] = [];
        directive.observe('p', u => received.push(u?.data?.value));

        const subj = dataSvc.subjects.get('env.clean|default')!;
        subj.next({ data: { value: 'C1', timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        expect(received).toEqual(['C1']);

        const cfg2 = makeCfg({ path: '' as string, source: null });
        directive.applyStreamsConfigDiff(cfg2);

        subj.next({ data: { value: 'C2', timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        expect(received).toEqual(['C1']);
    });

    it('does nothing when observing the same signature twice', async () => {
        const cfg = makeCfg({ path: 'env.same', source: null, pathType: 'string', sampleTime: 50 });
        directive.setStreamsConfig(cfg);

        const hits: string[] = [];
        const cb = (u: IPathUpdate) => {
            hits.push(String(u?.data?.value));
            if (hits.length === 2) {
                // Only one subscription should have been created
                expect(dataSvc.calls.length).toBe(1);
                expect(dataSvc.calls[0]).toEqual({ path: 'env.same', source: 'default' });
                expect(hits).toEqual(['S1', 'S2']);
                ;
            }
        };

        // Call observe twice with the same callback and unchanged config
        directive.observe('p', cb);
        const subj = dataSvc.subjects.get('env.same|default')!;
        subj.next({ data: { value: 'S1', timestamp: new Date() }, state: 'normal' } as IPathUpdate);

        directive.observe('p', cb);
        // No new subscribePath call should occur
        expect(dataSvc.calls.length).toBe(1);
        subj.next({ data: { value: 'S2', timestamp: new Date() }, state: 'normal' } as IPathUpdate);
    });

    it('does not subscribe when observing empty path twice', () => {
        const cfg = makeCfg({ path: '' as string, source: null });
        directive.setStreamsConfig(cfg);

        const cb = () => { };
        directive.observe('p', cb);
        directive.observe('p', cb);

        // No DataService.subscribePath should have been called
        expect(dataSvc.calls.length).toBe(0);
    });

    it('rewires pipeline on signature change (convertUnitTo) while reusing base stream', () => {
        // Initial config: number path, no conversion
        const cfg1 = makeCfg({ path: 'env.rewire', source: null, pathType: 'number', sampleTime: 50 });
        directive.setStreamsConfig(cfg1);

        const hits: number[] = [];
        directive.observe('p', u => hits.push(u?.data?.value as number));

        // Single base subscription should be created
        expect(dataSvc.calls.length).toBe(1);
        expect(dataSvc.calls[0]).toEqual({ path: 'env.rewire', source: 'default' });

        const subj = dataSvc.subjects.get('env.rewire|default')!;
        subj.next({ data: { value: 2, timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        expect(hits).toEqual([2]);

        // Change only convertUnitTo (part of signature), keep base identity (path+source) the same
        const cfg2 = makeCfg({ path: 'env.rewire', source: null, pathType: 'number', convertUnitTo: 'x10', sampleTime: 50 });
        directive.applyStreamsConfigDiff(cfg2);

        // DataService should NOT have been called again (base reused)
        expect(dataSvc.calls.length).toBe(1);

        // Next emission should reflect new pipeline (converted by x10)
        subj.next({ data: { value: 3, timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        expect(hits).toEqual([2, 30]);
    });

    it('suppresses leading bootstrap null values when configured', async () => {
        vi.useFakeTimers();
        const cfg = makeCfg({ path: 'env.bootstrap', source: null, pathType: 'number', sampleTime: 50, suppressBootstrapNull: true });
        directive.setStreamsConfig(cfg);

        const hits: (number | null)[] = [];
        directive.observe('p', u => hits.push((u?.data?.value as number | null) ?? null));

        const subj = dataSvc.subjects.get('env.bootstrap|default')!;
        subj.next({ data: { value: null, timestamp: null }, state: 'normal' } as IPathUpdate);
        await vi.advanceTimersByTimeAsync(60);
        expect(hits).toEqual([]);

        subj.next({ data: { value: 12, timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        expect(hits).toEqual([12]);
    });

    it('still emits later null values after the first non-null when suppressBootstrapNull is enabled', async () => {
        vi.useFakeTimers();
        const cfg = makeCfg({ path: 'env.bootstrap-reset', source: null, pathType: 'number', sampleTime: 30, suppressBootstrapNull: true });
        directive.setStreamsConfig(cfg);

        const hits: (number | null)[] = [];
        directive.observe('p', u => hits.push((u?.data?.value as number | null) ?? null));

        const subj = dataSvc.subjects.get('env.bootstrap-reset|default')!;
        subj.next({ data: { value: null, timestamp: null }, state: 'normal' } as IPathUpdate);
        await vi.advanceTimersByTimeAsync(35);
        expect(hits).toEqual([]);

        subj.next({ data: { value: 21, timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        expect(hits).toEqual([21]);

        subj.next({ data: { value: null, timestamp: null }, state: 'normal' } as IPathUpdate);
        await vi.advanceTimersByTimeAsync(35);
        expect(hits).toEqual([21, null]);
    });

    it('treats suppressBootstrapNull as part of the path signature', () => {
        const cfg1 = makeCfg({ path: 'env.sig', source: null, pathType: 'number', sampleTime: 50, suppressBootstrapNull: false });
        directive.setStreamsConfig(cfg1);
        directive.observe('p', () => { });

        expect(dataSvc.calls.length).toBe(1);

        const cfg2 = makeCfg({ path: 'env.sig', source: null, pathType: 'number', sampleTime: 50, suppressBootstrapNull: true });
        directive.applyStreamsConfigDiff(cfg2);

        expect(dataSvc.calls.length).toBe(1);
    });

    it('applies sampleTime: emits initial immediately and latest per interval', async () => {
        vi.useFakeTimers();
        const cfg = makeCfg({ path: 'env.sample', source: null, pathType: 'string', sampleTime: 50 });
        directive.setStreamsConfig(cfg);

        const hits: string[] = [];
        directive.observe('p', u => hits.push(String(u?.data?.value)));

        const subj = dataSvc.subjects.get('env.sample|default')!;
        // Emit two quick values; first should be received immediately (initial$),
        // second should appear after the sample window as the latest sampled value.
        subj.next({ data: { value: 'A', timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        subj.next({ data: { value: 'B', timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        await vi.advanceTimersByTimeAsync(60);
        expect(hits).toEqual(['A', 'B']);

        // Next value appears at next sampling tick
        subj.next({ data: { value: 'C', timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        await vi.advanceTimersByTimeAsync(60);
        expect(hits).toEqual(['A', 'B', 'C']);
    });

    it('triggers timeout and calls DataService.timeoutPathObservable', async () => {
        vi.useFakeTimers();
        // Silence noisy console logs from timeout/retry handling to keep test output clean
        vi.spyOn(console, 'log');
        // Configure a very short timeout (seconds) so the test runs fast
        const cfg = makeCfg({ path: 'env.to', source: null, pathType: 'string', sampleTime: 100, displayName: 'Test', enableTimeout: true, dataTimeout: 0.02 });
        directive.setStreamsConfig(cfg);

        const hits: string[] = [];
        directive.observe('p', u => hits.push(String(u?.data?.value)));

        // Do not emit anything; advance virtual time beyond 20ms to trigger timeout
        await vi.advanceTimersByTimeAsync(30);
        expect(dataSvc.timeoutCalls.length).toBe(1);
        // dataTimeout (0.02 s) is threaded through as the ms window; compute it the same way the
        // directive does so the assertion is exact regardless of float representation.
        expect(dataSvc.timeoutCalls[0]).toEqual({ path: 'env.to', source: 'default', pathType: 'string', dataTimeoutMs: 0.02 * 1000 });
    });

    it('forwards a configured non-default source into timeoutPathObservable', async () => {
        vi.useFakeTimers();
        vi.spyOn(console, 'log');
        const cfg = makeCfg({ path: 'env.to', source: 'n2k-1', pathType: 'string', sampleTime: 100, displayName: 'Test', enableTimeout: true, dataTimeout: 0.02 });
        directive.setStreamsConfig(cfg);

        const hits: string[] = [];
        directive.observe('p', u => hits.push(String(u?.data?.value)));

        // The stream's effective source must reach the reset so a source-bound widget
        // clears its own registration, not the default bucket (#206).
        await vi.advanceTimersByTimeAsync(30);
        expect(dataSvc.timeoutCalls[0]).toEqual({ path: 'env.to', source: 'n2k-1', pathType: 'string', dataTimeoutMs: 0.02 * 1000 });
    });

    it('applies convertUnitTo to numeric values (initial + sampled)', async () => {
        vi.useFakeTimers();
        const cfg = makeCfg({ path: 'env.units', source: null, pathType: 'number', sampleTime: 50, convertUnitTo: 'x10' });
        directive.setStreamsConfig(cfg);

        const hits: number[] = [];
        directive.observe('p', u => hits.push(u?.data?.value as number));

        const subj = dataSvc.subjects.get('env.units|default')!;
        // Initial should be converted immediately
        subj.next({ data: { value: 1, timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        // Next two quick emissions; only latest sampled should be delivered after tick
        subj.next({ data: { value: 2, timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        subj.next({ data: { value: 3, timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        await vi.advanceTimersByTimeAsync(60);
        expect(hits).toEqual([10, 30]);
    });

    it('supports observer-level min/max compounding with sampling', async () => {
        vi.useFakeTimers();
        const cfg = makeCfg({ path: 'env.stats', source: null, pathType: 'number', sampleTime: 40 });
        directive.setStreamsConfig(cfg);

        const stats = { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY, values: [] as number[] };
        directive.observe('p', u => {
            const v = u?.data?.value as number;
            stats.values.push(v);
            if (v < stats.min)
                stats.min = v;
            if (v > stats.max)
                stats.max = v;
        });

        const subj = dataSvc.subjects.get('env.stats|default')!;
        // Initial emission updates min/max immediately
        subj.next({ data: { value: 5, timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        expect(stats.values).toEqual([5]);
        expect(stats.min).toBe(5);
        expect(stats.max).toBe(5);

        // Burst of values within one sample window - only last should be sampled in next tick
        subj.next({ data: { value: 7, timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        subj.next({ data: { value: 3, timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        subj.next({ data: { value: 9, timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        await vi.advanceTimersByTimeAsync(45);
        // After first sampling window: min/max should reflect 5 (initial) and 9 (sampled)
        expect(stats.values).toEqual([5, 9]);
        expect(stats.min).toBe(5);
        expect(stats.max).toBe(9);

        // Another burst leading to a new higher max; the lower value '1' occurs within
        // the sample window but is not the latest, so it is not observed by the subscriber.
        subj.next({ data: { value: 1, timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        subj.next({ data: { value: 12, timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        await vi.advanceTimersByTimeAsync(45);
        expect(stats.values).toEqual([5, 9, 12]);
        expect(stats.min).toBe(5);
        expect(stats.max).toBe(12);
    });

    it('updates sampling cadence when sampleTime changes without resubscribing base', async () => {
        vi.useFakeTimers();
        // Initial sampleTime: 100ms
        const cfg1 = makeCfg({ path: 'env.cadence', source: null, pathType: 'string', sampleTime: 100 });
        directive.setStreamsConfig(cfg1);

        const hits: string[] = [];
        directive.observe('p', u => hits.push(String(u?.data?.value)));

        // One base subscription should be created
        expect(dataSvc.calls.length).toBe(1);
        expect(dataSvc.calls[0]).toEqual({ path: 'env.cadence', source: 'default' });

        const subj = dataSvc.subjects.get('env.cadence|default')!;
        // Initial emission is immediate
        subj.next({ data: { value: 'A', timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        // Burst within first 100ms window
        subj.next({ data: { value: 'B', timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        subj.next({ data: { value: 'C', timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        // Not yet at 100ms: should still only have initial
        await vi.advanceTimersByTimeAsync(90);
        expect(hits).toEqual(['A']);
        // Cross the first sampling boundary: latest ('C') is emitted
        await vi.advanceTimersByTimeAsync(20);
        expect(hits).toEqual(['A', 'C']);

        // Change only sampleTime to 30ms; base identity (path+source) unchanged
        const cfg2 = makeCfg({ path: 'env.cadence', source: null, pathType: 'string', sampleTime: 30 });
        directive.applyStreamsConfigDiff(cfg2);

        // DataService should NOT have been called again (no new base subscription)
        expect(dataSvc.calls.length).toBe(1);

        // New emissions under the new 30ms cadence
        subj.next({ data: { value: 'D', timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        subj.next({ data: { value: 'E', timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        // After rewire, the first next value ('D') is emitted immediately (initial$),
        // and then sampling resumes for subsequent values.
        await vi.advanceTimersByTimeAsync(20);
        expect(hits).toEqual(['A', 'C', 'D']);
        // After crossing 30ms boundary, latest ('E') should be emitted
        await vi.advanceTimersByTimeAsync(15);
        expect(hits).toEqual(['A', 'C', 'D', 'E']);

        // Next single value should appear after next 30ms window
        subj.next({ data: { value: 'F', timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        await vi.advanceTimersByTimeAsync(35);
        expect(hits).toEqual(['A', 'C', 'D', 'E', 'F']);
    });

    it('releases the old base exactly once when the source rebinds', () => {
        const cfg1 = makeCfg({ path: 'env.rebind', source: null, pathType: 'string', sampleTime: 50 });
        directive.setStreamsConfig(cfg1);
        directive.observe('p', () => { });
        expect(dataSvc.calls).toEqual([{ path: 'env.rebind', source: 'default' }]);
        expect(dataSvc.releases).toEqual([]);

        const cfg2 = makeCfg({ path: 'env.rebind', source: 'n2k', pathType: 'string', sampleTime: 50 });
        directive.applyStreamsConfigDiff(cfg2);

        // The old (default) base is released once; the new (n2k) base is acquired.
        expect(dataSvc.releases).toEqual([{ path: 'env.rebind', source: 'default' }]);
        expect(dataSvc.calls).toEqual([
            { path: 'env.rebind', source: 'default' },
            { path: 'env.rebind', source: 'n2k' }
        ]);
    });

    it('does NOT release or re-acquire the base on a sampleTime or convertUnitTo change (the trap)', () => {
        const cfg1 = makeCfg({ path: 'env.trap', source: null, pathType: 'number', sampleTime: 100 });
        directive.setStreamsConfig(cfg1);
        directive.observe('p', () => { });
        expect(dataSvc.calls.length).toBe(1);

        // Same base identity (path+source): pipeline rebuilds, but releasing here would over-release
        // a live registration, so the base must be neither released nor re-acquired.
        directive.applyStreamsConfigDiff(makeCfg({ path: 'env.trap', source: null, pathType: 'number', sampleTime: 30 }));
        expect(dataSvc.calls.length).toBe(1);
        expect(dataSvc.releases).toEqual([]);

        directive.applyStreamsConfigDiff(makeCfg({ path: 'env.trap', source: null, pathType: 'number', sampleTime: 30, convertUnitTo: 'x10' }));
        expect(dataSvc.calls.length).toBe(1);
        expect(dataSvc.releases).toEqual([]);
    });

    it('releases the base when its path key is removed from the config', () => {
        directive.setStreamsConfig(makeCfg({ key: 'p', path: 'env.keep', source: null }));
        directive.observe('p', () => { });
        expect(dataSvc.calls.length).toBe(1);

        // New config drops key 'p' entirely (replaced by 'q').
        directive.applyStreamsConfigDiff(makeCfg({ key: 'q', path: 'env.other', source: null }));
        expect(dataSvc.releases).toEqual([{ path: 'env.keep', source: 'default' }]);
    });

    it('releases the base when the path becomes empty', () => {
        directive.setStreamsConfig(makeCfg({ path: 'env.clean', source: null }));
        directive.observe('p', () => { });
        expect(dataSvc.calls.length).toBe(1);

        directive.applyStreamsConfigDiff(makeCfg({ path: '' as string, source: null }));
        expect(dataSvc.releases).toEqual([{ path: 'env.clean', source: 'default' }]);
    });

    it('releases all held bases in the bulk config-reset branch', () => {
        directive.setStreamsConfig(makeCfg({ path: 'env.reset', source: null }));
        directive.observe('p', () => { });
        expect(dataSvc.calls.length).toBe(1);

        directive.applyStreamsConfigDiff(undefined);
        expect(dataSvc.releases).toEqual([{ path: 'env.reset', source: 'default' }]);
    });

    it('releases all held bases on destroy (the primary current leak vector)', () => {
        directive.setStreamsConfig(makeCfg({ path: 'env.destroy', source: null }));
        directive.observe('p', () => { });
        expect(dataSvc.releases).toEqual([]);

        directive.ngOnDestroy();
        expect(dataSvc.releases).toEqual([{ path: 'env.destroy', source: 'default' }]);
    });

    it('does NOT release or re-acquire the base on a timeout-setting change (rootChanged rebuild)', () => {
        directive.setStreamsConfig(makeCfg({ path: 'env.root', source: null, pathType: 'string', sampleTime: 50, enableTimeout: false, dataTimeout: 5 }));
        directive.observe('p', () => { });
        expect(dataSvc.calls.length).toBe(1);

        // A dataTimeout change flips the ROOT signature, taking the distinct rootChanged branch that
        // force-rebuilds every path's pipeline even though the per-path signature is unchanged. baseKey
        // (path+source) is still identical, so the base must be neither released nor re-acquired.
        directive.applyStreamsConfigDiff(makeCfg({ path: 'env.root', source: null, pathType: 'string', sampleTime: 50, enableTimeout: false, dataTimeout: 7 }));
        expect(dataSvc.calls.length).toBe(1);
        expect(dataSvc.releases).toEqual([]);
    });

    it('releases every held base (not just one) in the bulk config-reset branch', () => {
        directive.setStreamsConfig(makeMultiCfg([{ key: 'a', path: 'env.a' }, { key: 'b', path: 'env.b' }]));
        directive.observe('a', () => { });
        directive.observe('b', () => { });
        expect(dataSvc.calls.length).toBe(2);
        expect(heldBaseCount(directive)).toBe(2);

        directive.applyStreamsConfigDiff(undefined);

        expect(dataSvc.releases.map(r => r.path).sort()).toEqual(['env.a', 'env.b']);
        expect(heldBaseCount(directive)).toBe(0);
    });

    it('releases every held base (not just one) on destroy', () => {
        directive.setStreamsConfig(makeMultiCfg([{ key: 'a', path: 'env.a' }, { key: 'b', path: 'env.b' }]));
        directive.observe('a', () => { });
        directive.observe('b', () => { });
        expect(heldBaseCount(directive)).toBe(2);

        directive.ngOnDestroy();

        expect(dataSvc.releases.map(r => r.path).sort()).toEqual(['env.a', 'env.b']);
        expect(heldBaseCount(directive)).toBe(0);
    });
});

/**
 * Faithful-to-DataService fake: path values live in a BehaviorSubject (so the current value is
 * replayed on re-subscription), and timeoutPathObservable() resets the value to null - exactly
 * like the real service does on a TTL timeout.
 */
class TtlFakeDataService {
    subjects = new Map<string, BehaviorSubject<IPathUpdate>>();
    timeoutCalls: { path: string; source: string; pathType: string; dataTimeoutMs: number }[] = [];

    private keyFor(path: string, source?: string): string {
        return `${path}|${source?.trim() || 'default'}`;
    }

    subscribePath(path: string, source?: string): Observable<IPathUpdate> {
        const key = this.keyFor(path, source);
        if (!this.subjects.has(key)) {
            this.subjects.set(key, new BehaviorSubject<IPathUpdate>(
                { data: { value: null, timestamp: null }, state: 'normal' } as IPathUpdate
            ));
        }
        return this.subjects.get(key)!.asObservable();
    }

    acquirePath(path: string, source?: string): { data$: Observable<IPathUpdate>; release: () => void } {
        return { data$: this.subscribePath(path, source), release: () => undefined };
    }

    timeoutPathObservable(path: string, source: string, pathType: string, dataTimeoutMs: number): void {
        this.timeoutCalls.push({ path, source, pathType, dataTimeoutMs });
        // Mirror the real DataService: a TTL timeout resets the timed-out source's value to null.
        this.subjects.get(this.keyFor(path, source))?.next(
            { data: { value: null, timestamp: null }, state: 'normal' } as IPathUpdate
        );
    }
}

describe('WidgetStreamsDirective TTL value reset (#1069)', () => {
    let directive: WidgetStreamsDirective;
    let dataSvc: TtlFakeDataService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                WidgetStreamsDirective,
                { provide: DataService, useClass: TtlFakeDataService },
                { provide: UnitsService, useClass: FakeUnitsService }
            ]
        });
        directive = TestBed.inject(WidgetStreamsDirective);
        dataSvc = TestBed.inject(DataService) as unknown as TtlFakeDataService;
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('resets the value to null after a TTL timeout even with suppressBootstrapNull enabled', async () => {
        vi.useFakeTimers();
        vi.spyOn(console, 'log'); // silence timeout/retry logs
        const cfg = makeCfg({
            path: 'env.ttl', source: null, pathType: 'number', sampleTime: 50,
            suppressBootstrapNull: true, enableTimeout: true, dataTimeout: 0.02
        });
        directive.setStreamsConfig(cfg);

        const hits: (number | null)[] = [];
        directive.observe('p', u => hits.push((u?.data?.value as number | null) ?? null));

        const subj = dataSvc.subjects.get('env.ttl|default')!;
        // A real value arrives (e.g. engine running).
        subj.next({ data: { value: 500, timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        await vi.advanceTimersByTimeAsync(10);
        expect(hits).toEqual([500]);

        // Engine stops: no more data. Let the TTL fire and the retry resubscribe (retryDelay = 5s).
        await vi.advanceTimersByTimeAsync(5100);

        expect(dataSvc.timeoutCalls.length).toBeGreaterThanOrEqual(1);
        // The widget must be reset to null ("--"), not left showing the stale 500.
        expect(hits[hits.length - 1]).toBeNull();
    });
});
