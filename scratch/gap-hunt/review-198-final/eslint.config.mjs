import base from '../../../eslint.config.mjs';
const typed = base.find(config => config.rules !== undefined);
export default [base[0], { ...typed, files: ['scratch/gap-hunt/review-198-final/**/*.ts'], languageOptions: { ...typed.languageOptions, parserOptions: { project: './scratch/gap-hunt/review-198-final/tsconfig.json', tsconfigRootDir: import.meta.dirname + '/../../..' } } }];
