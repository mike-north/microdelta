/** External corruption characterization on copies of a disposable acknowledged store.
 * Checksums are intentionally not repaired: this is not process-crash durability.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
const root = resolve('.');
const { openHistory } = await import(pathToFileURL(join(root, 'packages/core/.test-build/test/durable-history/support.js')));
const temporary = mkdtempSync(join(tmpdir(), 'microdelta-committed-wal-'));
const location = join(temporary, 'original.sqlite');
const scope = { analysis: 'analysis:contributors', environment: 'env:fixture' };
const request = { ...scope, subject: 'gap-hunt:wal-corruption', version: 1, attemptKey: 'acknowledged', intentDigest: 'intent:acknowledged' };
const payload = { value: 'acknowledged synthetic payload', nested: { unicode: '日本語' } };
const script = { location, store: 'store:contributors', steps: [{ op: 'time', at: 1000 }, { op: 'acquire', holder: 'wal-diagnostic', lease: 60000 }, { op: 'allocate', request }, { op: 'stage', payload, label: 'wal-diagnostic' }, { op: 'publish' }, { op: 'kill' }] };
const scriptPath = join(temporary, 'script.json');
writeFileSync(scriptPath, JSON.stringify(script));
const child = spawnSync(process.execPath, ['packages/core/.test-build/test/gap-hunt-durability-worker.js', scriptPath], { cwd: root, encoding: 'utf8' });
assert.equal(child.signal, 'SIGKILL');
const trace = child.stdout.trim().split('\n').map(line => JSON.parse(line));
const publication = trace.find(entry => entry.op === 'publish');
assert.equal(publication.ok, true);
const reference = publication.value;
const database = readFileSync(location);
const originalWal = readFileSync(`${location}-wal`);
const pageSizeWord = originalWal.readUInt32BE(8);
const pageSize = pageSizeWord === 1 ? 65536 : pageSizeWord;
const frameSize = 24 + pageSize;
assert.equal((originalWal.length - 32) % frameSize, 0);
const commits = [];
for (let offset = 32, index = 1; offset + frameSize <= originalWal.length; offset += frameSize, index++) {
  if (originalWal.readUInt32BE(offset + 4) !== 0) commits.push({ index, offset, page: originalWal.readUInt32BE(offset), databasePages: originalWal.readUInt32BE(offset + 4) });
}
const frame = commits.at(-1);
assert.ok(frame);
const mutationOffset = frame.offset + 24 + 100;
const damagedWal = Buffer.from(originalWal);
damagedWal[mutationOffset] ^= 1;
assert.equal(originalWal.filter((byte, index) => byte !== damagedWal[index]).length, 1);
const snapshot = bytes => ({ bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), gzipBase64: gzipSync(bytes).toString('base64') });
const outcomes = {};
for (const [name, wal] of [['intact', originalWal], ['corrupt', damagedWal]]) {
  const directory = join(temporary, name);
  mkdirSync(directory);
  const copy = join(directory, 'store.sqlite');
  writeFileSync(copy, database);
  writeFileSync(`${copy}-wal`, wal);
  // No shared-memory file is copied: SQLite must reconstruct its own WAL index.
  let history;
  const outcome = {};
  try {
    history = openHistory({ location: copy });
    outcome.open = 'ok';
    for (const [operation, run] of [['recover', () => history.recoverAttempt(request)], ['current', () => history.readCurrent({ ...scope, subject: request.subject })], ['read', () => history.reader.readSubtree(reference, [])]]) {
      try { const value = run(); outcome[operation] = value === undefined ? { ok: true, valueKind: 'undefined' } : { ok: true, value }; }
      catch (error) { outcome[operation] = { ok: false, name: error.name, code: error.code, message: error.message }; }
    }
  } catch (error) { outcome.open = { name: error.name, code: error.code, message: error.message }; }
  finally { history?.close(); }
  outcomes[name] = outcome;
}
assert.equal(outcomes.intact.open, 'ok');
assert.deepEqual(outcomes.intact.read, { ok: true, value: payload });
assert.deepEqual(outcomes.intact.recover.value.reference, reference);
assert.deepEqual(outcomes.intact.current.value, reference);
assert.deepEqual(readFileSync(location), database);
assert.deepEqual(readFileSync(`${location}-wal`), originalWal);
const report = { command: 'npx tsc -p packages/core/tsconfig.test.json && node scratch/gap-hunt/contract-operations/diagnose-committed-wal.mjs', node: process.version, platform: process.platform, arch: process.arch, temporary, script, child: { signal: child.signal, status: child.status, trace, stderr: child.stderr }, reference, pageSize, frameCount: (originalWal.length - 32) / frameSize, committedFrames: commits, mutation: { ...frame, mutationOffset, before: originalWal[mutationOffset], after: damagedWal[mutationOffset], checksumRepaired: false }, snapshots: { database: snapshot(database), originalWal: snapshot(originalWal), damagedWal: snapshot(damagedWal) }, outcomes, incorrectPayloadPresentedValid: outcomes.corrupt.read?.ok === true && JSON.stringify(outcomes.corrupt.read.value) !== JSON.stringify(payload) };
writeFileSync('scratch/gap-hunt/contract-operations/committed-wal-result.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, snapshots: Object.fromEntries(Object.entries(report.snapshots).map(([key, value]) => [key, { bytes: value.bytes, sha256: value.sha256 }])) }, null, 2));
