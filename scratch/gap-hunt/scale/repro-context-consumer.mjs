/** Offline context diagnostic; no provider or consumer-repository execution. */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { bootstrap, command, root } from '../contract-surface/repro-support.mjs';
if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Use Node 24.x for the durable fixture; pure controls may use Node 26 separately');
bootstrap();
command(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'scratch/gap-hunt/scale/tsconfig.context-consumer.json']);
command(process.execPath, ['node_modules/eslint/bin/eslint.js', '--config', 'scratch/gap-hunt/scale/context-consumer.eslint.config.mjs', 'scratch/gap-hunt/scale/context-consumer.ts']);
command(process.execPath, ['--experimental-vm-modules', 'node_modules/jest/bin/jest.js', '--config', 'scratch/gap-hunt/scale/context-consumer.jest.config.mjs', '--runInBand']);
for (const [mode, isolated] of [['unentered', false], ['tracking', false], ['tracking', true], ['fresh', false], ['fresh', true]]) {
  command(process.execPath, ['--expose-gc', 'scratch/gap-hunt/scale/dist/context-consumer.js', mode, ...(isolated ? ['--isolated'] : [])]);
}
if (process.argv.includes('--fresh-process-control')) {
  const samples = [];
  for (let batch = 0; batch < 30; batch += 1) {
    const child = spawnSync(process.execPath, ['--expose-gc', 'scratch/gap-hunt/scale/dist/context-consumer.js', 'tracking'], { cwd: root, encoding: 'utf8', env: { ...process.env, CONTEXT_MICRODELTA: undefined, CONTEXT_RUNS: '100', CONTEXT_BATCH: '100' } });
    if (child.status !== 0) throw new Error(child.stderr);
    const line = child.stdout.trim();
    samples.push({ batch, ...JSON.parse(line) });
  }
  writeFileSync(new URL('./logs/context-fresh-process.json', import.meta.url), JSON.stringify(samples, null, 2));
}
