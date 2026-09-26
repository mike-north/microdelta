/** The default facade exposes its existing public Store contract. */
import { expectType } from 'tsd';
import { createMemoryStore } from 'microdelta';
import type { Store } from 'microdelta';
expectType<Store>(createMemoryStore());
