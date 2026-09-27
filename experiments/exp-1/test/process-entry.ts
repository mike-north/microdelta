/**
 * EXP-1's Node-only process and JSON driver. It deliberately supplies a small
 * history fixture to the portable candidate; it does not claim atomic durable
 * publication, recovery, source policy, or a production Machine capability.
 */
import { readFile, writeFile } from 'node:fs/promises';

import { capture, compatibilityVersion, createRegistry, tracked, validate } from '../src/protocol.js';
import type { IBindingDescriptor, ICandidate, IObservation, IRegistry, IValidation } from '../src/protocol.js';
import {
  editedHelper,
  editedUnusedHelper,
  importedConfig,
  importedHelper,
  suppliedAssessor,
  unusedHelper,
} from './imported-bindings.js';

/** These two member keys are fixed fixture subjects; invocation order can change independently. */
type IMemberKey = 'a' | 'b';

/** The JSON file is harness state; retained candidates are not a selected History schema. */
interface IStore {
  readonly history: ICandidate[];
  readonly currentPointers: Record<IMemberKey, string>;
  nextReference: number;
}

/** A process result makes body counts, exact references, and miss reasons observable. */
interface IProcessReport {
  readonly invocationOrder: readonly IMemberKey[];
  readonly displayLabel?: string;
  readonly producerExecutions: number;
  readonly executions: number;
  readonly references: Record<IMemberKey, string>;
  readonly decisions: Record<IMemberKey, string>;
  readonly currentPointers: Record<IMemberKey, string>;
  readonly rollbackReferences?: Record<IMemberKey, string>;
}

/** Scope and slots are author-declared structure, never labels, source text, or call ordinals. */
const scope = 'roster-fixture';
const configSlot: IBindingDescriptor = { scope, role: 'input', slot: 'config' };
const helperSlot: IBindingDescriptor = { scope, role: 'callable', slot: 'helper' };
const assessorSlot: IBindingDescriptor = { scope, role: 'callable', slot: 'assessor' };
const unusedSlot: IBindingDescriptor = { scope, role: 'callable', slot: 'unused-helper' };

/** A JSON boundary must reject malformed fixture records rather than cast unknown history into proof. */
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Only the bounded descriptor grammar is accepted from the prior process. */
function descriptor(value: unknown): value is IBindingDescriptor {
  return record(value)
    && typeof value.scope === 'string'
    && typeof value.slot === 'string'
    && (value.role === 'input' || value.role === 'callable' || value.role === 'step')
    && (value.memberKey === undefined || typeof value.memberKey === 'string');
}

/** The harness parses only observations its portable probe can currently produce. */
function observation(value: unknown): value is IObservation {
  if (!record(value) || !descriptor(value.descriptor)) {
    return false;
  }
  if (value.kind === 'implementation') {
    return typeof value.source === 'string';
  }
  return value.kind === 'field'
    && typeof value.field === 'string'
    && (value.value === null || typeof value.value === 'string' || typeof value.value === 'boolean'
      || (typeof value.value === 'number' && Number.isFinite(value.value)));
}

/** A candidate locates one exact result and carries no function or process-local token. */
function candidate(value: unknown): value is ICandidate {
  if (!record(value) || typeof value.subject !== 'string' || typeof value.reference !== 'string'
    || typeof value.version !== 'number' || !Number.isSafeInteger(value.version) || value.version < 1
    || !Array.isArray(value.observations)) {
    return false;
  }
  const facts: readonly unknown[] = value.observations;
  return facts.every(observation);
}

/** This readback is deliberately stronger than trusting a JSON.parse cast. */
function store(value: unknown): value is IStore {
  if (!record(value) || !Array.isArray(value.history) || !record(value.currentPointers)
    || typeof value.currentPointers.a !== 'string' || typeof value.currentPointers.b !== 'string'
    || typeof value.nextReference !== 'number' || !Number.isSafeInteger(value.nextReference)) {
    return false;
  }
  const history: readonly unknown[] = value.history;
  return history.every(candidate);
}

/** A simple fixture file is sufficient to prove process exit and reconstruction, not crash safety. */
async function readStore(file: string): Promise<IStore> {
  const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
  if (!store(parsed)) {
    throw new TypeError('Invalid EXP-1 fixture history');
  }
  return parsed;
}

/** This fixture has no concurrent writer or crash claim. */
async function saveStore(file: string, history: IStore): Promise<void> {
  await writeFile(file, JSON.stringify(history));
}

/** A member's subject is author-provided identity; its display label is not used as a locator. */
function subjectFor(key: IMemberKey): string {
  return `assessment:pr-${key}`;
}

/** Nonmemoized input production runs on each pass even when its consumer retains a result. */
function produceMember(key: IMemberKey, scenario: string, processStage: 'A' | 'B'): { readonly score: number; readonly unread: string } {
  const changedScore = processStage === 'B' && scenario === 'consumed-field' && key === 'a';
  const changedUnread = processStage === 'B' && scenario === 'unread-and-label';
  return tracked({
    score: (key === 'a' ? 7 : 8) + (changedScore ? 1 : 0),
    unread: changedUnread ? 'after' : 'before',
  });
}

/** Each key instantiates fresh current objects under declared slots. */
function currentBindings(key: IMemberKey, scenario: string, processStage: 'A' | 'B'): { readonly registry: IRegistry; readonly consumer: () => number } {
  const member = produceMember(key, scenario, processStage);
  const helper = processStage === 'B' && scenario === 'helper-edit' ? editedHelper : importedHelper;
  const unused = processStage === 'B' && scenario === 'uncalled-helper-edit' ? editedUnusedHelper : unusedHelper;
  const consumer = tracked((): number => suppliedAssessor(helper(member.score)));
  const memberSlot: IBindingDescriptor = { scope, role: 'input', slot: 'member', memberKey: key };
  const consumerSlot: IBindingDescriptor = { scope, role: 'step', slot: 'assessment', memberKey: key };
  const registry = createRegistry();
  const registrations: readonly (readonly [IBindingDescriptor, object])[] = [
    [consumerSlot, consumer],
    [memberSlot, member],
    [helperSlot, helper],
    [assessorSlot, suppliedAssessor],
    [configSlot, importedConfig],
    [unusedSlot, unused],
  ];
  const currentOrder = processStage === 'B' ? [...registrations].reverse() : registrations;
  for (const [slot, declaration] of currentOrder) {
    if (processStage === 'B' && scenario === 'missing-assessor' && slot.slot === 'assessor') {
      continue;
    }
    registry.register(slot, declaration);
  }
  if (processStage === 'B' && scenario === 'ambiguous-helper') {
    registry.register(helperSlot, editedHelper);
  }
  return { registry, consumer };
}

/** A stored result from the requested compatibility group is merely a candidate. */
function retainedCandidate(history: IStore, subject: string, version: number): ICandidate | undefined {
  return [...history.history].reverse().find(item => item.subject === subject && item.version === version);
}

/** A fresh execution creates a new exact fixture reference and moves only its explicit pointer. */
function execute(history: IStore, registry: IRegistry, consumer: () => number, key: IMemberKey, version: number): string {
  const result = capture(registry, consumer);
  const reference = `result-${history.nextReference}`;
  history.nextReference++;
  history.history.push({ subject: subjectFor(key), version, reference, observations: result.observations });
  history.currentPointers[key] = reference;
  return reference;
}

/** One pass validates without replay, then executes only ordinary admitted misses. */
function pass(
  history: IStore,
  order: readonly IMemberKey[],
  scenario: string,
  processStage: 'A' | 'B',
  requestedVersion?: number,
  checkOnly = false,
): IProcessReport {
  const version = compatibilityVersion(requestedVersion);
  const references: Record<IMemberKey, string> = { a: history.currentPointers.a, b: history.currentPointers.b };
  const decisions: Record<IMemberKey, string> = { a: '', b: '' };
  let executions = 0;
  let producerExecutions = 0;
  for (const key of order) {
    const current = currentBindings(key, scenario, processStage);
    producerExecutions++;
    const prior = retainedCandidate(history, subjectFor(key), version);
    const decision: IValidation = prior === undefined
      ? { status: 'miss', reason: 'version' }
      : validate(current.registry, prior, version);
    decisions[key] = decision.status === 'hit' ? 'hit' : decision.reason;
    if (decision.status === 'hit') {
      references[key] = decision.reference;
      continue;
    }
    if (checkOnly || decision.reason === 'missing-binding' || decision.reason === 'ambiguous-binding') {
      continue;
    }
    references[key] = execute(history, current.registry, current.consumer, key, version);
    executions++;
  }
  return {
    invocationOrder: order,
    producerExecutions,
    executions,
    references,
    decisions,
    currentPointers: { ...history.currentPointers },
  };
}

/** Two independent invocations of this file are the required process boundary. */
async function main(): Promise<void> {
  const stage = process.argv[2];
  const file = process.argv[3];
  const scenario = process.argv[4];
  if ((stage !== 'A' && stage !== 'B') || file === undefined || scenario === undefined) {
    throw new TypeError('Use process-entry.js A|B history.json scenario');
  }
  if (stage === 'A') {
    const initial: IStore = { history: [], currentPointers: { a: '', b: '' }, nextReference: 1 };
    const report = pass(initial, ['a', 'b'], scenario, 'A');
    await saveStore(file, initial);
    process.stdout.write(JSON.stringify({ ...report, displayLabel: 'Assess PR' }));
    return;
  }
  const history = await readStore(file);
  const displayLabel = scenario === 'unread-and-label' ? 'Renamed assessment' : 'Assess PR';
  if (scenario === 'tracked-capture-edit') {
    importedConfig.factor = 3;
  }
  if (scenario === 'unread-and-label') {
    importedConfig.unread = 'after';
  }
  const versionScenario = scenario === 'version-rollback' || scenario === 'version-rollback-changed';
  if (!versionScenario) {
    const report = pass(history, ['b', 'a'], scenario, 'B');
    await saveStore(file, history);
    process.stdout.write(JSON.stringify({ ...report, displayLabel }));
    return;
  }
  const newer = pass(history, ['b', 'a'], scenario, 'B', 2);
  if (scenario === 'version-rollback-changed') {
    importedConfig.factor = 3;
  }
  const rollback = pass(history, ['b', 'a'], scenario, 'B', 1, scenario === 'version-rollback-changed');
  const report: IProcessReport = {
    ...rollback,
    displayLabel,
    producerExecutions: newer.producerExecutions + rollback.producerExecutions,
    executions: newer.executions + rollback.executions,
    rollbackReferences: rollback.references,
    currentPointers: { ...history.currentPointers },
  };
  await saveStore(file, history);
  process.stdout.write(JSON.stringify(report));
}

await main();
