/** Outcome fixtures cover issue #4's local, event, and untrusted-input boundaries. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { completeBody, incompleteBodies } from './fixtures/pr-metadata.mjs';
import { validateBody, validateEvent } from './pr-metadata.mjs';

/** A current PR response is deliberately distinct from its stale webhook body. */
const event = { number: 4, pull_request: { head: { sha: 'head-a' }, body: completeBody } };
const current = { number: 4, head: { sha: 'head-a' }, body: completeBody };

test('complete evidence passes while review is pending', () => {
  assert.deepEqual(validateBody(completeBody), []);
  assert.deepEqual(validateBody(completeBody.replace('Codex wrote the tests and checker.', 'None.')), []);
});

for (const fixture of incompleteBodies) {
  test(`rejects missing or incomplete ${fixture.name} with an actionable diagnostic`, () => {
    assert.match(validateBody(fixture.body).join('\n'), fixture.diagnostic);
  });
}

test('the untouched repository template and absent bodies fail', async () => {
  const template = await readFile(new URL('../.github/pull_request_template.md', import.meta.url), 'utf8');
  assert.match(validateBody(template).join('\n'), /placeholder/i);
  assert.ok(validateBody(null).length > 0);
});

for (const action of ['opened', 'edited', 'reopened', 'synchronize']) {
  test(`${action} validates the current body rather than stale passing event text`, async () => {
    const result = await validateEvent('pull_request', { ...event, action }, async number => {
      assert.equal(number, 4);
      return { ...current, body: '' };
    });
    assert.match(result.join('\n'), /Acceptance evidence/);
  });
}

test('rerunning an old event uses the newly corrected body', async () => {
  assert.deepEqual(await validateEvent('pull_request', { ...event, pull_request: { ...event.pull_request, body: '' } }, async () => current), []);
});

test('workflow dispatch checks the requested PR only when its head matches the dispatched ref', async () => {
  const dispatched = { inputs: { pr_number: '4' }, ref: 'changeset-release/main' };
  assert.deepEqual(await validateEvent('workflow_dispatch', dispatched, async number => {
    assert.equal(number, 4);
    return current;
  }, 'head-a'), []);
  await assert.rejects(validateEvent('workflow_dispatch', dispatched, async () => current, 'head-b'), /head/i);
  await assert.rejects(validateEvent('workflow_dispatch', { inputs: { pr_number: '0' } }, async () => current, 'head-a'), /payload/i);
});

test('push-only CI needs neither a PR payload nor API access', async () => {
  assert.deepEqual(await validateEvent('push', {}, () => { throw new Error('must not fetch'); }), []);
});

test('malformed PR payload, changed head, bad API response, and failed API request fail closed', async () => {
  await assert.rejects(validateEvent('pull_request', {}, async () => current), /payload/i);
  await assert.rejects(validateEvent('pull_request', event, async () => ({ ...current, head: { sha: 'head-b' } })), /head/i);
  await assert.rejects(validateEvent('pull_request', event, async () => ({ ...current, number: 8 })), /response/i);
  await assert.rejects(validateEvent('pull_request', event, async () => { throw new Error('API unavailable'); }), /API unavailable/);
  await assert.rejects(validateEvent('workflow_dispatch', event, async () => current), /event/i);
});

test('the local CLI reads shell-looking PR text as data and returns useful failures', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pr-metadata-'));
  try {
    const file = path.join(directory, 'body.md');
    const sentinel = path.join(directory, 'executed');
    await writeFile(file, completeBody + `\n$(touch ${sentinel})\n\`touch ${sentinel}\`\n`);
    const run = () => spawnSync(process.execPath, ['tooling/pr-metadata.mjs', '--body-file', file], { encoding: 'utf8' });
    assert.equal(run().status, 0);
    await assert.rejects(readFile(sentinel), { code: 'ENOENT' });
    await writeFile(file, '');
    const invalid = run();
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /Acceptance evidence/);
    const noArguments = spawnSync(process.execPath, ['tooling/pr-metadata.mjs'], { encoding: 'utf8' });
    assert.equal(noArguments.status, 1);
    assert.match(noArguments.stderr, /body-file/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

/** The checked-in workflow is the enforcement entrypoint, not the event helper. */
test('CI wires every required event to one read-only, cancellable metadata check', async () => {
  const workflow = await readFile(new URL('../.github/workflows/pr-metadata.yml', import.meta.url), 'utf8');
  // These intentionally explicit assertions require review when CI's trust or
  // scheduling boundary changes; they do not parse arbitrary user-supplied YAML.
  assert.match(workflow, /^on:\n  pull_request:\n    types: \[opened, edited, reopened, synchronize\]\n  workflow_dispatch:\n    inputs:\n      pr_number:/mu);
  assert.match(workflow, /^permissions:\n  contents: read\n  pull-requests: read\n/mu);
  assert.match(workflow, /^concurrency:\n  group: pr-metadata-\$\{\{ github\.event\.pull_request\.number \|\| inputs\.pr_number \}\}\n  cancel-in-progress: true\n/mu);
  assert.match(workflow, /^    name: PR metadata$/mu);
  assert.match(workflow, /^          persist-credentials: false$/mu);
  assert.match(workflow, /^        run: node tooling\/pr-metadata\.mjs --github-event$/mu);
  assert.doesNotMatch(workflow, /pull_request_target:|secrets\.|:\s*write\b|npm (?:ci|install)|github\.event\.pull_request\.body/u);
});

test('CLI push mode does not need an event file or token', () => {
  const result = spawnSync(process.execPath, ['tooling/pr-metadata.mjs', '--github-event'], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_EVENT_NAME: 'push', GITHUB_EVENT_PATH: '/does-not-exist', GITHUB_TOKEN: '' },
  });
  assert.equal(result.status, 0, result.stderr);
});
