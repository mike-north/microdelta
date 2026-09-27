import { expectAssignable, expectError, expectType } from 'tsd';
import { createTrackingObserver } from '../dist/api/tracking.alpha.js';
import type {
  IAddressSegment as ITrackingAddressSegment,
  IDetachedOutput,
  IOperation as ITrackingOperation,
  ISelectedFact as ITrackingSelectedFact,
  ITracked,
  ITrackedView,
  ITrackingObserver,
  ITrackingObserverHost,
  IValueProjectionDescriptor as ITrackingProjectionDescriptor,
  IValueProjectionFact as ITrackingProjectionFact,
  IValueProjectionMember as ITrackingProjectionMember,
  IValueProjectionTraversal as ITrackingProjectionTraversal,
} from '../dist/api/tracking.alpha.js';
import type {
  IAddressSegment,
  IOperation,
  ISelectedFact,
  IValueProjectionDescriptor,
  IValueProjectionFact,
  IValueProjectionMember,
  IValueProjectionTraversal,
} from '@microdelta/value';

const machine: ITrackingObserverHost = {
  createAsyncContext: () => ({
    getStore: () => undefined,
    run: (_value, callback) => callback(),
  }),
  sha256: (_input: string) => '0'.repeat(64),
};
const observer: ITrackingObserver = createTrackingObserver(machine);
const binding = { path: ['analysis', 'config'] } as const;
const address: IAddressSegment = { kind: 'property', key: 'profile.name' };
const trackingAddress: ITrackingAddressSegment = address;
expectAssignable<IAddressSegment>(trackingAddress);
expectAssignable<ITrackingAddressSegment>(address);
const operation: IOperation = 'value';
const trackingOperation: ITrackingOperation = operation;
expectAssignable<IOperation>(trackingOperation);
expectAssignable<ITrackingOperation>(operation);
const selectedFact: ISelectedFact = { operation, address: [address], fact: 'Ada' };
const trackingSelectedFact: ITrackingSelectedFact = selectedFact;
expectAssignable<ISelectedFact>(trackingSelectedFact);
expectAssignable<ITrackingSelectedFact>(selectedFact);
const projectionDescriptor: IValueProjectionDescriptor = {
  address: [address], operation: 'value', traversal: { kind: 'exhaustive', complete: true },
};
const trackingProjectionDescriptor: ITrackingProjectionDescriptor = projectionDescriptor;
expectAssignable<IValueProjectionDescriptor>(trackingProjectionDescriptor);
expectAssignable<ITrackingProjectionDescriptor>(projectionDescriptor);
const projectionFact: IValueProjectionFact = { descriptor: projectionDescriptor, members: [['user-1', 'Ada']] };
const trackingProjectionFact: ITrackingProjectionFact = projectionFact;
expectAssignable<IValueProjectionFact>(trackingProjectionFact);
expectAssignable<ITrackingProjectionFact>(projectionFact);
const projectionMember: IValueProjectionMember = ['user-1', 'Ada'];
const trackingProjectionMember: ITrackingProjectionMember = projectionMember;
expectAssignable<IValueProjectionMember>(trackingProjectionMember);
expectAssignable<ITrackingProjectionMember>(projectionMember);
const projectionTraversal: IValueProjectionTraversal = { kind: 'visited', complete: false, keys: ['user-1'] };
const trackingProjectionTraversal: ITrackingProjectionTraversal = projectionTraversal;
expectAssignable<IValueProjectionTraversal>(trackingProjectionTraversal);
expectAssignable<ITrackingProjectionTraversal>(projectionTraversal);
const config = observer.tracked({ count: 2, enabled: true }, binding);
expectType<ITracked<{ count: number; enabled: boolean }>>(config);
expectType<number>(config.count);
expectType<boolean>(config.enabled);
expectType<number>(observer.materialization.read(config, 'count'));
expectError(observer.materialization.read(config, '__microdeltaTracked'));
const author = observer.tracked({ author: { name: 'Ada' } }, binding).author;
expectType<ITracked<{ name: string }>>(author);
expectAssignable<ITrackedView<{ readonly name: string }>>(author);
expectError(() => {
  author.name = 'Grace';
});
const optionalInput: { author: { name: string } | undefined } = { author: undefined };
const optionalAuthor = observer.tracked(optionalInput, binding);
expectType<ITracked<{ name: string }> | undefined>(optionalAuthor.author);
const roster = observer.tracked([{ name: 'Ada' }], binding);
expectType<ITracked<{ name: string }> | undefined>(roster[0]);
expectType<number>(roster.length);
expectType<ITracked<{ name: string }> | undefined>(observer.materialization.read(roster, 0));
expectType<ITracked<{ name: string }> | undefined>(observer.materialization.read(roster, 99));
expectType<number>(observer.materialization.read(roster, 'length'));
const sparseRoster = observer.tracked(new Array<{ name: string }>(2), binding);
expectType<ITracked<{ name: string }> | undefined>(observer.materialization.read(sparseRoster, 1));
expectError(() => {
  roster[0] = { name: 'Grace' };
});
expectError(() => {
  roster.length = 0;
});
expectError(roster.map);
expectError(roster.filter);
const pair = observer.tracked([{ name: 'Ada' }, 'selected'] as const, binding);
expectType<ITracked<{ readonly name: 'Ada' }>>(pair[0]);
expectType<'selected'>(pair[1]);
expectType<2>(pair.length);
expectType<ITracked<{ readonly name: 'Ada' }>>(observer.materialization.read(pair, '0'));
expectType<'selected'>(observer.materialization.read(pair, '1'));
const nested = observer.tracked({ profile: { name: 'Ada' } }, binding);
expectType<ITracked<{ name: string }>>(observer.materialization.read(nested, 'profile'));
const dictionary = observer.tracked<Record<string, number>>({ count: 1 }, binding);
expectType<number | undefined>(observer.materialization.read(dictionary, 'count'));
const dictionaryKey: string = 'count';
expectType<number | undefined>(observer.materialization.read(dictionary, dictionaryKey));
expectError(observer.materialization.read(dictionary, '__microdeltaTracked'));
function readImportedDeclaration(input: ITracked<{ count: number; enabled: boolean }>): number {
  return input.count;
}
expectType<number>(readImportedDeclaration(config));
expectError(() => {
  const unbranded: ITracked<{ count: number; enabled: boolean }> = { count: 2, enabled: true };
  return unbranded;
});

const increment = observer.tracked((value: number) => value + 1, binding);
expectAssignable<ITrackedView<(value: number) => number>>(increment);
expectType<number>(increment(2));
expectError(observer.tracked(2, binding));
expectError(observer.tracked('text', binding));
expectError(observer.tracked(true, binding));
expectError(observer.captureAsync(() => 2));

const detached = observer.snapshotOutput(config);
expectType<number>(detached.count);
expectError(readImportedDeclaration(detached));
const detachedNumbers = observer.snapshotOutput([1, 2]);
expectType<number>(detachedNumbers[0]!);
const mappedDetachedNumbers = detachedNumbers.map(value => value + 1);
expectType<number>(mappedDetachedNumbers[0]!);
// eslint-disable-next-line @typescript-eslint/no-unsafe-call -- This negative tsd case intentionally calls a mutator absent from the declared array type.
expectError(detachedNumbers.push(3));
// eslint-disable-next-line @typescript-eslint/no-unsafe-call -- This negative tsd case intentionally calls a mutator absent from the declared array type.
expectError(detachedNumbers.splice(0, 1));
const detachedPair = observer.snapshotOutput(observer.tracked([1, 'selected'] as const, binding));
expectType<1>(detachedPair[0]);
expectType<'selected'>(detachedPair[1]);
// eslint-disable-next-line @typescript-eslint/no-unsafe-call -- This negative tsd case intentionally calls a mutator absent from the declared tuple type.
expectError(detachedPair.push(2));
// eslint-disable-next-line @typescript-eslint/no-unsafe-call -- This negative tsd case intentionally calls a mutator absent from the declared tuple type.
expectError(detachedPair.splice(0, 1));
declare const detachedRawPair: IDetachedOutput<[number, string]>;
expectType<number>(detachedRawPair[0]);
expectType<string>(detachedRawPair[1]);
// eslint-disable-next-line @typescript-eslint/no-unsafe-call -- This negative tsd case intentionally calls a mutator absent from the declared tuple type.
expectError(detachedRawPair.push(2));
// eslint-disable-next-line @typescript-eslint/no-unsafe-call -- This negative tsd case intentionally calls a mutator absent from the declared tuple type.
expectError(detachedRawPair.splice(0, 1));
expectError(() => {
  const branded: ITracked<readonly [1, 'selected']> = detachedPair;
  return branded;
});
expectType<never>(observer.snapshotOutput((value: number) => value));
const mixedDetached = observer.snapshotOutput({ config, label: 'local' });
expectType<string>(mixedDetached.label);
expectError(readImportedDeclaration(mixedDetached.config));
