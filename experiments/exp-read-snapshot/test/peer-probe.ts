/** Isolate pre-repair event-callback throws while independently terminating every actual fault-test child. */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { qualificationBounds } from '../src/protocol.js';
import { cleanup, Peer } from './coordinator.js';
import { isRecord } from './transport.js';

/** These opaque disposable paths are supplied by the parent assertion, never by a candidate consumer. */
const root = process.argv[2]; const mode = process.argv[3];
if (root === undefined || mode === undefined) { throw new TypeError('Expected finite probe root and fault'); }
/** The injected first/secondary objects can be compared by identity only inside this process. */
const primary = new Error(`artifact:${mode}`); const secondary = new Error('artifact:exit-secondary');
/** Actual worker ownership is checked separately from constructor success and eventual process disappearance. */
const owned = new Set<Peer>();
let peer: Peer | undefined; let pid: number | undefined; let ownedBeforeFault = false;
let first: unknown; let rejected = false; let uncaught = false; let finalizing = false; let exitedSettled = false;
/** The containment deadline is outside Peer and can clean up even its pre-repair constructor gap. */
const deadline = setTimeout(() => { void finish(); }, 2_000);

/** PID existence is an independent process fact, not a transport acknowledgment. */
function alive(): boolean {
  if (pid === undefined) { return false; }
  try { process.kill(pid, 0); return true; } catch { return false; }
}
/** Keep a short finite interval while waiting for a child killed by either ownership layer to disappear. */
async function gone(): Promise<boolean> {
  const end = Date.now() + 1_000;
  while (alive() && Date.now() < end) { await new Promise<void>(resolve => setTimeout(resolve, 10)); }
  return !alive();
}
/** Report original-error identity, callback containment and actual termination after every tested failure stage. */
async function finish(): Promise<void> {
  if (finalizing) { return; } finalizing = true; clearTimeout(deadline);
  if (peer !== undefined) {
    peer.exited.then(() => { exitedSettled = true; }).catch(() => undefined);
    await cleanup([peer], 500);
  }
  if (alive() && pid !== undefined) { try { process.kill(pid, 'SIGKILL'); } catch { /* Independent containment may race an already exited child. */ } }
  const terminated = await gone();
  const state: unknown = peer;
  const facts = isRecord(state) && isRecord(state.failureFacts) ? state.failureFacts : undefined;
  const later = facts !== undefined && Array.isArray(facts.secondary) ? facts.secondary : [];
  process.stdout.write(`${JSON.stringify({ kind: 'result', mode, pid, ownedBeforeFault, constructed: peer !== undefined,
    rejected, primaryIdentity: first === primary, uncaught, exitedSettled, terminated,
    retainedPrimaryIdentity: facts?.primary === primary, retainedSecondaryIdentity: later.some((value: unknown) => value === secondary) })}\n`);
  process.exit(0);
}
/** Old callback bugs are contained here so a behavioral RED cannot crash Jest or abandon its worker. */
process.on('uncaughtException', (error: unknown) => { uncaught = true; first ??= error; void finish(); });
try {
  mkdirSync(join(root, mode), { recursive: true });
  peer = new Peer('control', join(root, mode), join(root, 'proof'), owned, { value: 0 }, qualificationBounds, {
    entrypoint: fileURLToPath(new URL('./peer-fixture.js', import.meta.url)),
    artifact: (path, data, persistence): void => {
      if (path.endsWith('/process.json')) {
        const value: unknown = JSON.parse(typeof data === 'string' ? data : Buffer.from(data).toString());
        if (!isRecord(value) || typeof value.pid !== 'number') { throw new TypeError('Missing actual spawned PID'); }
        pid = value.pid; process.stdout.write(`${JSON.stringify({ kind: 'spawned', pid })}\n`);
      }
      const target = mode === 'primary-secondary' ? 'records.jsonl' : `${mode === 'records' ? 'records.jsonl' : mode === 'stderr' ? 'stderr.log' : mode === 'exit' ? 'exit.json' : 'process.json'}`;
      if (path.endsWith(`/${target}`) && ['process', 'records', 'stderr', 'exit', 'primary-secondary'].includes(mode)) {
        ownedBeforeFault = owned.size === 1; throw primary;
      }
      if (mode === 'primary-secondary' && path.endsWith('/exit.json')) { throw secondary; }
      if (persistence === 'append') { appendFileSync(path, data); } else { writeFileSync(path, data); }
    },
  });
  await peer.finish();
} catch (error: unknown) { rejected = true; first = error; }
await finish();
