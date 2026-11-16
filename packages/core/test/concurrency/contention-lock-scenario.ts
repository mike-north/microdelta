/** Deliberately broken lock-holder behaviors used to verify C3 cleanup paths. */
import { createNodeSqlite } from '@microdelta/machine-node';

const location = process.argv[2];
const scenario = process.argv[3];
if (location === undefined || scenario === undefined) { throw new Error('lock scenario requires a location and case'); }

if (scenario === 'delayed-unexpected-ready') {
  // Exercise whether the parent preserves its protocol assertion after worker startup is slow.
  setTimeout(() => process.send?.({ kind: 'not-locked' }), 300);
} else if (scenario === 'exit-before-ready') {
  process.exit(17);
}

if (scenario === 'unexpected-ready') {
  process.send?.({ kind: 'not-locked' });
} else if (scenario === 'no-ready') {
  // A bounded natural exit keeps the no-cleanup mutant self-cleaning after its assertion fails.
  setTimeout(() => process.exit(0), 350);
} else if (scenario === 'ignore-release' || scenario === 'exit-nonzero-after-release' || scenario === 'signal-after-release') {
  const connection = createNodeSqlite().openSqlite(location);
  connection.exec('BEGIN IMMEDIATE');
  process.send?.({ kind: 'locked' });
  process.on('message', (message: unknown) => {
    if (scenario === 'ignore-release' || typeof message !== 'object' || message === null || !('kind' in message) || message.kind !== 'release') { return; }
    connection.exec('ROLLBACK');
    connection.close();
    if (scenario === 'exit-nonzero-after-release') { process.exit(1); }
    process.kill(process.pid, 'SIGTERM');
  });
} else if (scenario !== 'no-ready' && scenario !== 'delayed-unexpected-ready') {
  throw new Error(`unknown lock scenario ${scenario}`);
}

setInterval(() => undefined, 1_000);
