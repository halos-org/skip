import cloneDeep from 'lodash-es/cloneDeep';
import { IConfig } from '../app/core/interfaces/app-settings.interfaces';
import { defaultConfig } from './config.blank.const';
import { DefaultDashboard } from './config.blank.dashboard';
import { UUID } from '../app/core/utils/uuid.util';

/**
 * A fresh configuration seeded with the dashboards shipped in this release: what a new profile
 * starts from, and what an anonymous visitor sees when the server publishes no shared dashboard.
 * Each call returns its own deep copy with new page ids, so the exported singletons stay pristine.
 *
 * Lives apart from `config.blank.const` because it reaches into the dashboard seed, which carries a
 * type import from the dashboard service — pulling that chain into the const module would close an
 * import cycle around the very constants it exports.
 */
export function buildDefaultConfig(): IConfig {
  const config = cloneDeep(defaultConfig);
  config.dashboards = cloneDeep(DefaultDashboard).map(dashboard => ({
    ...dashboard,
    id: UUID.create()
  }));
  return config;
}
