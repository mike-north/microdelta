/**
 * PR evidence is untrusted data. This dependency-free checker verifies only the
 * delivery contract's mechanically observable fields; it cannot certify truth,
 * semantic review, or distinct identities behind shared GitHub credentials.
 */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/** Exact template headings keep omissions actionable for authors and reviewers. */
const headings = [
  'Problem and resulting behavior',
  'Governing issue and contracts',
  'Acceptance evidence',
  'Risks and limitations',
  'Attribution',
];

/** Recognize the previous prose template as well as explicit unfinished markers. */
const templateInstructions = [
  'Describe the concrete problem and what this change makes possible.',
  'Identify the owning context, requirement IDs, and preserved invariants.',
  'Map each issue criterion to a named test or observed artifact.',
  'State unresolved concerns or explicitly say none identified within the issue scope.',
  'Identify the implementer and any agent assistance accurately.',
];

/** Return stable diagnostics without reflecting arbitrary PR text into CI logs. */
export function validateBody(body) {
  const text = typeof body === 'string' ? body.replace(/<!--[^]*?(?:-->|$)/gu, '') : '';
  const sections = new Map();
  const problems = [];
  let heading;
  for (const line of text.split(/\r?\n/u)) {
    const match = /^##\s+(.+?)\s*#*\s*$/u.exec(line);
    if (match) {
      heading = match[1];
      if (sections.has(heading)) problems.push('Remove duplicate section headings.');
      else sections.set(heading, '');
    } else if (heading) {
      sections.set(heading, `${sections.get(heading)}\n${line}`);
    }
  }
  for (const required of headings) {
    if (!sections.get(required)?.trim()) problems.push(`Fill the "${required}" section.`);
  }
  const contracts = sections.get('Governing issue and contracts') ?? '';
  if (!/^Refs\s+#[1-9]\d*\b/mu.test(contracts)) {
    problems.push('Add an issue reference using "Refs #N" in Governing issue and contracts.');
  }
  const normalized = text.replace(/\s+/gu, ' ');
  if (templateInstructions.some(instruction => normalized.includes(instruction)) ||
      /^\s*(?:[-*]\s+)?(?:(?:Implementer|Agent assistance):\s*)?(?:TODO|TBD|PLACEHOLDER|\[fill[^\]]*\])\s*[.!]?\s*$/imu.test(text)) {
    problems.push('Replace untouched template placeholders with concrete evidence.');
  }
  const attribution = sections.get('Attribution') ?? '';
  for (const label of ['Implementer', 'Agent assistance']) {
    if (!new RegExp(`^${label}:[ \\t]*\\S[^\\r\\n]*$`, 'mu').test(attribution)) {
      problems.push(`Add "${label}:" with accurate attribution (agent assistance may explicitly be None).`);
    }
  }
  return problems;
}

/**
 * Webhooks identify the PR, not its current body. Every run, including a rerun
 * of an older event or a dispatch for an automation-created PR, reads live
 * metadata. A moved head fails closed rather than attributing evidence to
 * another commit.
 */
export async function validateEvent(eventName, event, fetchPullRequest, workflowSha) {
  if (eventName === 'push') return [];
  let number;
  let eventHead;
  if (eventName === 'pull_request') {
    number = event?.number;
    eventHead = event?.pull_request?.head?.sha;
  } else if (eventName === 'workflow_dispatch') {
    // The dispatch ref must be the PR's current head, not a caller-supplied SHA.
    number = Number(event?.inputs?.pr_number);
    eventHead = workflowSha;
  } else {
    throw new Error('Unsupported metadata event.');
  }
  if (!Number.isSafeInteger(number) || number < 1 || typeof eventHead !== 'string') {
    throw new Error('PR event payload is missing its number or head.');
  }
  const current = await fetchPullRequest(number);
  if (current?.number !== number || typeof current?.head?.sha !== 'string' ||
      !(typeof current.body === 'string' || current.body === null)) {
    throw new Error('Invalid PR API response.');
  }
  if (current.head.sha !== eventHead) {
    throw new Error('PR head changed; wait for the synchronize run on the current head.');
  }
  return validateBody(current.body);
}

/** Read only the fixed GitHub API origin; neither PR text nor redirects choose it. */
async function fetchCurrentPullRequest(number) {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository) || !token) {
    throw new Error('GitHub mode requires GITHUB_REPOSITORY and a read-only GITHUB_TOKEN.');
  }
  const response = await fetch(`https://api.github.com/repos/${repository}/pulls/${number}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Cannot read current PR metadata: HTTP ${response.status}.`);
  return response.json();
}

/** Explicit modes prevent a missing local body from silently producing success. */
async function main(args) {
  let problems;
  if (args.length === 2 && args[0] === '--body-file') {
    problems = validateBody(await readFile(args[1], 'utf8'));
  } else if (args.length === 1 && args[0] === '--github-event') {
    const eventName = process.env.GITHUB_EVENT_NAME;
    // Push checks remain runnable without either an event file or API credentials.
    const event = eventName === 'push' ? {} : JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
    problems = await validateEvent(eventName, event, fetchCurrentPullRequest, process.env.GITHUB_SHA);
  } else {
    throw new Error('Usage: node tooling/pr-metadata.mjs --body-file PATH | --github-event');
  }
  if (problems.length) {
    process.stderr.write(`${problems.join('\n')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('PR metadata completeness passed (push events have no PR metadata requirement).\n');
  }
}

/** Imports expose pure validation to fixtures without running the CLI. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`PR metadata check failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
