/**
 * PKG-004 proves the generated public declaration rejects an alpha-only type.
 * The expected compiler error is the assertion; success would expose a private
 * project contract through the consumer's default package view.
 */
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

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
    const expected = diagnostics.filter(diagnostic => diagnostic.code === 2694 &&
      diagnostic.file?.fileName.endsWith('/consumer-alpha/public-tier-negative.ts') &&
      ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ').includes('ITrackedCaptureConfig'));
    const unexpected = diagnostics.filter(diagnostic => !expected.includes(diagnostic));
    if (expected.length !== 2 || unexpected.length > 0) {
      process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCurrentDirectory: () => root,
        getCanonicalFileName: filename => filename,
        getNewLine: () => '\n',
      }));
      process.stderr.write('Expected both generated public declarations to hide their alpha-only capture contract.\n');
      process.exitCode = 1;
    }
}
