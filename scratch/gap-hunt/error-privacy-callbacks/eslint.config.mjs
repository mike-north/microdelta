/** Apply repository type-aware rules to the generated-declaration consumer. */
import base from '../../../eslint.config.mjs';
const typed = base.find(config => config.rules !== undefined);
export default [base[0], { ...typed, files: ['scratch/gap-hunt/error-privacy-callbacks/*.ts'], languageOptions: { ...typed.languageOptions, parserOptions: { project: './scratch/gap-hunt/error-privacy-callbacks/tsconfig.json', tsconfigRootDir: import.meta.dirname + '/../../..' } } }];
