/** The publication candidate's source must compile without ambient Node host capabilities. */
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/** The repository root anchors the portable source config and its negative type probe. */
const root = fileURLToPath(new URL('../', import.meta.url));
/** Only the candidate source tree participates in the host-independence check. */
const configPath = path.join(root, 'experiments/exp-3/tsconfig.portable.json');
/** A named Node global makes ambient host-type leakage fail with a stable diagnostic. */
const nodeLeakProbe = path.join(root, 'tooling/fixtures/exp3-node-types-leak.ts');

test('EXP-3 source rejects ambient Node declarations', () => {
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.equal(configFile.error, undefined, 'Portable source config must be readable');
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
  assert.deepEqual(parsed.options.types, [], 'Portable source must not auto-load host type packages');

  const program = ts.createProgram([...parsed.fileNames, nodeLeakProbe], parsed.options);
  const diagnostics = ts.getPreEmitDiagnostics(program).filter(diagnostic =>
    diagnostic.file?.fileName === nodeLeakProbe);
  assert.ok(
    diagnostics.some(diagnostic => diagnostic.code === 2503),
    `The NodeJS namespace leaked into portable source: ${ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: filename => filename,
      getCurrentDirectory: () => root,
      getNewLine: () => '\n',
    })}`,
  );
});
