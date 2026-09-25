import { describe, expect, it } from 'vitest';
import { WidgetRacerTimerComponent } from './widget-racer-timer/widget-racer-timer.component';
import { WidgetRacerLineViewComponent } from './widget-racer-line-view/widget-racer-line-view.component';
import { WidgetRacerLineComponent } from './widget-racer-line/widget-racer-line.component';
import type { IWidgetSvcConfig } from '../core/interfaces/widgets-interface';

/**
 * Exempting a path from the stale-data timeout only works if EVERY widget on that path
 * agrees.
 *
 * DataService.timeoutPathObservable cross-clears all registrations on a path once it has
 * gone silent, and the trigger is whichever widget's TTL fires first. A widget that has
 * opted out never calls it — but it is still cleared by one that has not, and its own
 * exemption buys it nothing. These paths carry state the racer plugin publishes when it
 * changes and then leaves alone, so the exemption has to hold across all three widgets.
 */
describe('racer widgets: shared state paths', () => {
  const widgets: [string, IWidgetSvcConfig][] = [
    ['racer-timer', WidgetRacerTimerComponent.DEFAULT_CONFIG],
    ['racer-line-view', WidgetRacerLineViewComponent.DEFAULT_CONFIG],
    ['racer-line', WidgetRacerLineComponent.DEFAULT_CONFIG]
  ];

  /** Published on change only — a countdown that is set once, a line that is set once. */
  const publishedOnChange = [
    'self.navigation.racing.startTime',
    'self.navigation.racing.startLinePort',
    'self.navigation.racing.startLineStb',
    'self.navigation.racing.startLineLength',
    'self.navigation.racing.startLineBearing',
    'self.navigation.racing.lines'
  ];

  /**
   * None of the three should offer "Blank the reading after 5s without data". Everything
   * they show is either a countdown the plugin keeps publishing or a line it publishes
   * once, so blanking it is never right - and the option only exists in the dialog
   * because the config declares the key.
   */
  it('none of them offers the stale-data timeout', () => {
    for (const [name, cfg] of widgets) {
      expect(cfg.enableTimeout, `${name} still offers the timeout`).toBeUndefined();
      expect(cfg.dataTimeout, `${name} still carries a timeout window`).toBeUndefined();
    }
  });

  for (const path of publishedOnChange) {
    it(`${path} is exempt from the timeout in every widget that subscribes to it`, () => {
      const subscribers = widgets.flatMap(([name, cfg]) =>
        Object.entries(cfg.paths ?? {})
          .filter(([, p]) => p.path === path)
          .map(([key, p]) => ({ name, key, enableTimeout: p.enableTimeout })));

      for (const s of subscribers) {
        expect(s.enableTimeout, `${s.name}.${s.key} would clear ${path} for every widget`)
          .toBe(false);
      }
    });
  }
});
