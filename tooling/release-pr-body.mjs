/**
 * Render factual, reviewable metadata for the Changesets-generated version PR.
 * The release plan is generated from repository changesets immediately before
 * versioning; this body records intended package changes without claiming CI or
 * human review has already succeeded. Merging the PR is the human release
 * decision that lets release.yml publish through npm trusted publishing, so the
 * body states that consequence rather than implying the PR is inert.
 */
import { readFile } from 'node:fs/promises';

/** Convert Changesets' release-plan JSON into stable package/bump evidence. */
function releaseSummary(plan) {
  if (!Array.isArray(plan?.releases)) throw new Error('Release plan has no releases array.');
  if (plan.releases.length === 0) return '- No package versions are pending.';
  return plan.releases.map(release => {
    if (typeof release?.name !== 'string' ||
        !/^(?:microdelta|@microdelta\/[a-z0-9-]+)$/u.test(release.name) ||
        !['patch', 'minor', 'major'].includes(release.type)) {
      throw new Error('Release plan contains an invalid package entry.');
    }
    return `- ${release.name}: ${release.type} version`;
  }).join('\n');
}

/** Read the trusted runner-created plan path; it never comes from a PR body. */
async function main() {
  const planPath = process.env.RELEASE_PLAN_PATH;
  if (!planPath) throw new Error('RELEASE_PLAN_PATH is required.');
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  const packages = releaseSummary(plan);
  process.stdout.write([
    '## Problem and resulting behavior',
    '',
    'This Changesets version PR prepares package versions and changelogs for human review. Merging this PR is the release decision: release.yml then verifies the merged commit and publishes the first-party packages to npm through npm trusted publishing. Opening or updating this PR publishes nothing.',
    '',
    '## Governing issue and contracts',
    '',
    'Refs #31',
    'Refs #64',
    '',
    'The repository release contract versions internal dependency ranges exactly, leaves version PR approval and merge to maintainers, and publishes only after that merge (docs/releasing.md).',
    '',
    '## Acceptance evidence',
    '',
    'Changesets release plan captured immediately before versioning:',
    packages,
    '',
    'The workflow creates or updates this PR and requests current required checks. Check results and human review are pending independently of this body.',
    '',
    '## Risks and limitations',
    '',
    'This automation does not approve or merge this PR. npm versions are immutable once published, so review generated versions, changelogs, internal dependency ranges, current checks, and review feedback before merge. A package left at the reserved bootstrap version 0.0.0 stops the release before anything is published.',
    '',
    '## Attribution',
    '',
    'Implementer: Changesets automation (GitHub Action)',
    'Agent assistance: None',
    '',
  ].join('\n'));
}

main().catch(error => {
  process.stderr.write(`Release PR evidence generation failed: ${error.message}\n`);
  process.exitCode = 1;
});
