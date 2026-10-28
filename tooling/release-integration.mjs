/**
 * Observe the existing exact-commit main Check that authorizes release packaging.
 *
 * The native Release push and its provenance stay unchanged. This module reads
 * Actions evidence; it never starts checks, grants release eligibility, or treats
 * a receipt as reusable authority. The waiting gate and publisher compose this
 * same proof with their separate latest-Version-Packages decision. Current run
 * selection and before/after reads bound races with reruns; GitHub and npm do not
 * offer an atomic transaction, so every actual publish needs a fresh assertion.
 *
 * @see https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-workflow
 * @see https://docs.github.com/en/rest/actions/workflow-jobs#list-jobs-for-a-workflow-run
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { trustedPublisher } from './release-graph.mjs';

/** The source file, rather than its display name alone, identifies main integration. */
const WORKFLOW_PATH = '.github/workflows/check.yml';
/** Native main-push run paths may include GitHub's explicit main reference suffix. */
const RUN_PATHS = new Set([WORKFLOW_PATH, `${WORKFLOW_PATH}@main`, `${WORKFLOW_PATH}@refs/heads/main`]);
/** Node 24 is the supported main baseline; a retired Node 22 result cannot supply this proof. */
const REQUIRED_JOBS = ['core (24)'];
/** Step names are GitHub's native labels for the unconditional Check run commands. */
const REQUIRED_STEPS = ['Run npm ci', 'Run npm run check', 'Run npm test', 'Run npm run build'];
/** Scheduling and nonterminal rerun states can be observed again by the waiting gate. */
const PENDING_STATUSES = new Set(['queued', 'requested', 'waiting', 'pending', 'in_progress']);
/** Every recognized terminal conclusion other than success refuses release immediately. */
const CONCLUSIONS = new Set(['success', 'failure', 'cancelled', 'skipped', 'neutral', 'timed_out', 'action_required', 'stale']);
/** Every page and observation has a finite work bound, even on malformed or changing APIs. */
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
/** Filtered workflow-run searches truncate at 1,000; reaching the cap cannot prove coverage. */
const FILTERED_RUN_LIMIT = 1000;
/** Per-request and total-observation deadlines also cover reading the JSON response body. */
const REQUEST_TIMEOUT_MS = 10_000;
const OBSERVATION_TIMEOUT_MS = 60_000;
/** The selected gate budget allows normal main integration without holding publication credentials. */
const WAIT_TIMEOUT_MS = 120 * 60_000;
const POLL_INTERVAL_MS = 30_000;

/** Evidence that is invalid, unsuccessful, unavailable, or too late cannot authorize release. */
export class IntegrationEvidenceError extends Error {
  constructor(message) { super(message); this.name = 'IntegrationEvidenceError'; }
}

/** Validate the caller's native release identity before any authenticated request. */
function validateEnvironment(env) {
  if (env.GITHUB_REPOSITORY !== trustedPublisher.repository) throw new IntegrationEvidenceError(`Main integration only supports ${trustedPublisher.repository}.`);
  if (typeof env.GITHUB_SHA !== 'string' || !/^[0-9a-f]{40}$/u.test(env.GITHUB_SHA)) throw new IntegrationEvidenceError('Main integration needs an exact full commit SHA.');
  if (env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_REF !== 'refs/heads/main') throw new IntegrationEvidenceError('Main integration requires the original main push identity.');
  if (typeof env.GITHUB_TOKEN !== 'string' || !env.GITHUB_TOKEN) throw new IntegrationEvidenceError('GITHUB_TOKEN is required to read main integration.');
}

/** API identities are positive safe integers; string coercion never supplies evidence. */
function positiveId(value) { return Number.isSafeInteger(value) && value > 0; }

/** Distinguish a valid nonterminal state from a terminal result without coercing malformed primitives. */
function validateState(value, label) {
  if (PENDING_STATUSES.has(value?.status) && value.conclusion === null) return;
  if (value?.status === 'completed' && typeof value.conclusion === 'string' && CONCLUSIONS.has(value.conclusion)) return;
  throw new IntegrationEvidenceError(`Malformed ${label} status or conclusion in main integration.`);
}

/** Pending evidence may be re-observed; every unsuccessful terminal result stops the waiting gate. */
function pendingOrThrow(value, label) {
  if (value.status !== 'completed') return { state: 'pending', reason: `${label} is ${value.status}.` };
  if (value.conclusion !== 'success') throw new IntegrationEvidenceError(`Main integration unsuccessful: ${label} concluded ${value.conclusion}.`);
  return null;
}

/** Read a bounded canonical repository resource; payload URLs never redirect authenticated requests. */
function reader(env, { fetchImpl, now, deadline }) {
  const apiUrl = (env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/$/u, '');
  const prefix = `/repos/${trustedPublisher.repository}`;
  const end = Math.min(deadline ?? Infinity, now() + OBSERVATION_TIMEOUT_MS);
  const get = async resource => {
    const remaining = Math.floor(end - now());
    if (remaining <= 0) throw new IntegrationEvidenceError('Main integration observation deadline expired.');
    try {
      const response = await fetchImpl(`${apiUrl}${resource}`, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, remaining)),
        headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${env.GITHUB_TOKEN}`, 'x-github-api-version': '2022-11-28' },
      });
      if (!response.ok) throw new Error(`GitHub API ${resource} returned ${response.status}`);
      const data = await response.json();
      if (now() >= end) throw new Error('observation deadline expired');
      return data;
    } catch (error) {
      throw new IntegrationEvidenceError(`Main integration read refused: ${error.message}`);
    }
  };
  /** Counts, full page lengths and distinct identities prove this selected listing was not truncated. */
  const pages = async (resource, key, limit) => {
    const rows = []; const ids = new Set(); let total;
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const data = await get(`${resource}&per_page=${PAGE_SIZE}&page=${page}`);
      if (!Number.isSafeInteger(data?.total_count) || data.total_count < 0 || data.total_count > limit || !Array.isArray(data[key])) {
        throw new IntegrationEvidenceError(`Malformed or incomplete main integration ${key} coverage/count limit.`);
      }
      total ??= data.total_count;
      if (data.total_count !== total || data[key].length !== Math.min(PAGE_SIZE, total - rows.length)) {
        throw new IntegrationEvidenceError(`Incomplete or changing main integration ${key} pages.`);
      }
      for (const row of data[key]) {
        if (!positiveId(row?.id)) throw new IntegrationEvidenceError(`Malformed main integration ${key} identity.`);
        if (ids.has(row.id)) throw new IntegrationEvidenceError(`Duplicate main integration ${key} identity.`);
        ids.add(row.id); rows.push(row);
      }
      if (rows.length === total) return rows;
    }
    throw new IntegrationEvidenceError(`Main integration ${key} exceeded its page-work limit.`);
  };
  return { apiUrl, prefix, get, pages };
}

/** Resolve the intended workflow by canonical filename, binding its repository URL and immutable ID. */
async function workflowIdentity(api) {
  const workflow = await api.get(`${api.prefix}/actions/workflows/check.yml`);
  if (!positiveId(workflow?.id) || workflow.path !== WORKFLOW_PATH || workflow.name !== 'Check' || workflow.state !== 'active'
    || workflow.url !== `${api.apiUrl}${api.prefix}/actions/workflows/${workflow.id}`) {
    throw new IntegrationEvidenceError('Canonical main integration workflow identity is invalid or unavailable.');
  }
  return workflow;
}

/** A run must prove every native source dimension; an identically named PR or manual check cannot substitute. */
function validateRun(run, env, api, workflow, repositoryId, expectedId) {
  if (!positiveId(run?.id) || !positiveId(run.run_number) || !positiveId(run.run_attempt)
    || (expectedId !== undefined && run.id !== expectedId)
    || run.workflow_id !== workflow.id || run.name !== 'Check' || !RUN_PATHS.has(run.path)
    || run.repository?.id !== repositoryId || run.repository.full_name !== trustedPublisher.repository
    || run.head_repository?.id !== repositoryId || run.head_repository.full_name !== trustedPublisher.repository
    || run.head_sha !== env.GITHUB_SHA || run.head_branch !== 'main' || run.event !== 'push'
    || run.url !== `${api.apiUrl}${api.prefix}/actions/runs/${run.id}`
    || run.html_url !== `https://github.com/${trustedPublisher.repository}/actions/runs/${run.id}`
    || run.workflow_url !== `${api.apiUrl}${api.prefix}/actions/workflows/${workflow.id}`) {
    throw new IntegrationEvidenceError('Main integration run has malformed or mismatched source identity.');
  }
  validateState(run, 'run');
}

/** Workflow run_number orders distinct runs; run_attempt orders reruns of that same immutable identity. */
async function latestRun(env, api, workflow, repositoryId) {
  const query = new URLSearchParams({ event: 'push', branch: 'main', head_sha: env.GITHUB_SHA });
  const runs = await api.pages(`${api.prefix}/actions/workflows/${workflow.id}/runs?${query}`, 'workflow_runs', FILTERED_RUN_LIMIT - 1);
  const numbers = new Set(); let latest;
  for (const run of runs) {
    validateRun(run, env, api, workflow, repositoryId);
    if (numbers.has(run.run_number)) throw new IntegrationEvidenceError('Ambiguous main integration workflow run number.');
    numbers.add(run.run_number);
    if (latest === undefined || run.run_number > latest.run_number) latest = run;
  }
  return latest;
}

/** These mutable fields must agree across current selection and the before/after job observation. */
function sameObservation(left, right) {
  return left !== undefined && right !== undefined && ['id', 'run_number', 'run_attempt', 'status', 'conclusion'].every(key => left[key] === right[key]);
}

/**
 * GitHub's latest jobs view owns failed-job-only rerun selection. A required
 * successful job may retain an earlier attempt, so equality with the current run's
 * attempt is deliberately not required. Same run, source, complete commands,
 * and stable surrounding run observations remain mandatory.
 */
async function matrixProof(env, api, run) {
  const jobs = await api.pages(`${api.prefix}/actions/runs/${run.id}/jobs?filter=latest`, 'jobs', PAGE_SIZE * MAX_PAGES);
  const selected = new Map();
  for (const job of jobs) {
    if (typeof job.name !== 'string' || !job.name || job.run_id !== run.id || job.head_sha !== env.GITHUB_SHA
      || job.head_branch !== 'main' || job.workflow_name !== 'Check'
      || job.run_url !== `${api.apiUrl}${api.prefix}/actions/runs/${run.id}`
      || job.url !== `${api.apiUrl}${api.prefix}/actions/jobs/${job.id}`
      || (job.run_attempt !== undefined && (!positiveId(job.run_attempt) || job.run_attempt > run.run_attempt))) {
      throw new IntegrationEvidenceError('Main integration job has malformed or mismatched source identity.');
    }
    validateState(job, 'job');
    if (!REQUIRED_JOBS.includes(job.name)) continue;
    if (selected.has(job.name)) throw new IntegrationEvidenceError(`Ambiguous main integration matrix job ${job.name}.`);
    selected.set(job.name, job);
  }
  const proof = []; let pending;
  for (const name of REQUIRED_JOBS) {
    const job = selected.get(name);
    if (job === undefined) { pending ??= `Main integration ${name} is not yet visible.`; continue; }
    const jobPending = pendingOrThrow(job, name);
    if (jobPending) pending ??= jobPending.reason;
    if (!Array.isArray(job.steps) || job.steps.length > 1000) throw new IntegrationEvidenceError(`Malformed main integration steps for ${name}.`);
    const numbers = new Set(); const steps = new Map();
    for (const step of job.steps) {
      if (!positiveId(step?.number) || typeof step.name !== 'string' || !step.name || numbers.has(step.number)) {
        throw new IntegrationEvidenceError(`Malformed or duplicate main integration step identity for ${name}.`);
      }
      numbers.add(step.number); validateState(step, 'step');
      if (!REQUIRED_STEPS.includes(step.name)) continue;
      if (steps.has(step.name)) throw new IntegrationEvidenceError(`Ambiguous main integration command ${step.name}.`);
      steps.set(step.name, step);
      const stepPending = pendingOrThrow(step, `${name}: ${step.name}`);
      if (stepPending) pending ??= stepPending.reason;
    }
    const required = REQUIRED_STEPS.map(stepName => steps.get(stepName));
    if (required.some(step => step === undefined)) pending ??= `Main integration commands for ${name} are not yet visible.`;
    proof.push({ id: job.id, name, status: job.status, conclusion: job.conclusion, attempt: job.run_attempt ?? null,
      steps: required.filter(step => step !== undefined).map(({ number, name: stepName, status, conclusion }) => ({ number, name: stepName, status, conclusion })) });
  }
  return pending ? { state: 'pending', reason: pending } : { state: 'success', jobs: proof };
}

/** Observe one bounded, complete current proof; invalid/unavailable or terminal unsuccessful evidence throws. */
export async function readIntegrationEvidence(env, { fetchImpl = fetch, now = () => performance.now(), deadline } = {}) {
  validateEnvironment(env);
  const api = reader(env, { fetchImpl, now, deadline });
  const repository = await api.get(api.prefix);
  if (!positiveId(repository?.id) || repository.full_name !== trustedPublisher.repository) throw new IntegrationEvidenceError('Main integration repository identity is invalid.');
  const workflow = await workflowIdentity(api);
  const selected = await latestRun(env, api, workflow, repository.id);
  if (selected === undefined) return { state: 'pending', reason: 'Main integration Check is not yet scheduled.' };
  const selectionPending = pendingOrThrow(selected, 'current Check run');
  if (selectionPending) return selectionPending;
  const before = await api.get(`${api.prefix}/actions/runs/${selected.id}`);
  validateRun(before, env, api, workflow, repository.id, selected.id);
  const beforePending = pendingOrThrow(before, 'current Check run');
  if (beforePending) return beforePending;
  if (!sameObservation(selected, before)) return { state: 'pending', reason: 'Main integration current run changed during selection.' };
  const matrix = await matrixProof(env, api, before);
  const after = await api.get(`${api.prefix}/actions/runs/${selected.id}`);
  validateRun(after, env, api, workflow, repository.id, selected.id);
  const afterPending = pendingOrThrow(after, 'current Check run');
  if (afterPending) return afterPending;
  const currentWorkflow = await workflowIdentity(api);
  if (currentWorkflow.id !== workflow.id) throw new IntegrationEvidenceError('Canonical main integration workflow identity changed during observation.');
  const latest = await latestRun(env, api, workflow, repository.id);
  if (latest !== undefined) {
    const latestPending = pendingOrThrow(latest, 'current Check run');
    if (latestPending) return latestPending;
  }
  if (!sameObservation(before, after) || !sameObservation(after, latest)) return { state: 'pending', reason: 'Main integration selection or rerun attempt changed during observation.' };
  if (matrix.state === 'pending') return matrix;
  return { state: 'success', receipt: { repository: trustedPublisher.repository, commit: env.GITHUB_SHA,
    workflow: { id: workflow.id, path: WORKFLOW_PATH },
    run: { id: after.id, number: after.run_number, attempt: after.run_attempt, url: after.html_url, status: after.status, conclusion: after.conclusion },
    jobs: matrix.jobs, observedAt: new Date().toISOString() } };
}

/** The OIDC-capable publisher never waits or trusts a prior receipt after packaging or concurrency waits. */
export async function assertMainIntegration(env, options) {
  const evidence = await readIntegrationEvidence(env, options);
  if (evidence.state !== 'success') throw new IntegrationEvidenceError(`Main integration is pending: ${evidence.reason}`);
  return evidence.receipt;
}

/** Poll only missing/nonterminal/changing visibility within the selected deadline; errors never become retries. */
export async function waitForMainIntegration(env, { read = readIntegrationEvidence, now = () => performance.now(), sleep: pause = sleep } = {}) {
  validateEnvironment(env);
  const deadline = now() + WAIT_TIMEOUT_MS;
  while (now() < deadline) {
    const evidence = await read(env, { now, deadline });
    if (now() >= deadline) break;
    if (evidence.state === 'success') return evidence.receipt;
    await pause(Math.min(POLL_INTERVAL_MS, deadline - now()));
  }
  throw new IntegrationEvidenceError('Main integration timed out at its 120-minute deadline; no packaging or publication is authorized.');
}

/** The read-only workflow gate has no override surface for its source identity or wait budget. */
async function main() {
  if (process.argv.slice(2).join(' ') !== '--wait') throw new IntegrationEvidenceError('Usage: node tooling/release-integration.mjs --wait');
  const receipt = await waitForMainIntegration(process.env);
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => { process.stderr.write(`Main integration gate refused: ${error.message}\n`); process.exitCode = 1; });
}
