/**
 * Sessions of the stop fixture over the facade. A session stands in for one
 * process lifetime: the facade's workspace over a durable SQLite store and a
 * freshly composed fixture. Runs go through `workspace.run` with the options a
 * test chooses (stop controller, permits, window, observers).
 */
import { openWorkspace } from '../../src/index.js';
import type { IMembersReport, IRunEvent, IRunResult, IWorkspace, IWorkspaceRun, IWorkspaceRunOptions } from '../../src/index.js';
import { composeStop, environment } from './fixture.js';
import type { IHelpers, IInputs, IStopFixture } from './fixture.js';

/** The logical store of every stop-fixture store. */
export const logicalStore = 'store:stop';

/** One simulated process lifetime over a durable store. */
export interface IStopSession {
  readonly workspace: IWorkspace;
  readonly fixture: IStopFixture;
  close(): void;
}

/** Open a session over `location`. */
export function openStopSession(location: string, options: { readonly leaseMilliseconds?: number } = {}): IStopSession {
  const workspace = openWorkspace({ location, logicalStore, ...(options.leaseMilliseconds === undefined ? {} : { leaseMilliseconds: options.leaseMilliseconds }) });
  return { workspace, fixture: composeStop(), close: () => workspace.close() };
}

/** Run options a test may choose. */
export type IChosenRunOptions = Pick<IWorkspaceRunOptions<IInputs, IHelpers>, 'stop' | 'permits' | 'window' | 'observers'>;

/** Monotonic counter of fresh request keys. */
let requestCounter = 0;

/** A fresh opaque request key, as a caller saves before starting work. */
export function freshKey(): string {
  requestCounter += 1;
  return `stop-request:${String(requestCounter)}`;
}

/**
 * Run `body` in one workspace run of the session with the chosen options.
 * The returned run is already marked handled: a test that fails before
 * awaiting it (for example a bounded wait that times out) reports its own
 * failed expectation, instead of the run's later failure surfacing as an
 * unhandled rejection that crashes the runner. Awaiting it still rejects.
 */
export function runIn<T>(session: IStopSession, options: IChosenRunOptions, body: (run: IWorkspaceRun) => Promise<T>): Promise<IRunResult<T>> {
  const running = session.workspace.run({ authoring: session.fixture.builders, composition: session.fixture.composition, environment, ...options }, body);
  running.catch(() => undefined);
  return running;
}

/** Resolve every current item's `work` in one run. */
export function runMembers(session: IStopSession, options: IChosenRunOptions = {}): Promise<IRunResult<IMembersReport>> {
  return runIn(session, options, (run) => run.resolveMembers({ template: 'item', step: 'work' }, { requestKey: freshKey() }));
}

/** Each member's status in a members report, by key. */
export function statuses(report: IMembersReport): Readonly<Record<string, string>> {
  return Object.fromEntries(report.members.map((member) => [member.key, member.status]));
}

/** The stop and send events a run offered, as compact strings. */
export function controlEvents(events: readonly IRunEvent[]): string[] {
  return events.flatMap((event) => {
    if (event.kind === 'stop') {
      return [`stop:${event.level}:${String(event.cause)}`];
    }
    if (event.kind === 'send') {
      return [`send:${event.label}:${event.phase}${event.phase === 'remote-state' ? `:${event.remote}` : ''}`];
    }
    return [];
  });
}
