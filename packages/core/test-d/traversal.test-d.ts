/** The installed alpha facade carries restricted relationship and terminal types without owner imports. */
import { expectError, expectType } from 'tsd';

import type { IAuthoring, IComposition, IRootAcquisitionWitness, ITraversalAdapter, ITraversalDeclaration, ITraversalReport, IWorkspaceRun } from '../dist/api/microdelta.alpha.js';

/** Current query data has analysis identity, never a mutable traversal ordinal. */
interface IInputs { readonly query: { readonly person: string } }

declare const author: IAuthoring<IInputs, object>;
declare const composition: IComposition<IInputs, object>;
declare const declaration: ITraversalDeclaration<IInputs, object>;
declare const run: IWorkspaceRun;
declare const adapter: ITraversalAdapter;

const witness = author.rootAcquisition(composition, declaration);
expectType<IRootAcquisitionWitness<IInputs, object>>(witness);
expectType<Promise<ITraversalReport>>(run.traverse(witness, adapter, { requestKey: 'person' }));
expectError(run.traverse({ kind: 'root-acquisition', relationship: 'person' }, adapter, { requestKey: 'person' }));
expectError(run.traverse(witness, { accept: () => ({ kind: 'continue', frontier: {}, cursor: 'raw' }) }, { requestKey: 'person' }));
