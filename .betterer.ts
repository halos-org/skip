import { typescript } from '@betterer/typescript';

// tsconfig.strict.json is the single source of the strict compiler options.
// Betterer ignores that config's own include/exclude and uses the globs below,
// so they must mirror its file scope (all app sources, no specs, no test setup).
export default {
  'strictNullChecks': () =>
    typescript('./tsconfig.strict.json')
      .include('./src/**/*.ts')
      .exclude(/\.spec\.ts$/, /(^|\/)test\.ts$/),
};
