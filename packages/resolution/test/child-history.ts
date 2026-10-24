/**
 * In-memory History port for Resolution's isolated child-validation contract.
 * It stores immutable exact snapshots, parent provenance and current
 * acceptances separately; no SQLite, Machine policy or recursive child
 * resolver participates in the parent's decision.
 */
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

import type {
  IAcceptanceRecord,
  IAttemptRecord,
  ICompletedEnvelope,
  ICompletedResultReference,
  IStageRequest,
  IVersionedSubject,
} from '@microdelta/history';
import { createTrackingObserver } from '@microdelta/tracking';
import type { IAddressSegment, IOperation, ISelectedFact, ISelectedNode, ITrackingObserver } from '@microdelta/tracking';

import type { IResolutionHistory, IResolutionHost } from '../src/contracts.js';

/** The only host facilities Resolution and Tracking need in this fixture. */
export const host: IResolutionHost = {
  createAsyncContext<T>() { return new AsyncLocalStorage<T>(); },
  sha256(input: string): string { return createHash('sha256').update(input, 'utf8').digest('hex'); },
};

/** A test-owned exact result and its independently recorded History metadata. */
interface IStoredResult {
  readonly payload: unknown;
  readonly envelope: ICompletedEnvelope | undefined;
}

/** A staged attempt has no completed result until publication. */
interface IAttemptEntry {
  readonly record: IAttemptRecord;
  readonly stage: IStageRequest | undefined;
}

/** The port and observation handles used by one isolated parent scenario. */
export interface IChildHistory {
  readonly history: IResolutionHistory;
  readonly tracking: ITrackingObserver;
  readonly acceptances: readonly IAcceptanceRecord[];
  readonly childQueries: number;
  readonly parentQueries: number;
  readonly childEnvelopeReads: number;
  readonly fingerprintReads: number;
  /** Fail if the normal resolver enters this child candidate query. */
  armChildQuerySentinel(): void;
  /** Store an exact current child output without running its resolver. */
  seedChild(payload: object): ICompletedResultReference;
  /** Read a stored snapshot by its exact reference for outcome assertions. */
  payloadOf(reference: ICompletedResultReference): unknown;
  /** Damage only a candidate's exact dependency list for an integrity sentinel. */
  dropDependencies(reference: ICompletedResultReference): void;
}

/** A compact fake that implements only History's declared Resolution port. */
export function childHistory(): IChildHistory {
  const results = new Map<string, IStoredResult>();
  const attempts = new Map<number, IAttemptEntry>();
  const acceptances: IAcceptanceRecord[] = [];
  let childQueries = 0;
  let parentQueries = 0;
  let childEnvelopeReads = 0;
  let fingerprintReads = 0;
  let childQueryMustFail = false;
  /** Independent observer used only to compute matching selected-fact digests. */
  const probe = createTrackingObserver(host);
  let nextAttempt = 1;
  let nextResult = 1;

  /** An unknown exact locator is integrity damage, not a candidate miss. */
  const stored = (reference: ICompletedResultReference): IStoredResult => {
    const result = results.get(reference.locator);
    if (result === undefined) {
      throw new Error(`Unknown exact result ${reference.locator}`);
    }
    return result;
  };

  /** Stage identity is issued by this fake, never inferred from an author result. */
  const attempted = (attemptId: number): IAttemptEntry => {
    const entry = attempts.get(attemptId);
    if (entry === undefined) {
      throw new Error(`Unknown attempt ${String(attemptId)}`);
    }
    return entry;
  };

  /** Values are copied in the Jest realm at History's immutable snapshot boundary. */
  const copy = (payload: unknown): unknown => JSON.parse(JSON.stringify(payload)) as unknown;

  /** Navigate this fixture's plain records and arrays without importing Value across PKG-004. */
  const at = (payload: unknown, address: readonly IAddressSegment[]): unknown => {
    let current = payload;
    for (const segment of address) {
      if (current === null || typeof current !== 'object') {
        throw new Error('Selection descended through a scalar');
      }
      current = segment.kind === 'property'
        ? Reflect.get(current, segment.key) as unknown
        : Reflect.get(current, segment.index) as unknown;
    }
    return current;
  };

  /** The selected read surface used by this fixture's scalar-consuming parents. */
  const selected = (payload: unknown, address: readonly IAddressSegment[], operation: IOperation): ISelectedFact => {
    const value = at(payload, address);
    if (operation === 'value') {
      return { operation, address, fact: value };
    }
    if (operation === 'container-kind') {
      return { operation, address, fact: Array.isArray(value) ? 'array' : typeof value === 'object' && value !== null ? 'record' : 'scalar' };
    }
    if (operation === 'length' && Array.isArray(value)) {
      return { operation, address, fact: value.length };
    }
    if (operation === 'keys' && value !== null && typeof value === 'object') {
      return { operation, address, fact: Object.keys(value) };
    }
    if ((operation === 'own' || operation === 'membership') && address.length > 0) {
      const parent = at(payload, address.slice(0, -1));
      const final = address[address.length - 1];
      if (parent !== null && typeof parent === 'object' && final?.kind === 'property') {
        return { operation, address, fact: operation === 'own' ? Object.hasOwn(parent, final.key) : final.key in parent };
      }
    }
    throw new Error(`Unsupported fixture selection ${operation}`);
  };

  /** Tracking itself supplies the canonical digest for the selected scalar. */
  const selectedFingerprint = (payload: unknown, address: readonly IAddressSegment[]): string => {
    const root = copy(payload);
    if (root === null || typeof root !== 'object') {
      throw new Error('Stored result root must be a container');
    }
    const tracked = probe.tracked(root, { path: ['fixture'] });
    // eslint-disable-next-line microdelta/tracked-captures -- The fake History reader deliberately captures a selected scalar to obtain Tracking's canonical digest, not to author a computation.
    const captured = probe.capture(() => at(tracked, address));
    const observation = captured.observations.find((item) => item.kind === 'fact' && item.operation === 'value'
      && JSON.stringify(item.address) === JSON.stringify(address));
    if (observation === undefined) {
      throw new Error('Tracking did not observe the requested scalar');
    }
    return observation.fingerprint;
  };

  /** Navigation exposes only shape or one scalar, as History's reader does. */
  const node = (payload: unknown, address: readonly IAddressSegment[]): ISelectedNode => {
    const value = at(payload, address);
    if (Array.isArray(value)) {
      return { kind: 'array', address, length: value.length };
    }
    if (value !== null && typeof value === 'object') {
      return { kind: 'record', address };
    }
    return { kind: 'scalar', selected: selected(payload, address, 'value') };
  };

  const history: IResolutionHistory = {
    reader: {
      readSelected(reference, request) {
        return selected(stored(reference).payload, request.address, request.operation);
      },
      resolveFingerprint(reference, request) {
        if (request.kind === 'selected' && request.operation === 'value') {
          fingerprintReads += 1;
          return { kind: 'compatible', fingerprint: selectedFingerprint(stored(reference).payload, request.address) };
        }
        return { kind: 'unavailable' };
      },
      readNode(reference, address) {
        return node(stored(reference).payload, address);
      },
      readSubtree(reference, address) {
        const payload = stored(reference).payload;
        return copy(at(payload, address));
      },
    },
    findCandidates(subject: IVersionedSubject) {
      if (subject.subject === 'child') {
        childQueries += 1;
        if (childQueryMustFail) {
          throw new Error('CHILD-CANDIDATE-SENTINEL');
        }
      }
      if (subject.subject === 'parent') {
        parentQueries += 1;
      }
      return [...results.values()]
        .flatMap(({ envelope }) => envelope === undefined ? [] : [envelope])
        .filter((envelope) => envelope.analysis === subject.analysis && envelope.environment === subject.environment
          && envelope.subject === subject.subject && envelope.version === subject.version)
        .sort((left, right) => right.publication - left.publication);
    },
    readEnvelope(reference) {
      const envelope = stored(reference).envelope;
      if (envelope === undefined) {
        throw new Error(`Result ${reference.locator} has no published envelope`);
      }
      if (envelope.subject === 'child') {
        childEnvelopeReads += 1;
      }
      return envelope;
    },
    allocateAttempt(lease, request) {
      const record: IAttemptRecord = {
        ...request, attemptId: nextAttempt, state: 'allocated', allocatedFence: lease.fence,
        endedFence: null, result: null, outcome: null,
      };
      nextAttempt += 1;
      attempts.set(record.attemptId, { record, stage: undefined });
      return record;
    },
    stageAttempt(_lease, request) {
      const entry = attempted(request.attemptId);
      const record: IAttemptRecord = { ...entry.record, state: 'staged' };
      attempts.set(record.attemptId, { record, stage: { ...request, payload: copy(request.payload) } });
      return record;
    },
    publishAttempt(lease, attemptId) {
      const entry = attempted(attemptId);
      const stage = entry.stage;
      if (stage === undefined) {
        throw new Error('An unstaged attempt cannot publish');
      }
      const reference: ICompletedResultReference = { kind: 'completed-result', locator: `result:${String(nextResult)}` };
      const envelope: ICompletedEnvelope = {
        analysis: entry.record.analysis, environment: entry.record.environment,
        subject: entry.record.subject, version: entry.record.version,
        reference, attemptId, publication: nextResult, encoding: 'MDS1',
        provenance: stage.provenance, dependencies: [...stage.dependencies],
      };
      nextResult += 1;
      results.set(reference.locator, { payload: copy(stage.payload), envelope });
      attempts.set(attemptId, { ...entry, record: { ...entry.record, state: 'completed', endedFence: lease.fence, result: reference } });
      return reference;
    },
    abandonAttempt(lease, request) {
      const entry = attempted(request.attemptId);
      const record: IAttemptRecord = { ...entry.record, state: request.outcome, endedFence: lease.fence, outcome: request.evidence };
      attempts.set(record.attemptId, { ...entry, record });
      return record;
    },
    recoverAttempt(request) {
      const match = [...attempts.values()].map(({ record }) => record).find((record) =>
        record.analysis === request.analysis && record.environment === request.environment
        && record.subject === request.subject && record.version === request.version && record.attemptKey === request.attemptKey);
      if (match === undefined) {
        return { kind: 'absent' };
      }
      if (match.state === 'completed' && match.result !== null) {
        return { kind: 'completed', attempt: match, reference: match.result };
      }
      return match.state === 'failed' || match.state === 'interrupted'
        ? { kind: 'unsuccessful', attempt: match }
        : { kind: 'incomplete', attempt: match };
    },
    recordAcceptance(lease, request) {
      const record: IAcceptanceRecord = {
        acceptanceId: acceptances.length + 1, reference: request.reference,
        environment: request.environment, fence: lease.fence,
        evidence: request.evidence, dependencies: [...request.dependencies],
      };
      acceptances.push(record);
      return record;
    },
  };

  return {
    history,
    tracking: createTrackingObserver(host),
    acceptances,
    get childQueries() { return childQueries; },
    get parentQueries() { return parentQueries; },
    get childEnvelopeReads() { return childEnvelopeReads; },
    get fingerprintReads() { return fingerprintReads; },
    armChildQuerySentinel() { childQueryMustFail = true; },
    seedChild(payload) {
      const reference: ICompletedResultReference = { kind: 'completed-result', locator: `seed:${String(nextResult)}` };
      nextResult += 1;
      results.set(reference.locator, { payload: copy(payload), envelope: undefined });
      return reference;
    },
    payloadOf(reference) { return copy(stored(reference).payload); },
    dropDependencies(reference) {
      const result = stored(reference);
      if (result.envelope === undefined) {
        throw new Error('Only a published candidate has dependencies');
      }
      results.set(reference.locator, { ...result, envelope: { ...result.envelope, dependencies: [] } });
    },
  };
}
