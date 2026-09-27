import { expectAssignable, expectError, expectType } from 'tsd';

import { createMemoryStore } from '../dist/src/index.js';
import type { GenerationPatch, ResultKey, Store, SubjectPatch } from '../dist/src/index.js';
import type { StoreConformanceOptions } from '../dist/test/conformance/store/index.js';

const key: ResultKey = { step: 'summarize', revision: 1, subjectHash: 'stable' };
const store = createMemoryStore();
expectType<Store>(store);
expectType<Promise<boolean>>(store.casSubject(key, 0, { currentGeneration: 1 }));
expectAssignable<SubjectPatch>({ claim: null, durations: [10] });
expectAssignable<GenerationPatch>({ state: 'abandoned', cost: { tokens: 123 } });
expectError(store.casSubject(key, 0, { key }));
expectError(store.casSubject(key, 0, { version: 5 }));
expectError(store.updateGeneration(key, 1, { key }));
expectError(store.updateGeneration(key, 1, { generation: 2 }));
// eslint-disable-next-line @typescript-eslint/no-unsafe-call -- This negative tsd case intentionally calls a method absent from the declared type.
expectError(store.deleteGeneration(key, 1));

// The shipped suite and public backend must share the same opaque digest type.
expectAssignable<StoreConformanceOptions>({ create: createMemoryStore, fingerprintAlgorithm: 'sha256' });
