/** Deliberately broken lock-holder behaviors used to verify C3 cleanup paths. */
import { createNodeSqlite } from '@microdelta/machine-node';

const location = process.argv[2];
const scenario = process.argv[3];
if (location === undefined || scenario === undefined) { throw new Error('lock scenario requires a location and case'); }

if (scenario === 'exit-before-ready') {
  process.exit(17);
}

if (scenario === 'unexpected-ready') {
  process.send?.({ kind: 'not-locked' });
} else if (scenario === 'no-ready') {
  // A bounded natural exit keeps the no-cleanup mutant self-cleaning after its assertion fails.
  setTimeout(() => process.exit(0), 350);
} else if (scenario === 'ignore-release') {
  const connection = createNodeSqlite().openSqlite(location);
  connection.exec('BEGIN IMMEDIATE');
  process.send?.({ kind: 'locked' });
  process.on('message', () => undefined);
} else if (scenario !== 'no-ready') {
  throw new Error(`unknown lock scenario ${scenario}`);
}

setInterval(() => undefined, 1_000);
