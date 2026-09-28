/**
 * Structural audit of `.github/workflows/release.yml`, the workflow npm trusts
 * to publish every first-party package.
 *
 * Because npm grants publication to any run of this file, its shape is a
 * security boundary: only the `publish` job may obtain an OIDC token; it runs
 * only after the release decision and verified packing, on a GitHub-hosted
 * runner, with pinned actions, no dependency installation, and no registry
 * secret. Its only other permissions are read access used to re-establish,
 * after any wait, that its commit is still the latest release decision. The
 * package job may not suppress install scripts, because the artifact check
 * installs the native SQLite binding normally. The version job remains version-only and the triggers remain push to
 * main plus manual dispatch. Run as a CLI by `npm run check:release-workflow`.
 * This is a line-oriented reader of the repository's own block-style YAML,
 * not a general YAML parser; unexpected layout fails the audit.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Required jobs, in their checked-in order. */
const expectedJobs = ['version', 'release-decision', 'package', 'publish'];

/** The only trigger block the trusted workflow may declare. */
const expectedTriggers = 'on:\n  push:\n    branches: [main]\n  workflow_dispatch:\n';

/** Condition shared by every job that exists only for an actual release. */
const releaseCondition = "if: needs.release-decision.outputs.publish == 'true'";

/** Split the `jobs:` mapping into each job's text. */
export function workflowJobs(text) {
  const start = text.search(/^jobs:\n/mu);
  if (start === -1) return {};
  const jobs = {};
  let current;
  for (const line of text.slice(start).split('\n').slice(1)) {
    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/u.exec(line);
    if (header) {
      current = header[1];
      jobs[current] = '';
    } else if (current !== undefined) {
      jobs[current] += `${line}\n`;
    }
  }
  return jobs;
}

/** A job's `permissions:` mapping as sorted `key: value` strings. */
function jobPermissions(job) {
  const match = /^ {4}permissions:\n((?: {6}\S.*\n)*)/mu.exec(job);
  if (match === null) return undefined;
  return match[1].trim().split('\n').map(line => line.trim()).sort();
}

/** Every `uses:` reference in a job. */
function actionsUsed(job) {
  return [...job.matchAll(/uses:\s*([^\s#]+)/gu)].map(match => match[1]);
}

/** Diagnostics for a release workflow's text; empty means acceptable. */
export function auditReleaseWorkflow(text) {
  const problems = [];
  const preamble = text.slice(0, Math.max(0, text.search(/^jobs:\n/mu)));
  if (!/^permissions: \{\}$/mu.test(preamble) || /^permissions:\n/mu.test(preamble)) {
    problems.push('workflow-level permissions must be empty (permissions: {}); grant permissions per job');
  }
  const triggers = /^on:\n(?: {2,}.*\n)*/mu.exec(preamble)?.[0];
  if (triggers !== expectedTriggers) problems.push('release workflow triggers must be exactly push to main and workflow_dispatch');
  if (/secrets\.|NPM_TOKEN|NODE_AUTH_TOKEN|_authToken/iu.test(text)) problems.push('release workflow must not reference secrets or npm tokens');

  const jobs = workflowJobs(text);
  if (Object.keys(jobs).join(',') !== expectedJobs.join(',')) {
    problems.push(`release workflow jobs must be ${expectedJobs.join(', ')}`);
  }
  for (const [name, job] of Object.entries(jobs)) {
    if (name !== 'publish' && /id-token:/u.test(job)) problems.push(`only the publish job may request id-token: write (found in ${name})`);
    if (name === 'version') continue;
    for (const action of actionsUsed(job)) {
      if (!/@[0-9a-f]{40}$/u.test(action)) problems.push(`${name} job action ${action} must be pinned to a full commit SHA`);
    }
  }

  const version = jobs.version ?? '';
  if (/npm publish|changeset publish|^\s*publish:/mu.test(version)) problems.push('version job must not publish');

  const decision = jobs['release-decision'] ?? '';
  if (jobPermissions(decision)?.join(',') !== 'contents: read,pull-requests: read') {
    problems.push('release-decision job permissions must be exactly contents: read and pull-requests: read');
  }
  if (!/node tooling\/release-decision\.mjs/u.test(decision)) problems.push('release-decision job must run tooling/release-decision.mjs');

  const pack = jobs.package ?? '';
  if (!/^ {4}needs: release-decision$/mu.test(pack) || !pack.includes(`    ${releaseCondition}\n`)) {
    problems.push(`package job must need release-decision and run only when release-decision outputs publish == 'true'`);
  }
  if (jobPermissions(pack)?.join(',') !== 'contents: read') problems.push('package job permissions must be exactly contents: read');
  if (!pack.includes('          ref: ${{ github.sha }}\n')) problems.push('package job must check out github.sha');
  for (const command of ['npm ci', 'npm run check', 'npm test']) {
    if (!pack.includes(`run: ${command}\n`)) problems.push(`package job must run ${command}`);
  }
  if (!/node tooling\/release-artifacts\.mjs --release /u.test(pack)) problems.push('package job must run release-artifacts in --release mode');
  if (/ignore[-_]scripts/iu.test(pack)) problems.push('package job must not suppress install scripts; the native SQLite check needs a normal install');

  const publish = jobs.publish ?? '';
  if (!/^ {4}needs: \[release-decision, package\]$/mu.test(publish)) problems.push('publish job must need release-decision and package');
  if (!publish.includes(`    ${releaseCondition}\n`)) problems.push(`publish job must run only when release-decision outputs publish == 'true'`);
  if (jobPermissions(publish)?.join(',') !== 'contents: read,id-token: write,pull-requests: read') {
    problems.push('publish job permissions must be exactly contents: read, id-token: write and pull-requests: read');
  }
  if (!/node tooling\/publish-release\.mjs --manifest [^\n]*\n {8}env:\n {10}GITHUB_TOKEN: \$\{\{ github\.token \}\}\n/u.test(publish)) {
    problems.push('publish job must pass the read-only job token for release revalidation to publish-release.mjs');
  }
  if (!/^ {4}runs-on: ubuntu-latest$/mu.test(publish)) problems.push('publish job must run on a GitHub-hosted ubuntu-latest runner');
  if (/npm (?:ci|install|run|test)\b/u.test(publish)) problems.push('publish job must not install or build; it only publishes verified tarballs');
  if (/registry-url/u.test(publish)) problems.push('publish job must not configure a registry-url token placeholder');
  if (!/node tooling\/publish-release\.mjs --manifest /u.test(publish)) problems.push('publish job must run tooling/publish-release.mjs');
  return problems;
}

/** CLI: audit the checked-in workflow and exit nonzero with diagnostics. */
async function main() {
  const file = fileURLToPath(new URL('../.github/workflows/release.yml', import.meta.url));
  const problems = auditReleaseWorkflow(await readFile(file, 'utf8'));
  if (problems.length > 0) {
    process.stderr.write(`release.yml audit failed:\n- ${problems.join('\n- ')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('release.yml audit passed.\n');
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
