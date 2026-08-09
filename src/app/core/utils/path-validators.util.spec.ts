import { describe, expect, it } from 'vitest';
import { UntypedFormControl, UntypedFormGroup } from '@angular/forms';
import { IPathSlotRequirements, pathRequiredValidator, pathSlotWarning } from './path-validators.util';
import type { ISkPathData } from '../interfaces/app-interfaces';
import { ISkMetadata, States } from '../interfaces/signalk-interfaces';

const groupWith = (path: unknown, pathRequired?: boolean): UntypedFormGroup => {
  const controls: Record<string, UntypedFormControl> = { path: new UntypedFormControl(path) };
  if (pathRequired !== undefined) {
    controls['pathRequired'] = new UntypedFormControl(pathRequired);
  }
  return new UntypedFormGroup(controls);
};

describe('pathRequiredValidator', () => {
  it('rejects an empty required path', () => {
    expect(pathRequiredValidator(groupWith('', true).controls['path'])).toEqual({ required: true });
  });

  it('rejects a null required path', () => {
    expect(pathRequiredValidator(groupWith(null, true).controls['path'])).toEqual({ required: true });
  });

  it('treats a slot with no pathRequired flag as required', () => {
    expect(pathRequiredValidator(groupWith('').controls['path'])).toEqual({ required: true });
  });

  it('accepts an empty path in an optional slot', () => {
    expect(pathRequiredValidator(groupWith('', false).controls['path'])).toBeNull();
  });

  it('accepts a path the server does not currently publish', () => {
    // The instrument behind it may simply be switched off; blocking here would strand the config.
    expect(pathRequiredValidator(groupWith('self.steering.rudderAngle', true).controls['path'])).toBeNull();
  });
});

describe('pathSlotWarning', () => {
  const numberSlot: IPathSlotRequirements =
    { pathType: 'number', supportsPutOnly: false, zonesOnly: false, selfOnly: true };

  const meta = (overrides: Partial<ISkMetadata> = {}): ISkMetadata =>
    ({ description: '', properties: {}, ...overrides });

  const pathData = (overrides: Partial<ISkPathData> = {}): ISkPathData => ({
    path: 'self.navigation.speedThroughWater',
    pathValue: 4.2,
    pathTimestamp: undefined,
    type: 'number',
    state: States.Normal,
    sources: {},
    ...overrides
  });

  it('says nothing for an empty path', () => {
    expect(pathSlotWarning('', null, numberSlot)).toBeNull();
    expect(pathSlotWarning(null, null, numberSlot)).toBeNull();
  });

  it('says nothing for a path that satisfies the slot', () => {
    expect(pathSlotWarning('self.navigation.speedThroughWater', pathData(), numberSlot)).toBeNull();
  });

  it('reports a path the server is not sending at all', () => {
    // Covers a typo, a missing "self." prefix, and an instrument switched off since server start.
    const warning = pathSlotWarning('self.steering.rudderAngle', null, numberSlot);
    expect(warning).toContain('not sending this path');
    expect(warning).toContain('switched off');
  });

  it('distinguishes a known path that has not sent a value yet', () => {
    // A meta-only entry whose units imply no type: published, but its type cannot be checked.
    const warning = pathSlotWarning('self.navigation.speedThroughWater', pathData({ type: undefined }), numberSlot);
    expect(warning).toContain('has not sent a value yet');
  });

  it('names both types when the path carries the wrong one', () => {
    const warning = pathSlotWarning('self.navigation.state', pathData({ type: 'string' }), numberSlot);
    expect(warning).toContain('sends text values');
    expect(warning).toContain('needs a number');
  });

  it('reports a read-only path in a slot that needs PUT', () => {
    const warning = pathSlotWarning('self.steering.autopilot.state', pathData({ meta: meta({ supportsPut: false }) }),
      { ...numberSlot, supportsPutOnly: true });
    expect(warning).toContain('read-only');
  });

  it('says nothing when a PUT slot gets a path that supports PUT', () => {
    expect(pathSlotWarning('self.steering.autopilot.state', pathData({ meta: meta({ supportsPut: true }) }),
      { ...numberSlot, supportsPutOnly: true })).toBeNull();
  });

  it('reports a path on another vessel when the slot is restricted to own vessel', () => {
    const warning = pathSlotWarning('vessels.urn:mrn:imo:mmsi:123456789.navigation.speedOverGround', pathData(), numberSlot);
    expect(warning).toContain('another vessel');
  });

  it('accepts a path on another vessel when the slot is not restricted', () => {
    expect(pathSlotWarning('vessels.urn:mrn:imo:mmsi:123456789.navigation.speedOverGround', pathData(),
      { ...numberSlot, selfOnly: false })).toBeNull();
  });

  it('reports a path with no alarm zones in a zones-only slot', () => {
    const warning = pathSlotWarning('self.navigation.speedThroughWater', pathData({ meta: meta({ zones: [] }) }),
      { ...numberSlot, zonesOnly: true });
    expect(warning).toContain('no alarm zones');
  });

  it('matches a non-runtime slot type against the path metadata', () => {
    // A slot type outside the JS runtime types is matched on meta.type, not the value's type.
    const dateSlot: IPathSlotRequirements = { ...numberSlot, pathType: 'position' };
    expect(pathSlotWarning('self.navigation.position', pathData({ meta: meta({ type: 'position' }) }), dateSlot)).toBeNull();
    expect(pathSlotWarning('self.navigation.position', pathData({ meta: meta({ type: 'other' }) }), dateSlot))
      .toContain('sends other values');
  });
});
