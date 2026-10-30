/** Restricted traversal entry keeps source and continuation authority out of author adapters. */
import { expectError, expectType } from 'tsd';
import type { IBindingFamily, IRootAcquisitionWitness } from '@microdelta/definition';
import type { ITraversalRunAuthority } from '@microdelta/resolution';

import type { IResolutionPorts, IRun, ITraversalAdapter, ITraversalReport } from '../dist/src/index.js';

declare const run: IRun;
declare const witness: IRootAcquisitionWitness<IBindingFamily>;
declare const adapter: ITraversalAdapter;
declare const ports: IResolutionPorts;

expectType<Promise<ITraversalReport>>(run.traverse(witness, adapter, { requestKey: 'person' }));
expectType<ITraversalRunAuthority>(ports.traversalAuthority);
expectError(run.traverse({ kind: 'root-acquisition', relationship: 'person' }, adapter, { requestKey: 'person' }));
expectError(run.traverse(witness, { accept: () => ({ kind: 'continue', frontier: {}, cursor: 'raw' }) }, { requestKey: 'person' }));
expectError(run.traverse(witness, { accept: () => Promise.resolve({ kind: 'complete', frontier: {} }) }, { requestKey: 'person' }));
