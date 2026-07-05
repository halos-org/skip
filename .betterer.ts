import { typescript } from '@betterer/typescript';

export default {
  'strictNullChecks': () =>
    typescript('./tsconfig.strict.json', {
      strictNullChecks: true,
      noEmit: true,
    })
      .include('./src/**/*.ts')
      .exclude(/\.spec\.ts$/),
};
