/** Classification for the exact negative fixture that proves public declarations hide alpha capture configuration. */
import ts from 'typescript';

/**
 * Separate only the expected alpha-only type diagnostic from the requested fixture;
 * every other compiler diagnostic remains a gate failure on any host platform.
 */
export function classifyPublicCaptureTierDiagnostics(diagnostics, expectedFileName) {
  const normalizeSeparators = filename => filename.replaceAll('\\', '/');
  const expectedPath = normalizeSeparators(expectedFileName);
  const expected = diagnostics.filter(diagnostic => diagnostic.code === 2694 &&
    diagnostic.file?.fileName && normalizeSeparators(diagnostic.file.fileName) === expectedPath &&
    ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ').includes('ITrackedCaptureConfig'));
  return { expected, unexpected: diagnostics.filter(diagnostic => !expected.includes(diagnostic)) };
}
