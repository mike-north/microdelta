/**
 * The generated restricted traversal surface accepts declared authority and
 * opaque continuation/capture tokens; it exposes no caller-selected page slot,
 * raw query override or structural substitute for captured source evidence.
 */
import { expectAssignable, expectError, expectNotAssignable, expectType } from 'tsd';

import type {
  IFoldRequest,
  IFrontierOffer,
  IRequestSourceEvidence,
  IResolution,
  IRootAcquisition,
  ITraversalContinuation,
  ITraversalPageOutcome,
} from '../dist/src/index.js';

/** A valid owner-supplied storage lease cannot independently authorize a root call. */
const lease = { holder: 'fixture', fence: 1, expiresAt: 30_000 };
declare const resolution: IResolution;
declare const witness: unknown;
declare const continuation: ITraversalContinuation;
declare const offer: IFrontierOffer;
declare const evidence: IRequestSourceEvidence;

const port = resolution.traversals;
if (port !== undefined) {
  const root = port.open(witness);
  expectType<IRootAcquisition>(root);
  expectType<Promise<ITraversalPageOutcome>>(root.acquire({ requestKey: 'page', lease }));
  expectType<Promise<ITraversalPageOutcome>>(root.acquire({ requestKey: 'page', lease, continuation }));
  expectError(root.acquire({ requestKey: 'page', lease, query: { person: 'other' } }));
  expectError(root.acquire({ requestKey: 'page', lease, continuation: { kind: 'traversal-continuation' } }));
  expectError(root.capture({ kind: 'frontier-offer' }, 'consumer'));
  expectType<IRequestSourceEvidence>(root.capture(offer, 'consumer'));
}
expectNotAssignable<IRequestSourceEvidence>({ kind: 'request-source-evidence' });
expectAssignable<IFoldRequest>({
  step: { scope: 'test', role: 'step', slot: 'summary' }, requestKey: 'consumer#pass:2',
  normalRequestKey: 'consumer', lease, sourceEvidence: evidence,
});
expectNotAssignable<IFoldRequest>({
  step: { scope: 'test', role: 'step', slot: 'summary' }, requestKey: 'consumer', lease,
  sourceEvidence: { kind: 'request-source-evidence' },
});
