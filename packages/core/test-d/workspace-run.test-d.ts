/**
 * The author-facing workspace run, as the facade's generated alpha
 * declarations describe it: it offers the run operations and the exact read,
 * but never Supervision's declared-call check, which only the facade's own
 * handle uses (CMP-9, RUN-013).
 */
import { expectError, expectType } from 'tsd';

import type { IWorkspaceRun } from '../dist/api/microdelta.alpha.js';

declare const run: IWorkspaceRun;

expectType<IWorkspaceRun['read']>(run.read);
expectError(run.assertDeclaredCall);
