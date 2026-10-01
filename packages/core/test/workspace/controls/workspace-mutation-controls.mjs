/**
 * Behavioral discrimination controls for the workspace run path (issue #57).
 * Each control plants exactly one wrong behavior into an emitted build (never
 * TypeScript source): Supervision's `dist` together with its own test build
 * (which its owner suite imports), the facade's test build that the assembly
 * suites import, or the example's `dist`. It then runs the unchanged
 * suites — Supervision's owner suite, the facade's workspace assembly suites
 * and the example's CLI verification — and records which named tests fail.
 * A control whose anchor does not match exactly once, or that no test
 * rejects, fails the run. Jest runs are judged fail-closed by the facade's
 * shared `control-outcome.mjs`; the example's `node --test` run is judged by
 * its TAP results against the baseline titles. Every planted file is restored
 * after its control, on error, and on SIGINT/SIGTERM/SIGHUP, and the final
 * bytes are compared with the originals. A SIGKILL cannot be intercepted;
 * rebuilding restores the files.
 *
 * It is an on-demand evidence command, not part of `npm test`: run
 * `npm run build`, `npm run test:unit --workspace @microdelta/supervision` and
 * `npm run test:unit --workspace microdelta` first, then
 * `node packages/core/test/workspace/controls/workspace-mutation-controls.mjs`.
 * Controls must run serially.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { judgeRun } from '../../durable-history/controls/control-outcome.mjs';

const root = new URL('../../../../../', import.meta.url).pathname;

/** Emitted files a control plants into, per target; each file must contain the anchor exactly once. */
const targets = Object.freeze({
  supervision: [join(root, 'packages/supervision/dist/src/supervision.js'), join(root, 'packages/supervision/.test-build/src/supervision.js')],
  workspace: [join(root, 'packages/core/.test-build/src/workspace.js')],
  writer: [join(root, 'packages/core/.test-build/src/writer.js')],
  activity: [join(root, 'examples/contribution-report/dist/activity.js')],
});

const controls = [
  { name: 'context lookup ignores the composition phase', target: 'supervision', anchor: "if (isComposing()) {\n            throw new SupervisionError('composition-phase', 'Runtime context", replacement: "if (false) {\n            throw new SupervisionError('composition-phase', 'Runtime context" },
  { name: 'a closed run still answers context lookups', target: 'supervision', anchor: "if (!frame.open) {\n            throw new SupervisionError('run-closed', `Run ${frame.context.runId} has closed; its context", replacement: "if (false) {\n            throw new SupervisionError('run-closed', `Run ${frame.context.runId} has closed; its context" },
  { name: 'a closed run still accepts new work', target: 'supervision', anchor: "if (!frame.open) {\n                throw new SupervisionError('run-closed', `Run ${context.runId} has closed and accepts", replacement: "if (false) {\n                throw new SupervisionError('run-closed', `Run ${context.runId} has closed and accepts" },
  { name: 'work presented after close is admitted', target: 'supervision', anchor: "if (!frame.open) {\n                    return closedDenial();", replacement: "if (false) {\n                    return closedDenial();" },
  { name: 'an admission decided after actual closure is not denied', target: 'supervision', anchor: 'return frame.open ? decision : closedDenial();', replacement: 'return decision;' },
  { name: 'the run closes without waiting for operations it started', target: 'supervision', anchor: 'await drainAndClose();', replacement: 'frame.open = false;' },
  { name: 'the run yields between its final empty check and closing', target: 'supervision', anchor: '            }\n            frame.open = false;', replacement: '            }\n            await Promise.resolve();\n            frame.open = false;' },
  { name: 'started operations are not accounted to the run', target: 'supervision', anchor: 'started.add(settled);', replacement: 'void settled;' },
  { name: 'the caller admission policy is ignored', target: 'supervision', anchor: 'const decision = await policy.admit(request);', replacement: "const decision = Object.freeze({ kind: 'admitted' });" },
  { name: 'recovery takes the writer lease', target: 'supervision', anchor: "return within(() => resolution.recover({ step, requestKey: request.requestKey }), 'recover');", replacement: "return within(() => { writer.tryLease(); return resolution.recover({ step, requestKey: request.requestKey }); }, 'recover');" },
  { name: 'the writer lease is never released', target: 'supervision', anchor: 'writer.release();', replacement: 'void writer;' },
  { name: 'observer failures are swallowed', target: 'supervision', anchor: 'throw failure.error;', replacement: 'void failure;' },
  { name: 'observers are read live instead of captured at start', target: 'supervision', anchor: 'Reflect.apply(observe, observer, [event]);', replacement: "Reflect.apply(Reflect.get(observer, 'observe'), observer, [event]);" },
  { name: 'a failing begin observer does not stop ordinary work', target: 'supervision', anchor: "throw new SupervisionError('observer-failure', `Run observer failed before ordinary work", replacement: "void new SupervisionError('observer-failure', `Run observer failed before ordinary work" },
  { name: 'ordinary completion is not observed', target: 'supervision', anchor: "afterOrdinary(label, 'end');", replacement: 'void label;' },
  { name: 'request diagnostics are not collected by the run', target: 'supervision', anchor: 'diagnostics.push(...outcome.diagnostics);', replacement: 'void outcome;' },
  { name: 'Resolution uses a fixed environment instead of the selected one', target: 'workspace', anchor: "                    environment: runOptions.environment,\n                    history,", replacement: "                    environment: 'env:fixture',\n                    history," },
  { name: 'a closed run can still read results', target: 'workspace', anchor: 'if (!live.open) {', replacement: 'if (false) {' },
  { name: 'an expired writer lease is kept instead of re-acquired', target: 'writer', anchor: 'if (!(error instanceof StaleWriterError)) {\n                        throw error;\n                    }\n                    held = undefined;', replacement: 'if (true) {\n                        throw error;\n                    }\n                    held = undefined;' },
  { name: 'releasing an expired lease is reported as a failure', target: 'writer', anchor: 'if (!(error instanceof StaleWriterError)) {\n                        throw error;\n                    }\n                }\n            }', replacement: 'if (true) {\n                        throw error;\n                    }\n                }\n            }' },
  { name: 'every run of a workspace uses the same writer holder name', target: 'workspace', anchor: 'writer: writerFor(history, `microdelta-run:${runId}`, leaseMilliseconds),', replacement: 'writer: writerFor(history, `microdelta-run:${composition.scope}`, leaseMilliseconds),' },
  { name: 'the example counts pending reviews', target: 'activity', anchor: "review.state === 'submitted' && ", replacement: '' },
  { name: 'the example window end is inclusive', target: 'activity', anchor: 'return time >= Date.parse(`${window.start}T00:00:00Z`) && time < Date.parse(', replacement: 'return time >= Date.parse(`${window.start}T00:00:00Z`) && time <= Date.parse(' },
];

/** The original bytes of every target file. */
const originals = new Map(Object.values(targets).flat().map((file) => [file, readFileSync(file, 'utf8')]));

/** Restore every target file. */
function restoreAll() {
  for (const [file, content] of originals) {
    writeFileSync(file, content);
  }
}

/** The child currently running and its report directory, so a signal can stop and remove them. */
let running;
let reportDirectory;

// A signal mid-control must not leave a planted defect in the build.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    running?.kill('SIGKILL');
    restoreAll();
    if (reportDirectory !== undefined) {
      rmSync(reportDirectory, { recursive: true, force: true });
    }
    console.log(`INTERRUPTED by ${signal}; emitted files restored`);
    process.exit(130);
  });
}

/** Spawn one child and resolve its exit code, capturing stdout. */
function spawnChild(args, cwd) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    running = spawn(process.execPath, args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
    running.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    running.on('error', reject);
    running.on('exit', (code) => {
      running = undefined;
      resolve({ code, stdout });
    });
  });
}

/** Run one Jest suite set and judge it fail-closed. */
async function runJest(config, pattern, suites, expectedTitles) {
  const directory = mkdtempSync(join(tmpdir(), 'workspace-controls-'));
  reportDirectory = directory;
  try {
    const out = join(directory, 'report.json');
    const { code } = await spawnChild(['--experimental-vm-modules', join(root, 'node_modules/jest/bin/jest.js'), '--config', config, '--runInBand', '--json', `--outputFile=${out}`, pattern], root);
    return judgeRun({ exitStatus: code, reportText: existsSync(out) ? readFileSync(out, 'utf8') : undefined, expectedTitles, suites });
  } finally {
    rmSync(directory, { recursive: true, force: true });
    reportDirectory = undefined;
  }
}

/** Run the example's CLI verification and judge its TAP results fail-closed. */
async function runExample(expectedTitles) {
  const { code, stdout } = await spawnChild(['--test', '--test-reporter=tap', 'examples/contribution-report/test/example.test.mjs'], root);
  if (code !== 0 && code !== 1) {
    throw new Error(`abnormal example exit ${String(code)}`);
  }
  const results = [...stdout.matchAll(/^(ok|not ok) \d+ - (.+)$/gmu)].map((match) => ({ status: match[1], title: match[2].trim() }));
  const titles = new Set(results.map((result) => result.title));
  if (results.length === 0 || titles.size !== results.length) {
    throw new Error('the example run reported no trustworthy results');
  }
  if (expectedTitles !== undefined && (titles.size !== expectedTitles.size || [...titles].some((title) => !expectedTitles.has(title)))) {
    throw new Error('example test titles differ from the baseline');
  }
  const failed = results.filter((result) => result.status === 'not ok').map((result) => result.title);
  if ((code === 0) !== (failed.length === 0)) {
    throw new Error(`example exit ${String(code)} disagrees with ${String(failed.length)} failing tests`);
  }
  return { titles, failed };
}

/** Run every suite once; `baseline` holds the expected titles per suite set. */
async function runAll(baseline) {
  // Patterns name exactly the suites judged, so suites added to these directories later do not invalidate the run.
  const supervision = await runJest(join(root, 'packages/supervision/jest.config.mjs'), '.test-build/test/supervision\\.test\\.js$', ['supervision.test.js'], baseline?.supervision);
  const workspace = await runJest(join(root, 'packages/core/jest.config.mjs'), '.test-build/test/workspace/(admission-observers|contribution-run|recovery|scope|writer-wait)\\.test\\.js$',
    ['admission-observers.test.js', 'contribution-run.test.js', 'recovery.test.js', 'scope.test.js', 'writer-wait.test.js'], baseline?.workspace);
  const example = await runExample(baseline?.example);
  return {
    titles: { supervision: supervision.titles, workspace: workspace.titles, example: example.titles },
    failed: [...supervision.failed.map((title) => `supervision: ${title}`), ...workspace.failed.map((title) => `workspace: ${title}`), ...example.failed.map((title) => `example: ${title}`)],
  };
}

let failures = 0;
try {
  const baseline = await runAll(undefined);
  const count = baseline.titles.supervision.size + baseline.titles.workspace.size + baseline.titles.example.size;
  console.log(`baseline: ${String(count)} tests, ${String(baseline.failed.length)} failing`);
  if (baseline.failed.length > 0) {
    throw new Error('the unmodified builds must pass every test before controls run');
  }
  for (const control of controls) {
    const files = targets[control.target];
    const unmatched = files.filter((file) => originals.get(file).split(control.anchor).length - 1 !== 1);
    if (unmatched.length > 0) {
      console.log(`ANCHOR not matched exactly once in ${unmatched.join(', ')}: ${control.name}`);
      failures += 1;
      continue;
    }
    for (const file of files) {
      writeFileSync(file, originals.get(file).replace(control.anchor, control.replacement));
    }
    try {
      const { failed } = await runAll(baseline.titles);
      console.log(`\n## ${control.name}: ${String(failed.length)} failing`);
      for (const name of failed) console.log(`- ${name}`);
      if (failed.length === 0) failures += 1;
    } finally {
      for (const file of files) {
        writeFileSync(file, originals.get(file));
      }
    }
    if (files.some((file) => readFileSync(file, 'utf8') !== originals.get(file))) {
      throw new Error(`${control.target} was not restored after ${control.name}`);
    }
  }
  const restored = await runAll(baseline.titles);
  console.log(`\nrestored: ${String(restored.failed.length)} failing`);
  if (restored.failed.length > 0) failures += 1;
} catch (error) {
  console.log(`CONTROL RUN INVALID: ${error instanceof Error ? error.message : String(error)}`);
  failures += 1;
} finally {
  restoreAll();
}
for (const [file, content] of originals) {
  if (readFileSync(file, 'utf8') !== content) {
    console.log(`NOT RESTORED: ${file}`);
    failures += 1;
  }
}
console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${String(controls.length)} controls`);
process.exit(failures > 0 ? 1 : 0);
