/**
 * The default facade exposes its existing public Store contract, and nothing
 * of the project-private workspace authoring and run surface: a normal
 * consumer resolves `microdelta` to the generated public rollup.
 */
import { expectError, expectType } from 'tsd';
import * as facade from 'microdelta';
import { createMemoryStore } from 'microdelta';
import type { Store } from 'microdelta';

expectType<Store>(createMemoryStore());

// The workspace run path is @alpha and must stay out of the public view.
expectError(facade.authoring);
expectError(facade.openWorkspace);
expectError(facade.currentRun);
expectError(facade.currentExecution);
expectError(facade.createStopController);
expectError(facade.sourceOutcome);
expectError(facade.stepLifecycle);
expectError(facade.ResolutionError);
expectError(facade.SupervisionError);
