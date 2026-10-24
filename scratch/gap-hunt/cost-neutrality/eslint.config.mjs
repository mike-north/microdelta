import base from '../../../eslint.config.mjs';
const typed=base[1];
export default [{...typed,files:['scratch/gap-hunt/cost-neutrality/*.ts'],languageOptions:{...typed.languageOptions,parserOptions:{project:['./scratch/gap-hunt/cost-neutrality/tsconfig.json'],tsconfigRootDir:process.cwd()}}}];
