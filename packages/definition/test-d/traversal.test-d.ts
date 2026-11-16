/**
 * Generated declaration contract for the restricted root relationship: a page
 * source and strict fold remain distinct from memo slots and tolerant folds.
 * Nominal tokens prevent structural construction of acquisition authority.
 */
import { expectError, expectNotAssignable, expectType } from 'tsd';

import {
  declarations,
  type ICollectionResult,
  type IInvocationArguments,
  type IRootAcquisitionWitness,
  type ITraversalBinding,
  type ITraversalDeclaration,
} from '../dist/src/index.js';
import type { ITestFamily } from '../test/fixtures/contributors.js';

/** One fixed query and source signature; no author-selected arbitrary invoker. */
const builders = declarations<ITestFamily>();
const page = builders.sourceSlot<readonly [object, string | undefined], object>({ slot: 'page' });
const collection = builders.source<ICollectionResult<{ readonly id: string }>>({ subject: 'frontier', collection: { identity: 'id' }, run: () => ({ members: [], status: 'open' }) });
const template = builders.template({ slot: 'prs', collection, steps: member => ({ assess: member.memo({ subject: member.subject('assessment'), run: () => ({}) }) }) });
const fold = builders.fold({ subject: 'summary', over: { template, step: 'assess' }, run: () => ({}) });
const relation = builders.traversal({ slot: 'person-prs', query: 'query', page, collection, template, fold });
expectType<ITraversalDeclaration<ITestFamily>>(relation);
const composition = builders.compose({ scope: 'test', traversals: [relation] });
const witness = builders.rootAcquisition(composition, relation);
expectType<IRootAcquisitionWitness<ITestFamily>>(witness);
expectType<ITraversalBinding>(builders.resolveRootAcquisition(composition, witness));
expectType<IInvocationArguments>(builders.rootArgumentRecipes(composition, witness, [{ person: 'A' }, undefined], true));
expectError(builders.rootArgumentRecipes(composition, witness, [{ person: 'A' }, 1], true));
expectError(builders.rootArgumentRecipes(composition, witness, [{ person: 'A' }], true));
expectNotAssignable<IRootAcquisitionWitness<ITestFamily>>({ kind: 'root-acquisition' });
expectError(builders.rootAcquisition(composition, { slot: 'person-prs' }));
const memo = builders.stepSlot<readonly [object, string | undefined], object>({ slot: 'memo' });
expectError(builders.traversal({ slot: 'bad', query: 'query', page: memo, collection, template, fold }));
const tolerant = builders.outcomeFold({ subject: 'tolerant', over: { template, step: 'assess' }, run: () => ({}) });
expectError(builders.traversal({ slot: 'bad-fold', query: 'query', page, collection, template, fold: tolerant }));

/** The source's declared result fixes evidence type, with explicit absence outside a capture. */
builders.source<ICollectionResult<{ readonly id: string }>>({ subject: 'typed-frontier', run: context => {
  expectType<ICollectionResult<{ readonly id: string }> | undefined>(context.evidence);
  return { members: [], status: 'open' };
} });
