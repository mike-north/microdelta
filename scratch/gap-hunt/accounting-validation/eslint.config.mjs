import base from '../../../eslint.config.mjs';
const typed=base[1];
export default [{...typed,files:['scratch/gap-hunt/accounting-validation/*.ts'],languageOptions:{...typed.languageOptions,parserOptions:{project:['./scratch/gap-hunt/accounting-validation/tsconfig.json'],tsconfigRootDir:process.cwd()}}}];
