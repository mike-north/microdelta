/** Issue #144 probes mutate emitted copies only; the working checkout is never a mutant. */
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = resolve('.');
const temporary = realpathSync(mkdtempSync(join(tmpdir(), 'microdelta-144-')));
const judged = ['resolution/source-policy', 'resolution/summary-validation', 'resolution/admission-recovery'];
const expanded = [...judged, 'keyed/members', 'keyed/restart', 'nested/validation', 'nested/restart', 'nested/arguments', 'fold/fold', 'fold/restart', 'gap-hunt-contracts-cost', 'gap-hunt-contracts-precedence', 'gap-hunt-contracts-resolution-144'];
const previousExpanded = expanded.filter(suite => suite !== 'gap-hunt-contracts-resolution-144');
const controls = [
 { id: 'gate-tracking', file: 'resolution.js', anchor: "const gateInvoker = (callback, context) => {\n        // eslint-disable-next-line microdelta/tracked-captures -- Framework invoker: the callback is the author's actual gate from Definition's record, tracked so its implementation is the gate's own evidence.\n        const authored = tracking.tracked(callback, { path: bindingPaths.self });", replacement: "const gateInvoker = (callback, context) => {\n        const authored = callback;" },
 { id: 'direct-memo-sharing', file: 'resolution.js', anchor: 'const existing = request.memos.get(key);\n        if (existing !== undefined) {', replacement: 'const existing = request.memos.get(key);\n        if (false) {' },
 { id: 'supplied-intent', file: 'intent.js', anchor: 'options.arguments,\n        sourceText(options.run),\n        ...currentBindings(options.validation, options.slots),\n    ];\n    return `mdi1:${options.host.sha256(JSON.stringify(intent))}`;', replacement: "options.arguments,\n        sourceText(options.run),\n        ...currentBindings(options.validation, options.slots),\n    ];\n    return 'mdi1:constant';" },
 { id: 'supplied-own-evidence', file: 'evidence.js', anchor: "if (!observations.some(isOwnImplementation)) {\n        return malformed(`${kind} provenance lacks its own implementation observation`);\n    }\n    if (kind === 'supplied' && calls.length > 0)", replacement: "if (kind !== 'supplied' && !observations.some(isOwnImplementation)) {\n        return malformed(`${kind} provenance lacks its own implementation observation`);\n    }\n    if (kind === 'supplied' && calls.length > 0)" },
 { id: 'fold-own-evidence', file: 'evidence.js', anchor: "if (!observations.some(isOwnImplementation)) {\n        return malformed('fold provenance lacks its own implementation observation');\n    }", replacement: "if (false) {\n        return malformed('fold provenance lacks its own implementation observation');\n    }" },
];
const dist = join(temporary, 'packages/resolution/dist/src');
const output = { baseline: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(), mode: process.argv.includes('--focused') ? 'focused-five' : 'full-matrix', controls: [], anchors: controls };
const inventories = new Map();
const expectedArtifacts = new Map();
function digest(text) { return createHash('sha256').update(text).digest('hex'); }
function run(suites, label) {
 if (process.argv.includes('--focused')) suites = ['gap-hunt-contracts-resolution-144'];
 const probe = spawnSync(process.execPath, ['--input-type=module', '-e', "console.log(import.meta.resolve('@microdelta/resolution'))"], { cwd: join(temporary, 'packages/core'), encoding: 'utf8' });
 const loaded = probe.status === 0 ? realpathSync(fileURLToPath(probe.stdout.trim())) : '';
 if (loaded !== join(dist, 'index.js')) throw new Error(`Unexpected loaded Resolution entry ${loaded}`);
 for (const [file, expected] of expectedArtifacts) {
   const actual = digest(readFileSync(join(dist, file), 'utf8'));
   if (actual !== expected) throw new Error(`Unexpected loaded artifact hash ${file}`);
 }
 output.verifiedLoads ??= [];
 output.verifiedLoads.push({ label, entry: loaded.replace(temporary, '<isolated>'), artifacts: Object.fromEntries(expectedArtifacts) });
 const report = join(temporary, `${label}.json`);
 const child = spawnSync(process.execPath, ['--experimental-vm-modules', join(temporary, 'node_modules/jest/bin/jest.js'), '--config', 'jest.config.mjs', '--runInBand', '--json', `--outputFile=${report}`, '--runTestsByPath', ...suites.map(file => `.test-build/test/${file}.test.js`)], { cwd: join(temporary, 'packages/core'), encoding: 'utf8', timeout: 60000 });
 if (!existsSync(report)) throw new Error(`No Jest report ${label}: ${child.stderr}`);
 const parsed = JSON.parse(readFileSync(report, 'utf8'));
 const assertions = parsed.testResults.flatMap(file => file.assertionResults);
 if (child.signal || assertions.length === 0 || parsed.numRuntimeErrorTestSuites > 0) throw new Error(`Invalid ${label}: ${child.stderr}`);
 const failed = assertions.filter(assertion => assertion.status !== 'passed').map(assertion => assertion.fullName);
 if ((child.status === 0) !== (failed.length === 0)) throw new Error(`Exit/outcomes disagree ${label}`);
 const names = assertions.map(assertion => assertion.fullName).sort();
 const key = JSON.stringify(suites);
 const previous = inventories.get(key);
 if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(names)) throw new Error(`Changed test inventory ${label}`);
 inventories.set(key, names);
 return { count: assertions.length, failed };
}
try {
 for (const path of ['node_modules', 'packages']) cpSync(join(root, path), join(temporary, path), { recursive: true, dereference: false, verbatimSymlinks: true });
 for (const path of ['package.json', 'tsconfig.json']) if (existsSync(join(root, path))) cpSync(join(root, path), join(temporary, path));
 if (!realpathSync(join(temporary, 'node_modules/@microdelta/resolution')).startsWith(temporary)) throw new Error('Resolution link escaped isolated copy');
 for (const file of new Set(controls.map(control => control.file))) expectedArtifacts.set(file, digest(readFileSync(join(dist, file), 'utf8')));
 const baseline = run(expanded, 'baseline');
 run(judged, 'judged-baseline');
 run(previousExpanded, 'before-baseline');
 if (baseline.failed.length) throw new Error(`Baseline failed: ${baseline.failed.join('; ')}`);
 output.executedBaseline = baseline;
 console.log(`baseline ${baseline.count} passed`);
 for (const control of controls) {
   const path = join(dist, control.file);
   const original = readFileSync(path, 'utf8');
   if (original.split(control.anchor).length !== 2) throw new Error(`Nonunique anchor ${control.id}`);
   try {
     const mutant = original.replace(control.anchor, control.replacement);
     writeFileSync(path, mutant);
     expectedArtifacts.set(control.file, digest(mutant));
     const old = run(judged, `${control.id}-judged`);
     const before = run(previousExpanded, `${control.id}-before`);
     const all = run(expanded, `${control.id}-expanded`);
     output.controls.push({ id: control.id, judged: old, before, expanded: all });
     console.log(JSON.stringify(output.controls.at(-1)));
     if (!all.failed.some(name => name.startsWith('gap hunt existing issue #144'))) throw new Error(`Unexpected mutant result ${control.id}`);
   } finally { writeFileSync(path, original); expectedArtifacts.set(control.file, digest(original)); }
   if (readFileSync(path, 'utf8') !== original) throw new Error('Failed restoration');
 }
 output.restored = run(expanded, 'restored');
 if (output.restored.failed.length) throw new Error('Restored copy failed');
 writeFileSync('scratch/gap-hunt/contracts/resolution-gap-controls.json', JSON.stringify(output, null, 2) + '\n');
 console.log(`restored ${output.restored.count} passed`);
} finally { rmSync(temporary, { recursive: true, force: true }); }
