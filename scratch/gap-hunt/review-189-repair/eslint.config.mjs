/** Apply the repository's real type-aware rules to the frozen consumer rather than accepting an ignored file. */
import base from '../../../eslint.config.mjs';
const typed = base.find(config => config.rules !== undefined);
export default [base[0], { ...typed, files: ['scratch/gap-hunt/consumer-dx/custom-key.ts'], languageOptions: { ...typed.languageOptions, parserOptions: { project: './scratch/gap-hunt/consumer-dx/tsconfig.custom-key.json', tsconfigRootDir: import.meta.dirname + '/../../..' } } }];
