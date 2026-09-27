import { expectAssignable } from 'tsd';

import type {
  IAddressSegment as IHistoryAddressSegment,
  IOperation as IHistoryOperation,
  ISelectedFact as IHistorySelectedFact,
  ISelectedReadRequest,
  IValueProjectionDescriptor as IHistoryProjectionDescriptor,
  IValueProjectionFact as IHistoryProjectionFact,
  IValueProjectionMember as IHistoryProjectionMember,
  IValueProjectionTraversal as IHistoryProjectionTraversal,
} from '../dist/api/history.alpha.js';
import type {
  IAddressSegment,
  IOperation,
  ISelectedFact,
  IValueProjectionDescriptor,
  IValueProjectionFact,
  IValueProjectionMember,
  IValueProjectionTraversal,
} from '@microdelta/value';

const address: IAddressSegment = { kind: 'property', key: 'nested.literal' };
const historyAddress: IHistoryAddressSegment = address;
expectAssignable<IAddressSegment>(historyAddress);
expectAssignable<IHistoryAddressSegment>(address);

const operation: IOperation = 'value';
const historyOperation: IHistoryOperation = operation;
expectAssignable<IOperation>(historyOperation);
expectAssignable<IHistoryOperation>(operation);

const selectedFact: ISelectedFact = { address: [address], operation, fact: 'Ada' };
const historySelectedFact: IHistorySelectedFact = selectedFact;
expectAssignable<ISelectedFact>(historySelectedFact);
expectAssignable<IHistorySelectedFact>(selectedFact);

const descriptor: IValueProjectionDescriptor = {
  address: [address],
  operation: 'value',
  traversal: { kind: 'visited', complete: false, keys: ['member-2', 'member-1'] },
};
const historyDescriptor: IHistoryProjectionDescriptor = descriptor;
expectAssignable<IValueProjectionDescriptor>(historyDescriptor);
expectAssignable<IHistoryProjectionDescriptor>(descriptor);

const projectionFact: IValueProjectionFact = { descriptor, members: [['member-2', 'Ada'], ['member-1', 'Grace']] };
const historyProjectionFact: IHistoryProjectionFact = projectionFact;
expectAssignable<IValueProjectionFact>(historyProjectionFact);
expectAssignable<IHistoryProjectionFact>(projectionFact);

const member: IValueProjectionMember = ['member-2', 'Ada'];
const historyMember: IHistoryProjectionMember = member;
expectAssignable<IValueProjectionMember>(historyMember);
expectAssignable<IHistoryProjectionMember>(member);
const traversal: IValueProjectionTraversal = { kind: 'visited', complete: false, keys: ['member-2'] };
const historyTraversal: IHistoryProjectionTraversal = traversal;
expectAssignable<IValueProjectionTraversal>(historyTraversal);
expectAssignable<IHistoryProjectionTraversal>(traversal);

const request: ISelectedReadRequest = { address: [address], operation: 'value' };
expectAssignable<ISelectedFact>({ ...selectedFact, address: request.address, operation: request.operation });
