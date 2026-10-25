/**
 * On-demand discrimination of the facade's post-send lease-loss assertions.
 * Each fault removes one History ownership guard from emitted output only.
 * Exact suite/title/status checks reject crashes, setup failures and unrelated
 * assertion failures as evidence. Every run is bounded and original bytes are
 * restored on completion, exceptions and ordinary termination signals.
 *
 * Run after package build and Core test compilation:
 * node packages/core/test/stop/controls/lease-drain-mutation-controls.mjs
 * `--check-anchors` participates in the repository's automatic drift check.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { anchorCheckRequested, anchorProblems, reportAnchorCheck } from '../../durable-history/controls/anchor-check.mjs';
import { judgeRun } from '../../durable-history/controls/control-outcome.mjs';

/** Resolve targets from this runner, independent of the caller's directory. */
const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const target = join(root, 'packages/history/dist/src/durable/index.js');
const original = readFileSync(target, 'utf8');
/** Each omitted guard must be rejected by its own post-send scenario. */
const controls = [
  { name: 'expiry check omitted', anchor: 'else if (writer.expiresAt <= now) {', replacement: 'else if (false) {', scenario: 'the lease simply expires' },
  { name: 'holder and fence check omitted', anchor: 'if (writer.holder !== lease.holder || writer.lastFence !== lease.fence) {', replacement: 'if (false) {', scenario: 'a successor takes the lease over' },
];
const problems = anchorProblems(controls.map((control) => ({ control: control.name, file: target, text: original, anchor: control.anchor })));
if (anchorCheckRequested()) { process.exit(reportAnchorCheck(problems, controls.length)); }
assert.deepEqual(problems, [], 'every planted guard must have one exact anchor');
const temporary = mkdtempSync(join(tmpdir(), 'microdelta-lease-control-'));

/** Restore authoritative output bytes before any subsequent command uses them. */
function restore() { writeFileSync(target, original); }
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.once(signal, () => { restore(); process.exit(1); });
}

/** Run exactly the two drain cases; a timeout or incomplete report is not rejection evidence. */
function run(name, expectedTitles) {
  const report = join(temporary, `${name}.json`);
  const result = spawnSync(process.execPath, [
    '--experimental-vm-modules', join(root, 'node_modules/jest/bin/jest.js'),
    '--config', join(root, 'packages/core/jest.config.mjs'), '--runInBand',
    '--testPathPatterns', 'stop/lease-drain.test', '--json', '--outputFile', report,
  ], { cwd: root, encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL' });
  assert.equal(result.error, undefined, `${name}: child did not finish normally`);
  assert.equal(result.signal, null, `${name}: child was killed`);
  return judgeRun({ exitStatus: result.status, reportText: readFileSync(report, 'utf8'), expectedTitles, suites: ['lease-drain.test.js'] });
}

try {
  const baseline = run('baseline');
  assert.equal(baseline.titles.size, 2);
  assert.deepEqual(baseline.failed, []);
  for (const control of controls) {
    try {
      writeFileSync(target, original.replace(control.anchor, control.replacement));
      const judged = run(control.name.replaceAll(' ', '-'), baseline.titles);
      assert.equal(judged.failed.length, 1, 'only the scenario whose guard was omitted must fail');
      const title = judged.failed[0];
      assert.ok(title.includes(control.scenario));
      const message = judged.failureMessages.get(title) ?? '';
      assert.match(message, /lease-lost/u, 'the intended terminal denial assertion must reject the fault');
      assert.match(message, /published/u, 'the fault must actually authorize late publication');
      assert.doesNotMatch(message, /timed out|Run ended before/u, 'setup failure cannot reject a publication control');
      console.log(`${control.name}: rejected by ${title}`);
    } finally { restore(); }
    assert.equal(readFileSync(target, 'utf8'), original, 'emitted output must be restored exactly');
  }
  assert.deepEqual(run('restored', baseline.titles).failed, []);
  console.log('Restored facade lease-drain suite: 2 passed');
} finally {
  restore();
  assert.equal(readFileSync(target, 'utf8'), original);
  rmSync(temporary, { recursive: true, force: true });
}
