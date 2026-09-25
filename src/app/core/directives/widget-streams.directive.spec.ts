import { TestBed } from '@angular/core/testing';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Subject, BehaviorSubject, Observable } from 'rxjs';
import { WidgetStreamsDirective, widgetPathSignature, normalizeWidgetPath, WidgetRepointTracker } from './widget-streams.directive';
import { DataService, IPathUpdate } from '../services/data.service';
import { TDurationFormat, UnitsService } from '../services/units.service';
import { IWidgetSvcConfig, IWidgetPath } from '../interfaces/widgets-interface';
import { ISkMetadata } from '../interfaces/signalk-interfaces';
import { CONSOLE_MIGRATION_SINK, migrateWidgetConfig } from '../utils/config-migration.util';

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
    metaSubjects = new Map<string, BehaviorSubject<ISkMetadata | null>>();
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

    getPathMetaObservable(path: string): Observable<ISkMetadata | null> {
        if (!this.metaSubjects.has(path)) {
            this.metaSubjects.set(path, new BehaviorSubject<ISkMetadata | null>(null));
        }
        return this.metaSubjects.get(path)!.asObservable();
    }
}

class FakeUnitsService {
    /** Per-path resolved measure a display path follows; defaults to an identity measure ('kn'). */
    pathMeasures = new Map<string, string>();
    resolvePathMeasure(path: string): string {
        return this.pathMeasures.get(path) ?? 'kn';
    }
    pathDurationFormats = new Map<string, TDurationFormat>();
    resolvePathDurationFormat(path: string): TDurationFormat | undefined {
        return this.pathDurationFormats.get(path);
    }
}

function makeCfg(opts: {
    key?: string;
    path?: string | null;
    pathType?: 'number' | 'string' | 'Date' | 'boolean';
    updateInterval?: number;
    convertUnitTo?: string | null;
    showConvertUnitTo?: boolean;
    source?: string | null;
    suppressBootstrapNull?: boolean;
    displayName?: string;
    enableTimeout?: boolean;
    /** The path's own TTL opt-in/opt-out, which overrides the widget-level flag. */
    pathEnableTimeout?: boolean;
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
            showConvertUnitTo: opts.showConvertUnitTo,
            enableTimeout: opts.pathEnableTimeout,
            supportsPut: false
        }
    };
    return {
        displayName: opts.displayName ?? 'Test Widget',
        filterSelfPaths: true,
        paths,
        updateInterval: opts.updateInterval ?? 1000,
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
    let unitsSvc: FakeUnitsService;

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
        unitsSvc = TestBed.inject(UnitsService) as unknown as FakeUnitsService;
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('subscribes and receives updates for a valid path', async () => {
        const cfg = makeCfg({ path: 'env.test', source: null, pathType: 'string', updateInterval: 50 });
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

    const attitude = (state: IPathUpdate['state'] = 'normal') =>
        ({ data: { value: { roll: -0.0384, pitch: 0.0091, yaw: null }, timestamp: new Date() }, state } as IPathUpdate);

    it('delivers a pointer path\'s field in its Signal K unit when the slot stores no unit', () => {
        unitsSvc.pathMeasures.set('self.navigation.attitude#/roll', 'unitless');
        directive.setStreamsConfig(makeCfg({ path: 'self.navigation.attitude#/roll', pathType: 'number', updateInterval: 50 }));

        const received: unknown[] = [];
        directive.observe('p', u => received.push(u?.data?.value));
        dataSvc.subjects.get('self.navigation.attitude|default')!.next(attitude());

        expect(dataSvc.calls).toEqual([{ path: 'self.navigation.attitude', source: 'default' }]);
        expect(received).toEqual([-0.0384]);
    });

    it('tags the resolved field with the slot\'s measure, value in SI', () => {
        const cfg = makeCfg({ path: 'navigation.attitude', source: null, pathType: 'number', convertUnitTo: 'x10', showConvertUnitTo: false, updateInterval: 50 });
        directive.setStreamsConfig(cfg);

        const received: unknown[][] = [];
        directive.observe('p', u => received.push([u?.data?.value, u?.data?.measure]), '/roll');

        const subj = dataSvc.subjects.get('navigation.attitude|default')!;
        subj.next({ data: { value: { roll: 0.2, pitch: 0.1 }, timestamp: new Date() }, state: 'normal' } as IPathUpdate);

        expect(received).toEqual([[0.2, 'x10']]);
    });

    it('tags a pointer path\'s field with the slot\'s stored unit and keeps the value in SI', () => {
        unitsSvc.pathMeasures.set('self.navigation.attitude#/roll', 'unitless');
        directive.setStreamsConfig(makeCfg({ path: 'self.navigation.attitude#/roll', pathType: 'number', convertUnitTo: 'deg', updateInterval: 50 }));

        const received: unknown[][] = [];
        directive.observe('p', u => received.push([u?.data?.value, u?.data?.measure]));
        dataSvc.subjects.get('self.navigation.attitude|default')!.next(attitude());

        expect(received).toEqual([[-0.0384, 'deg']]);
    });

    it('tags live roll with the stored degrees on a slot migrated from the dotted v20 path', () => {
        const v20 = makeCfg({ path: 'self.navigation.attitude.roll', pathType: 'number', convertUnitTo: 'deg', updateInterval: 50 });
        const migrated = migrateWidgetConfig('widget-numeric', v20, 20, CONSOLE_MIGRATION_SINK);
        unitsSvc.pathMeasures.set('self.navigation.attitude#/roll', 'unitless');
        directive.setStreamsConfig(migrated);

        const received: unknown[][] = [];
        directive.observe('p', u => received.push([u?.data?.value, u?.data?.measure]));
        dataSvc.subjects.get('self.navigation.attitude|default')!.next(attitude());

        expect((migrated.paths as Record<string, IWidgetPath>)['p'].convertUnitTo).toBe('deg');
        expect(received).toEqual([[-0.0384, 'deg']]);
    });

    it('reads the measure of the field, not of the base path', () => {
        unitsSvc.pathMeasures.set('self.navigation.attitude', 'x10');
        unitsSvc.pathMeasures.set('self.navigation.attitude#/roll', 'deg');
        directive.setStreamsConfig(makeCfg({ path: 'self.navigation.attitude#/roll', pathType: 'number', updateInterval: 50 }));

        const received: IPathUpdate[] = [];
        directive.observe('p', u => received.push(u));
        dataSvc.subjects.get('self.navigation.attitude|default')!.next(attitude());

        expect(received[0].data.measure).toBe('deg');
        expect(dataSvc.metaSubjects.has('self.navigation.attitude#/roll')).toBe(true);
    });

    it('acquires the base path once per slot, so #/latitude and #/longitude share one registration', () => {
        directive.setStreamsConfig(makeMultiCfg([
            { key: 'lat', path: 'self.navigation.position#/latitude' },
            { key: 'lon', path: 'self.navigation.position#/longitude' }
        ]));
        const lat: unknown[] = [];
        const lon: unknown[] = [];
        directive.observe('lat', u => lat.push(u?.data?.value));
        directive.observe('lon', u => lon.push(u?.data?.value));

        dataSvc.subjects.get('self.navigation.position|default')!.next(
            { data: { value: { latitude: 60.08, longitude: 21.97 }, timestamp: new Date() }, state: 'normal' } as IPathUpdate);

        expect(dataSvc.calls.map(c => c.path)).toEqual(['self.navigation.position', 'self.navigation.position']);
        expect([...dataSvc.subjects.keys()]).toEqual(['self.navigation.position|default']);
        expect(lat).toEqual([60.08]);
        expect(lon).toEqual([21.97]);
    });

    it('yields null for a field that is null or absent in the value', () => {
        directive.setStreamsConfig(makeMultiCfg([
            { key: 'yaw', path: 'self.navigation.attitude#/yaw' },
            { key: 'heave', path: 'self.navigation.attitude#/heave' }
        ]));
        const yaw: unknown[] = [];
        const heave: unknown[] = [];
        directive.observe('yaw', u => yaw.push(u?.data?.value));
        directive.observe('heave', u => heave.push(u?.data?.value));
        dataSvc.subjects.get('self.navigation.attitude|default')!.next(attitude());

        expect(yaw).toEqual([null]);
        expect(heave).toEqual([null]);
    });

    it('suppresses a null field while bootstrapping, and passes a later one, as for a scalar path', async () => {
        vi.useFakeTimers();
        directive.setStreamsConfig(makeCfg({ path: 'self.navigation.attitude#/yaw', pathType: 'number', updateInterval: 30, suppressBootstrapNull: true }));
        const yaw: unknown[] = [];
        directive.observe('p', u => yaw.push(u?.data?.value));
        const subj = dataSvc.subjects.get('self.navigation.attitude|default')!;

        subj.next(attitude());
        await vi.advanceTimersByTimeAsync(35);
        expect(yaw).toEqual([]);

        subj.next({ data: { value: { yaw: 1.5 }, timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        expect(yaw).toEqual([1.5]);

        subj.next(attitude());
        await vi.advanceTimersByTimeAsync(35);
        expect(yaw).toEqual([1.5, null]);
    });

    it('re-points #/roll to #/pitch by rebuilding the pipeline without re-acquiring the base path', () => {
        directive.setStreamsConfig(makeCfg({ path: 'self.navigation.attitude#/roll', updateInterval: 50 }));
        const received: unknown[] = [];
        directive.observe('p', u => received.push(u?.data?.value));
        const subj = dataSvc.subjects.get('self.navigation.attitude|default')!;
        subj.next(attitude());

        directive.applyStreamsConfigDiff(makeCfg({ path: 'self.navigation.attitude#/pitch', updateInterval: 50 }));
        subj.next(attitude());

        expect(dataSvc.calls).toHaveLength(1);
        expect(dataSvc.releases).toHaveLength(0);
        expect(received).toEqual([-0.0384, 0.0091]);
    });

    it('resets the alarm state of a field, but keeps it on the whole value', () => {
        directive.setStreamsConfig(makeMultiCfg([
            { key: 'field', path: 'self.navigation.position#/latitude' },
            { key: 'whole', path: 'self.navigation.position' }
        ]));
        const field: IPathUpdate[] = [];
        const whole: IPathUpdate[] = [];
        directive.observe('field', u => field.push(u));
        directive.observe('whole', u => whole.push(u));

        dataSvc.subjects.get('self.navigation.position|default')!.next(
            { data: { value: { latitude: 60.08, longitude: 21.97 }, timestamp: new Date() }, state: 'alarm' } as IPathUpdate);

        expect(field[0].state).toBe('normal');
        expect(whole[0].state).toBe('alarm');
    });

    it('treats a stored path with a malformed pointer like an empty path', () => {
        directive.setStreamsConfig(makeCfg({ path: 'self.navigation.position#latitude' }));
        const received: unknown[] = [];

        expect(() => directive.observe('p', u => received.push(u))).not.toThrow();
        expect(dataSvc.calls).toEqual([]);
        expect(received).toEqual([]);
    });

    it('resolves an observe() pointer against the configured path\'s value', () => {
        directive.setStreamsConfig(makeCfg({ path: 'self.navigation.attitude', pathType: 'number', convertUnitTo: 'x10', showConvertUnitTo: false, updateInterval: 50 }));
        const received: IPathUpdate[] = [];
        directive.observe('p', u => received.push(u), '/roll');
        dataSvc.subjects.get('self.navigation.attitude|default')!.next(attitude('alarm'));

        expect(received[0].data.value).toBe(-0.0384);
        expect(received[0].data.measure).toBe('x10');
        expect(received[0].state).toBe('normal');
    });

    it('resolves the configured pointer first, then the observe() pointer', () => {
        directive.setStreamsConfig(makeCfg({ path: 'self.a#/b' }));
        const received: unknown[] = [];
        directive.observe('p', u => received.push(u?.data?.value), '/c');
        dataSvc.subjects.get('self.a|default')!.next({ data: { value: { b: { c: 5 }, c: 7 }, timestamp: new Date() }, state: 'normal' } as IPathUpdate);

        expect(received).toEqual([5]);
    });

    it('yields null when an observe() pointer meets a scalar value', () => {
        directive.setStreamsConfig(makeCfg({ path: 'steering.rudderAngle' }));
        const received: unknown[] = [];
        directive.observe('p', u => received.push(u?.data?.value), '/roll');
        dataSvc.subjects.get('steering.rudderAngle|default')!.next({ data: { value: 0.42, timestamp: new Date() }, state: 'normal' } as IPathUpdate);

        expect(received).toEqual([null]);
    });

    it('delivers every widget SI values: a ratio of 1 stays 1 when the server shows the path in percent', () => {
        // A boolean-switch numeric slot reads 0/1, whatever unit the server shows the path in.
        unitsSvc.pathMeasures.set('electrical.switches.bank.1.state', 'percent');
        directive.setStreamsConfig(makeCfg({ path: 'electrical.switches.bank.1.state', pathType: 'number', updateInterval: 50 }));

        const received: IPathUpdate[] = [];
        directive.observe('p', u => received.push(u));
        dataSvc.subjects.get('electrical.switches.bank.1.state|default')!
            .next({ data: { value: 1, timestamp: new Date() }, state: 'normal' } as IPathUpdate);

        expect(received.map(u => [u.data.value, u.data.measure])).toEqual([[1, 'percent']]);
    });

    it('rejects an observe() pointer that is not an RFC 6901 pointer', () => {
        directive.setStreamsConfig(makeCfg({ path: 'self.navigation.attitude' }));
        expect(() => directive.observe('p', () => undefined, 'roll')).toThrow(/RFC 6901/);
    });

    it('resubscribes to DataService when source changes', async () => {
        const cfg1 = makeCfg({ path: 'env.switch', source: null, pathType: 'string', updateInterval: 50 });
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

        const cfg2 = makeCfg({ path: 'env.switch', source: 'n2k', pathType: 'string', updateInterval: 50 });
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
        const cfg = makeCfg({ path: 'env.same', source: null, pathType: 'string', updateInterval: 50 });
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
        // Initial config: structural number path without a fixed unit.
        const cfg1 = makeCfg({ path: 'env.rewire', source: null, pathType: 'number', showConvertUnitTo: false, updateInterval: 50 });
        directive.setStreamsConfig(cfg1);

        const hits: unknown[][] = [];
        directive.observe('p', u => hits.push([u?.data?.value, u?.data?.measure]));

        // Single base subscription should be created
        expect(dataSvc.calls.length).toBe(1);
        expect(dataSvc.calls[0]).toEqual({ path: 'env.rewire', source: 'default' });

        const subj = dataSvc.subjects.get('env.rewire|default')!;
        subj.next({ data: { value: 2, timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        expect(hits).toEqual([[2, undefined]]);

        // Change only convertUnitTo (part of signature), keep base identity (path+source) the same
        const cfg2 = makeCfg({ path: 'env.rewire', source: null, pathType: 'number', convertUnitTo: 'x10', showConvertUnitTo: false, updateInterval: 50 });
        directive.applyStreamsConfigDiff(cfg2);

        // DataService should NOT have been called again (base reused)
        expect(dataSvc.calls.length).toBe(1);

        // Next emission comes through the new pipeline, tagged with the new unit
        subj.next({ data: { value: 3, timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        expect(hits).toEqual([[2, undefined], [3, 'x10']]);
    });

    it('suppresses leading bootstrap null values when configured', async () => {
        vi.useFakeTimers();
        const cfg = makeCfg({ path: 'env.bootstrap', source: null, pathType: 'number', updateInterval: 50, suppressBootstrapNull: true });
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
        const cfg = makeCfg({ path: 'env.bootstrap-reset', source: null, pathType: 'number', updateInterval: 30, suppressBootstrapNull: true });
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
        const cfg1 = makeCfg({ path: 'env.sig', source: null, pathType: 'number', updateInterval: 50, suppressBootstrapNull: false });
        directive.setStreamsConfig(cfg1);
        directive.observe('p', () => { });

        expect(dataSvc.calls.length).toBe(1);

        const cfg2 = makeCfg({ path: 'env.sig', source: null, pathType: 'number', updateInterval: 50, suppressBootstrapNull: true });
        directive.applyStreamsConfigDiff(cfg2);

        expect(dataSvc.calls.length).toBe(1);
    });

    it('applies updateInterval: emits initial immediately and latest per interval', async () => {
        vi.useFakeTimers();
        const cfg = makeCfg({ path: 'env.sample', source: null, pathType: 'string', updateInterval: 50 });
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
        // The TTL is a fixed 5 s (no longer configurable); a stored dataTimeout is ignored.
        const cfg = makeCfg({ path: 'env.to', source: null, pathType: 'string', updateInterval: 100, displayName: 'Test', enableTimeout: true, dataTimeout: 0.02 });
        directive.setStreamsConfig(cfg);

        const hits: string[] = [];
        directive.observe('p', u => hits.push(String(u?.data?.value)));

        // Do not emit anything; advance virtual time beyond the fixed 5 s window to trigger timeout.
        await vi.advanceTimersByTimeAsync(5100);
        expect(dataSvc.timeoutCalls.length).toBe(1);
        // The window is the fixed constant, not the stored (0.02 s) dataTimeout.
        expect(dataSvc.timeoutCalls[0]).toEqual({ path: 'env.to', source: 'default', pathType: 'string', dataTimeoutMs: 5000 });
    });

    /**
     * The widget-level flag is not offered in the options dialog, so a widget that does
     * not declare one has none — and a live reading that stops arriving would sit frozen
     * on screen looking current. The path says so itself instead.
     */
    it('times out a path that asks for it, on a widget with no timeout of its own', async () => {
        vi.useFakeTimers();
        vi.spyOn(console, 'log');
        const cfg = makeCfg({
            path: 'env.live', source: null, pathType: 'string', updateInterval: 100,
            displayName: 'Test', enableTimeout: false, pathEnableTimeout: true
        });
        directive.setStreamsConfig(cfg);
        directive.observe('p', () => { /* value not under test */ });

        await vi.advanceTimersByTimeAsync(5100);
        expect(dataSvc.timeoutCalls.length).toBe(1);
        expect(dataSvc.timeoutCalls[0].path).toBe('env.live');
    });

    it('still lets a path opt out of a widget that does have one', async () => {
        vi.useFakeTimers();
        vi.spyOn(console, 'log');
        const cfg = makeCfg({
            path: 'env.state', source: null, pathType: 'string', updateInterval: 100,
            displayName: 'Test', enableTimeout: true, pathEnableTimeout: false
        });
        directive.setStreamsConfig(cfg);
        directive.observe('p', () => { /* value not under test */ });

        await vi.advanceTimersByTimeAsync(5100);
        expect(dataSvc.timeoutCalls.length).toBe(0);
    });

    it('forwards a configured non-default source into timeoutPathObservable', async () => {
        vi.useFakeTimers();
        vi.spyOn(console, 'log');
        const cfg = makeCfg({ path: 'env.to', source: 'n2k-1', pathType: 'string', updateInterval: 100, displayName: 'Test', enableTimeout: true });
        directive.setStreamsConfig(cfg);

        const hits: string[] = [];
        directive.observe('p', u => hits.push(String(u?.data?.value)));

        // The stream's effective source must reach the reset so a source-bound widget
        // clears its own registration, not the default bucket (#206).
        await vi.advanceTimersByTimeAsync(5100);
        expect(dataSvc.timeoutCalls[0]).toEqual({ path: 'env.to', source: 'n2k-1', pathType: 'string', dataTimeoutMs: 5000 });
    });

    it('samples a structural slot (initial + latest) and tags it with its fixed unit', async () => {
        vi.useFakeTimers();
        const cfg = makeCfg({ path: 'env.units', source: null, pathType: 'number', updateInterval: 50, convertUnitTo: 'x10', showConvertUnitTo: false });
        directive.setStreamsConfig(cfg);

        const hits: unknown[][] = [];
        directive.observe('p', u => hits.push([u?.data?.value, u?.data?.measure]));

        const subj = dataSvc.subjects.get('env.units|default')!;
        // Initial is delivered immediately
        subj.next({ data: { value: 1, timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        // Next two quick emissions; only latest sampled should be delivered after tick
        subj.next({ data: { value: 2, timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        subj.next({ data: { value: 3, timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        await vi.advanceTimersByTimeAsync(60);
        expect(hits).toEqual([[1, 'x10'], [3, 'x10']]);
    });

    it('tags a display path with the server-resolved measure, not the stored one', () => {
        unitsSvc.pathMeasures.set('env.disp', 'x10');
        // Stored convertUnitTo is ignored for a display path (no showConvertUnitTo:false).
        const cfg = makeCfg({ path: 'env.disp', source: null, pathType: 'number', convertUnitTo: 'noop', updateInterval: 50 });
        directive.setStreamsConfig(cfg);

        const received: IPathUpdate[] = [];
        directive.observe('p', u => received.push(u));

        dataSvc.subjects.get('env.disp|default')!.next({ data: { value: 4, timestamp: new Date() }, state: 'normal' } as IPathUpdate);

        expect(received.at(-1)?.data.value).toBe(4);
        expect(received.at(-1)?.data.measure).toBe('x10');
    });

    it('re-emits the last value with the new measure when the resolved measure changes (late meta)', () => {
        unitsSvc.pathMeasures.set('env.late', 'noop'); // starts as an identity measure
        const cfg = makeCfg({ path: 'env.late', source: null, pathType: 'number', updateInterval: 50 });
        directive.setStreamsConfig(cfg);

        const values: unknown[][] = [];
        directive.observe('p', u => values.push([u?.data?.value, u?.data?.measure]));

        dataSvc.subjects.get('env.late|default')!.next({ data: { value: 5, timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        expect(values.at(-1)).toEqual([5, 'noop']);

        // Server displayUnits meta arrives after subscribe -> resolved measure becomes 'x10'.
        // No new data delta: the last value must re-emit with it, so label and value agree.
        unitsSvc.pathMeasures.set('env.late', 'x10');
        dataSvc.metaSubjects.get('env.late')!.next({} as ISkMetadata);
        expect(values.at(-1)).toEqual([5, 'x10']);
    });

    it('falls back to the stored unit for a display path while the resolved measure is still unitless', () => {
        unitsSvc.pathMeasures.set('env.pre', 'unitless'); // no unit meta resolved yet
        const cfg = makeCfg({ path: 'env.pre', source: null, pathType: 'number', convertUnitTo: 'x10', updateInterval: 50 });
        directive.setStreamsConfig(cfg);

        const received: IPathUpdate[] = [];
        directive.observe('p', u => received.push(u));

        dataSvc.subjects.get('env.pre|default')!.next({ data: { value: 4, timestamp: new Date() }, state: 'normal' } as IPathUpdate);

        // Resolved 'unitless' -> tag with the stored 'x10', so a pre-meta value is presented in the
        // widget's stored unit.
        expect(received.at(-1)?.data.value).toBe(4);
        expect(received.at(-1)?.data.measure).toBe('x10');
    });

    it('keeps a duration-format display path numeric and tags it with the format (#627)', () => {
        unitsSvc.pathMeasures.set('racing.ttl', 's');
        unitsSvc.pathDurationFormats.set('racing.ttl', 'HH:MM:SS');
        directive.setStreamsConfig(makeCfg({ path: 'racing.ttl', source: null, pathType: 'number', updateInterval: 50 }));

        const received: IPathUpdate[] = [];
        directive.observe('p', u => received.push(u));
        dataSvc.subjects.get('racing.ttl|default')!.next({ data: { value: 1800, timestamp: new Date() }, state: 'normal' } as IPathUpdate);

        expect(received.at(-1)?.data.value).toBe(1800);
        expect(received.at(-1)?.data.measure).toBe('s');
        expect(received.at(-1)?.data.durationFormat).toBe('HH:MM:SS');
    });

    it('re-emits the last value when only the duration format changes (late meta)', () => {
        unitsSvc.pathMeasures.set('racing.late', 's');
        directive.setStreamsConfig(makeCfg({ path: 'racing.late', source: null, pathType: 'number', updateInterval: 50 }));

        const received: IPathUpdate[] = [];
        directive.observe('p', u => received.push(u));
        dataSvc.subjects.get('racing.late|default')!.next({ data: { value: 90, timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        expect(received.at(-1)?.data.durationFormat).toBeUndefined();

        // The measure stays 's'; the format alone changing must still reach the widget.
        unitsSvc.pathDurationFormats.set('racing.late', 'MM:SS');
        dataSvc.metaSubjects.get('racing.late')!.next({} as ISkMetadata);
        expect(received.at(-1)?.data.value).toBe(90);
        expect(received.at(-1)?.data.durationFormat).toBe('MM:SS');
    });

    it('never tags a structural path with a duration format', () => {
        unitsSvc.pathDurationFormats.set('racing.fixed', 'HH:MM:SS');
        directive.setStreamsConfig(makeCfg({ path: 'racing.fixed', source: null, pathType: 'number', convertUnitTo: 's', showConvertUnitTo: false, updateInterval: 50 }));

        const received: IPathUpdate[] = [];
        directive.observe('p', u => received.push(u));
        dataSvc.subjects.get('racing.fixed|default')!.next({ data: { value: 30, timestamp: new Date() }, state: 'normal' } as IPathUpdate);

        expect(received.at(-1)?.data.measure).toBe('s');
        expect(received.at(-1)?.data.durationFormat).toBeUndefined();
    });

    it('supports observer-level min/max compounding with sampling', async () => {
        vi.useFakeTimers();
        const cfg = makeCfg({ path: 'env.stats', source: null, pathType: 'number', updateInterval: 40 });
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

    it('updates sampling cadence when updateInterval changes without resubscribing base', async () => {
        vi.useFakeTimers();
        // Initial updateInterval: 100ms
        const cfg1 = makeCfg({ path: 'env.cadence', source: null, pathType: 'string', updateInterval: 100 });
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

        // Change only updateInterval to 30ms; base identity (path+source) unchanged
        const cfg2 = makeCfg({ path: 'env.cadence', source: null, pathType: 'string', updateInterval: 30 });
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

    it('falls back to a 1000ms cadence when updateInterval is absent (Number(undefined) → NaN)', async () => {
        vi.useFakeTimers();
        const cfg = makeCfg({ path: 'env.fallback', source: null, pathType: 'string' });
        delete (cfg as { updateInterval?: number }).updateInterval;
        directive.setStreamsConfig(cfg);

        const hits: string[] = [];
        directive.observe('p', u => hits.push(String(u?.data?.value)));

        const subj = dataSvc.subjects.get('env.fallback|default')!;
        subj.next({ data: { value: 'A', timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        subj.next({ data: { value: 'B', timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        // Well inside the 1000ms window: only the immediate initial emission.
        await vi.advanceTimersByTimeAsync(500);
        expect(hits).toEqual(['A']);
        // Cross the 1000ms boundary: latest ('B') is emitted.
        await vi.advanceTimersByTimeAsync(600);
        expect(hits).toEqual(['A', 'B']);
    });

    it('falls back to 1000ms when updateInterval is non-positive (0 → the <=0 branch)', async () => {
        vi.useFakeTimers();
        const cfg = makeCfg({ path: 'env.zero', source: null, pathType: 'string', updateInterval: 0 });
        directive.setStreamsConfig(cfg);

        const hits: string[] = [];
        directive.observe('p', u => hits.push(String(u?.data?.value)));

        const subj = dataSvc.subjects.get('env.zero|default')!;
        subj.next({ data: { value: 'A', timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        subj.next({ data: { value: 'B', timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        await vi.advanceTimersByTimeAsync(500);
        expect(hits).toEqual(['A']);
        await vi.advanceTimersByTimeAsync(600);
        expect(hits).toEqual(['A', 'B']);
    });

    it('releases the old base exactly once when the source rebinds', () => {
        const cfg1 = makeCfg({ path: 'env.rebind', source: null, pathType: 'string', updateInterval: 50 });
        directive.setStreamsConfig(cfg1);
        directive.observe('p', () => { });
        expect(dataSvc.calls).toEqual([{ path: 'env.rebind', source: 'default' }]);
        expect(dataSvc.releases).toEqual([]);

        const cfg2 = makeCfg({ path: 'env.rebind', source: 'n2k', pathType: 'string', updateInterval: 50 });
        directive.applyStreamsConfigDiff(cfg2);

        // The old (default) base is released once; the new (n2k) base is acquired.
        expect(dataSvc.releases).toEqual([{ path: 'env.rebind', source: 'default' }]);
        expect(dataSvc.calls).toEqual([
            { path: 'env.rebind', source: 'default' },
            { path: 'env.rebind', source: 'n2k' }
        ]);
    });

    it('does NOT release or re-acquire the base on an updateInterval or convertUnitTo change (the trap)', () => {
        const cfg1 = makeCfg({ path: 'env.trap', source: null, pathType: 'number', updateInterval: 100 });
        directive.setStreamsConfig(cfg1);
        directive.observe('p', () => { });
        expect(dataSvc.calls.length).toBe(1);

        // Same base identity (path+source): pipeline rebuilds, but releasing here would over-release
        // a live registration, so the base must be neither released nor re-acquired.
        directive.applyStreamsConfigDiff(makeCfg({ path: 'env.trap', source: null, pathType: 'number', updateInterval: 30 }));
        expect(dataSvc.calls.length).toBe(1);
        expect(dataSvc.releases).toEqual([]);

        directive.applyStreamsConfigDiff(makeCfg({ path: 'env.trap', source: null, pathType: 'number', updateInterval: 30, convertUnitTo: 'x10' }));
        expect(dataSvc.calls.length).toBe(1);
        expect(dataSvc.releases).toEqual([]);
    });

    it('unobserve releases the base and stops delivering updates', () => {
        directive.setStreamsConfig(makeCfg({ path: 'env.off', source: null }));
        const hits: unknown[] = [];
        directive.observe('p', update => hits.push(update.data.value));
        dataSvc.subjects.get('env.off|default')!.next({ data: { value: 'A', timestamp: new Date() }, state: 'normal' } as IPathUpdate);

        directive.unobserve('p');
        dataSvc.subjects.get('env.off|default')!.next({ data: { value: 'B', timestamp: new Date() }, state: 'normal' } as IPathUpdate);

        expect(hits).toEqual(['A']);
        expect(dataSvc.releases).toEqual([{ path: 'env.off', source: 'default' }]);
        expect(heldBaseCount(directive)).toBe(0);
    });

    it('does not resubscribe an unobserved path on a later config change', () => {
        directive.setStreamsConfig(makeCfg({ path: 'env.off', source: null }));
        directive.observe('p', () => { });
        directive.unobserve('p');

        directive.applyStreamsConfigDiff(makeCfg({ path: 'env.off', source: 'n2k' }));
        expect(dataSvc.calls).toEqual([{ path: 'env.off', source: 'default' }]);
    });

    it('unobserve of a path never observed is a no-op', () => {
        directive.setStreamsConfig(makeCfg({ path: 'env.none', source: null }));
        directive.unobserve('p');
        expect(dataSvc.calls).toEqual([]);
        expect(dataSvc.releases).toEqual([]);
    });

    it('reads a slot with the source of the slot named by sourceFromPath when both read the same path', () => {
        const cfg = makeMultiCfg([{ key: 'display', path: ' env.wind ' }, { key: 'hidden', path: 'env.wind' }]);
        const paths = cfg.paths as Record<string, IWidgetPath>;
        paths['display'].source = 'n2k.115';
        paths['hidden'].sourceFromPath = 'display';
        directive.setStreamsConfig(cfg);
        directive.observe('hidden', () => { });

        expect(dataSvc.calls).toEqual([{ path: 'env.wind', source: 'n2k.115' }]);
    });

    it('keeps a slot\'s own source when the slot named by sourceFromPath reads another path', () => {
        // Wind Steer showing Ground TWA from a pinned source: the hidden water-TWA slot must not ask
        // that source for a path it may not send.
        const cfg = makeMultiCfg([
            { key: 'trueWindAngle', path: 'self.environment.wind.angleTrueGround' },
            { key: 'polarTrueWindAngle', path: 'self.environment.wind.angleTrueWater' }
        ]);
        const paths = cfg.paths as Record<string, IWidgetPath>;
        paths['trueWindAngle'].source = 'n2k.115';
        paths['polarTrueWindAngle'].source = 'default';
        paths['polarTrueWindAngle'].sourceFromPath = 'trueWindAngle';
        directive.setStreamsConfig(cfg);
        directive.observe('polarTrueWindAngle', () => { });

        expect(dataSvc.calls).toEqual([{ path: 'self.environment.wind.angleTrueWater', source: 'default' }]);
    });

    it('rebinds a slot that follows another slot when that slot\'s source changes', () => {
        const build = (displaySource: string | null): IWidgetSvcConfig => {
            const cfg = makeMultiCfg([{ key: 'display', path: 'env.wind' }, { key: 'hidden', path: 'env.wind' }]);
            const paths = cfg.paths as Record<string, IWidgetPath>;
            paths['display'].source = displaySource;
            paths['hidden'].sourceFromPath = 'display';
            return cfg;
        };
        directive.setStreamsConfig(build(null));
        directive.observe('hidden', () => { });

        directive.applyStreamsConfigDiff(build('n2k.115'));

        expect(dataSvc.calls).toEqual([
            { path: 'env.wind', source: 'default' },
            { path: 'env.wind', source: 'n2k.115' }
        ]);
        expect(dataSvc.releases).toEqual([{ path: 'env.wind', source: 'default' }]);
    });

    it('drops the followed source when the followed slot is re-pointed to another path', () => {
        const build = (displayPath: string): IWidgetSvcConfig => {
            const cfg = makeMultiCfg([{ key: 'display', path: displayPath }, { key: 'hidden', path: 'env.wind' }]);
            const paths = cfg.paths as Record<string, IWidgetPath>;
            paths['display'].source = 'n2k.115';
            paths['hidden'].sourceFromPath = 'display';
            return cfg;
        };
        directive.setStreamsConfig(build('env.wind'));
        directive.observe('hidden', () => { });

        directive.applyStreamsConfigDiff(build('env.windGround'));

        expect(dataSvc.calls).toEqual([
            { path: 'env.wind', source: 'n2k.115' },
            { path: 'env.wind', source: 'default' }
        ]);
    });

    it('keeps a slot\'s own source when sourceFromPath names no slot', () => {
        const cfg = makeMultiCfg([{ key: 'hidden', path: 'env.windSI' }]);
        const paths = cfg.paths as Record<string, IWidgetPath>;
        paths['hidden'].source = 'own';
        paths['hidden'].sourceFromPath = 'missing';
        directive.setStreamsConfig(cfg);
        directive.observe('hidden', () => { });

        expect(dataSvc.calls).toEqual([{ path: 'env.windSI', source: 'own' }]);
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
        directive.setStreamsConfig(makeCfg({ path: 'env.root', source: null, pathType: 'string', updateInterval: 50, enableTimeout: false }));
        directive.observe('p', () => { });
        expect(dataSvc.calls.length).toBe(1);

        // An enableTimeout change flips the ROOT signature, taking the distinct rootChanged branch that
        // force-rebuilds every path's pipeline even though the per-path signature is unchanged. baseKey
        // (path+source) is still identical, so the base must be neither released nor re-acquired.
        directive.applyStreamsConfigDiff(makeCfg({ path: 'env.root', source: null, pathType: 'string', updateInterval: 50, enableTimeout: true }));
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

describe('WidgetStreamsDirective SI values', () => {
    let directive: WidgetStreamsDirective;
    let dataSvc: FakeDataService;
    let unitsSvc: FakeUnitsService;

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
        unitsSvc = TestBed.inject(UnitsService) as unknown as FakeUnitsService;
    });

    const emit = (key: string, value: unknown) =>
        dataSvc.subjects.get(key)!.next({ data: { value, timestamp: new Date() }, state: 'normal' } as IPathUpdate);

    it('delivers a display slot\'s SI value with the server-resolved measure', () => {
        unitsSvc.pathMeasures.set('nav.sog', 'knots');
        directive.setStreamsConfig(makeCfg({ path: 'nav.sog', pathType: 'number', convertUnitTo: 'kph', updateInterval: 50 }));

        const received: IPathUpdate[] = [];
        directive.observe('p', u => received.push(u));
        emit('nav.sog|default', 5.14);

        expect(received.at(-1)?.data.value).toBe(5.14);
        expect(received.at(-1)?.data.measure).toBe('knots');
    });

    it('delivers a structural slot\'s SI value with its fixed convertUnitTo as measure', () => {
        directive.setStreamsConfig(makeCfg({ path: 'env.twa', pathType: 'number', convertUnitTo: 'deg', showConvertUnitTo: false, updateInterval: 50 }));

        const received: IPathUpdate[] = [];
        directive.observe('p', u => received.push(u));
        emit('env.twa|default', Math.PI / 2);

        expect(received.at(-1)?.data.value).toBe(Math.PI / 2);
        expect(received.at(-1)?.data.measure).toBe('deg');
    });

    it('tags a display slot with the stored unit before meta resolves, then re-emits with the server measure', () => {
        unitsSvc.pathMeasures.set('nav.stw', 'unitless');
        directive.setStreamsConfig(makeCfg({ path: 'nav.stw', pathType: 'number', convertUnitTo: 'knots', updateInterval: 50 }));

        const received: IPathUpdate[] = [];
        directive.observe('p', u => received.push(u));
        emit('nav.stw|default', 5.14);

        expect(received.at(-1)?.data.value).toBe(5.14);
        expect(received.at(-1)?.data.measure).toBe('knots');

        unitsSvc.pathMeasures.set('nav.stw', 'kph');
        dataSvc.metaSubjects.get('nav.stw')!.next({} as ISkMetadata);

        expect(received).toHaveLength(2);
        expect(received.at(-1)?.data.value).toBe(5.14);
        expect(received.at(-1)?.data.measure).toBe('kph');
    });

    it('delivers the SI number of seconds for a string-format measure', () => {
        unitsSvc.pathMeasures.set('env.uptime', 'D HH:MM:SS');
        directive.setStreamsConfig(makeCfg({ path: 'env.uptime', pathType: 'number', updateInterval: 50 }));

        const received: IPathUpdate[] = [];
        directive.observe('p', u => received.push(u));
        emit('env.uptime|default', 3600);

        expect(received.at(-1)?.data.value).toBe(3600);
        expect(received.at(-1)?.data.measure).toBe('D HH:MM:SS');
    });

    it('keeps carrying the duration format of a display slot', () => {
        unitsSvc.pathMeasures.set('racing.ttl', 's');
        unitsSvc.pathDurationFormats.set('racing.ttl', 'HH:MM:SS');
        directive.setStreamsConfig(makeCfg({ path: 'racing.ttl', pathType: 'number', updateInterval: 50 }));

        const received: IPathUpdate[] = [];
        directive.observe('p', u => received.push(u));
        emit('racing.ttl|default', 1800);

        expect(received.at(-1)?.data.durationFormat).toBe('HH:MM:SS');
    });

    it('passes a null value through on display and structural slots', () => {
        const cfg = makeMultiCfg([{ key: 'display', path: 'env.a' }, { key: 'structural', path: 'env.b' }]);
        const paths = cfg.paths as Record<string, IWidgetPath>;
        paths['display'].pathType = 'number';
        paths['structural'].pathType = 'number';
        paths['structural'].convertUnitTo = 'deg';
        paths['structural'].showConvertUnitTo = false;
        directive.setStreamsConfig(cfg);

        const received: IPathUpdate[] = [];
        directive.observe('display', u => received.push(u));
        directive.observe('structural', u => received.push(u));
        emit('env.a|default', null);
        emit('env.b|default', null);

        expect(received.map(u => u.data.value)).toEqual([null, null]);
        expect(received.map(u => u.data.measure)).toEqual(['kn', 'deg']);
    });
});

/**
 * Faithful-to-DataService fake: path values live in a BehaviorSubject (so the current value is
 * replayed on re-subscription), and timeoutPathObservable() resets the value to null - exactly
 * like the real service does on a TTL timeout.
 */
class TtlFakeDataService {
    subjects = new Map<string, BehaviorSubject<IPathUpdate>>();
    metaSubjects = new Map<string, BehaviorSubject<ISkMetadata | null>>();
    timeoutCalls: { path: string; source: string; pathType: string; dataTimeoutMs: number }[] = [];

    private keyFor(path: string, source?: string): string {
        return `${path}|${source?.trim() || 'default'}`;
    }

    getPathMetaObservable(path: string): Observable<ISkMetadata | null> {
        if (!this.metaSubjects.has(path)) {
            this.metaSubjects.set(path, new BehaviorSubject<ISkMetadata | null>(null));
        }
        return this.metaSubjects.get(path)!.asObservable();
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

    it('times out on the base path, nulling a field slot and a whole-value slot alike', async () => {
        vi.useFakeTimers();
        vi.spyOn(console, 'log');
        directive.setStreamsConfig({
            ...makeMultiCfg([
                { key: 'lat', path: 'self.navigation.position#/latitude' },
                { key: 'whole', path: 'self.navigation.position' }
            ]),
            enableTimeout: true
        });
        const lat: unknown[] = [];
        const whole: unknown[] = [];
        directive.observe('lat', u => lat.push(u?.data?.value));
        directive.observe('whole', u => whole.push(u?.data?.value));

        dataSvc.subjects.get('self.navigation.position|default')!.next(
            { data: { value: { latitude: 60.08, longitude: 21.97 }, timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        // The 5 s TTL counts from the 1 s sample of the value above; the reset null arrives on the
        // resubscribe 5 s after that.
        await vi.advanceTimersByTimeAsync(12000);

        expect(dataSvc.timeoutCalls.map(c => c.path)).toContain('self.navigation.position');
        expect(dataSvc.timeoutCalls.every(c => c.path === 'self.navigation.position')).toBe(true);
        expect(lat.at(-1)).toBeNull();
        expect(whole.at(-1)).toBeNull();
    });

    it('resets the value to null after a TTL timeout even with suppressBootstrapNull enabled', async () => {
        vi.useFakeTimers();
        vi.spyOn(console, 'log'); // silence timeout/retry logs
        const cfg = makeCfg({
            path: 'env.ttl', source: null, pathType: 'number', updateInterval: 50,
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

        // Engine stops: no more data. Let the fixed 5 s TTL fire, then the retry resubscribe
        // (retryDelay = 5s) — the resubscribe is where suppressBootstrapNull would re-show the stale
        // value, so advance past both (~10 s) to prove the reset holds through it.
        await vi.advanceTimersByTimeAsync(10100);

        expect(dataSvc.timeoutCalls.length).toBeGreaterThanOrEqual(1);
        // The widget must be reset to null ("--"), not left showing the stale 500.
        expect(hits[hits.length - 1]).toBeNull();
    });

    it('resets a structural slot\'s SI value to null after a TTL timeout', async () => {
        vi.useFakeTimers();
        vi.spyOn(console, 'log');
        directive.setStreamsConfig(makeCfg({
            path: 'env.ttl-si', source: null, pathType: 'number', updateInterval: 50,
            convertUnitTo: 'x10', showConvertUnitTo: false, enableTimeout: true
        }));

        const hits: (number | null)[] = [];
        directive.observe('p', u => hits.push((u?.data?.value as number | null) ?? null));

        dataSvc.subjects.get('env.ttl-si|default')!.next({ data: { value: 7, timestamp: new Date() }, state: 'normal' } as IPathUpdate);
        await vi.advanceTimersByTimeAsync(60);
        expect(hits.at(-1)).toBe(7);

        // The fixed 5 s TTL fires, then the 5 s retry resubscribes and replays the reset null.
        await vi.advanceTimersByTimeAsync(10100);
        expect(dataSvc.timeoutCalls.length).toBeGreaterThanOrEqual(1);
        expect(hits.at(-1)).toBeNull();
    });
});

/**
 * The identity a widget compares to tell a re-point apart from an unrelated reconfigure. The
 * directive computes it to decide whether to rebuild a subscription; the gauges compute it to decide
 * whether the reading on screen still describes the path being watched. Both must agree, which is
 * why it is one exported function rather than two implementations.
 */
describe('widgetPathSignature', () => {
    const base = { path: 'navigation.speedOverGround', pathType: 'number', convertUnitTo: 'knots', source: null, suppressBootstrapNull: true };

    it('returns null for a config with no usable path', () => {
        expect(widgetPathSignature(undefined)).toBeNull();
        expect(widgetPathSignature(null)).toBeNull();
        expect(widgetPathSignature({ ...base, path: null })).toBeNull();
        expect(widgetPathSignature({ ...base, path: '' })).toBeNull();
        // Whitespace passes the widget-options required check, so it has to normalize to "no path"
        // here rather than becoming an identity of its own.
        expect(widgetPathSignature({ ...base, path: '   ' })).toBeNull();
    });

    it('treats a trimmed path and its padded form as the same reading', () => {
        expect(widgetPathSignature({ ...base, path: '  navigation.speedOverGround  ' }))
            .toBe(widgetPathSignature(base));
    });

    it('treats an unset source and the default source as the same reading', () => {
        expect(widgetPathSignature({ ...base, source: null })).toBe(widgetPathSignature({ ...base, source: 'default' }));
        expect(widgetPathSignature({ ...base, source: '  ' })).toBe(widgetPathSignature({ ...base, source: 'default' }));
    });

    it('separates readings that differ in path, source, type, unit or bootstrap-null policy', () => {
        const sig = widgetPathSignature(base);
        expect(widgetPathSignature({ ...base, path: 'navigation.speedThroughWater' })).not.toBe(sig);
        expect(widgetPathSignature({ ...base, source: 'gps-2' })).not.toBe(sig);
        expect(widgetPathSignature({ ...base, pathType: 'string' })).not.toBe(sig);
        // A unit change re-expresses the number, so the displayed reading is no longer the same one.
        expect(widgetPathSignature({ ...base, convertUnitTo: 'kph' })).not.toBe(sig);
        expect(widgetPathSignature({ ...base, suppressBootstrapNull: false })).not.toBe(sig);
    });

    /**
     * An omitted per-path timeout defers to the widget-level flag, so it is a third setting,
     * not another spelling of `true`: flipping between any two has to rebuild the pipeline.
     */
    it('separates a per-path timeout that is on, off, or left to the widget', () => {
        const on = widgetPathSignature({ ...base, enableTimeout: true });
        const off = widgetPathSignature({ ...base, enableTimeout: false });
        const omitted = widgetPathSignature(base);
        expect(new Set([on, off, omitted]).size).toBe(3);
    });

    it('normalizeWidgetPath yields undefined for anything that is not a usable path', () => {
        expect(normalizeWidgetPath('  a.b  ')).toBe('a.b');
        expect(normalizeWidgetPath('')).toBeUndefined();
        expect(normalizeWidgetPath('   ')).toBeUndefined();
        expect(normalizeWidgetPath(null)).toBeUndefined();
        expect(normalizeWidgetPath(42)).toBeUndefined();
    });

    it('normalizeWidgetPath trims only the Signal K path of a pointer path', () => {
        expect(normalizeWidgetPath('  self.a.b #/c')).toBe('self.a.b#/c');
        expect(normalizeWidgetPath('self.a#/ ')).toBe('self.a#/ ');
        expect(normalizeWidgetPath('self.a#c')).toBeUndefined();
        expect(normalizeWidgetPath('  #/c')).toBeUndefined();
    });

    it('widgetPathSignature tells two fields of one path apart', () => {
        const sig = (path: string) => widgetPathSignature({ path, pathType: 'number' });
        expect(sig('self.navigation.attitude#/roll')).not.toBe(sig('self.navigation.attitude#/pitch'));
        expect(sig('self.navigation.attitude#latitude')).toBeNull();
    });
});

describe('WidgetRepointTracker', () => {
    const sigA = widgetPathSignature({ path: 'self.navigation.headingMagnetic', pathType: 'number' });
    const sigB = widgetPathSignature({ path: 'self.navigation.courseOverGroundTrue', pathType: 'number' });

    it('never reports on the first call: nothing has been shown, so there is nothing to clear', () => {
        expect(new WidgetRepointTracker().repointed(sigA)).toBe(false);
        expect(new WidgetRepointTracker().repointed(null)).toBe(false);
    });

    it('stays quiet across a rerun on the same path, so a theme change cannot blink the reading', () => {
        const tracker = new WidgetRepointTracker();
        tracker.repointed(sigA);
        expect(tracker.repointed(sigA)).toBe(false);
    });

    it('reports a re-point to another path', () => {
        const tracker = new WidgetRepointTracker();
        tracker.repointed(sigA);
        expect(tracker.repointed(sigB)).toBe(true);
    });

    it('treats no-usable-path as a real identity, in both directions', () => {
        // Clearing the path drops the reading, and a path that follows the cleared state must be
        // told apart from it — null is not a second "not yet".
        const tracker = new WidgetRepointTracker();
        tracker.repointed(sigA);
        expect(tracker.repointed(null)).toBe(true);
        expect(tracker.repointed(null)).toBe(false);
        expect(tracker.repointed(sigB)).toBe(true);
    });
});
