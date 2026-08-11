/* Test shim for chartjs-plugin-annotation (aliased in vitest.config.ts). A distinct object so a
 * spec asserting the registered plugin union can tell it from the streaming plugin. */
export default { id: 'annotation-shim' };
