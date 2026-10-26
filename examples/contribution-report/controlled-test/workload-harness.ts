/** REST-shaped fixed dataset and independent observations for the full controlled report workload. */
import { createNodeMachine } from '@microdelta/machine-node';
import { registerSharedRateSurface } from 'microdelta';
import type { IOperationSend, ISharedRateSurfaceDeclaration } from 'microdelta';
import type { IAssessmentRequest, IReportServices } from '../src/controlled/application.js';
import { workloadCardinality, workloadPeople, workloadPull } from './workload-fixture.js';
import type { IWorkloadPerson } from './workload-fixture.js';

/** Counts are taken at the actual service dispatch and evidence-payload boundaries. */
export interface IWorkloadRouteStats {
  readonly sends: number;
  readonly logicalOperations: number;
  readonly retrySends: number;
  readonly responseBytes: number;
}

/** Harness receipt separates provider attempts, application work, and independently seen membership. */
export interface IWorkloadStats {
  readonly routes: Readonly<Record<string, IWorkloadRouteStats>>;
  readonly observedPulls: number;
  readonly observedAssessmentRequests: number;
  readonly maxInFlightGithub: number;
  readonly maxInFlightAssessments: number;
  readonly loadedReviewEntries: number;
  readonly loadedCommentEntries: number;
  readonly loadedInlineEntries: number;
  readonly hydratedPayloadBytes: number;
}

/** Aggregate one authoritative durable row per retained subject without conflating records or acceptances. */
export interface IRetainedSubjectRow { readonly subject: string; readonly results: number; readonly acceptances: number }
/** The store reports subject identities, result records and accepted results as separate quantities. */
export interface IRetainedSubjectCounts { readonly subjects: number; readonly results: number; readonly acceptances: number }

/** Mutable counters remain private to one process and are snapshotted only after report completion. */
interface IRouteCounter { sends: number; responseBytes: number; readonly operations: Map<string, number> }

/** The adapter answers REST requests; the separate expected-ID set is only readable by the harness. */
export interface IWorkloadHarness {
  readonly services: IReportServices;
  readonly expectedPulls: ReadonlySet<string>;
  readonly observedPulls: ReadonlySet<string>;
  stats(): IWorkloadStats;
}

/** Convert Node's resourceUsage.maxRSS (kibibytes) to bytes for comparison with memoryUsage samples. */
export function maxRssBytesFromKibibytes(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) { throw new RangeError('Node maxRSS must be a non-negative integer in kibibytes'); }
  return value * 1_024;
}

/** Group already-aggregated durable store rows by their declared source/step subject prefix. */
export function summarizeRetainedSubjectRows(rows: readonly IRetainedSubjectRow[]): Readonly<Record<string, IRetainedSubjectCounts>> {
  const result: Record<string, { subjects: number; results: number; acceptances: number }> = {};
  for (const row of rows) {
    if (row.subject.length === 0 || !Number.isSafeInteger(row.results) || row.results < 0
      || !Number.isSafeInteger(row.acceptances) || row.acceptances < 0) { throw new RangeError('retained subject rows must contain a subject and non-negative integer counts'); }
    const separator = row.subject.indexOf(':');
    const kind = separator < 0 ? row.subject : row.subject.slice(0, separator);
    const counts = result[kind] ?? { subjects: 0, results: 0, acceptances: 0 };
    counts.subjects += 1;
    counts.results += row.results;
    counts.acceptances += row.acceptances;
    result[kind] = counts;
  }
  return result;
}

/** Build one fixed scenario without materializing detail or discussion payloads until the app requests them. */
export function createWorkloadHarness(access: string, personCount = 300): IWorkloadHarness {
  if (!/^[A-Za-z0-9_.:-]{1,128}$/u.test(access)) { throw new Error('workload access context must be a bounded non-secret identifier'); }
  const people = workloadPeople(personCount);
  const byLogin = new Map(people.map(person => [person.login, person]));
  const byNumber = new Map<number, IWorkloadPerson>();
  const expectedPulls = new Set<string>();
  for (const person of people) {
    for (let ordinal = 0; ordinal < person.pullRequests; ordinal += 1) {
      const pull = workloadPull(person, ordinal);
      byNumber.set(pull.number, person);
      expectedPulls.add(`acme/widget#${String(pull.number)}`);
    }
  }
  const observedPulls = new Set<string>();
  const counters = new Map<string, IRouteCounter>();
  let inFlightGithub = 0;
  let maxInFlightGithub = 0;
  let inFlightAssessments = 0;
  let maxInFlightAssessments = 0;
  let observedAssessmentRequests = 0;
  let loadedReviewEntries = 0;
  let loadedCommentEntries = 0;
  let loadedInlineEntries = 0;
  let hydratedPayloadBytes = 0;
  const machine = createNodeMachine();
  const gates: ISharedRateSurfaceDeclaration['gates'] = [{ id: 'api' }];
  const shared = registerSharedRateSurface({ environment: 'production', service: 'controlled', accessContext: access, surface: 'workload', gates });

  /** Fixed provider surface shares one request gate with assessment through the declared access scope. */
  const services: IReportServices = {
    githubRate: { surface: shared, cooldownGateId: 'api' },
    assessmentRate: { surface: shared, cooldownGateId: 'api' },
    connection: access,
    retry: { maxAttempts: 1, backoffMilliseconds: 0 },
    digest: input => machine.sha256(input),
    now: () => Date.now(),
    trace: () => undefined,
    async github(url, accept, send) {
      inFlightGithub += 1;
      maxInFlightGithub = Math.max(maxInFlightGithub, inFlightGithub);
      const route = routeFor(url, accept);
      const counter = counterFor(counters, route);
      counter.sends += 1;
      counter.operations.set(send.operation, (counter.operations.get(send.operation) ?? 0) + 1);
      try {
        const body = serve(url, accept, byLogin, byNumber, observedPulls);
        const bytes = Buffer.byteLength(JSON.stringify(body));
        counter.responseBytes += bytes;
        hydratedPayloadBytes += route === 'pull-detail' || route === 'review-list' || route === 'conversation-comments' || route === 'inline-comments' ? bytes : 0;
        if (route === 'review-list' && Array.isArray(body)) { loadedReviewEntries += body.length; }
        if (route === 'conversation-comments' && Array.isArray(body)) { loadedCommentEntries += body.length; }
        if (route === 'inline-comments' && Array.isArray(body)) { loadedInlineEntries += body.length; }
        return { status: 200, headers: responseHeaders(url, body), body };
      } finally { inFlightGithub -= 1; }
    },
    async assess(request: IAssessmentRequest, send: IOperationSend) {
      inFlightAssessments += 1;
      maxInFlightAssessments = Math.max(maxInFlightAssessments, inFlightAssessments);
      observedAssessmentRequests += 1;
      const route = 'assessment';
      const counter = counterFor(counters, route);
      counter.sends += 1;
      counter.operations.set(send.operation, (counter.operations.get(send.operation) ?? 0) + 1);
      try {
        const score = request.merged ? 2 : 1;
        return { kind: 'succeeded', value: { score, explanation: 'Controlled workload assessment.' }, usage: { report: send.requestAttempt, quantities: [{ unit: 'tokens', amount: 1 }] } };
      } finally { inFlightAssessments -= 1; }
    },
  };

  return {
    services,
    expectedPulls,
    observedPulls,
    stats() {
      const routes: Record<string, IWorkloadRouteStats> = {};
      for (const [name, counter] of counters) {
        let retrySends = 0;
        for (const attempts of counter.operations.values()) { retrySends += Math.max(0, attempts - 1); }
        routes[name] = { sends: counter.sends, logicalOperations: counter.operations.size, retrySends, responseBytes: counter.responseBytes };
      }
      return { routes, observedPulls: observedPulls.size, observedAssessmentRequests, maxInFlightGithub, maxInFlightAssessments,
        loadedReviewEntries, loadedCommentEntries, loadedInlineEntries, hydratedPayloadBytes };
    },
  };
}

/** Validate the independent set after traversal without passing it into any application callback. */
export function assertWorkloadMembership(expected: ReadonlySet<string>, observed: ReadonlySet<string>, personCount = 300): void {
  if (expected.size !== workloadCardinality(personCount).pullRequests || observed.size !== expected.size) {
    throw new Error(`workload membership cardinality mismatch: expected ${String(expected.size)}, observed ${String(observed.size)}`);
  }
  for (const id of expected) { if (!observed.has(id)) { throw new Error(`workload membership omitted ${id}`); } }
}

/** Classify each actual REST request for separate attempt and payload accounting. */
function routeFor(url: string, accept: 'application/vnd.github.diff' | undefined): string {
  const path = new URL(url).pathname;
  if (path === '/search/issues') { return 'search-page'; }
  if (/\/pulls\/[0-9]+\/reviews$/u.test(path)) { return 'review-list'; }
  if (/\/issues\/[0-9]+\/comments$/u.test(path)) { return 'conversation-comments'; }
  if (/\/pulls\/[0-9]+\/comments$/u.test(path)) { return 'inline-comments'; }
  if (/\/pulls\/[0-9]+$/u.test(path) && accept === 'application/vnd.github.diff') { return 'pull-diff'; }
  if (/\/pulls\/[0-9]+$/u.test(path)) { return 'pull-detail'; }
  throw new Error('unexpected controlled workload route');
}

/** Fixed REST service implementation uses only URL query and path fields visible to a provider adapter. */
function serve(url: string, accept: 'application/vnd.github.diff' | undefined, byLogin: ReadonlyMap<string, IWorkloadPerson>, byNumber: ReadonlyMap<number, IWorkloadPerson>, observed: Set<string>): unknown {
  const address = new URL(url);
  if (address.pathname === '/search/issues') {
    const query = address.searchParams.get('q') ?? '';
    const author = /(?:^| )author:([^ ]+)/u.exec(query)?.[1];
    const creation = /(?:^| )created:(\S+)\.\.(\S+)/u.exec(query);
    const person = author === undefined ? undefined : byLogin.get(author);
    if (person === undefined || creation?.[1] === undefined || creation[2] === undefined) { throw new Error('malformed workload search'); }
    const start = Math.floor(Date.parse(creation[1]) / 1_000);
    const end = Math.floor(Date.parse(creation[2]) / 1_000) + 1;
    const [first, after] = ordinalBounds(person, start, end);
    const total = after - first;
    const page = Number(address.searchParams.get('page'));
    const perPage = Number(address.searchParams.get('per_page'));
    const offset = first + (page - 1) * perPage;
    const items = Array.from({ length: Math.max(0, Math.min(perPage, after - offset)) }, (_, index) => {
      const pull = workloadPull(person, offset + index);
      const id = `acme/widget#${String(pull.number)}`;
      observed.add(id);
      return { id: 10_000_000 + pull.number, node_id: `workload-node-${String(pull.number)}`, number: pull.number,
        repository_url: 'https://api.github.com/repos/acme/widget', created_at: iso(pull.createdAt), user: { login: person.login },
        pull_request: { url: `https://api.github.com/repos/acme/widget/pulls/${String(pull.number)}` } };
    });
    return { total_count: total, incomplete_results: false, items };
  }

  const number = Number(/\/pulls\/([0-9]+)(?:\/|$)/u.exec(address.pathname)?.[1] ?? /\/issues\/([0-9]+)\/comments$/u.exec(address.pathname)?.[1]);
  const person = byNumber.get(number);
  if (person === undefined || !Number.isSafeInteger(number)) { throw new Error('unknown controlled workload PR'); }
  const pull = workloadPull(person, number - person.firstNumber);
  if (address.pathname.endsWith('/reviews')) {
    return [{ id: number * 10 + 1, body: pull.reviewBody, state: 'APPROVED', submitted_at: iso(pull.createdAt + 3_600), user: { login: 'reviewer' }, commit_id: `commit-${String(number)}` }];
  }
  if (address.pathname.startsWith('/repos/acme/widget/issues/')) {
    return pull.commentBodies.map((body, index) => ({ id: number * 10 + index + 2, body, created_at: iso(pull.createdAt + 7_200 + index), updated_at: iso(pull.createdAt + 7_200 + index), user: { login: `commenter-${String(index + 1)}` } }));
  }
  if (address.pathname.endsWith('/comments')) {
    return [{ id: number * 10 + 4, body: pull.inlineBody, created_at: iso(pull.createdAt + 10_800), updated_at: iso(pull.createdAt + 10_800), user: { login: 'reviewer' } }];
  }
  if (accept === 'application/vnd.github.diff') { return pull.diff; }
  return { id: 20_000_000 + number, number, base: { repo: { full_name: 'acme/widget' } }, title: pull.title, body: pull.body,
    state: 'closed', created_at: iso(pull.createdAt), updated_at: iso(pull.createdAt + 14_400), closed_at: iso(pull.createdAt + 14_400), merged_at: iso(pull.createdAt + 14_400), labels: [{ name: 'workload' }] };
}

/** The source server adds only standard REST pagination metadata; the response contains no manifest/version field. */
function responseHeaders(url: string, body: unknown): Readonly<Record<string, string>> {
  const address = new URL(url);
  if (address.pathname !== '/search/issues' || typeof body !== 'object' || body === null || !('total_count' in body) || !('items' in body)
    || typeof body.total_count !== 'number' || !Array.isArray(body.items)) { return {}; }
  const page = Number(address.searchParams.get('page'));
  const perPage = Number(address.searchParams.get('per_page'));
  if (page * perPage >= body.total_count) { return {}; }
  address.searchParams.set('page', String(page + 1));
  return { link: `<${address.toString()}>; rel="next"` };
}

/** Count the actual evidence array as it leaves the fixed provider service. */
/** A route's ledger has one operation identity per distinct supervised operation. */
function counterFor(counters: Map<string, IRouteCounter>, route: string): IRouteCounter {
  let counter = counters.get(route);
  if (counter === undefined) { counter = { sends: 0, responseBytes: 0, operations: new Map() }; counters.set(route, counter); }
  return counter;
}

/** Binary search preserves exact ordered range selection without scanning unrelated PR payloads. */
function ordinalBounds(person: IWorkloadPerson, start: number, end: number): readonly [number, number] {
  const lower = (target: number): number => {
    let low = 0;
    let high = person.pullRequests;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      const timestamp = workloadPull(person, middle).createdAt;
      if (timestamp < target) { low = middle + 1; } else { high = middle; }
    }
    return low;
  };
  return [lower(start), lower(end)];
}

/** REST timestamp serialization uses the fixture's fixed UTC second. */
function iso(seconds: number): string { return new Date(seconds * 1_000).toISOString(); }

/** Stable scalar digest only binds identical local requests; it is not a public fixture identity. */
