/** Lint the intentionally rejected type consumer without weakening type-aware rules. */
import base from './eslint.config.mjs';
export default base.map(config => ({ ...config, languageOptions: { ...config.languageOptions, parserOptions: { ...config.languageOptions.parserOptions, project: ['./scratch/gap-hunt/consumer-dx/tsconfig.async-source.json'] } } }));
