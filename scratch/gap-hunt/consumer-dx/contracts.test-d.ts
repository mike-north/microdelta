import { expectType, expectError } from 'tsd';
import { authoring, openWorkspace } from 'microdelta';
import type { IAuthoring, IWorkspace } from 'microdelta';
expectType<IAuthoring<Record<string, never>, Record<string, never>>>(authoring<Record<string, never>, Record<string, never>>());
expectType<IWorkspace>(openWorkspace({ location: 'synthetic.sqlite', logicalStore: 'synthetic' }));
expectError(openWorkspace({ location: 'synthetic.sqlite' }));
