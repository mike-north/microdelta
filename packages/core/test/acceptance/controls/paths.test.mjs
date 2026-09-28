/**
 * The acceptance control runner must address its targets on the real
 * filesystem even when the checkout path contains characters that URLs
 * percent-encode, such as spaces and `%`. A URL pathname keeps those
 * characters encoded, so the runner would miss every emitted target.
 *
 * @see https://nodejs.org/api/url.html#urlfileurltopathurl-options
 */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { repositoryRoot } from './paths.mjs';

test('the runner resolves the repository root from a checkout path with spaces and percent signs', () => {
  const checkout = '/private/tmp/microdelta control path %';
  const runner = pathToFileURL(join(checkout, 'packages/core/test/acceptance/controls/acceptance-mutation-controls.mjs'));
  assert.equal(join(repositoryRoot(runner.href), 'packages/resolution/dist/src/resolution.js'), join(checkout, 'packages/resolution/dist/src/resolution.js'));
});

test('an ordinary checkout path is unchanged', () => {
  const checkout = '/work/microdelta';
  const runner = pathToFileURL(join(checkout, 'packages/core/test/acceptance/controls/acceptance-mutation-controls.mjs'));
  assert.equal(join(repositoryRoot(runner.href), 'package.json'), join(checkout, 'package.json'));
});
