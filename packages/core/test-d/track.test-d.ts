import { expectError, expectType } from 'tsd';

import { cell, consume, createTag, derived, dirty, isValid, snapshot, withFrame, withFrameAsync } from '../dist/src/track/index.js';
import type { Revision, Tag } from '../dist/src/track/index.js';

const tag = createTag();
expectType<Tag>(tag);
expectType<void>(consume(tag));
expectType<void>(dirty(tag));
expectType<Revision>(snapshot([tag]));
expectType<boolean>(isValid([tag], 0));
expectType<{ value: number; consumed: ReadonlySet<Tag> }>(withFrame(() => 1));
expectType<Promise<{ value: number; consumed: ReadonlySet<Tag> }>>(withFrameAsync(async () => 1));
expectType<{ get(): number; set(v: number): void }>(cell(1));
expectType<{ get(): number }>(derived(() => 1));
expectError(consume({ __tag: Symbol('forged') }));
expectError(tag.__tag = Symbol('replacement'));
expectError(tag.value);
expectError(tag.revision);
// eslint-disable-next-line @typescript-eslint/no-unsafe-call -- This negative tsd case intentionally calls a method absent from the declared type.
expectError(withFrame(() => {}).consumed.add(tag));
expectError(cell(1).set('wrong type'));
// eslint-disable-next-line @typescript-eslint/no-unsafe-call -- This negative tsd case intentionally calls a method absent from the declared type.
expectError(derived(() => 1).set(2));
expectError(withFrameAsync(() => 1));
