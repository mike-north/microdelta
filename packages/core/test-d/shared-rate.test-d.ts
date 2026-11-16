/** The facade exposes explicit rate association without requiring a retry classifier. */
import { expectAssignable, expectError, expectType } from 'tsd';
import { registerSharedRateSurface } from '../dist/src/index.js';
import type { IOperationRequest, IOperationSharedRate, ISharedRateSurface } from '../dist/src/index.js';
const surface = registerSharedRateSurface({ environment: 'prod', service: 'catalog', accessContext: 'account', surface: 'catalog' });
expectType<ISharedRateSurface>(surface);
expectAssignable<IOperationSharedRate>({ surface, cooldownGateId: 'base' });
expectAssignable<IOperationRequest<number>>({ name: 'detail', binding: 'opaque', sharedRate: { surface, cooldownGateId: 'base' }, perform: () => Promise.resolve({ kind: 'succeeded', value: 1 }) });
expectError<IOperationSharedRate>({ surface });
expectError<IOperationSharedRate>({ surface, cooldownGateId: 'base', gates: [] });
