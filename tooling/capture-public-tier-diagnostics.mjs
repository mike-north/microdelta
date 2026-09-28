/** Classification for the exact negative fixture that proves public declarations hide alpha-only contracts. */
import ts from 'typescript';

/**
 * The project-private alpha symbols the public-tier fixture references. Each
 * must be hidden by its producer's public rollup; matches are by exact quoted
 * symbol name so a similarly named symbol is never mistaken for one of these.
 */
const hiddenAlphaSymbols = ['ITrackedCaptureConfig', 'IDeclaredCallHandle'];

/**
 * Separate only the expected alpha-only type diagnostics from the requested fixture;
 * every other compiler diagnostic remains a gate failure on any host platform.
 */
export function classifyPublicCaptureTierDiagnostics(diagnostics, expectedFileName) {
  const normalizeSeparators = filename => filename.replaceAll('\\', '/');
  const expectedPath = normalizeSeparators(expectedFileName);
  const expected = diagnostics.filter(diagnostic => {
    if (diagnostic.code !== 2694 || !diagnostic.file?.fileName || normalizeSeparators(diagnostic.file.fileName) !== expectedPath) {
      return false;
    }
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
    return hiddenAlphaSymbols.some(symbol => message.includes(`'${symbol}'`));
  });
  return { expected, unexpected: diagnostics.filter(diagnostic => !expected.includes(diagnostic)) };
}
