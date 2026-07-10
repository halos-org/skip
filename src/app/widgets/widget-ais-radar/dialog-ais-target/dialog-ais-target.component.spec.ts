import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { DialogAisTargetComponent } from './dialog-ais-target.component';
import { AisProcessingService } from '../../../core/services/ais-processing.service';
import type { AisTrack } from '../../../core/services/ais-processing.service';
import { UnitsService } from '../../../core/services/units.service';

function track(id: string, lastPositionAt: number): AisTrack {
  return {
    id,
    context: `vessels.urn:mrn:imo:mmsi:${id}`,
    type: 'vessel',
    ais: {},
    lastUpdateAt: lastPositionAt,
    lastPositionAt,
  } as unknown as AisTrack;
}

describe('DialogAisTargetComponent live target', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('re-reads the live track by id and falls back to the snapshot once evicted', () => {
    const targets = signal<AisTrack[]>([track('123', 1_000)]);
    // payload.target is the detached open-time snapshot (fallback only).
    const snapshot = track('123', 1_000);

    TestBed.configureTestingModule({
      imports: [DialogAisTargetComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { title: 't', component: 'ais-target', payload: { target: snapshot } } },
        { provide: AisProcessingService, useValue: { targets } },
        { provide: UnitsService, useValue: { convertToUnit: (_u: string, v: number) => v } },
      ],
    });
    const component = TestBed.createComponent(DialogAisTargetComponent)
      .componentInstance as unknown as { target: AisTrack | null };

    // A newer position report on the live set is reflected, not the frozen snapshot.
    targets.set([track('123', 5_000)]);
    expect(component.target?.lastPositionAt).toBe(5_000);

    // Once the target leaves the live set, fall back to the open-time snapshot.
    targets.set([]);
    expect(component.target?.lastPositionAt).toBe(1_000);
  });
});
