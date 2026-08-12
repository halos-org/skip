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
 * Lives apart from `config.blank.const` because two unrelated consumers need it — ProfileService for
 * a new profile, and the bootstrap for an anonymous visitor — and neither should import the other.
 * Keeping it out of the const module also keeps that module free of the dashboard seed's own import
 * of the dashboard service, which is type-only today but would close a cycle if it ever carried a value.
 */
export function buildDefaultConfig(): IConfig {
  const config = cloneDeep(defaultConfig);
  config.dashboards = cloneDeep(DefaultDashboard).map(dashboard => ({
    ...dashboard,
    id: UUID.create()
  }));
  return config;
}
