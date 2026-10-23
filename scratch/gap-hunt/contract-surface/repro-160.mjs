/** #160: publication must not repeatedly scan the whole root per address. */
import { jestRepro } from './repro-support.mjs';
jestRepro('array-validation');
