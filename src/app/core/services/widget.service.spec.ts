import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { WidgetService } from './widget.service';

describe('WidgetService', () => {
  let service: WidgetService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(WidgetService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('registers the available electrical family widgets in definitions', () => {
    const selectors = service.kipWidgets.map(widget => widget.selector);

    // widget-alternator/-inverter/-ac are commented out in widget.service.ts pending readiness.
    expect(selectors).toContain('widget-solar-charger');
    expect(selectors).toContain('widget-charger');
  });
});
