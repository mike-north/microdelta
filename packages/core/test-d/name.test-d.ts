import { expectError, expectType } from 'tsd';

import { nameOf, syntheticNamePrefixes, syntheticNames } from '../dist/src/name/index.js';

expectType<string | undefined>(nameOf(() => {}));
expectType<string | undefined>(nameOf(class Report {}));
expectType<string | undefined>(nameOf(() => {}, 'explicit'));
expectType<readonly string[]>(syntheticNames);
expectType<readonly string[]>(syntheticNamePrefixes);
expectError(nameOf({ name: 'notCallable' }));
expectError(nameOf(() => {}, 7));
expectError(syntheticNames.push('another'));
expectError(syntheticNamePrefixes.push('another '));
