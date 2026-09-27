import { expectError, expectNotAssignable, expectType } from 'tsd';

import {
  decodeSnapshot,
  encodeSnapshot,
  encodeSelectedFact,
  encodeProjectionFact,
  encodeValue,
  observe,
  recordFromEntries,
} from '../dist/src/index.js';
import type { IAddressSegment, ISelectedFact, IOperation, IValueProjectionFact } from '../dist/src/index.js';

const address: readonly IAddressSegment[] = [{ kind: 'property', key: 'account.name' }];
const operation: IOperation = 'value';
const selectedFact: ISelectedFact = { operation, address, fact: 'Ada' };
expectType<string>(encodeValue('Ada'));
expectType<string>(encodeSelectedFact(selectedFact));
expectType<unknown>(decodeSnapshot(encodeSnapshot(null)));
expectType<Record<string, unknown>>(recordFromEntries([['name', 'Ada']], null));
expectType<ISelectedFact>(observe({ name: 'Ada' }, [{ kind: 'property', key: 'name' }], 'value'));
expectNotAssignable<IAddressSegment>({ kind: 'property', key: 0 });
expectNotAssignable<IOperation>('keys-and-values');
const projection: IValueProjectionFact = {
  descriptor: { address, operation: 'value', traversal: { kind: 'exhaustive', complete: true } },
  members: [['user-1', { name: 'Ada' }]],
};
expectType<string>(encodeProjectionFact(projection));
expectError(encodeProjectionFact({
  descriptor: { address, operation: 'value', order: 'ordered', traversal: { kind: 'exhaustive', complete: true } },
  members: [['user-1', { name: 'Ada' }]],
}));
