/**
 * EXP-4 pass driver: discovery, keyed instantiation, tracked gates, nested
 * memo validation/execution and the strict fold, over an injected History
 * port. It is a synchronous fake of Reuse Resolution and Run Supervision for
 * mechanism evidence only; waits, retries and cancellation mechanics are M5.
 */
import { decode, encode, isData, lookup } from './data.js';
import type { IData, ILookup, IPath } from './data.js';
import { compiledGraph, descriptorKey, isForwarded } from './definition.js';
import type {
  IChildView,
  ICompiledFanout,
  ICompiledFold,
  ICompiledGraph,
  ICompiledStep,
  IDescriptor,
  IFoldBody,
  IFoldContext,
  IGateBody,
  IGraph,
  IMemberEntry,
} from './definition.js';
import { historyIdentity } from './evidence.js';
import type {
  IArgumentRecipe,
  IArguments,
  IChildCall,
  IInvocationRecord,
  IMissReason,
  IObservation,
  IUnreferencedRecord,
} from './evidence.js';

/** One discovery observation: its completion status and ordered member records. @internal */
export interface ICollectionSnapshot {
  readonly status: 'complete' | 'open';
  readonly members: readonly IData[];
}

/** Current source hooks, consulted lazily and at most once per slot per pass. @internal */
export interface ISources {
  readonly inputs: Readonly<Record<string, () => IData>>;
  readonly collections: Readonly<Record<string, () => ICollectionSnapshot>>;
}

/** The fixture History port: newest-first candidates by identity and append-only records. @internal */
export interface IHistory {
  candidates(identity: string): readonly IInvocationRecord[];
  append(record: IUnreferencedRecord): string;
}

/** Fake scheduler state standing in for M5-owned waits and cancellation. @internal */
export type ISupervision = Readonly<Record<string, 'pending' | 'cancelled'>>;

/** A hit or the reason a candidate was not accepted. @internal */
export type IDecision = 'hit' | IMissReason;

/** Every instance outcome is explicit; none of them is represented by `undefined`. @internal */
export type IMemberOutcome =
  | { readonly status: 'succeeded'; readonly reference: string; readonly decision: IDecision; readonly value: IData | undefined }
  | { readonly status: 'skipped' }
  | { readonly status: 'failed'; readonly diagnostic: string; readonly decision?: IDecision }
  | { readonly status: 'pending' }
  | { readonly status: 'cancelled' };

/** A strict fold succeeds, waits, or fails honestly with member keys. @internal */
export type IFoldOutcome =
  | { readonly status: 'succeeded'; readonly reference: string; readonly decision: IDecision; readonly value: IData | undefined }
  | { readonly status: 'waiting'; readonly openDiscovery: boolean; readonly pending: readonly string[] }
  | {
      readonly status: 'failed';
      readonly diagnostic: string;
      readonly failed: readonly string[];
      readonly cancelled: readonly string[];
      readonly pending: readonly string[];
      readonly openDiscovery: boolean;
    };

/** The keyed collection result, or a pre-work diagnostic. @internal */
export type ICollectionOutcome =
  | { readonly status: 'complete' | 'open'; readonly keys: readonly string[] }
  | { readonly status: 'rejected'; readonly diagnostic: string };

/** Observable outcome of one pass: per member key and template step slot, and per fold. @internal */
export interface IPassReport {
  readonly collection: ICollectionOutcome;
  readonly members: Readonly<Record<string, Readonly<Record<string, IMemberOutcome>>>>;
  readonly folds: Readonly<Record<string, IFoldOutcome>>;
}

/** An argument as the child sees it: data, or an opaque marker that no read can observe. */
type IArgumentValue = { readonly kind: 'data'; readonly value: IData } | { readonly kind: 'opaque'; readonly reason: string };

/** The current bindings a frame's paths resolve against. */
type IEnvironment =
  | { readonly kind: 'instance'; readonly member: IData }
  | { readonly kind: 'child'; readonly args: readonly IArgumentValue[] }
  | { readonly kind: 'fold'; readonly entries: readonly IMemberEntry[]; readonly outputs: ReadonlyMap<string, IData | undefined> };

/** A completed child call as its parent consumes it. */
interface IChildResult {
  readonly identity: string;
  readonly reference: string;
  readonly output: IData | undefined;
}

/** Accepting or rejecting one retained candidate; a miss never executes the candidate's own body. */
type IValidation =
  | { readonly status: 'hit'; readonly reference: string; readonly output: IData | undefined }
  | { readonly status: 'miss'; readonly reason: IMissReason };

/** One reuse-or-execute attempt for a memoized step. */
type IAttempt =
  | { readonly status: 'ok'; readonly reference: string; readonly output: IData | undefined; readonly decision: IDecision }
  | { readonly status: 'failed'; readonly diagnostic: string; readonly decision: IDecision };

/** A step shape the attempt loop runs: a body, its declared callable slots and fixed consumed bindings. */
interface IRunnable {
  readonly descriptor: IDescriptor;
  readonly body: IFoldBody;
  readonly calls: ReadonlyMap<string, IDescriptor>;
  readonly consumed: readonly IDescriptor[];
  readonly key: string | undefined;
}

/** Insufficient current correspondence, as distinct from changed content. */
class CorrespondenceError extends Error {
  constructor(readonly reason: 'missing-binding' | 'ambiguous-binding', message: string) {
    super(message);
  }
}

/** Presence is evidence; absence has a fact text no canonical data encoding can produce. */
const absentFact = '#absent';

/** Implementation evidence is the called body's emitted text, compared only after structural lookup. */
function implementationText(body: object): string {
  return Function.prototype.toString.call(body);
}

/** Diagnostics keep the thrown message without exposing the thrown object. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Reduce a resolution failure to its miss reason. */
function bindingReason(status: 'missing' | 'ambiguous'): 'missing-binding' | 'ambiguous-binding' {
  return status === 'missing' ? 'missing-binding' : 'ambiguous-binding';
}

/** Untyped JavaScript callers can pass anything; a path is a list of strings and safe-integer indexes. */
function isPath(value: unknown): value is IPath {
  return Array.isArray(value)
    && value.every((segment: unknown) => typeof segment === 'string' || Number.isSafeInteger(segment));
}

/** Validate an author path before it can become a durable fact address. */
function checkedPath(at: IPath): IPath {
  if (!isPath(at) || at.length === 0) {
    throw new TypeError('EXP-4 paths are nonempty lists of strings and integer indexes');
  }
  return Object.freeze([...at]);
}

/**
 * One body execution's capture. It is process-local and closes when the body
 * returns, so a leaked context cannot add evidence later. It never holds a
 * global "active frame"; nested child frames are independent objects.
 */
class Frame {
  readonly observations: IObservation[] = [];
  readonly calls: IChildCall[] = [];
  readonly outputs: (IData | undefined)[] = [];
  readonly consumed = new Map<string, IDescriptor>();
  #tainted = false;
  #open = true;

  constructor(
    private readonly pass: Pass,
    private readonly environment: IEnvironment,
    private readonly declaredCalls: ReadonlyMap<string, IDescriptor>,
    private readonly key: string | undefined,
  ) {}

  /** The author-facing capability; `members` exists only for fold frames. */
  context(): IFoldContext {
    return Object.freeze({
      key: this.key,
      read: (at: IPath): IData => this.#read(at),
      peek: (at: IPath): IData => this.#peek(at),
      call: (slot: string, ...args: readonly unknown[]): IChildView => this.#call(slot, args),
      members: (): readonly IMemberEntry[] => this.#members(),
    });
  }

  /** End capture; later use of a leaked context fails clearly. */
  close(): void {
    this.#open = false;
  }

  #ensureOpen(): void {
    if (!this.#open) {
      throw new TypeError('EXP-4 context used after its body returned');
    }
  }

  /** Record an input slot as a consumed structural binding of this execution. */
  #consume(at: IPath): void {
    const [family, slot] = at;
    if (family === 'input' && typeof slot === 'string') {
      const descriptor: IDescriptor = { scope: this.pass.graph.scope, role: 'input', slot };
      this.consumed.set(descriptorKey(descriptor), descriptor);
    }
  }

  #read(at: IPath): IData {
    this.#ensureOpen();
    const target = checkedPath(at);
    if (target[0] === 'child' || target[0] === 'members') {
      throw new TypeError('EXP-4 child outputs are read through their call view and members through members()');
    }
    const found = this.pass.resolve(this.environment, target);
    this.#consume(target);
    this.observations.push(Object.freeze({ kind: 'read', path: target, fact: found.found ? encode(found.value) : absentFact }));
    if (!found.found) {
      throw new TypeError(`EXP-4 absent evidence at ${JSON.stringify(target)}`);
    }
    return found.value;
  }

  #peek(at: IPath): IData {
    this.#ensureOpen();
    const target = checkedPath(at);
    const found = this.pass.resolve(this.environment, target);
    this.#tainted = true;
    this.observations.push(Object.freeze({ kind: 'untracked', path: target }));
    if (!found.found) {
      throw new TypeError(`EXP-4 absent value at ${JSON.stringify(target)}`);
    }
    return found.value;
  }

  #members(): readonly IMemberEntry[] {
    this.#ensureOpen();
    if (this.environment.kind !== 'fold') {
      throw new TypeError('EXP-4 members() exists only in a strict fold');
    }
    const found = this.pass.resolve(this.environment, ['members']);
    this.observations.push(Object.freeze({ kind: 'read', path: Object.freeze(['members']), fact: found.found ? encode(found.value) : absentFact }));
    return Object.freeze(this.environment.entries.map(entry => Object.freeze({ ...entry })));
  }

  /**
   * CMP-9: only a declared callable slot of this step may be called; a function
   * or any other non-slot value is rejected before dispatch. Each argument is
   * classified into its recipe here, from what the author actually passed.
   */
  #call(slot: unknown, args: readonly unknown[]): IChildView {
    this.#ensureOpen();
    const child = typeof slot === 'string' ? this.declaredCalls.get(slot) : undefined;
    if (child === undefined) {
      throw new TypeError(`EXP-4 undeclared call: ${typeof slot === 'string' ? slot : typeof slot} is not a declared callable slot of this step`);
    }
    const items: IArgumentRecipe[] = [];
    const values: IArgumentValue[] = [];
    for (const argument of args) {
      if (isForwarded(argument)) {
        const found = this.pass.origin(this.environment, this.outputs, argument.origin);
        if (!found.found) {
          throw new TypeError(`EXP-4 forwarded origin ${JSON.stringify(argument.origin)} is absent`);
        }
        this.#consume(argument.origin);
        items.push(Object.freeze({ form: 'forwarded', origin: argument.origin }));
        values.push({ kind: 'data', value: found.value });
      } else if (isData(argument)) {
        items.push(Object.freeze({ form: 'derived', value: encode(argument), justified: !this.#tainted }));
        values.push({ kind: 'data', value: argument });
      } else {
        items.push(Object.freeze({ form: 'unreconstructible', reason: typeof argument }));
        values.push({ kind: 'opaque', reason: typeof argument });
      }
    }
    const recipe: IArguments = items.length === 0 ? Object.freeze({ form: 'empty' }) : Object.freeze({ form: 'list', items: Object.freeze(items) });
    const result = this.pass.invokeChild(child, recipe, values);
    const index = this.calls.length;
    this.calls.push(Object.freeze({ index, child, arguments: recipe, identity: result.identity, reference: result.reference }));
    this.outputs.push(result.output);
    return Object.freeze({ read: (at: IPath): IData => this.#childRead(index, result.output, at) });
  }

  #childRead(index: number, output: IData | undefined, at: IPath): IData {
    this.#ensureOpen();
    const target = checkedPath(at);
    const found = output === undefined ? { found: false as const } : lookup(output, target);
    this.observations.push(Object.freeze({ kind: 'child-read', call: index, path: target, fact: found.found ? encode(found.value) : absentFact }));
    if (!found.found) {
      throw new TypeError(`EXP-4 child output has no ${JSON.stringify(target)}`);
    }
    return found.value;
  }
}

/**
 * One pass over a frozen graph. Source hooks and child results are memoized
 * per pass only, so a child that executed during parent validation is not
 * executed again when that parent then runs.
 */
class Pass {
  readonly #inputs = new Map<string, IData>();
  readonly #children = new Map<string, IChildResult | Error>();

  constructor(readonly graph: ICompiledGraph, private readonly sources: ISources, private readonly history: IHistory) {}

  /** Consult an input's current source hook lazily, once per pass. */
  input(slot: string): IData {
    const cached = this.#inputs.get(slot);
    if (cached !== undefined) {
      return cached;
    }
    const resolution = this.graph.resolve({ scope: this.graph.scope, role: 'input', slot });
    if (resolution.status !== 'found') {
      throw new CorrespondenceError(bindingReason(resolution.status), `EXP-4 input ${slot} has ${resolution.status} correspondence`);
    }
    const hook = Object.hasOwn(this.sources.inputs, slot) ? this.sources.inputs[slot] : undefined;
    if (hook === undefined) {
      throw new TypeError(`EXP-4 input ${slot} has no current source hook`);
    }
    const value: unknown = hook();
    if (!isData(value)) {
      throw new TypeError(`EXP-4 input ${slot} is not plain data`);
    }
    this.#inputs.set(slot, value);
    return value;
  }

  /** Resolve a binding path in a frame's current environment. */
  resolve(environment: IEnvironment, at: IPath): ILookup {
    const [family, head] = at;
    const rest = at.slice(2);
    if (family === 'input' && typeof head === 'string') {
      return lookup(this.input(head), rest);
    }
    if (family === 'member' && environment.kind === 'instance') {
      return lookup(environment.member, at.slice(1));
    }
    if (family === 'argument' && environment.kind === 'child') {
      const argument = typeof head === 'number' ? environment.args[head] : undefined;
      if (argument === undefined) {
        return { found: false };
      }
      if (argument.kind === 'opaque') {
        throw new TypeError(`EXP-4 argument ${String(head)} is unreconstructible (${argument.reason}) and cannot be observed`);
      }
      return lookup(argument.value, rest);
    }
    if (family === 'members' && environment.kind === 'fold') {
      return { found: true, value: environment.entries.map(entry => ({ key: entry.key, status: entry.status })) };
    }
    if (family === 'member' && environment.kind === 'fold' && typeof head === 'string') {
      const entry = environment.entries.find(candidate => candidate.key === head);
      if (entry?.status === 'skipped') {
        throw new TypeError(`EXP-4 member ${head} was skipped and has no data`);
      }
      const output = environment.outputs.get(head);
      return output === undefined ? { found: false } : lookup(output, rest);
    }
    throw new TypeError(`EXP-4 path ${JSON.stringify(at)} is not bound in this frame`);
  }

  /** Resolve a forwarded origin: a current binding, or an earlier child output of the same frame. */
  origin(environment: IEnvironment, outputs: readonly (IData | undefined)[], at: IPath): ILookup {
    const [family, head] = at;
    if (family !== 'child') {
      return this.resolve(environment, at);
    }
    const output = typeof head === 'number' && head < outputs.length ? outputs[head] : undefined;
    return output === undefined ? { found: false } : lookup(output, at.slice(2));
  }

  /**
   * Obtain a child result: validate retained candidates for its identity, else
   * execute it. Missing or ambiguous slot correspondence throws before any
   * child work; a child failure is cached and rethrown for this pass.
   */
  invokeChild(child: IDescriptor, recipe: IArguments, values: readonly IArgumentValue[]): IChildResult {
    const resolution = this.graph.resolve(child);
    if (resolution.status !== 'found') {
      throw new CorrespondenceError(bindingReason(resolution.status), `EXP-4 callable ${child.slot} has ${resolution.status} correspondence`);
    }
    if (resolution.declaration.kind !== 'implementation') {
      throw new CorrespondenceError('missing-binding', `EXP-4 ${child.slot} is not a supplied callable`);
    }
    const identity = historyIdentity(child, recipe);
    const cacheKey = `${identity}|${JSON.stringify(values.map(value => value.kind === 'data' ? encode(value.value) : `#opaque:${value.reason}`))}`;
    const cached = this.#children.get(cacheKey);
    if (cached instanceof Error) {
      throw cached;
    }
    if (cached !== undefined) {
      return cached;
    }
    const attempt = this.attempt(identity, { kind: 'child', args: values }, {
      descriptor: child, body: resolution.declaration.step.body, calls: new Map(), consumed: [], key: undefined,
    });
    if (attempt.status === 'failed') {
      const failure = new Error(`EXP-4 child ${child.slot} failed: ${attempt.diagnostic}`);
      this.#children.set(cacheKey, failure);
      throw failure;
    }
    const result: IChildResult = Object.freeze({ identity, reference: attempt.reference, output: attempt.output });
    this.#children.set(cacheKey, result);
    return result;
  }

  /**
   * Validate newest-first; on a miss, admit only if every declared callable
   * slot resolves to exactly one current implementation, then execute once.
   */
  attempt(identity: string, environment: IEnvironment, runnable: IRunnable): IAttempt {
    let decision: IDecision = 'no-history';
    for (const [index, candidate] of this.history.candidates(identity).entries()) {
      const validation = this.validate(candidate, environment, runnable);
      if (validation.status === 'hit') {
        return { status: 'ok', reference: validation.reference, output: validation.output, decision: 'hit' };
      }
      if (index === 0) {
        decision = validation.reason;
      }
    }
    for (const callable of runnable.calls.values()) {
      const resolution = this.graph.resolve(callable);
      if (resolution.status !== 'found') {
        return {
          status: 'failed',
          decision: bindingReason(resolution.status),
          diagnostic: `EXP-4 callable ${callable.slot} has ${resolution.status} correspondence; ${runnable.descriptor.slot} is not admitted`,
        };
      }
    }
    const frame = new Frame(this, environment, runnable.calls, runnable.key);
    try {
      const output: unknown = runnable.body(frame.context());
      if (output !== undefined && !isData(output)) {
        throw new TypeError('EXP-4 step output must be plain data or undefined');
      }
      for (const descriptor of runnable.consumed) {
        frame.consumed.set(descriptorKey(descriptor), descriptor);
      }
      const record: IUnreferencedRecord = Object.freeze({
        version: 2,
        identity,
        descriptor: runnable.descriptor,
        implementation: implementationText(runnable.body),
        consumed: Object.freeze([...frame.consumed.values()]),
        observations: Object.freeze([...frame.observations]),
        calls: Object.freeze([...frame.calls]),
        output: encode(output),
      });
      return { status: 'ok', reference: this.history.append(record), output, decision };
    } catch (error) {
      return { status: 'failed', diagnostic: describeError(error), decision };
    } finally {
      frame.close();
    }
  }

  /**
   * Candidate 1's validation order: implementation, consumed structural
   * bindings and the frame's own facts first; then each recorded child call in
   * order, reconstructing its arguments from current bindings or justified
   * recorded values, obtaining the current child result, and comparing only
   * the output facts the parent consumed from it.
   */
  validate(candidate: IInvocationRecord, environment: IEnvironment, runnable: IRunnable): IValidation {
    const miss = (reason: IMissReason): IValidation => ({ status: 'miss', reason });
    if (candidate.implementation !== implementationText(runnable.body)) {
      return miss('changed-implementation');
    }
    for (const consumed of candidate.consumed) {
      const resolution = this.graph.resolve(consumed);
      if (resolution.status !== 'found') {
        return miss(bindingReason(resolution.status));
      }
    }
    for (const observation of candidate.observations) {
      if (observation.kind !== 'read') {
        continue;
      }
      try {
        const found = this.resolve(environment, observation.path);
        if ((found.found ? encode(found.value) : absentFact) !== observation.fact) {
          return miss('changed-evidence');
        }
      } catch (error) {
        return miss(error instanceof CorrespondenceError ? error.reason : 'changed-evidence');
      }
    }
    const outputs: (IData | undefined)[] = [];
    const declared = new Set([...runnable.calls.values()].map(descriptorKey));
    for (const call of candidate.calls) {
      if (!declared.has(descriptorKey(call.child))) {
        return miss('missing-binding');
      }
      const values: IArgumentValue[] = [];
      for (const item of call.arguments.form === 'list' ? call.arguments.items : []) {
        if (item.form === 'unreconstructible') {
          return miss('unreconstructible-argument');
        }
        if (item.form === 'derived') {
          const value = item.justified ? decode(item.value) : undefined;
          if (value === undefined) {
            return miss('unjustified-argument');
          }
          values.push({ kind: 'data', value });
          continue;
        }
        let found: ILookup;
        try {
          found = this.origin(environment, outputs, item.origin);
        } catch (error) {
          return miss(error instanceof CorrespondenceError ? error.reason : 'changed-evidence');
        }
        if (!found.found) {
          return miss('changed-evidence');
        }
        values.push({ kind: 'data', value: found.value });
      }
      let result: IChildResult;
      try {
        result = this.invokeChild(call.child, call.arguments, values);
      } catch (error) {
        return miss(error instanceof CorrespondenceError ? error.reason : 'child-failed');
      }
      outputs.push(result.output);
      for (const observation of candidate.observations) {
        if (observation.kind !== 'child-read' || observation.call !== call.index) {
          continue;
        }
        const found = result.output === undefined ? { found: false as const } : lookup(result.output, observation.path);
        if ((found.found ? encode(found.value) : absentFact) !== observation.fact) {
          return miss('changed-child-output');
        }
      }
    }
    return { status: 'hit', reference: candidate.reference, output: decode(candidate.output) };
  }
}

/** A keyed member as discovered, or the reason discovery cannot proceed to member work. */
type IDiscovery =
  | { readonly status: 'complete' | 'open'; readonly members: readonly { readonly key: string; readonly record: IData }[] }
  | { readonly status: 'rejected'; readonly diagnostic: string };

/**
 * Key every discovered member before any member work (COL-1). The default key
 * is the designated `id`; a traversal position is only ever named in a
 * diagnostic, never used as identity.
 */
function discover(fanout: ICompiledFanout, sources: ISources): IDiscovery {
  const slot = fanout.collection.slot;
  const advice = `supply a custom key function (fanout "${fanout.slot}" key option)`;
  const hook = Object.hasOwn(sources.collections, slot) ? sources.collections[slot] : undefined;
  if (hook === undefined) {
    return { status: 'rejected', diagnostic: `Collection "${slot}" has no current source hook` };
  }
  const snapshot = hook();
  if ((snapshot.status !== 'complete' && snapshot.status !== 'open') || !snapshot.members.every(isData)) {
    return { status: 'rejected', diagnostic: `Collection "${slot}" returned an unsupported snapshot` };
  }
  const seen = new Set<string>();
  const members: { readonly key: string; readonly record: IData }[] = [];
  for (const [position, record] of snapshot.members.entries()) {
    let key: unknown;
    try {
      const id = lookup(record, ['id']);
      key = fanout.key !== undefined
        ? fanout.key(record)
        : id.found && (typeof id.value === 'string' || typeof id.value === 'number') ? String(id.value) : undefined;
    } catch (error) {
      return { status: 'rejected', diagnostic: `Collection "${slot}" custom key failed at traversal position ${position}: ${describeError(error)}` };
    }
    if (typeof key !== 'string' || key.length === 0) {
      return { status: 'rejected', diagnostic: `Collection "${slot}" member at traversal position ${position} has no member key; ${advice}` };
    }
    if (seen.has(key)) {
      return { status: 'rejected', diagnostic: `Collection "${slot}" has duplicate member key "${key}"; ${advice} that yields unique keys` };
    }
    seen.add(key);
    members.push({ key, record });
  }
  return { status: snapshot.status, members };
}

/** Evaluate a tracked gate; only an explicit boolean selects run or skip. */
function evaluateGate(pass: Pass, gate: IGateBody, key: string, record: IData): boolean | { readonly failed: string } {
  const frame = new Frame(pass, { kind: 'instance', member: record }, new Map(), key);
  try {
    const selected: unknown = gate(frame.context());
    return typeof selected === 'boolean'
      ? selected
      : { failed: `EXP-4 gate for member ${key} returned a non-boolean ${typeof selected}; only an explicit false is a skip` };
  } catch (error) {
    return { failed: `EXP-4 gate for member ${key} failed: ${describeError(error)}` };
  } finally {
    frame.close();
  }
}

/** Instantiate every template step for one member key. */
function instantiate(pass: Pass, fanout: ICompiledFanout, key: string, record: IData, supervised: 'pending' | 'cancelled' | undefined): Record<string, IMemberOutcome> {
  const every = (outcome: IMemberOutcome): Record<string, IMemberOutcome> =>
    Object.fromEntries(fanout.steps.map(compiledStep => [compiledStep.descriptor.slot, outcome]));
  if (supervised !== undefined) {
    return every({ status: supervised });
  }
  if (fanout.gate !== undefined) {
    const selected = evaluateGate(pass, fanout.gate, key, record);
    if (typeof selected !== 'boolean') {
      return every({ status: 'failed', diagnostic: selected.failed });
    }
    if (!selected) {
      return every({ status: 'skipped' });
    }
  }
  return Object.fromEntries(fanout.steps.map((compiledStep: ICompiledStep): [string, IMemberOutcome] => {
    const descriptor: IDescriptor = Object.freeze({ ...compiledStep.descriptor, memberKey: key });
    const attempt = pass.attempt(historyIdentity(descriptor, { form: 'empty' }), { kind: 'instance', member: record }, {
      descriptor, body: compiledStep.body, calls: compiledStep.calls, consumed: [], key,
    });
    return [compiledStep.descriptor.slot, attempt.status === 'ok'
      ? { status: 'succeeded', reference: attempt.reference, decision: attempt.decision, value: attempt.output }
      : { status: 'failed', diagnostic: attempt.diagnostic, decision: attempt.decision }];
  }));
}

/**
 * Candidate 5's strict fold: every current member contributes an explicit
 * keyed outcome. Failed or cancelled members fail it with their keys; open
 * discovery or pending members leave it waiting with no body execution;
 * skipped members are delivered as explicit entries excluded from the
 * required population. Only then is the fold validated or executed.
 */
function strictFold(
  pass: Pass,
  fold: ICompiledFold,
  status: 'complete' | 'open',
  members: ReadonlyMap<string, Record<string, IMemberOutcome>>,
): IFoldOutcome {
  const failed: string[] = [];
  const cancelled: string[] = [];
  const pending: string[] = [];
  const entries: IMemberEntry[] = [];
  const outputs = new Map<string, IData | undefined>();
  for (const key of [...members.keys()].sort()) {
    const outcome = members.get(key)?.[fold.over.slot];
    switch (outcome?.status) {
      case 'succeeded':
        entries.push(Object.freeze({ key, status: 'succeeded' }));
        outputs.set(key, outcome.value);
        break;
      case 'skipped':
        entries.push(Object.freeze({ key, status: 'skipped' }));
        break;
      case 'cancelled':
        cancelled.push(key);
        break;
      case 'pending':
        pending.push(key);
        break;
      default:
        failed.push(key);
    }
  }
  const openDiscovery = status === 'open';
  if (failed.length > 0 || cancelled.length > 0) {
    return {
      status: 'failed',
      diagnostic: `EXP-4 strict fold ${fold.descriptor.slot} requires every member; failed or cancelled members prevent completion`,
      failed, cancelled, pending, openDiscovery,
    };
  }
  if (openDiscovery || pending.length > 0) {
    return { status: 'waiting', openDiscovery, pending };
  }
  const attempt = pass.attempt(historyIdentity(fold.descriptor, { form: 'empty' }), { kind: 'fold', entries, outputs }, {
    descriptor: fold.descriptor, body: fold.body, calls: new Map(), consumed: [fold.over], key: undefined,
  });
  return attempt.status === 'ok'
    ? { status: 'succeeded', reference: attempt.reference, decision: attempt.decision, value: attempt.output }
    : { status: 'failed', diagnostic: attempt.diagnostic, failed: [], cancelled: [], pending: [], openDiscovery };
}

/**
 * Run one pass: discover and key members, evaluate gates, validate or
 * execute each member instance independently, then settle each strict fold.
 * Independent members never wait for each other or for discovery closure.
 * @internal
 */
export function runPass(graph: IGraph, sources: ISources, history: IHistory, supervision: ISupervision = {}): IPassReport {
  const state = compiledGraph(graph);
  const pass = new Pass(state, sources, history);
  const fanout = state.fanout;
  if (fanout === undefined) {
    return { collection: { status: 'complete', keys: [] }, members: {}, folds: {} };
  }
  const discovery = discover(fanout, sources);
  if (discovery.status === 'rejected') {
    return {
      collection: discovery,
      members: {},
      folds: Object.fromEntries(state.folds.map(fold => [fold.descriptor.slot, {
        status: 'failed' as const, diagnostic: discovery.diagnostic, failed: [], cancelled: [], pending: [], openDiscovery: false,
      }])),
    };
  }
  const members = new Map<string, Record<string, IMemberOutcome>>();
  for (const { key, record } of discovery.members) {
    members.set(key, instantiate(pass, fanout, key, record, Object.hasOwn(supervision, key) ? supervision[key] : undefined));
  }
  return {
    collection: { status: discovery.status, keys: discovery.members.map(member => member.key) },
    members: Object.fromEntries(members),
    folds: Object.fromEntries(state.folds.map(fold => [fold.descriptor.slot, strictFold(pass, fold, discovery.status, members)])),
  };
}
