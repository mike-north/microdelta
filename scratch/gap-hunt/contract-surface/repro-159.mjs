/** #159: exact inserted-acceptance acknowledgement must not read all history. */
import { jestRepro } from './repro-support.mjs';
jestRepro('acceptance-readback');
