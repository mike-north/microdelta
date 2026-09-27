/** The bounded author-facing probe accepts tracked objects/functions and declared roles. */
import { expectError, expectType } from 'tsd';

import { compatibilityVersion, createRegistry, tracked } from '../src/protocol.js';

/** Supported plain values retain ordinary property types. */
expectType<number>(tracked({ score: 7 }).score);
expectType<number>(tracked((score: number): number => score + 1)(7));
expectType<number>(compatibilityVersion());

/** Primitive tracking and undeclared structural roles fail at the type boundary. */
expectError(tracked(true));
expectError(createRegistry().register({ scope: 'fixture', role: 'display-label', slot: 'assessment' }, tracked({ score: 7 })));
