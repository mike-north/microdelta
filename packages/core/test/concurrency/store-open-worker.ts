/**
 * One opener process for the concurrent first-open test. It waits until a
 * shared start instant so every sibling contends together, opens the durable
 * History over Node's real SQLite capability on the shared file exactly as
 * production assembly does, and reports the outcome as one JSON line: opened,
 * or the class and message of whatever the open threw. It performs no other
 * History operation; only creation of the store is under test.
 * @packageDocumentation
 */
import { openDurableHistory } from '@microdelta/history';
import { createNodeClock, createNodeMachine, createNodeSqlite } from '@microdelta/machine-node';

const [location, store, startAtText] = process.argv.slice(2);
if (location === undefined || store === undefined || startAtText === undefined) {
  throw new Error('store-open worker requires a location, a logical store and a start instant');
}
const startAt = Number(startAtText);

// Spin rather than sleep so every process issues its open at the same instant.
while (Date.now() < startAt) {
  // busy-wait
}

try {
  const history = openDurableHistory({ sqlite: createNodeSqlite(), clock: createNodeClock(), sha256: createNodeMachine(), location, logicalStore: store });
  history.close();
  process.stdout.write(JSON.stringify({ opened: true }));
} catch (error: unknown) {
  const failure = error instanceof Error ? { name: error.name, message: error.message } : { name: 'NonError', message: String(error) };
  process.stdout.write(JSON.stringify({ opened: false, ...failure }));
}
