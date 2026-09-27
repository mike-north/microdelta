import { expectNotAssignable, expectType } from 'tsd';

import {
  decodeSnapshot,
  encodeSelectedFact,
  encodeValue,
  observe,
  recordFromEntries,
} from '../dist/src/index.js';
import type { IAddressSegment, ISelectedFact, IOperation } from '../dist/src/index.js';

const address: readonly IAddressSegment[] = [{ kind: 'property', key: 'account.name' }];
const operation: IOperation = 'value';
const selectedFact: ISelectedFact = { operation, address, fact: 'Ada' };
expectType<string>(encodeValue('Ada'));
expectType<string>(encodeSelectedFact(selectedFact));
expectType<unknown>(decodeSnapshot(encodeValue(null)));
expectType<Record<string, unknown>>(recordFromEntries([['name', 'Ada']], null));
expectType<ISelectedFact>(observe({ name: 'Ada' }, [{ kind: 'property', key: 'name' }], 'value'));
expectNotAssignable<IAddressSegment>({ kind: 'property', key: 0 });
expectNotAssignable<IOperation>('keys-and-values');
