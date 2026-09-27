import { expectType } from 'tsd';

import { encodeValue, observe } from '@microdelta/value';
import type { IAddressSegment, ISelectedFact } from '@microdelta/value';

const address: readonly IAddressSegment[] = [{ kind: 'property', key: 'name' }];
expectType<string>(encodeValue({ name: 'Ada' }));
expectType<ISelectedFact>(observe({ name: 'Ada' }, address, 'value'));
