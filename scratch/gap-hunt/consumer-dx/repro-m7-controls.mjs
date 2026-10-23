/** Portable current consumer controls; these do not establish full M7 acceptance. */
import { bootstrap, command } from '../contract-surface/repro-support.mjs';
if (Number(process.versions.node.split('.')[0]) !== 24) {
  throw new Error('Use Node 24.x for the pinned native dependency and fixture boundary');
}
console.log('M7 diagnostic: authored cumulative snapshots only; not full paginated roster acceptance.');
bootstrap();
command(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'scratch/gap-hunt/consumer-dx/tsconfig.m7-controls.json']);
command(process.execPath, ['node_modules/eslint/bin/eslint.js', '--config', 'scratch/gap-hunt/consumer-dx/eslint.config.mjs', 'scratch/gap-hunt/consumer-dx/pipeline.ts']);
command(process.execPath, ['--experimental-vm-modules', 'node_modules/jest/bin/jest.js', '--config', 'scratch/gap-hunt/consumer-dx/jest.config.mjs', '--runInBand']);
