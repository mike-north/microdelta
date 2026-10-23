/** Optional historical comparison, installed in a disposable tree from the public pinned release. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { bootstrap, command, root } from '../contract-surface/repro-support.mjs';
bootstrap();
command(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'scratch/gap-hunt/scale/tsconfig.context-consumer.json']);
const directory = mkdtempSync(join(tmpdir(), 'microdelta-context-installed-'));
try {
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  const install = spawnSync('npm', ['install', '--save-exact', '--no-audit', '--no-fund', 'microdelta@0.2.0'], { cwd: directory, stdio: 'inherit' });
  if (install.status !== 0) throw new Error('Disposable pinned installation failed');
  const entry = join(directory, 'node_modules/microdelta/dist/src/index.js');
  console.log(JSON.stringify({ package: 'microdelta@0.2.0', entrySha256: createHash('sha256').update(readFileSync(entry)).digest('hex'), lockSha256: createHash('sha256').update(readFileSync(join(directory, 'package-lock.json'))).digest('hex') }));
  for (const isolated of [false, true]) {
    const result = spawnSync(process.execPath, ['--expose-gc', '--loader', './scratch/gap-hunt/scale/context-runtime-loader.mjs', 'scratch/gap-hunt/scale/dist/context-consumer.js', 'fresh', ...(isolated ? ['--isolated'] : [])], { cwd: root, stdio: 'inherit', env: { ...process.env, CONTEXT_MICRODELTA: entry, CONTEXT_RUNS: process.env.CONTEXT_RUNS ?? '300', CONTEXT_BATCH: '100', CONTEXT_STORE: join(directory, `store-${String(isolated)}.sqlite`) } });
    if (result.status !== 0) throw new Error('Installed comparison failed');
  }
} finally { rmSync(directory, { recursive: true, force: true }); }
