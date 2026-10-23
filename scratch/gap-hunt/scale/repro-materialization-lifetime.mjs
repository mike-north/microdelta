/** Public-port lifecycle controls: no storage, providers or scale claims beyond the selected fixture. */
import { bootstrap, command } from '../contract-surface/repro-support.mjs';
bootstrap();
command(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'scratch/gap-hunt/scale/tsconfig.materialization-lifetime.json']);
command(process.execPath, ['node_modules/eslint/bin/eslint.js', '--config', 'scratch/gap-hunt/scale/materialization-lifetime.eslint.config.mjs', 'scratch/gap-hunt/scale/materialization-lifetime.ts']);
for (const size of [100, 1000]) command(process.execPath, ['--expose-gc', 'scratch/gap-hunt/scale/dist/materialization-lifetime.js', String(size)]);
command(process.execPath, ['--experimental-vm-modules', 'node_modules/jest/bin/jest.js', '--config', 'scratch/gap-hunt/scale/materialization-lifetime.jest.config.mjs', '--runInBand']);
