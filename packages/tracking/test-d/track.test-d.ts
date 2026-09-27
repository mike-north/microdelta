import { expectError, expectType } from 'tsd';

import { createTracking } from '../dist/src/index.js';
import type { IAsyncContext, IAsyncContextCapability } from '@microdelta/machine';
import type { ITracking, Revision, Tag } from '../dist/src/index.js';

const capability: IAsyncContextCapability = {
  createAsyncContext<T>(): IAsyncContext<T> {
    return {
      getStore: () => undefined,
      run: (_value, callback) => callback(),
    };
  },
};
const tracking = createTracking(capability);
const tag = tracking.createTag();

expectType<ITracking>(tracking);
expectType<Tag>(tag);
expectType<void>(tracking.consume(tag));
expectType<void>(tracking.dirty(tag));
expectType<Revision>(tracking.snapshot([tag]));
expectType<boolean>(tracking.isValid([tag], 0));
expectType<{ value: number; consumed: ReadonlySet<Tag> }>(tracking.withFrame(() => 1));
expectType<Promise<{ value: number; consumed: ReadonlySet<Tag> }>>(tracking.withFrameAsync(async () => 1));
expectType<{ get(): number; set(v: number): void }>(tracking.cell(1));
expectType<{ get(): number }>(tracking.derived(() => 1));
expectError(tracking.consume({ __tag: Symbol('forged') }));
expectError(tracking.withFrameAsync(() => 1));
expectError(createTracking({}));
