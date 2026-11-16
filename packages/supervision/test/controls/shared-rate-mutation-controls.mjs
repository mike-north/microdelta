/**
 * Discrimination proof for #238's synchronous send boundary. Each plant changes
 * only emitted Supervision code, runs the unchanged outcome suite, and requires
 * its named direct assertion to fail. Baseline/restored runs must pass; timeouts,
 * runtime errors, skipped tests and missing results never count as evidence.
 *
 * Run after test:unit has emitted the production modules and tests:
 * node test/controls/shared-rate-mutation-controls.mjs
 * --check-anchors is the ordinary CI drift check and performs no mutation.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { judgeRun } from '../../../core/test/durable-history/controls/control-outcome.mjs';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const build = join(packageRoot, '.test-build/src');
const controls = [
  { name: 'final stop', file: 'execution.js', anchor: 'const beforeDispatch = sendRefusal(retry);', replacement: 'const beforeDispatch = undefined;', expected: 'a hard stop re-entering the final fenced journal callback' },
  { name: 'final fence', file: 'operation-engine.js', anchor: 'current = write(lease, latest.record, latest.revision);', replacement: 'void latest;', expected: 'a begin observer that invalidates the fence' },
  { name: 'final allowance', file: 'operation-engine.js', anchor: '|| spentInRun(latest.record) > request.maxAttempts', replacement: '|| false', expected: 'allowance changed by the begin observer' },
  { name: 'final shared gate', file: 'operation-engine.js', anchor: 'const result = reservation.commitPossibleSend();', replacement: "const result = { kind: 'committed' };", expected: 'a gate becoming blocked in the begin observer' },
  { name: 'confirmed intent', file: 'operation-engine.js', anchor: "if (confirmation !== 'recorded' && confirmation !== 'duplicate') {", replacement: 'if (false) {', expected: 'a usage intent without explicit durability confirmation' },
  { name: 'independent access scopes', file: 'shared-rate-coordinator.js', anchor: 'const scope = [declaration.environment, declaration.service, declaration.accessContext];', replacement: "const scope = [declaration.environment, declaration.service, 'collapsed-access'];", expected: 'two paths and new runs share a fixed gate while an independent account progresses' },
];
const originals = new Map(controls.map((control) => [control.file, readFileSync(join(build, control.file), 'utf8')]));
for (const control of controls) {
  const count = originals.get(control.file).split(control.anchor).length - 1;
  if (count !== 1) { throw new Error(`${control.name}: expected one emitted anchor, found ${String(count)}`); }
}
if (process.argv.length === 3 && process.argv[2] === '--check-anchors') {
  console.log(`Shared dispatch: ${String(controls.length)} unique mutation anchors`);
  process.exit(0);
}
if (process.argv.length !== 2) { throw new Error('Unsupported shared dispatch control option'); }
const directory = mkdtempSync(join(tmpdir(), 'microdelta-shared-dispatch-controls-'));
let sequence = 0;

/** Restore every planted file byte-for-byte, including on a failed control. */
function restore() {
  for (const [file, original] of originals) { writeFileSync(join(build, file), original); }
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.once(signal, () => { restore(); process.exit(1); });
}

/** Judge one complete owner outcome suite without accepting setup/runtime failures. */
function run(expectedTitles) {
  sequence += 1;
  const report = join(directory, `${String(sequence)}.json`);
  const child = spawnSync(process.execPath, ['--experimental-vm-modules', join(root, 'node_modules/jest/bin/jest.js'),
    '--config', join(packageRoot, 'jest.config.mjs'), '--runInBand', '--runTestsByPath', join(packageRoot, '.test-build/test/operations.test.js'), '--json', '--outputFile', report,
  ], { cwd: packageRoot, encoding: 'utf8', timeout: 30_000 });
  if (child.error !== undefined) { throw child.error; }
  return judgeRun({ exitStatus: child.status, reportText: readFileSync(report, 'utf8'), expectedTitles, suites: ['operations.test.js'] });
}

try {
  const baseline = run();
  if (baseline.failed.length !== 0) { throw new Error('Shared dispatch baseline failed'); }
  for (const control of controls) {
    restore();
    writeFileSync(join(build, control.file), originals.get(control.file).replace(control.anchor, control.replacement));
    const result = run(baseline.titles);
    const direct = result.failed.find((title) => title.includes(control.expected));
    const message = direct === undefined ? '' : result.failureMessages.get(direct) ?? '';
    if (direct === undefined || !message.includes('expect(received)') || /timed out|Exceeded timeout/iu.test(message)) {
      throw new Error(`${control.name}: the expected direct outcome assertion did not reject the plant`);
    }
    console.log(`REJECTED ${control.name}: ${direct}`);
  }
  restore();
  const restored = run(baseline.titles);
  if (restored.failed.length !== 0) { throw new Error('Restored shared dispatch suite failed'); }
  console.log(`Restored ${String(restored.titles.size)} owner assertions pass`);
} finally {
  restore();
  for (const [file, original] of originals) {
    if (readFileSync(join(build, file), 'utf8') !== original) { throw new Error(`Failed to restore ${file}`); }
  }
  rmSync(directory, { recursive: true, force: true });
}
