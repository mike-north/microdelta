/**
 * Build prerequisites shared by the mutation-control runners and their anchor
 * guard.
 *
 * Some controls plant into Supervision's emitted test build
 * (`packages/supervision/.test-build`), which only Supervision's own
 * `test:unit` produces. That package is tested after the facade, so a runner
 * or guard started on a fresh checkout would otherwise crash with ENOENT.
 * Compiling it is cheap and writes only an ignored build directory, so the
 * consumers compile it themselves instead of depending on workspace order.
 * Larger shared builds (`npm run build`, the facade's own test build) are not
 * rebuilt here: a consumer reports the command that produces them.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * Compile Supervision's test build, or throw with the compiler output. `root`
 * is the repository root.
 */
export function ensureSupervisionTestBuild(root) {
  const tsc = spawnSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.test.json'], { cwd: join(root, 'packages/supervision'), encoding: 'utf8' });
  if (tsc.status !== 0) {
    throw new Error(`compiling Supervision's test build failed; run \`npm run test:unit --workspace @microdelta/supervision\`:\n${tsc.stdout}${tsc.stderr}`);
  }
}
