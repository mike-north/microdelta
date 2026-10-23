/** Portable clean-checkout reproduction; baseline ends with one intended runtime assertion failure. */
import { bootstrap, command } from '../contract-surface/repro-support.mjs';
if (Number(process.versions.node.split('.')[0]) !== 24) {
  throw new Error('Use Node24.x for the pinned native dependency and reproduced fixture boundary');
}
bootstrap();
command(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'scratch/gap-hunt/consumer-dx/tsconfig.custom-key.json']);
command(process.execPath, ['node_modules/eslint/bin/eslint.js', 'scratch/gap-hunt/consumer-dx/custom-key.ts']);
command(process.execPath, ['--test', 'scratch/gap-hunt/consumer-dx/custom-key.test.mjs']);
