/**
 * The facade composition role can pass Machine's host elapsed capability to
 * Supervision's structural admission port without introducing a context edge.
 */
import { expectAssignable } from 'tsd';

import { createNodeElapsedClock } from '@microdelta/machine-node';
import type { IRunElapsedClock } from '@microdelta/supervision';

expectAssignable<IRunElapsedClock>(createNodeElapsedClock());
