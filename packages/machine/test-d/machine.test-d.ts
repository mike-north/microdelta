import { expectError, expectType } from 'tsd';

import type { IAsyncContext, IAsyncContextCapability, IMachine, ISnapshotCapability } from '../dist/src/index.js';

declare const machine: IMachine;
declare const contextCapability: IAsyncContextCapability;
declare const snapshotCapability: ISnapshotCapability;
declare const context: IAsyncContext<string>;

expectType<IAsyncContext<string>>(contextCapability.createAsyncContext<string>());
expectType<string | undefined>(context.getStore());
expectType<Promise<number>>(context.run('scope', async () => 1));
expectType<{ value: number }>(snapshotCapability.snapshot({ value: 1 }));
expectType<IMachine>(machine);
expectError(context.run(1, () => 1));
