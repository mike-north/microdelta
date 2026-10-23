/** Stop an admitted asynchronous fold mid-body: drain versus discard (RUN-014/015). */
import { afterEach, expect, test } from '@jest/globals';

import type { ISourceOutcome } from '../src/index.js';
import { authoring, createStopController, openWorkspace, sourceOutcome } from '../src/index.js';
import { cleanup, freshLocation, openHistory } from './durable-history/support.js';

afterEach(cleanup);

/** The fold's synthetic asynchronous work; no provider is involved. */
interface IRoster {
  readonly members: readonly { readonly key: string }[];
  readonly status: 'complete';
}

interface IHelpers {
  readonly roster: () => ISourceOutcome<IRoster>;
  readonly pause: () => Promise<void>;
}

/** Explicit barrier: the test waits until the fold really entered its body. */
function barrier(): { readonly waiting: Promise<void>; release(): void } {
  let release: () => void = () => undefined;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  return { waiting, release: () => { release(); } };
}

for (const level of ['soft', 'hard'] as const) {
  test(`${level} stop while fold body awaits preserves member results and ${level === 'soft' ? 'publishes drained' : 'discards'} fold output`, async () => {
    const entered = barrier();
    const resume = barrier();
    const builders = authoring<object, IHelpers>();
    const source = builders.source<IRoster>({
      subject: 'roster', collection: { identity: 'key' }, run: ({ helpers }) => helpers.roster(),
    });
    const template = builders.template({ slot: 'member', collection: source, steps: (member) => ({ work: member.memo({ subject: member.subject('member'), run: ({ member: bound }) => ({ key: bound.key }) }) }) });
    const fold = builders.fold({ subject: 'fold', over: { template, step: 'work' }, run: async ({ members, helpers }) => { await helpers.pause(); return { count: members.length }; } });
    const composition = builders.compose({ scope: 'gap-hunt-fold', inputs: [], helpers: [{ slot: 'roster', helper: (): ISourceOutcome<IRoster> => sourceOutcome.fresh<IRoster>({ members: [{ key: 'a' }, { key: 'b' }], status: 'complete' }) }, { slot: 'pause', helper: async (): Promise<void> => { entered.release(); await resume.waiting; } }], steps: [{ slot: 'roster', declaration: source }, { slot: 'fold', declaration: fold }], templates: [template] });
    const location = freshLocation();
    const workspace = openWorkspace({ location, logicalStore: 'store:contributors' });
    const stop = createStopController();
    try {
      const running = workspace.run({ authoring: builders, composition, environment: 'env:fixture', stop }, (run) => run.resolveFold({ scope: 'gap-hunt-fold', role: 'step', slot: 'fold' }, { requestKey: 'fold-stop' }));
      await entered.waiting;
      stop.request({ level });
      resume.release();
      const result = await running;
      expect(result.value.outcome.status).toBe(level === 'soft' ? 'succeeded' : 'cancelled');
      workspace.close();
      const history = openHistory({ location });
      expect(history.findCandidates({ analysis: 'gap-hunt-fold', environment: 'env:fixture', subject: 'member:a', version: 1 })).toHaveLength(1);
      expect(history.findCandidates({ analysis: 'gap-hunt-fold', environment: 'env:fixture', subject: 'member:b', version: 1 })).toHaveLength(1);
      expect(history.findCandidates({ analysis: 'gap-hunt-fold', environment: 'env:fixture', subject: 'fold', version: 1 })).toHaveLength(level === 'soft' ? 1 : 0);
    } finally {
      resume.release();
      workspace.close();
    }
  });
}
