/**
 * Exact main integration is an observation of GitHub's current run, never a substitute run or a cached authorization.
 * Pure HTTP fixtures challenge source identity, complete current selection, reruns, and the finite waiting boundary.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readIntegrationEvidence, assertMainIntegration, waitForMainIntegration } from './release-integration.mjs';
import { checkRunId, checkWorkflowId, integrationRepository, jobsFixture, repositoryFixture, runFixture, workflowFixture } from './fixtures/release-integration.mjs';

/** A full exact merge identity is required before any authenticated request. */
const sha = 'a'.repeat(40);
/** Standard Actions metadata is the same boundary used by the waiting job and publisher. */
const env = { GITHUB_REPOSITORY: integrationRepository, GITHUB_SHA: sha, GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', GITHUB_TOKEN: 'fixture-token' };
/** Canonical REST paths keep each fixture scoped to the repository and selected run. */
const prefix = `/repos/${integrationRepository}`;

/** Complete REST pages expose their selected row count, rather than treating the first page as a result. */
function page(key, rows, total = rows.length) { return { total_count: total, [key]: rows }; }

/**
 * Mutable observations model GitHub transitions without secrets, writes, real requests or wall-clock waiting.
 * A custom route may replace any response; all ordinary requests remain strict GETs with the job token.
 */
function scenario(overrides = {}) {
  const state = { repository: repositoryFixture(), workflow: workflowFixture(), runs: [runFixture(sha)], jobs: jobsFixture(sha),
    runReads: 0, listReads: 0, workflowReads: 0, calls: [], ...overrides };
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url);
    state.calls.push({ url: parsed, options });
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.authorization, 'Bearer fixture-token');
    assert.ok(options.signal instanceof AbortSignal);
    let body;
    if (parsed.pathname === `${prefix}/actions/workflows/check.yml`) state.workflowReads += 1;
    if (parsed.pathname === `${prefix}/actions/workflows/${checkWorkflowId}/runs`) state.listReads += 1;
    if (parsed.pathname === `${prefix}/actions/runs/${checkRunId}`) state.runReads += 1;
    const replaced = state.route?.(parsed, state);
    if (replaced !== undefined) return replaced instanceof Response ? replaced : Response.json(replaced);
    if (parsed.pathname === prefix) body = state.repository;
    else if (parsed.pathname === `${prefix}/actions/workflows/check.yml`) body = state.workflow;
    else if (parsed.pathname === `${prefix}/actions/workflows/${checkWorkflowId}/runs`) body = page('workflow_runs', state.runs);
    else if (/\/actions\/runs\/\d+$/u.test(parsed.pathname)) body = state.run?.(state.runReads) ?? state.runs.find(run => run?.id === Number(parsed.pathname.split('/').at(-1)));
    else if (/\/actions\/runs\/\d+\/jobs$/u.test(parsed.pathname)) body = page('jobs', state.jobs);
    else throw new Error(`Unexpected read: ${url}`);
    return Response.json(body ?? null);
  };
  return { state, options: { fetchImpl }, read: () => readIntegrationEvidence(env, { fetchImpl }) };
}

test('complete successful main integration records the exact workflow, current run and both command proofs', async () => {
  const { read, state } = scenario();
  const evidence = await read();
  assert.equal(evidence.state, 'success');
  assert.equal(evidence.receipt.repository, integrationRepository);
  assert.equal(evidence.receipt.commit, sha);
  assert.deepEqual(evidence.receipt.workflow, { id: checkWorkflowId, path: '.github/workflows/check.yml' });
  assert.equal(evidence.receipt.run.id, checkRunId);
  assert.equal(evidence.receipt.run.attempt, 1);
  assert.deepEqual(evidence.receipt.jobs.map(job => job.name), ['core (22)', 'core (24)']);
  assert.ok(evidence.receipt.jobs.every(job => job.steps.length === 4 && job.steps.every(step => step.status === 'completed' && step.conclusion === 'success')));
  assert.match(evidence.receipt.observedAt, /^\d{4}-\d{2}-\d{2}T/u);
  assert.ok(state.runReads >= 2 && state.listReads >= 2 && state.workflowReads >= 2, 'success requires before/after current selection');
  for (const { url } of state.calls.filter(call => call.url.pathname.endsWith('/runs'))) {
    assert.equal(url.searchParams.get('event'), 'push');
    assert.equal(url.searchParams.get('branch'), 'main');
    assert.equal(url.searchParams.get('head_sha'), sha);
    assert.equal(url.searchParams.get('status'), null, 'success-only filtering could hide a current pending attempt');
  }
  assert.ok(state.calls.filter(call => call.url.pathname.endsWith('/jobs')).every(call => call.url.searchParams.get('filter') === 'latest'));
});

for (const suffix of ['', '@main', '@refs/heads/main']) {
  test(`canonical workflow run path accepts the native main reference form ${suffix}`, async () => {
    const { read } = scenario({ runs: [runFixture(sha, { path: `.github/workflows/check.yml${suffix}` })] });
    assert.equal((await read()).state, 'success');
  });
}

for (const [label, changes] of [
  ['another repository', { GITHUB_REPOSITORY: 'someone/microdelta' }],
  ['missing token', { GITHUB_TOKEN: '' }], ['short SHA', { GITHUB_SHA: 'main' }], ['array SHA', { GITHUB_SHA: [sha] }],
  ['manual dispatch', { GITHUB_EVENT_NAME: 'workflow_dispatch' }], ['PR event', { GITHUB_EVENT_NAME: 'pull_request' }],
  ['another branch', { GITHUB_REF: 'refs/heads/feature' }],
]) {
  test(`invalid observation request refuses ${label} before HTTP`, async () => {
    const { state, options } = scenario();
    await assert.rejects(readIntegrationEvidence({ ...env, ...changes }, options));
    assert.equal(state.calls.length, 0);
  });
}

for (const [label, override] of [
  ['repository', { repository: { id: 1, full_name: 'someone/microdelta' } }],
  ['head repository', { head_repository: { id: 1, full_name: 'someone/microdelta' } }],
  ['repository ID', { repository: { id: 51, full_name: integrationRepository } }],
  ['head', { head_sha: 'b'.repeat(40) }], ['workflow ID', { workflow_id: 999 }],
  ['workflow path', { path: '.github/workflows/not-check.yml' }], ['workflow reference', { path: '.github/workflows/check.yml@feature' }],
  ['display name', { name: 'Other' }], ['event', { event: 'pull_request' }], ['branch', { head_branch: 'other' }],
  ['run URL', { url: 'https://api.github.com/repos/other/repo/actions/runs/200' }],
  ['workflow URL', { workflow_url: 'https://api.github.com/repos/other/repo/actions/workflows/100' }],
  ['HTML URL', { html_url: 'https://github.com/other/repo/actions/runs/200' }],
  ['run ID', { id: '200' }], ['run number', { run_number: 0 }], ['run attempt', { run_attempt: null }],
  ['unknown status', { status: 'unknown', conclusion: null }], ['coerced success', { conclusion: ['success'] }],
  ['pending with conclusion', { status: 'queued', conclusion: 'success' }], ['completion without conclusion', { conclusion: null }],
]) {
  test(`run evidence refuses wrong or malformed ${label}`, async () => {
    await assert.rejects(scenario({ runs: [runFixture(sha, override)] }).read());
  });
}

for (const override of [{ id: 0 }, { id: '100' }, { name: 'Other' }, { path: '.github/workflows/other.yml' }, { state: 'disabled_manually' }, { url: 'https://api.github.com/repos/other/repo/actions/workflows/100' }]) {
  test(`canonical workflow lookup refuses ${JSON.stringify(override)}`, async () => {
    await assert.rejects(scenario({ workflow: workflowFixture(undefined, override) }).read());
  });
}

test('no matching main Check is pending scheduling evidence, never success', async () => {
  assert.equal((await scenario({ runs: [] }).read()).state, 'pending');
});
for (const status of ['queued', 'requested', 'waiting', 'pending', 'in_progress']) {
  test(`a current ${status} run remains pending`, async () => {
    assert.equal((await scenario({ runs: [runFixture(sha, { status, conclusion: null })] }).read()).state, 'pending');
  });
}
for (const conclusion of ['failure', 'cancelled', 'skipped', 'neutral', 'timed_out', 'action_required', 'stale']) {
  test(`a current completed ${conclusion} run fails immediately`, async () => {
    await assert.rejects(scenario({ runs: [runFixture(sha, { conclusion })] }).read(), /integration.*(?:failed|unsuccessful)/iu);
  });
}

for (const [status, conclusion] of [['queued', null], ['completed', 'failure']]) {
  for (const reverse of [false, true]) {
    test(`old success never masks a newer canonical ${status}/${conclusion}, either order ${reverse}`, async () => {
      const runs = [runFixture(sha), runFixture(sha, { id: 201, run_number: 11, status, conclusion })];
      if (reverse) runs.reverse();
      const { read } = scenario({ runs });
      if (conclusion === 'failure') await assert.rejects(read(), /failed|unsuccessful/u);
      else assert.equal((await read()).state, 'pending');
    });
  }
}

test('a newer successful canonical run supersedes an earlier failure by run number, not array order', async () => {
  const runs = [runFixture(sha, { conclusion: 'failure' }), runFixture(sha, { id: 201, run_number: 11 })];
  const jobs = jobsFixture(sha).map(job => ({ ...job, run_id: 201, run_url: `https://api.github.com${prefix}/actions/runs/201` }));
  assert.equal((await scenario({ runs, jobs }).read()).state, 'success');
});

test('a failed-job rerun retains a successful earlier-attempt sibling in the canonical latest jobs view', async () => {
  const jobs = jobsFixture(sha); jobs[1].run_attempt = 2;
  const { read } = scenario({ runs: [runFixture(sha, { run_attempt: 2 })], jobs });
  assert.equal((await read()).state, 'success');
});

test('the documented job shape without an attempt still proves the same canonical run and commit', async () => {
  const jobs = jobsFixture(sha).map(({ run_attempt: _attempt, ...job }) => job);
  assert.equal((await scenario({ jobs }).read()).state, 'success');
});

for (const [label, mutate] of [
  ['missing Node 24', jobs => jobs.slice(0, 1)],
  ['missing command', jobs => { jobs[0].steps.pop(); return jobs; }],
  ['pending command', jobs => { Object.assign(jobs[0].steps[3], { status: 'in_progress', conclusion: null }); return jobs; }],
  ['pending matrix member', jobs => { Object.assign(jobs[1], { status: 'queued', conclusion: null }); return jobs; }],
]) {
  test(`${label} waits for complete visible current results`, async () => {
    const { read } = scenario({ jobs: mutate(jobsFixture(sha)) });
    assert.equal((await read()).state, 'pending');
  });
}
for (const [label, mutate] of [
  ['duplicate matrix name', jobs => [...jobs, { ...jobs[0], id: 999, url: `https://api.github.com${prefix}/actions/jobs/999` }]],
  ['duplicate command', jobs => { jobs[0].steps.push({ ...jobs[0].steps[0], number: 9 }); return jobs; }],
  ['duplicate step identity', jobs => { jobs[0].steps[1].number = 1; return jobs; }],
  ['wrong run', jobs => { jobs[0].run_id = 999; return jobs; }],
  ['wrong commit', jobs => { jobs[0].head_sha = 'b'.repeat(40); return jobs; }],
  ['wrong branch', jobs => { jobs[0].head_branch = 'feature'; return jobs; }],
  ['wrong workflow name', jobs => { jobs[0].workflow_name = 'Other'; return jobs; }],
  ['future attempt', jobs => { jobs[0].run_attempt = 2; return jobs; }],
  ['wrong job URL', jobs => { jobs[0].url = 'https://api.github.com/repos/other/repo/actions/jobs/300'; return jobs; }],
  ['wrong run URL', jobs => { jobs[0].run_url = 'https://api.github.com/repos/other/repo/actions/runs/200'; return jobs; }],
  ['missing steps', jobs => { delete jobs[0].steps; return jobs; }],
  ['coerced successful step', jobs => { jobs[0].steps[0].conclusion = ['success']; return jobs; }],
  ...['failure', 'cancelled', 'skipped', 'timed_out', 'neutral', 'stale', 'action_required'].flatMap(conclusion => [
    [`${conclusion} job`, jobs => { jobs[0].conclusion = conclusion; return jobs; }],
    [`${conclusion} step`, jobs => { jobs[0].steps[0].conclusion = conclusion; return jobs; }],
  ]),
]) {
  test(`required matrix proof rejects ${label}`, async () => {
    await assert.rejects(scenario({ jobs: mutate(jobsFixture(sha)) }).read());
  });
}

for (const [key, path] of [['workflow_runs', `${prefix}/actions/workflows/100/runs`], ['jobs', `${prefix}/actions/runs/200/jobs`]]) {
  for (const [label, body] of [
    ['null', null], ['missing count', { [key]: [] }], ['negative count', page(key, [], -1)],
    ['noninteger count', page(key, [], 1.5)], ['unsafe count', page(key, [], Number.MAX_SAFE_INTEGER + 1)],
    ['missing rows', { total_count: 0 }], ['short page', page(key, [], 1)], ['malformed row', page(key, [null])],
  ]) {
    test(`${key} pagination refuses ${label}`, async () => {
      await assert.rejects(scenario({ route: url => url.pathname === path ? Response.json(body) : undefined }).read());
    });
  }
  test(`${key} pagination refuses overlapping row identities`, async () => {
    const rows = key === 'jobs' ? jobsFixture(sha) : [runFixture(sha)];
    await assert.rejects(scenario({ route: url => url.pathname === path ? page(key, [...rows, rows[0]]) : undefined }).read(), /duplicate/iu);
  });
}

test('ambiguous equal workflow run numbers fail closed', async () => {
  await assert.rejects(scenario({ runs: [runFixture(sha), runFixture(sha, { id: 201 })] }).read(), /ambiguous|run number/iu);
});

test('the filtered 1000-run search cap cannot authorize from an uncertain corpus', async () => {
  await assert.rejects(scenario({ route: url => url.pathname.endsWith('/runs') ? page('workflow_runs', [], 1000) : undefined }).read(), /limit|coverage|incomplete/iu);
});

/** Earlier pages deliberately have no authorizing result; the current result is on the final page. */
function pagedRuns() { return Array.from({ length: 101 }, (_, index) => runFixture(sha, { id: 1000 + index, run_number: index + 1, status: index === 100 ? 'queued' : 'completed', conclusion: index === 100 ? null : 'success' })); }

test('complete run pagination reaches a newer pending result beyond an older success page', async () => {
  const rows = pagedRuns();
  const { read, state } = scenario({ route: url => url.pathname.endsWith('/runs') ? page('workflow_runs', rows.slice((Number(url.searchParams.get('page')) - 1) * 100, Number(url.searchParams.get('page')) * 100), rows.length) : undefined });
  assert.equal((await read()).state, 'pending');
  assert.ok(state.calls.some(call => call.url.searchParams.get('page') === '2'));
});

for (const failure of ['unavailable', 'changed count', 'overlap', 'empty']) {
  test(`a later run page that is ${failure} cannot authorize`, async () => {
    const rows = pagedRuns();
    await assert.rejects(scenario({ route: url => {
      if (!url.pathname.endsWith('/runs')) return undefined;
      if (url.searchParams.get('page') === '1') return page('workflow_runs', rows.slice(0, 100), 101);
      if (failure === 'unavailable') return new Response('', { status: 503 });
      return page('workflow_runs', failure === 'empty' ? [] : [failure === 'overlap' ? rows[0] : rows[100]], failure === 'changed count' ? 102 : 101);
    } }).read());
  });
}

test('current required jobs may occur after a full page of other jobs', async () => {
  const extras = Array.from({ length: 100 }, (_, index) => ({ ...jobsFixture(sha)[0], id: index + 1000, name: `other ${index}`, url: `https://api.github.com${prefix}/actions/jobs/${index + 1000}` }));
  const all = [...extras, ...jobsFixture(sha)];
  assert.equal((await scenario({ route: url => url.pathname.endsWith('/jobs') ? page('jobs', all.slice((Number(url.searchParams.get('page')) - 1) * 100, Number(url.searchParams.get('page')) * 100), all.length) : undefined }).read()).state, 'success');
});

for (const failure of ['unavailable', 'changed count', 'overlap', 'empty']) {
  test(`a later jobs page that is ${failure} cannot authorize`, async () => {
    const rows = Array.from({ length: 101 }, (_, index) => ({ ...jobsFixture(sha)[0], id: 1000 + index, name: `other ${index}`, url: `https://api.github.com${prefix}/actions/jobs/${1000 + index}` }));
    await assert.rejects(scenario({ route: url => {
      if (!url.pathname.endsWith('/jobs')) return undefined;
      if (url.searchParams.get('page') === '1') return page('jobs', rows.slice(0, 100), 101);
      if (failure === 'unavailable') return new Response('', { status: 502 });
      return page('jobs', failure === 'empty' ? [] : [failure === 'overlap' ? rows[0] : rows[100]], failure === 'changed count' ? 102 : 101);
    } }).read());
  });
}

for (const [label, run] of [
  ['queued rerun', runFixture(sha, { run_attempt: 2, status: 'queued', conclusion: null })],
  ['new completed attempt', runFixture(sha, { run_attempt: 2 })],
]) {
  test(`an attempt changing during job observation is pending: ${label}`, async () => {
    const { read } = scenario({ run: count => count > 1 ? run : runFixture(sha) });
    assert.equal((await read()).state, 'pending');
  });
}

test('a failed rerun observed after the job read refuses immediately', async () => {
  await assert.rejects(scenario({ run: count => runFixture(sha, count > 1 ? { run_attempt: 2, conclusion: 'failure' } : {}) }).read(), /failed|unsuccessful/u);
});

test('a newly selected higher-numbered pending run during observation cannot hide behind old success', async () => {
  const { read } = scenario({ route: (url, state) => url.pathname.endsWith('/runs') && state.listReads > 1 ? page('workflow_runs', [runFixture(sha), runFixture(sha, { id: 201, run_number: 11, status: 'queued', conclusion: null })]) : undefined });
  assert.equal((await read()).state, 'pending');
});

test('canonical workflow replacement during observation refuses the obsolete identity', async () => {
  await assert.rejects(scenario({ route: (url, state) => url.pathname.endsWith('/check.yml') && state.workflowReads > 1 ? workflowFixture(undefined, { id: 101, url: `https://api.github.com${prefix}/actions/workflows/101` }) : undefined }).read(), /workflow|identity/iu);
});

for (const response of [new Response('', { status: 403 }), new Response('{', { status: 200 })]) {
  test(`unavailable or malformed HTTP evidence refuses (${response.status})`, async () => {
    const { options } = scenario();
    await assert.rejects(readIntegrationEvidence(env, { ...options, fetchImpl: async () => response.clone() }));
  });
}

test('HTTP work is deadline-bound and aborted rather than held indefinitely', async () => {
  await assert.rejects(readIntegrationEvidence(env, { now: () => 0, deadline: 1,
    fetchImpl: async (_url, { signal }) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(Response.json(repositoryFixture())), 1000);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    }),
  }), /read|deadline|timeout|abort/iu);
});

test('the publisher assertion does not wait or reuse a preceding successful receipt', async () => {
  const first = scenario();
  assert.ok((await assertMainIntegration(env, first.options)).run);
  const pending = scenario({ runs: [runFixture(sha, { status: 'queued', conclusion: null })] });
  await assert.rejects(assertMainIntegration(env, pending.options), /pending|not yet|integration/iu);
});

test('the bounded waiter handles missing, pending, then fresh successful evidence', async () => {
  let reads = 0; let clock = 0; const sleeps = [];
  const receipt = { marker: 'current proof' };
  assert.equal(await waitForMainIntegration(env, {
    read: async () => (++reads < 3 ? { state: 'pending', reason: 'not visible yet' } : { state: 'success', receipt }),
    now: () => clock, sleep: async delay => { sleeps.push(delay); clock += delay; },
  }), receipt);
  assert.equal(reads, 3);
  assert.deepEqual(sleeps, [30_000, 30_000]);
});

test('the waiter stops at the 120-minute deadline without another observation or unbounded sleep', async () => {
  let clock = 0; let reads = 0;
  await assert.rejects(waitForMainIntegration(env, {
    read: async () => { reads += 1; return { state: 'pending', reason: 'missing run' }; },
    now: () => clock, sleep: async delay => { assert.equal(delay, 30_000); clock = 120 * 60_000; },
  }), /120|deadline|timed out/iu);
  assert.equal(reads, 1);
});

test('terminal or unreadable evidence stops waiting immediately without retry', async () => {
  let sleeps = 0; let reads = 0;
  await assert.rejects(waitForMainIntegration(env, { read: async () => { reads += 1; throw new Error('terminal failed integration'); }, sleep: async () => { sleeps += 1; } }), /terminal/u);
  assert.equal(reads, 1); assert.equal(sleeps, 0);
});

test('success arriving only after the deadline cannot authorize the waiting gate', async () => {
  let clock = 0;
  await assert.rejects(waitForMainIntegration(env, { now: () => clock, read: async () => { clock = 120 * 60_000 + 1; return { state: 'success', receipt: {} }; } }), /deadline|timed out/iu);
});
