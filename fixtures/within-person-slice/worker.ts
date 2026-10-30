/**
 * One fixed application run per process. Only mode and durable directory cross
 * the process boundary; fresh authoring and facade context own every callback.
 * Successful output follows actual drain and closure of every opened owner.
 */
import { createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { openDurableAccounting } from '@microdelta/accounting';
import { openDurableHistory } from '@microdelta/history';
import { createNodeClock, createNodeMachine, createNodeSqlite } from '@microdelta/machine-node';
import { operationJournalDeclaration, operationsCollection } from '@microdelta/supervision';
import { createStopController, openWorkspace } from 'microdelta';
import type { ICompletedResultReference, IWorkspace, ITraversalReport, IOperationView } from 'microdelta';

import { analysis, composeFixture, createControlledService, createTrace, environment, logicalStore, primaryMember } from './application.js';

/** Only the selected opaque journal record is inspected, through its existing owner port. */
function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) { throw new Error('Selected page journal content is not an object'); }
  return Object.fromEntries(Object.entries(value));
}
/** No unchecked binding or identity leaves the worker as trusted output. */
function string(value: unknown): string {
  if (typeof value !== 'string' || value.length > 32_768) { throw new Error('Selected page field is not finite text'); }
  return value;
}
/** Failure diagnostics keep original and cleanup errors distinguishable across the JSON boundary. */
function diagnostic(cause: unknown, depth = 0): string {
  if (depth >= 8) { return '[error nesting exceeds finite fixture bound]'; }
  if (cause instanceof AggregateError) {
    const errors: readonly unknown[] = cause.errors;
    return `${cause.name}: ${cause.message} [${errors.map(value => diagnostic(value, depth + 1)).join('; ')}]`;
  }
  return cause instanceof Error ? `${cause.name}: ${cause.message}${cause.cause === undefined ? '' : `; cause: ${diagnostic(cause.cause, depth + 1)}`}` : String(cause);
}
/** Stores and sidecars are counted together; this never interprets native tables. */
function storeBytes(directory: string): number {
  return readdirSync(directory).reduce((total, name) => total + statSync(resolve(directory, name)).size, 0);
}
/** One non-renewable live deadline covers acknowledgments, traversal and owner inspection. */
async function before<T>(promise: Promise<T>, deadline: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Worker live acknowledgment deadline')), Math.max(0, deadline - Date.now())); })]); }
  finally { if (timer !== undefined) { clearTimeout(timer); } }
}
/** The selected operation receipt preserves historical retry outcome/facts without a generic record codec. */
function selectedPage(directory: string, operation: IOperationView): Readonly<Record<string, unknown>> {
  const history = openDurableHistory({ sqlite: createNodeSqlite(), clock: createNodeClock(), sha256: createNodeMachine(), location: resolve(directory, 'history.sqlite'), logicalStore });
  let primary: unknown; let failed = false;
  try {
    const entry = history.openJournal(operationJournalDeclaration).read({ analysis, environment, collection: operationsCollection, key: operation.operation });
    if (entry === undefined) { throw new Error('Selected page operation is not durable'); }
    const raw = record(entry.record.content);
    const attempts: unknown = raw['attempts'];
    if (!Array.isArray(attempts) || attempts.length > 2 || raw['maxAttempts'] !== 1) { throw new Error('Selected operation exceeds fixed attempt bounds'); }
    return { identity: string(raw['operation']), subject: string(raw['subject']), binding: string(raw['binding']), maxAttempts: raw['maxAttempts'], status: string(raw['status']),
      attempts: attempts.map((value: unknown) => {
        const attempt = record(value);
        const status = string(attempt['status']);
        const usage = string(attempt['usage']);
        if (usage !== 'acknowledged' || (status !== 'failed' && status !== 'succeeded')) { throw new Error('Selected page attempt has unexpected settlement/usage'); }
        let outcome: { readonly kind: 'failed'; readonly transient: false } | null = null;
        let facts: { readonly providerCode: string; readonly conditions: readonly string[] } | null = null;
        let decision: { readonly kind: 'stop' } | null = null;
        if (status === 'failed') {
          const observed = record(attempt['outcome']); const classified = record(attempt['facts']); const selected = record(attempt['decision']);
          const conditions: unknown = classified['conditions'];
          if (observed['kind'] !== 'failed' || observed['transient'] !== false || selected['kind'] !== 'stop' || !Array.isArray(conditions) || conditions.length !== 2) { throw new Error('Selected failed page classification is malformed'); }
          outcome = { kind: observed['kind'], transient: observed['transient'] };
          facts = { providerCode: string(classified['providerCode']), conditions: conditions.map((item: unknown) => string(item)) };
          decision = { kind: selected['kind'] };
        } else if (attempt['outcome'] !== null || attempt['facts'] !== null || attempt['decision'] !== null) { throw new Error('Selected success unexpectedly carries failure classification'); }
        // Hash the entire owner-returned attempt to detect changes in retained fields not selected for display.
        const retainedDigest = createHash('sha256').update(JSON.stringify(attempt)).digest('hex');
        return { requestAttempt: string(attempt['requestAttempt']), run: string(attempt['run']), runInstance: string(attempt['runInstance']), stepAttempt: string(attempt['stepAttempt']), status, outcome, facts, decision, usage, retainedDigest };
      }) };
  } catch (cause: unknown) { failed = true; primary = cause; throw cause; }
  finally { try { history.close(); } catch (cleanup: unknown) { if (failed) { throw new AggregateError([primary, cleanup], 'Selected page inspection and owner closure failed'); } throw cleanup; } }
}

/** The top-level entry owns exactly one run and cannot recover or repeat itself. */
async function main(): Promise<void> {
  const mode = process.argv[2]; const directory = process.argv[3];
  if ((mode !== 'failure' && mode !== 'recovery') || directory === undefined || process.argv.length !== 4) { throw new Error('Expected failure|recovery and one durable directory'); }
  const started = Date.now(); const liveDeadline = started + 12_000; const closeDeadline = started + 15_000;
  const trace = createTrace(); const stop = createStopController();
  const service = createControlledService(trace, mode === 'failure' ? 5 : 9);
  const graph = composeFixture(service.helpers);
  let accounting: ReturnType<typeof openDurableAccounting> | undefined;
  let workspace: IWorkspace | undefined;
  let running: Promise<unknown> | undefined; let runClosed = false; let runs = 0; let traversals = 0;
  let a: ICompletedResultReference | undefined;
  let terminal: ITraversalReport | undefined;
  let operations: readonly IOperationView[] = [];
  let summary: unknown = null;
  let diagnostics: readonly string[] = [];
  let interruptions: readonly unknown[] = [];
  let sampledRssBytes = 0; let sampledStoreBytes = 0; let samples = 0;
  let failed = false; let primary: unknown;
  const cleanupFaults: string[] = [];
  let accountingClosed = false; let workspaceClosed = false;
  let resourceFailure: Error | undefined;
  /** Boundaries plus interval samples are observations, never a continuous resource-peak claim. */
  const sample = (): void => {
    try {
      samples += 1; sampledRssBytes = Math.max(sampledRssBytes, process.memoryUsage().rss);
      sampledStoreBytes = Math.max(sampledStoreBytes, storeBytes(directory));
      if (sampledRssBytes > 512 * 1024 * 1024 || sampledStoreBytes > 64 * 1024 * 1024 || Buffer.byteLength(JSON.stringify(trace.events)) > 2 * 1024 * 1024) { throw new Error('Worker finite resource bound exceeded'); }
    } catch (cause: unknown) { resourceFailure ??= cause instanceof Error ? cause : new Error(String(cause)); stop.request({ level: 'hard' }); service.cancel(); }
  };
  /** A parent deadline requests cleanup; it cannot satisfy any successful gate. */
  const interrupted = (): void => { resourceFailure ??= new Error('Parent requested terminal cleanup'); stop.request({ level: 'hard' }); service.cancel(); };
  process.on('SIGTERM', interrupted);
  const sampler = setInterval(sample, 100);
  try {
    sample(); if (resourceFailure !== undefined) { throw resourceFailure; }
    accounting = openDurableAccounting({ sqlite: createNodeSqlite(), location: resolve(directory, 'accounting.sqlite'), logicalStore });
    workspace = openWorkspace({ location: resolve(directory, 'history.sqlite'), logicalStore, leaseMilliseconds: 30_000, accounting });
    const actual = workspace.run({ authoring: graph.authoring, composition: graph.composition, environment, permits: 2, window: 2, stop,
      admission: { admit: request => service.admit(request) }, observers: [{ observe: event => service.observe(event) }],
    }, async run => {
      runs += 1; service.attach(run.context, `slice:${process.pid}`); traversals += 1;
      const traversal = run.traverse(graph.witness, service.adapter, { requestKey: `fixed-person-traversal:${mode}` });
      /** An early terminal cannot fabricate a hold or ready acknowledgment. */
      const acknowledgment = <T>(pending: Promise<T>): Promise<T> => before(Promise.race([pending, traversal.then(() => { throw new Error('Traversal terminated before acknowledgment'); })]), liveDeadline);
      await acknowledgment(service.held); await acknowledgment(service.ready);
      if (resourceFailure !== undefined) { throw resourceFailure; }
      service.release(mode === 'failure' ? 'definite-failure' : 'closed-response');
      const report = await before(traversal, liveDeadline);
      const inspected = await run.inspectOperations();
      const member = report.report?.members.find(value => value.key === primaryMember);
      if (member?.status !== 'succeeded' || (member.outcome.kind !== 'published' && member.outcome.kind !== 'reused')) { throw new Error('A has no successful exact outcome'); }
      a = member.outcome.reference;
      if (report.kind === 'complete') {
        if (report.report.outcome.status !== 'succeeded') { throw new Error('Closed traversal strict outcome did not succeed'); }
        summary = run.read<unknown>(report.report.outcome.outcome.reference);
      }
      return { report, inspected };
    });
    running = actual;
    const result = await before(actual, liveDeadline);
    runClosed = true; terminal = result.value.report; operations = result.value.inspected; diagnostics = result.diagnostics; interruptions = result.interruptions;
    if (diagnostics.length !== 0 || interruptions.length !== 0 || result.waitingUntil !== undefined) { throw new Error('Run closed with diagnostics, interrupted sends or deferred work'); }
    sample(); if (resourceFailure !== undefined) { throw resourceFailure; }
  } catch (cause: unknown) { failed = true; primary = cause; }
  finally {
    if (!runClosed && running !== undefined) {
      stop.request({ level: 'hard' }); service.cancel();
      try { await before(running.then(() => undefined, () => undefined), closeDeadline); runClosed = true; }
      catch (cause: unknown) { cleanupFaults.push(`run: ${diagnostic(cause)}`); }
    }
    // All owner closures are attempted and recorded without hiding the body's original failure.
    try { workspace?.close(); workspaceClosed = true; } catch (cause: unknown) { cleanupFaults.push(`workspace: ${diagnostic(cause)}`); }
    try { accounting?.close(); accountingClosed = true; } catch (cause: unknown) { cleanupFaults.push(`accounting: ${diagnostic(cause)}`); }
    clearInterval(sampler); process.off('SIGTERM', interrupted); sample();
  }
  let pageOperation: unknown = null;
  if (!failed && cleanupFaults.length === 0) {
    try {
      const held = trace.events.find(event => event.kind === 'page-held');
      const operation = operations.find(value => value.operation === held?.facts['operation']);
      if (operation === undefined) { throw new Error('Held page operation inspection absent'); }
      pageOperation = selectedPage(directory, operation);
    } catch (cause: unknown) { failed = true; primary = cause; }
  }
  const receipt = { mode, pid: process.pid, runs, traversals, terminal: terminal?.kind ?? null, a: a ?? null, summary, stop: stop.state.level,
    pageOperation, terminalFailure: terminal?.kind === 'discovery-failed' ? diagnostic(terminal.error) : null, diagnostics, interruptions, trace: trace.events, inFlight: service.inFlight, sends: service.sends, peakSends: service.peak,
    runClosed, ownersClosed: workspaceClosed && accountingClosed && cleanupFaults.length === 0,
    sampledRssBytes, sampledStoreBytes, samples, elapsedMilliseconds: Date.now() - started,
    failed, originalFailure: failed ? diagnostic(primary) : null, resourceFailure: resourceFailure === undefined ? null : diagnostic(resourceFailure), cleanupFaults };
  const output = JSON.stringify(receipt);
  if (Buffer.byteLength(output) > 512 * 1024) { throw new Error('Worker output exceeds finite allowance'); }
  await new Promise<void>((complete, reject) => { process.stdout.write(output, error => { if (error !== null && error !== undefined) { reject(error); } else { complete(); } }); });
  if (failed || cleanupFaults.length > 0 || resourceFailure !== undefined || Date.now() >= closeDeadline) {
    throw new AggregateError([...(failed ? [primary] : []), ...cleanupFaults, ...(resourceFailure === undefined ? [] : [resourceFailure])], 'Facade worker failed; original and cleanup causes retained');
  }
}

void main().catch((cause: unknown) => { process.stderr.write(`${diagnostic(cause)}\n`); process.exitCode = 1; });
