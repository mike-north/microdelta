/** The public capture-tier gate must classify its exact negative fixture across host path formats. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyPublicCaptureTierDiagnostics } from './capture-public-tier-diagnostics.mjs';

const expectedType = 'ITrackedCaptureConfig';
const expectedCode = 2694;
const expectedSuffix = 'fixtures/declarations/consumer-alpha/public-tier-negative.ts';

function diagnostic(fileName, code = expectedCode, messageText = `Property '${expectedType}' is missing.`) {
  return { code, file: { fileName }, messageText };
}

test('classifies POSIX and Windows paths for the same exact public-tier negative fixture', () => {
  const posixFixture = `/workspace/${expectedSuffix}`;
  const windowsFixture = `C:\\workspace\\${expectedSuffix.replaceAll('/', '\\')}`;
  const posix = classifyPublicCaptureTierDiagnostics([
    diagnostic(posixFixture),
    diagnostic(posixFixture),
  ], posixFixture);
  const windows = classifyPublicCaptureTierDiagnostics([
    diagnostic(windowsFixture),
    diagnostic(windowsFixture),
  ], windowsFixture);

  assert.equal(posix.expected.length, 2);
  assert.equal(posix.unexpected.length, 0);
  assert.equal(windows.expected.length, 2);
  assert.equal(windows.unexpected.length, 0);
});

test('keeps extra, wrong-code, wrong-file, and wrong-symbol diagnostics unexpected', () => {
  const expectedFixture = `/workspace/${expectedSuffix}`;
  const result = classifyPublicCaptureTierDiagnostics([
    diagnostic(expectedFixture),
    diagnostic(expectedFixture),
    diagnostic(expectedFixture, 2322),
    diagnostic('/workspace/other/public-tier-negative.ts'),
    diagnostic(expectedFixture, expectedCode, 'Property is missing.'),
    diagnostic(expectedFixture),
  ], expectedFixture);

  assert.equal(result.expected.length, 3, 'the checker must not hide extra matching diagnostics');
  assert.equal(result.unexpected.length, 3, 'all nonmatching compiler diagnostics remain visible');
});
