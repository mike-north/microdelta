/** The bounded authoring surface: declared slots, recipe tokens and explicit strict-fold entries. */
import { expectAssignable, expectError, expectNotAssignable, expectType } from 'tsd';

import { compose, forward, step } from '../src/protocol.js';
import type { IChildView, IContext, IForwarded, IMemberEntry, IMemberOutcome } from '../src/protocol.js';

declare const context: IContext;

/** Forwarded origins are tokens; calls address declared slots by structural name. */
expectType<IForwarded>(forward(['input', 'pulls']));
expectType<IChildView>(context.call('assessor', 'pr-1', forward(['input', 'pulls'])));

/** A callable obtained from a result is not a slot name. */
expectError(context.call((): number => 1));

/** A step body must return plain data or undefined, never a function. */
expectError(step((_context: IContext) => (): number => 1));

/** Only a callable handle can be supplied an implementation. */
expectError(compose('fixture', builder => {
  builder.supply(builder.input('config'), step(() => null));
}));

/** Strict-fold entries are only succeeded or explicitly skipped. */
expectAssignable<IMemberEntry>({ key: 'a', status: 'skipped' });
expectNotAssignable<IMemberEntry>({ key: 'a', status: 'pending' });

/** A skipped outcome carries no value; a successful one always states its value, even undefined. */
expectNotAssignable<IMemberOutcome>({ status: 'skipped', value: undefined });
expectNotAssignable<IMemberOutcome>({ status: 'succeeded', reference: 'r', decision: 'hit' });
