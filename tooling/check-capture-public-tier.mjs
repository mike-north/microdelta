/**
 * PKG-004 proves the generated public declarations reject alpha-only types,
 * including Definition's declared-call handle.
 * The expected compiler error is the assertion; success would expose a private
 * project contract through the consumer's default package view.
 */
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

import { classifyPublicCaptureTierDiagnostics } from './capture-public-tier-diagnostics.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const configPath = path.join(root, 'fixtures/declarations/consumer-alpha/tsconfig.public.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile.bind(ts.sys));
if (config.error) {
  process.stderr.write(ts.flattenDiagnosticMessageText(config.error.messageText, '\n') + '\n');
  process.exitCode = 1;
} else {
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath), undefined, configPath);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  const expectedFileName = path.join(root, 'fixtures', 'declarations', 'consumer-alpha', 'public-tier-negative.ts');
  const { expected, unexpected } = classifyPublicCaptureTierDiagnostics(diagnostics, expectedFileName);
  if (expected.length !== 3 || unexpected.length > 0) {
    process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => root,
      getCanonicalFileName: filename => filename,
      getNewLine: () => '\n',
    }));
    process.stderr.write('Expected the generated public declarations to hide all three alpha-only contracts.\n');
    process.exitCode = 1;
  }
}
