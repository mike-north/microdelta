/** #154: strict import-only alpha closure with negative and positive control. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { bootstrap, command, root } from './repro-support.mjs';
bootstrap();
const negative = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'scratch/gap-hunt/consumer-dx/tsconfig.alpha-facade.json'], { cwd: root, encoding: 'utf8' });
if (negative.error !== undefined) throw negative.error;
assert.equal(negative.signal, null, 'Compiler terminated by signal; not declaration evidence');
assert.notEqual(negative.status, null, 'Compiler has no exit status; not declaration evidence');
process.stdout.write(negative.stdout);
process.stderr.write(negative.stderr);
assert.notEqual(negative.status, 0, 'Expected facade-only mapping to expose missing transitive alpha closure');
assert.match(negative.stdout, /error TS2305:/u, 'Expected the actual hidden-alpha import diagnostic');
command(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'scratch/gap-hunt/consumer-dx/tsconfig.alpha-six.json']);
console.log('Facade-only alpha mapping fails; explicit six-owner import-only mapping passes. Alpha remains private by PKG-003.');
