/**
 * One opt-in finite facade proof: failure, post-close exact readback, then a new
 * process recovering from only durable store identity and fixed configuration.
 * Assertions deliberately own the expected dataset rather than teaching the adapter it.
 * The reviewed GNU timeout invocation independently bounds synchronous parent
 * History work; this event loop cannot enforce that wall-clock cutoff itself.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@jest/globals';
import { readHistorySelection } from 'microdelta';
import type { ICompletedResultReference } from 'microdelta';

/** Selected scalar trace facts are validated at the child-output boundary. */
interface IEvent { readonly sequence: number; readonly kind: string; readonly facts: Readonly<Record<string, unknown>>; readonly runId: string; readonly runInstance: string }
/** Reject malformed child receipts before applying any behavioral oracle. */
function object(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) { throw new Error('Expected a receipt object'); }
  return Object.fromEntries(Object.entries(value));
}
/** A finite JSON list has no lazy or native inspection authority. */
function list(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || value.length > 2_000) { throw new Error('Expected a bounded receipt list'); }
  return value.map((entry: unknown) => entry);
}
/** Receipt text is bounded independently of the pipe's byte ceiling. */
function text(value: unknown): string {
  if (typeof value !== 'string' || value.length > 32_768) { throw new Error('Expected finite receipt text'); }
  return value;
}
/** Counts and causal positions cannot be negative, fractional or unbounded. */
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) { throw new Error('Expected a nonnegative receipt count'); }
  return value;
}
/** Only a completed reference is sufficient for independent exact readback. */
function reference(value: unknown): ICompletedResultReference {
  const raw = object(value);
  if (raw['kind'] !== 'completed-result') { throw new Error('Expected an exact completed reference'); }
  return { kind: 'completed-result', locator: text(raw['locator']) };
}
/** Reconstruct only the fixed fixture's selected scalar observations. */
function trace(value: unknown): readonly IEvent[] {
  return list(value).map(entry => {
    const raw = object(entry);
    return { sequence: count(raw['sequence']), kind: text(raw['kind']), facts: object(raw['facts']), runId: text(raw['runId']), runInstance: text(raw['runInstance']) };
  });
}
/** Retained stores and sidecars are measured together, separately from bounded evidence. */
function bytes(directory: string): number {
  return readdirSync(directory).reduce((total, name) => total + statSync(resolve(directory, name)).size, 0);
}
/**
 * Exactly one owned child is live here. SIGTERM requests bounded orderly cleanup;
 * SIGKILL at 15 seconds and the 16-second close deadline never authorize recovery.
 */
async function worker(mode: 'failure' | 'recovery', directory: string, evidence: string, wholeDeadline: number): Promise<Readonly<Record<string, unknown>>> {
  const started = Date.now();
  if (wholeDeadline - started < 16_000) { throw new Error('Insufficient whole allowance for a complete worker terminal interval'); }
  const child = spawn(process.execPath, ['--max-old-space-size=384', fileURLToPath(new URL('./worker.js', import.meta.url)), mode, directory], { env: {}, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = ''; let refusal: Error | undefined;
  const timers: ReturnType<typeof setTimeout>[] = [];
  /** A byte overflow is failure evidence; it never becomes truncated success JSON. */
  const append = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
    if (Buffer.byteLength(stream === 'stdout' ? stdout : stderr) + chunk.length > 512 * 1024) {
      refusal ??= new Error(`${mode} ${stream} overflow`); child.kill('SIGTERM'); return;
    }
    if (stream === 'stdout') { stdout += chunk.toString('utf8'); } else { stderr += chunk.toString('utf8'); }
  };
  child.stdout.on('data', (chunk: Buffer) => { append('stdout', chunk); });
  child.stderr.on('data', (chunk: Buffer) => { append('stderr', chunk); });
  child.on('error', error => { refusal ??= error; });
  const closed = new Promise<void>((complete, reject) => {
    child.once('close', (code, signal) => {
      for (const timer of timers) { clearTimeout(timer); }
      try {
      writeFileSync(resolve(evidence, `${mode}.stdout.json`), stdout);
      writeFileSync(resolve(evidence, `${mode}.stderr.txt`), stderr);
      writeFileSync(resolve(evidence, `${mode}.close.json`), JSON.stringify({ pid: child.pid ?? null, code, signal, elapsedMilliseconds: Date.now() - started, stdoutBytes: Buffer.byteLength(stdout), stderrBytes: Buffer.byteLength(stderr) }));
      } catch (cause: unknown) {
        reject(new AggregateError([...(refusal === undefined ? [] : [refusal]), cause], `${mode} child result and evidence finalization failed`)); return;
      }
      if (refusal !== undefined) { reject(refusal); }
      else if (code !== 0 || signal !== null) { reject(new Error(`${mode} child failed: ${code}/${signal}: ${stderr}`)); }
      else { complete(); }
    });
    timers.push(setTimeout(() => { refusal ??= new Error(`${mode} live deadline`); child.kill('SIGTERM'); }, Math.min(12_000, Math.max(0, wholeDeadline - Date.now()))));
    timers.push(setTimeout(() => { refusal ??= new Error(`${mode} kill deadline`); child.kill('SIGKILL'); }, Math.min(15_000, Math.max(0, wholeDeadline - Date.now()))));
    timers.push(setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${mode} terminal close unconfirmed`)); }, Math.min(16_000, Math.max(0, wholeDeadline - Date.now()))));
  });
  await closed;
  const parsed: unknown = JSON.parse(stdout);
  const receipt = object(parsed);
  expect(receipt['mode']).toBe(mode); expect(receipt['pid']).toBe(child.pid);
  expect(receipt['ownersClosed']).toBe(true); expect(receipt['runClosed']).toBe(true);
  expect(receipt['cleanupFaults']).toEqual([]); expect(receipt['inFlight']).toBe(0);
  expect(receipt['diagnostics']).toEqual([]); expect(receipt['interruptions']).toEqual([]); expect(receipt['resourceFailure']).toBeNull();
  expect(count(receipt['runs'])).toBe(1); expect(count(receipt['traversals'])).toBe(1);
  expect(count(receipt['sends'])).toBeLessThanOrEqual(mode === 'failure' ? 5 : 9);
  expect(count(receipt['peakSends'])).toBeLessThanOrEqual(2);
  expect(count(receipt['sampledRssBytes'])).toBeLessThanOrEqual(512 * 1024 * 1024);
  expect(count(receipt['samples'])).toBeGreaterThan(0);
  expect(bytes(directory)).toBeLessThanOrEqual(64 * 1024 * 1024);
  expect(bytes(evidence)).toBeLessThanOrEqual(8 * 1024 * 1024);
  expect(Date.now()).toBeLessThan(wholeDeadline);
  return receipt;
}
/** This read opens no run and invokes no application callback; native WAL coordination is intentional. */
function exactA(directory: string, selected: ICompletedResultReference): void {
  for (const [key, expected] of [['id', 'fixture/repo#101'], ['statement', 'discussion:fixture/repo#101:content-v1|detail:fixture/repo#101:content-v1']] as const) {
    const result = readHistorySelection({ location: resolve(directory, 'history.sqlite'), logicalStore: 'store:within-person-fixed' }, { kind: 'fact', reference: selected, request: { operation: 'value', address: [{ kind: 'property', key }] } });
    expect(result.kind).toBe('fact');
    if (result.kind !== 'fact') { throw new Error('Exact scalar read did not return a fact'); }
    expect(result.selected.fact).toBe(expected);
  }
}

test('facade early publication survives definite failure and fresh-process recovery closes strictly', async () => {
  const requested = process.env['MICRODELTA_SLICE_EVIDENCE'];
  if (requested === undefined) { throw new Error('Set MICRODELTA_SLICE_EVIDENCE to a fresh explicit evidence directory'); }
  const evidence = resolve(requested);
  mkdirSync(evidence); // A previous invocation cannot be silently overwritten or repeated.
  const directory = resolve(evidence, 'store'); mkdirSync(directory);
  const started = Date.now(); const wholeDeadline = started + 40_000;
  let primary: unknown; let failed = false;
  try {
    const failure = await worker('failure', directory, evidence, wholeDeadline);
    const before = trace(failure['trace']);
    const select = (kind: string): readonly IEvent[] => before.filter(event => event.kind === kind);
    expect(select('page-held')).toHaveLength(1); expect(select('page-release')).toHaveLength(1);
    const held = select('page-held')[0]; const released = select('page-release')[0];
    if (held === undefined || released === undefined) { throw new Error('Held/release acknowledgment absent'); }
    const publication = select('publication').find(event => event.facts['slot'] === 'assess' && event.facts['member'] === 'fixture/repo#101');
    if (publication === undefined) { throw new Error('A actual publication absent'); }
    for (const name of ['discussion', 'detail', 'assessment']) {
      const sends = select('send').filter(event => event.facts['name'] === name && event.facts['key'] === 'fixture/repo#101');
      expect(sends).toHaveLength(1);
      expect(sends[0]?.sequence).toBeGreaterThan(held.sequence);
      expect(sends[0]?.sequence).toBeLessThan(publication.sequence);
    }
    expect(publication.sequence).toBeLessThan(released.sequence);
    expect(released.facts['reason']).toBe('definite-failure');
    for (const name of ['strict-admission', 'strict-body', 'strict-publication']) { expect(select(name)).toHaveLength(0); }
    expect(failure['terminal']).toBe('discovery-failed'); expect(failure['stop']).toBe('soft');
    expect(failure['sends']).toBe(5);
    expect(text(failure['terminalFailure'])).toContain('fixture-page-two-definite-refusal');
    expect(select('assessment-body').filter(event => event.facts['member'] === 'fixture/repo#101')).toHaveLength(1);
    expect(new Set(before.map(event => event.runInstance)).size).toBe(1);
    expect(new Set(before.map(event => event.runId)).size).toBe(1);
    const a = reference(failure['a']); expect(publication.facts['reference']).toBe(a.locator);
    exactA(directory, a);
    const oldPage = object(failure['pageOperation']);
    expect(oldPage['status']).toBe('retry-exhausted'); expect(oldPage['maxAttempts']).toBe(1);
    const oldAttempts = list(oldPage['attempts']); expect(oldAttempts).toHaveLength(1);
    expect(object(oldAttempts[0])['status']).toBe('failed');
    expect(object(oldAttempts[0])['outcome']).toEqual({ kind: 'failed', transient: false });
    expect(object(oldAttempts[0])['facts']).toEqual({ providerCode: 'fixture-page2-refused', conditions: ['definite', 'permanent'] });
    // No reference, receipt, continuation, closure or in-memory object crosses this launch.
    const recovery = await worker('recovery', directory, evidence, wholeDeadline);
    expect(recovery['pid']).not.toBe(failure['pid']); expect(recovery['terminal']).toBe('complete');
    expect(reference(recovery['a'])).toEqual(a); exactA(directory, a);
    const after = trace(recovery['trace']);
    const root = after.find(event => event.kind === 'send'); expect(root?.facts['key']).toBe('root');
    expect(after.filter(event => event.kind === 'assessment-body' && event.facts['member'] === 'fixture/repo#101')).toHaveLength(0);
    expect(after.filter(event => event.kind === 'send' && event.facts['name'] === 'assessment' && event.facts['key'] === 'fixture/repo#101')).toHaveLength(0);
    const collections = after.filter(event => event.kind === 'collection-body');
    expect(collections).toHaveLength(2);
    const openBody = collections[0]; const closedBody = collections[1];
    if (openBody === undefined || closedBody === undefined) { throw new Error('Both actual frontier source bodies are required'); }
    expect(object(openBody.facts['frontier'])['status']).toBe('open');
    expect(object(closedBody.facts['frontier'])['status']).toBe('complete');
    const openPublication = after.find(event => event.kind === 'publication' && event.facts['slot'] === 'frontier' && event.sequence > openBody.sequence && event.sequence < closedBody.sequence);
    const closedPublication = after.find(event => event.kind === 'publication' && event.facts['slot'] === 'frontier' && event.sequence > closedBody.sequence);
    const acceptedA = after.filter(event => {
      if (event.kind !== 'lifecycle' || event.facts['phase'] !== 'accept') { return false; }
      const step = object(event.facts['step']);
      return step['slot'] === 'assess' && step['memberKey'] === 'fixture/repo#101';
    });
    expect(acceptedA).toHaveLength(2);
    const openA = acceptedA[0]; const closedA = acceptedA[1];
    if (openPublication === undefined || closedPublication === undefined || openA === undefined || closedA === undefined) { throw new Error('Each frontier needs actual collection publication and exact A acceptance'); }
    expect(openA.sequence).toBeLessThan(closedBody.sequence);
    for (const [frontier, acceptance] of [[openPublication, openA], [closedPublication, closedA]] as const) {
      expect(reference(acceptance.facts['reference'])).toEqual(a);
      for (const name of ['discussion', 'detail']) {
        const sends = after.filter(event => event.kind === 'send' && event.facts['name'] === name && event.facts['key'] === 'fixture/repo#101' && event.sequence > frontier.sequence && event.sequence < acceptance.sequence);
        expect(sends).toHaveLength(1);
      }
    }
    for (const name of ['discussion', 'detail']) {
      expect(after.filter(event => event.kind === 'send' && event.facts['name'] === name && event.facts['key'] === 'fixture/repo#101')).toHaveLength(2);
      expect(after.filter(event => event.kind === 'send' && event.facts['name'] === name && event.facts['key'] === 'fixture/repo#102')).toHaveLength(1);
    }
    expect(after.filter(event => event.kind === 'assessment-body' && event.facts['member'] === 'fixture/repo#102')).toHaveLength(1);
    expect(after.filter(event => event.kind === 'send' && event.facts['name'] === 'assessment' && event.facts['key'] === 'fixture/repo#102')).toHaveLength(1);
    const closed = after.find(event => event.kind === 'adapter-frontier' && event.facts['kind'] === 'complete');
    if (closed === undefined) { throw new Error('Certified closure absent'); }
    const bPublished = after.find(event => event.kind === 'publication' && event.facts['slot'] === 'assess' && event.facts['member'] === 'fixture/repo#102');
    if (bPublished === undefined) { throw new Error('B actual publication absent'); }
    for (const name of ['strict-admission', 'strict-body', 'strict-publication']) {
      const events = after.filter(event => event.kind === name); expect(events).toHaveLength(1);
      expect(events[0]?.sequence).toBeGreaterThan(closed.sequence);
      expect(events[0]?.sequence).toBeGreaterThan(bPublished.sequence);
      expect(events[0]?.sequence).toBeGreaterThan(closedA.sequence);
    }
    expect(recovery['summary']).toEqual({ ids: ['fixture/repo#101', 'fixture/repo#102'] });
    const resumed = object(recovery['pageOperation']); expect(resumed['identity']).toBe(oldPage['identity']);
    expect(resumed['subject']).toEqual(oldPage['subject']); expect(resumed['binding']).toBe(oldPage['binding']);
    expect(resumed['status']).toBe('succeeded'); expect(resumed['maxAttempts']).toBe(1);
    const attempts = list(resumed['attempts']); expect(attempts).toHaveLength(2);
    expect(attempts[0]).toEqual(oldAttempts[0]); expect(object(attempts[1])['status']).toBe('succeeded');
    expect(object(attempts[1])['run']).not.toBe(object(attempts[0])['run']);
    expect(object(attempts[1])['runInstance']).not.toBe(object(attempts[0])['runInstance']);
    expect(recovery['sends']).toBe(9);
    expect(after.filter(event => event.kind === 'send')).toHaveLength(9);
    expect(after.filter(event => event.kind === 'send' && event.facts['name'] === 'search-page')).toHaveLength(2);
    expect(new Set(after.map(event => event.runInstance)).size).toBe(1);
    expect(new Set(after.map(event => event.runId)).size).toBe(1);
  } catch (cause: unknown) { failed = true; primary = cause; throw cause; }
  finally {
    try {
      writeFileSync(resolve(evidence, 'parent.json'), JSON.stringify({ failed, elapsedMilliseconds: Date.now() - started, sampledParentRssBytes: process.memoryUsage().rss, sampling: 'worker interval/boundary samples; no continuous peak or scale claim', retainedEvidenceBytes: bytes(evidence), storeBytes: bytes(directory) }));
      expect(Date.now()).toBeLessThan(wholeDeadline); expect(bytes(evidence)).toBeLessThanOrEqual(8 * 1024 * 1024);
    } catch (cleanup: unknown) { if (failed) { throw new AggregateError([primary, cleanup], 'Original fixture failure and final evidence failure'); } throw cleanup; }
  }
}, 42_000);
