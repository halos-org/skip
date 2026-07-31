import { describe, expect, it, vi } from 'vitest';
import { makeConfigResultHandler } from './widget-config-panel.component';
import type { IWidgetSvcConfig } from '../../interfaces/widgets-interface';

describe('makeConfigResultHandler', () => {
  it('saves the config and closes the panel on Save (a result config)', () => {
    const save = vi.fn();
    const closePanel = vi.fn();
    const cfg = { updateInterval: 2000 } as IWidgetSvcConfig;
    makeConfigResultHandler(save, closePanel)(cfg);
    expect(save).toHaveBeenCalledWith(cfg);
    expect(closePanel).toHaveBeenCalledTimes(1);
  });

  it('only closes the panel on Cancel (no result)', () => {
    const save = vi.fn();
    const closePanel = vi.fn();
    makeConfigResultHandler(save, closePanel)();
    expect(save).not.toHaveBeenCalled();
    expect(closePanel).toHaveBeenCalledTimes(1);
  });
});
