/** Reproduce the generated-type rejection, then independently verify JavaScript runtime controls. */
import { spawnSync } from 'node:child_process';
import { bootstrap, command, root } from '../contract-surface/repro-support.mjs';
if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Use Node 24.x for the pinned native fixture boundary');
bootstrap();
const compile = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'scratch/gap-hunt/consumer-dx/tsconfig.async-source.json'], { cwd: root, encoding: 'utf8' });
process.stdout.write(compile.stdout);
process.stderr.write(compile.stderr);
if (compile.status !== 0 && (compile.status !== 2 || (compile.stdout.match(/error TS2322:/gu) ?? []).length !== 4 || (compile.stdout.match(/error TS\d+:/gu) ?? []).length !== 4)) throw new Error('Expected only four async source callback type rejections (direct/template fresh/retain)');
console.log(compile.status === 0 ? 'Async source type acceptance passed.' : 'Declaration gap: direct and template async fresh/retain rejected; matching sync controls accepted.');
command(process.execPath, ['node_modules/tsd/dist/cli.js', 'scratch/gap-hunt/consumer-dx', '--files', 'async-source.test-d.ts']);
command(process.execPath, ['node_modules/eslint/bin/eslint.js', '--config', 'scratch/gap-hunt/consumer-dx/async-source.eslint.config.mjs', 'scratch/gap-hunt/consumer-dx/async-source.ts']);
command(process.execPath, ['--experimental-vm-modules', 'node_modules/jest/bin/jest.js', '--config', 'scratch/gap-hunt/consumer-dx/async-source.jest.config.mjs', '--runInBand']);

// Preserve the actual acceptance result: baseline red becomes green when declarations are repaired.
process.exitCode = compile.status ?? 1;
