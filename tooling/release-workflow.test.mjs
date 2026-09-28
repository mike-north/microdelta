/**
 * The npm-trusted workflow file `release.yml` separates version preparation,
 * the release decision, verified packing, and the only OIDC-capable publish job.
 * Each negative case mutates the checked-in workflow to prove the audit refuses it.
 *
 * @see https://docs.npmjs.com/trusted-publishers
 * @see https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions#permissions
 * @see https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/about-security-hardening-with-openid-connect
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { auditReleaseWorkflow, workflowJobs } from './release-workflow.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const workflow = await readFile(path.join(root, '.github/workflows/release.yml'), 'utf8');

/** Assert that a mutation yields a diagnostic matching the intended refusal. */
function refuses(mutated, pattern) {
  assert.notEqual(mutated, workflow, 'mutation must change the workflow');
  const problems = auditReleaseWorkflow(mutated);
  assert.ok(problems.some(problem => pattern.test(problem)), `expected ${pattern}; got:\n${problems.join('\n')}`);
}

/** Replace exactly one occurrence so each negative control is precise. */
function once(text, search, replacement) {
  const index = text.indexOf(search);
  assert.notEqual(index, -1, `missing ${search}`);
  assert.equal(text.indexOf(search, index + 1), -1, `ambiguous ${search}`);
  return text.slice(0, index) + replacement + text.slice(index + search.length);
}

test('the checked-in release workflow passes the publication audit', () => {
  assert.deepEqual(auditReleaseWorkflow(workflow), []);
  assert.deepEqual(Object.keys(workflowJobs(workflow)), ['version', 'release-decision', 'package', 'publish']);
});

test('OIDC token permission granted to the whole workflow is refused', () => {
  refuses(once(workflow, 'permissions: {}', 'permissions:\n  id-token: write'), /workflow-level permissions must be empty/u);
});

test('OIDC token permission in the version or package job is refused', () => {
  refuses(once(workflow, '      pull-requests: write\n', '      pull-requests: write\n      id-token: write\n'), /only the publish job may request id-token: write/u);
});

test('a publish job with broader write permission is refused', () => {
  refuses(workflow.replace(/(^  publish:\n[\s\S]*?permissions:\n)/mu, '$1      packages: write\n'), /publish job permissions must be exactly contents: read, id-token: write and pull-requests: read/u);
});

test('publication that no longer depends on the release decision is refused', () => {
  refuses(workflow.replace(/(^  publish:\n[\s\S]*?)    if: needs\.release-decision\.outputs\.publish == 'true'\n/mu, '$1'), /publish job must run only when release-decision outputs publish == 'true'/u);
});

test('publication that skips verified packing is refused', () => {
  refuses(once(workflow, 'needs: [release-decision, package]', 'needs: [release-decision]'), /publish job must need release-decision and package/u);
});

test('registry secrets or long-lived tokens are refused', () => {
  refuses(workflow.replace(/(node tooling\/publish-release\.mjs[^\n]*\n)/u, '$1        env:\n          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}\n'), /must not reference secrets or npm tokens/u);
});

test('installing dependencies inside the OIDC-capable job is refused', () => {
  refuses(workflow.replace(/(^  publish:\n[\s\S]*?steps:\n)/mu, '$1      - run: npm ci\n'), /publish job must not install or build/u);
});

test('self-hosted or unpinned publication runners and actions are refused', () => {
  refuses(workflow.replace(/(^  publish:\n(?:.*\n)*?    runs-on: )ubuntu-latest/mu, '$1self-hosted'), /publish job must run on a GitHub-hosted ubuntu-latest runner/u);
  refuses(workflow.replace(/(^  publish:\n[\s\S]*?uses: actions\/download-artifact@)[0-9a-f]{40}/mu, '$1v4'), /publish job action actions\/download-artifact@v4 must be pinned to a full commit SHA/u);
});

test('a setup-node registry-url in the publish job is refused', () => {
  refuses(workflow.replace(/(^  publish:\n[\s\S]*?node-version: 24\n)/mu, "$1          registry-url: 'https://registry.npmjs.org'\n"), /publish job must not configure a registry-url token placeholder/u);
});

test('pull-request triggers are refused', () => {
  refuses(once(workflow, '  workflow_dispatch:\n', '  workflow_dispatch:\n  pull_request_target:\n'), /release workflow triggers must be exactly push to main and workflow_dispatch/u);
});

test('the version job must remain version-only', () => {
  refuses(once(workflow, '          createGithubReleases: false\n', '          createGithubReleases: false\n          publish: npm publish\n'), /version job must not publish/u);
});

test('packing must verify the exact pushed commit in release mode', () => {
  refuses(once(workflow, 'node tooling/release-artifacts.mjs --release', 'node tooling/release-artifacts.mjs'), /package job must run release-artifacts in --release mode/u);
  refuses(workflow.replace(/(^ {2}package:\n[\s\S]*?) {10}ref: \$\{\{ github\.sha \}\}\n/mu, '$1'), /package job must check out github\.sha/u);
});

// Issue #64 review finding 2: the publish job re-reads GitHub at its final
// boundary, so it needs a read-only PR permission and the job token, and no more.
test('publication must receive only read access for release revalidation', () => {
  refuses(workflow.replace(/(^ {2}publish:\n[\s\S]*?) {6}pull-requests: read\n/mu, '$1'), /publish job permissions must be exactly contents: read, id-token: write and pull-requests: read/u);
  refuses(workflow.replace(/(^ {2}publish:\n[\s\S]*?) {6}pull-requests: read\n/mu, '$1      pull-requests: write\n'), /publish job permissions must be exactly contents: read, id-token: write and pull-requests: read/u);
  refuses(workflow.replace(/(^ {2}publish:\n[\s\S]*?) {10}GITHUB_TOKEN: \$\{\{ github\.token \}\}\n/mu, '$1'), /publish job must pass the read-only job token for release revalidation/u);
});

// Issue #64 review finding 4: the package job must let release-artifacts run
// the native install; suppressing scripts there would hide a missing binding.
test('the package job cannot suppress the native install check', () => {
  refuses(once(workflow, 'node tooling/release-artifacts.mjs --release --out', 'npm_config_ignore_scripts=true node tooling/release-artifacts.mjs --release --out'), /package job must not suppress install scripts/u);
});
