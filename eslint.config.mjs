import tseslint from 'typescript-eslint';

import { dependencyBoundaries } from './tooling/dependencies.mjs';

/** DR-1 applies to every component from the first source file onward. */
export default [
  { ignores: ['**/dist/**', '**/.test-build/**', '**/node_modules/**'] },
  {
    files: ['packages/core/**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    plugins: { microdelta: { rules: { 'dependency-boundaries': dependencyBoundaries } } },
    rules: { 'microdelta/dependency-boundaries': 'error', curly: ['error', 'all'], 'no-var': 'error', 'prefer-const': 'error' },
  },
];
