/** Current-component lifecycle regression: expected red until an internal repair. */
import { bootstrap, command } from '../contract-surface/repro-support.mjs';
bootstrap();
command(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'scratch/gap-hunt/scale/tsconfig.context-consumer.json']);
command(process.execPath, ['node_modules/eslint/bin/eslint.js', '--config', 'scratch/gap-hunt/scale/context-consumer.eslint.config.mjs', 'scratch/gap-hunt/scale/context-consumer.ts']);
command(process.execPath, ['--experimental-vm-modules', 'node_modules/jest/bin/jest.js', '--config', 'scratch/gap-hunt/scale/context-component.jest.config.mjs', '--runInBand']);
