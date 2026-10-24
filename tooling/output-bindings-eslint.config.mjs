/**
 * Type-aware lint for the pinned generated-alpha output binding consumer.
 * Its dedicated program keeps unrelated historical gap-hunt probes out of
 * the active acceptance gate.
 */
import tseslint from 'typescript-eslint';

export default [{
  files: ['**/output-bindings.ts'],
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      project: ['./scratch/gap-hunt/consumer-dx/tsconfig.output-bindings.json'],
      tsconfigRootDir: process.cwd(),
    },
  },
  plugins: { '@typescript-eslint': tseslint.plugin },
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-unsafe-assignment': 'error',
    '@typescript-eslint/no-unsafe-call': 'error',
    '@typescript-eslint/no-unsafe-member-access': 'error',
    '@typescript-eslint/no-unsafe-return': 'error',
    '@typescript-eslint/no-unsafe-argument': 'error',
  },
}];
