import { expectAssignable, expectError, expectType } from 'tsd';
import { createTrackingObserver } from '../dist/api/tracking.alpha.js';
import type { ITracked, ITrackedView, ITrackingObserver, ITrackingObserverHost } from '../dist/api/tracking.alpha.js';

const machine: ITrackingObserverHost = {
  createAsyncContext: () => ({
    getStore: () => undefined,
    run: (_value, callback) => callback(),
  }),
  sha256: (_input: string) => '0'.repeat(64),
};
const observer: ITrackingObserver = createTrackingObserver(machine);
const binding = { path: ['analysis', 'config'] } as const;
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
