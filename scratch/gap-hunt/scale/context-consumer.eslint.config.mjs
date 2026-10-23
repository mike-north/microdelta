import base from '../consumer-dx/eslint.config.mjs';
export default base.map(config => ({ ...config, languageOptions: { ...config.languageOptions, parserOptions: { ...config.languageOptions.parserOptions, project: ['./scratch/gap-hunt/scale/tsconfig.context-consumer.json'] } } }));
