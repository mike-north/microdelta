import base from '../../../eslint.config.mjs';
const typed = base.find(config => config.rules !== undefined);
export default [base[0], { ...typed, files: ['scratch/gap-hunt/review-198-repair/**/*.ts'], languageOptions: { ...typed.languageOptions, parserOptions: { project: './scratch/gap-hunt/review-198-repair/tsconfig.json', tsconfigRootDir: import.meta.dirname + '/../../..' } } }];
