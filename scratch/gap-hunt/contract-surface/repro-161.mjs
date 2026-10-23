/** #161: establish current runtime behavior, then fail stale map assertions. */
import { bootstrap, command } from './repro-support.mjs';
bootstrap();
command(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'packages/core/tsconfig.test.json']);
command(process.execPath, ['--experimental-vm-modules', 'node_modules/jest/bin/jest.js', '--config', 'packages/core/jest.config.mjs', '--runInBand', '--runTestsByPath', 'packages/core/.test-build/test/workspace-operations/operations.test.js']);
command('npm', ['run', 'build:examples']);
command(process.execPath, ['--test', 'examples/contribution-report/test/example.test.mjs']);
command(process.execPath, ['--test', 'scratch/gap-hunt/contract-surface/package-map.test.mjs']);
