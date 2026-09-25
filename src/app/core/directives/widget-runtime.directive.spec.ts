import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { WidgetRuntimeDirective } from './widget-runtime.directive';
import type { IWidgetSvcConfig } from '../interfaces/widgets-interface';

/**
 * The merge is what a placed widget actually runs on: its defaults under the config that
 * was saved with it on the dashboard.
 */
describe('WidgetRuntimeDirective config merge', () => {
  const build = (base: IWidgetSvcConfig, saved: IWidgetSvcConfig) =>
    TestBed.runInInjectionContext(() => {
      const d = new WidgetRuntimeDirective();
      d.initialize(base, saved);
      return d.options();
    });

  it('keeps the saved value for an editable path', () => {
    const merged = build(
      { paths: { p: { description: 'P', path: 'self.a', source: 'default', pathType: 'number', isPathConfigurable: true } } },
      { paths: { p: { description: 'P', path: 'self.b', source: 'default', pathType: 'number', isPathConfigurable: true } } }
    );
    expect(merged?.paths?.['p'].path).toBe('self.b');
  });

  /**
   * The regression this exists for: a widget placed on a dashboard stored the path its
   * release happened to use, and because the path is fixed — not shown in the options
   * dialog, not editable — a later correction to the widget's defaults could never reach
   * it. The stored value is not a choice, so it does not get to win.
   */
  it('takes a fixed path back from the defaults', () => {
    const merged = build(
      { paths: { p: { description: 'P', path: 'self.racing.lines', source: 'default', pathType: 'object', isPathConfigurable: false, enableTimeout: false } } },
      { paths: { p: { description: 'P', path: 'self.racing.lines.lines', source: 'default', pathType: null, isPathConfigurable: false } } }
    );
    expect(merged?.paths?.['p'].path).toBe('self.racing.lines');
    expect(merged?.paths?.['p'].pathType).toBe('object');
    expect(merged?.paths?.['p'].enableTimeout).toBe(false);
  });

  /**
   * A widget that retires a setting must actually be rid of it: the saved config carries
   * whatever it was when the widget was placed, and the merge lets the saved value win.
   */
  it('drops a retired widget setting the defaults no longer declare', () => {
    const merged = build(
      { paths: {} },
      { enableTimeout: true, dataTimeout: 5, paths: {} }
    );
    expect(merged?.enableTimeout).toBeUndefined();
    expect(merged?.dataTimeout).toBeUndefined();
  });

  it('keeps it for a widget that still declares it', () => {
    const merged = build(
      { enableTimeout: false, paths: {} },
      { enableTimeout: true, paths: {} }
    );
    expect(merged?.enableTimeout).toBe(true);
  });

  it('leaves a fixed path that offers options alone, the stored one being a choice', () => {
    const merged = build(
      {
        paths: {
          p: {
            description: 'P', path: 'self.headingTrue', source: 'default', pathType: 'number',
            isPathConfigurable: false,
            pathOptions: [{ label: 'True', path: 'self.headingTrue' }, { label: 'Magnetic', path: 'self.headingMagnetic' }]
          }
        }
      },
      { paths: { p: { description: 'P', path: 'self.headingMagnetic', source: 'default', pathType: 'number', isPathConfigurable: false } } }
    );
    expect(merged?.paths?.['p'].path).toBe('self.headingMagnetic');
  });

  it('leaves the editable parts of a fixed path alone', () => {
    const merged = build(
      { paths: { p: { description: 'P', path: 'self.len', source: 'default', pathType: 'number', isPathConfigurable: false, convertUnitTo: 'm' } } },
      { paths: { p: { description: 'P', path: 'self.len', source: 'n2k', pathType: 'number', isPathConfigurable: false, convertUnitTo: 'feet' } } }
    );
    expect(merged?.paths?.['p'].convertUnitTo).toBe('feet');
    expect(merged?.paths?.['p'].source).toBe('n2k');
  });

  /**
   * Whether a path keeps the widget's unit or follows the server's preference is the
   * widget's own decision, not a stored choice — a widget corrected to hold metres must
   * not be dragged back to the server's nautical miles by what was saved with it.
   */
  it('takes a fixed path’s unit policy back from the defaults', () => {
    const merged = build(
      { paths: { p: { description: 'P', path: 'self.len', source: 'default', pathType: 'number', isPathConfigurable: false, convertUnitTo: 'm', showConvertUnitTo: false } } },
      { paths: { p: { description: 'P', path: 'self.len', source: 'default', pathType: 'number', isPathConfigurable: false, convertUnitTo: 'm', showConvertUnitTo: true } } }
    );
    expect(merged?.paths?.['p'].showConvertUnitTo).toBe(false);
  });

  /**
   * And with the policy, the unit it decides: a path the widget does not expose the unit
   * for is converted with its own fixed unit, so the stored one is as stale a snapshot as
   * the path — restoring the policy alone would leave the widget converting to a unit it
   * no longer declares.
   */
  it('takes a structural fixed path’s unit back from the defaults too', () => {
    const merged = build(
      { paths: { p: { description: 'P', path: 'self.len', source: 'default', pathType: 'number', isPathConfigurable: false, convertUnitTo: 'm', showConvertUnitTo: false } } },
      { paths: { p: { description: 'P', path: 'self.len', source: 'default', pathType: 'number', isPathConfigurable: false, convertUnitTo: 'nm', showConvertUnitTo: false } } }
    );
    expect(merged?.paths?.['p'].convertUnitTo).toBe('m');
  });

  it('keeps the saved unit where the widget exposes it for editing', () => {
    const merged = build(
      { paths: { p: { description: 'P', path: 'self.len', source: 'default', pathType: 'number', isPathConfigurable: false, convertUnitTo: 'm', showConvertUnitTo: true } } },
      { paths: { p: { description: 'P', path: 'self.len', source: 'default', pathType: 'number', isPathConfigurable: false, convertUnitTo: 'feet', showConvertUnitTo: true } } }
    );
    expect(merged?.paths?.['p'].convertUnitTo).toBe('feet');
  });
});
