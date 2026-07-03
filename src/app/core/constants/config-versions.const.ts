/**
 * Single definition site for the config version constants (#17). Three independent version
 * spaces meet here — a bump in one never implies a bump in another:
 *  - the remote storage FILE version: the applicationData URL path segment holding the config slots;
 *  - the app-config schema version: the `configVersion` property inside profile (IAppConfig) blobs;
 *  - the per-device connectionConfig schema version: its own space, decoupled from the app config.
 * Legacy source-version literals with a single definition site (file v9, app v10, the 11.99
 * backup slot) stay in ConfigurationUpgradeService.
 */

/**
 * Remote storage file version — the applicationData URL path segment (ie. .../skip/11) naming
 * the file that contains the configuration slots. Applies only to remote storage; localStorage
 * has no file concept.
 */
export const REMOTE_CONFIG_FILE_VERSION = 11;

/**
 * Current app-config schema version, stamped into `IAppConfig.configVersion` by everything that
 * writes a baseline/current config. ConfigurationUpgradeService deliberately does NOT stamp this:
 * its legacy transforms pin their own MIGRATION_OUTPUT_VERSION so that bumping this constant
 * cannot silently re-label old migration output as current — add a chained migration instead.
 */
export const LATEST_APP_CONFIG_VERSION = 13;

/**
 * Per-device connectionConfig schema version (its own version space, decoupled from the app config
 * version). Only the one-time migration in AppNetworkInitService advances a stored config to this —
 * nothing else may stamp it, or a write would prematurely mark the migration done and lose the lifted
 * remote-control identity.
 */
export const CONNECTION_CONFIG_VERSION = 13;

/** connectionConfig versions this build can load without forcing defaults. */
export const SUPPORTED_CONNECTION_CONFIG_VERSIONS = [11, 12, 13];
