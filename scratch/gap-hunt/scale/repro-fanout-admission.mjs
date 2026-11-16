/** Clean replay: bounded synthetic roster, real workspace admission/window, no provider. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrap, command, root } from '../contract-surface/repro-support.mjs';
bootstrap();
// Only the PR runner supplies this mode after verifying the prepared bundle.
// Default local execution still compiles and lints before the ordered gate.
if (!process.argv.includes('--prepared')) {
  command(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'scratch/gap-hunt/scale/tsconfig.fanout-admission.json']);
  command(process.execPath, ['node_modules/eslint/bin/eslint.js', '--config', 'scratch/gap-hunt/scale/fanout-admission.eslint.config.mjs', 'scratch/gap-hunt/scale/fanout-admission.ts']);
}
const directory = mkdtempSync(join(tmpdir(), 'microdelta-fanout-matrix-'));
try {
  for (const [size, window, phase] of [[100, 1, 'admission'], [1000, 1, 'admission'], [100, 8, 'admission'], [1000, 8, 'admission'], [8, 8, 'admission'], [100, 8, 'body']]) {
    const result = spawnSync(process.execPath, ['--expose-gc', 'scratch/gap-hunt/scale/dist/fanout-admission.js', String(size), String(window), phase, join(directory, `store-${size}-${window}-${phase}.sqlite`)], { cwd: root, encoding: 'utf8', timeout: 120000 });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    if (result.status !== 0) throw new Error('Fanout matrix failed');
  }
} finally { rmSync(directory, { recursive: true, force: true }); }
command(process.execPath, ['--experimental-vm-modules', 'node_modules/jest/bin/jest.js', '--config', 'scratch/gap-hunt/scale/fanout-admission.jest.config.mjs', '--runInBand']);
