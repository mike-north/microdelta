import { expectType } from 'tsd';

import { createNodeMachine } from '../dist/src/index.js';
import type { IMachine } from '@microdelta/machine';

expectType<IMachine>(createNodeMachine());
