import { expectError, expectType } from 'tsd';

import { nameOf, syntheticNamePrefixes, syntheticNames } from '../dist/src/index.js';

expectType<string | undefined>(nameOf(() => {}));
expectType<string | undefined>(nameOf(class Report {}));
expectType<string | undefined>(nameOf(() => {}, 'explicit'));
expectType<readonly string[]>(syntheticNames);
expectType<readonly string[]>(syntheticNamePrefixes);
expectError(nameOf({ name: 'notCallable' }));
expectError(nameOf(() => {}, 7));
// eslint-disable-next-line @typescript-eslint/no-unsafe-call -- This negative tsd case intentionally calls a method absent from the declared type.
expectError(syntheticNames.push('another'));
// eslint-disable-next-line @typescript-eslint/no-unsafe-call -- This negative tsd case intentionally calls a method absent from the declared type.
expectError(syntheticNamePrefixes.push('another '));
