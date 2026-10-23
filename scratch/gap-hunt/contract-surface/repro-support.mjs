/** Clean-checkout issue replays use only Node, npm and checked-in repo tools. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export const root = fileURLToPath(new URL('../../../', import.meta.url));
export function command(executable, args) {
  console.log(`$ ${executable} ${args.join(' ')}`);
  const result = spawnSync(executable, args, { cwd: root, stdio: 'inherit' });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
export function bootstrap() {
  if (process.env.GAP_HUNT_REUSE_BUILD !== '1') {
    command('npm', ['ci']);
    command('npm', ['run', 'build:packages']);
  }
}
export function jestRepro(name) {
  bootstrap();
  command(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'packages/core/tsconfig.test.json']);
  command(process.execPath, ['--experimental-vm-modules', 'node_modules/jest/bin/jest.js', '--config', 'packages/core/jest.config.mjs', '--runInBand', '--runTestsByPath', `packages/core/.test-build/test/gap-hunt-scale/${name}.test.js`]);
}
