/** Fixed post-work IPC release protocol; readiness never substitutes for an actual final RSS sample. @packageDocumentation */
/** @internal Dispatch, successful send completion and OS close remain independent facts. */
export interface IReleaseState { readonly ready: boolean; readonly finalRssBytes: number | null; readonly releaseDispatched: boolean; readonly releaseConfirmed: boolean; readonly failure: string | null }
/** @internal Only the owned driver supplies sampling, transport and termination effects. */
export interface IReleaseEffects { readonly rssLimit: number; readonly finalRss: () => number | undefined; readonly pauseSampling: () => void; readonly dispatch: (done: (error: Error | null) => void) => boolean; readonly fail: (reason: string) => void; readonly settle: () => void }
/** @internal Receipt settlement requires actual close and either protocol completion or a recorded stop. */
export interface IReleaseGate { readonly state: () => IReleaseState; readonly message: (value: unknown) => void; readonly closed: (normal: boolean, stopped: boolean) => void; readonly cancel: (reason: string) => void }
/** @internal A fixed gate does not own a timer, executable, domain work or an OS-terminal witness. */
export function createReleaseGate(effects: IReleaseEffects, required = true): IReleaseGate {
  let state: IReleaseState = { ready: false, finalRssBytes: null, releaseDispatched: false, releaseConfirmed: false, failure: null };
  let didClose = false; let stopped = false; let settled = false; let callbackSeen = false;
  const settle = (): void => {
    if (!settled && didClose && (stopped || state.failure !== null || !required || state.releaseConfirmed)) { settled = true; effects.settle(); }
  };
  const fail = (reason: string): void => {
    if (state.failure === null) { state = { ...state, failure: reason }; effects.fail(reason); }
    settle();
  };
  return {
    state: () => state,
    message: (value) => {
      if (!required || value !== 'tuple-ready' || state.ready || didClose || state.failure !== null) { fail('invalid-or-duplicate-ready'); return; }
      state = { ...state, ready: true };
      let rss: number | undefined;
      try { rss = effects.finalRss(); } catch { rss = undefined; }
      if (rss === undefined || !Number.isSafeInteger(rss) || rss < 1 || rss > effects.rssLimit) { fail('invalid-final-rss'); return; }
      state = { ...state, finalRssBytes: rss };
      // The child has completed application work. Pause at dispatch to avoid
      // observing its immediate exit before the send callback. This bounded
      // pending phase is not delivery, an OS-terminal witness, or acceptance.
      effects.pauseSampling(); state = { ...state, releaseDispatched: true };
      try {
        // Node's boolean is backpressure only; the callback is authoritative.
        effects.dispatch((error) => {
          if (callbackSeen) { fail('duplicate-release-callback'); return; }
          callbackSeen = true;
          if (error !== null) { fail('release-send-failed'); return; }
          state = { ...state, releaseConfirmed: true }; settle();
        });
      } catch { fail('release-send-failed'); }
    },
    closed: (normal, wasStopped) => {
      didClose = true; stopped ||= wasStopped;
      if (!stopped && !normal) { fail('abnormal-close'); }
      else if (!stopped && required && !state.releaseDispatched) { fail('closed-before-release'); }
      settle();
    },
    cancel: (reason) => { stopped = true; if (state.failure === null) { state = { ...state, failure: reason }; } settle(); },
  };
}
/** @internal Called only after all child work/writes finish; release performs no further application work. */
export function waitForParentRelease(): void {
  if (process.send === undefined || !process.connected) { throw new Error('diagnostic requires owned IPC'); }
  // Listener installation precedes ready. Release exits synchronously: no
  // disconnect callback, async flush, or application allocation/work follows it.
  process.on('message', (message: unknown) => { process.exit(message === 'tuple-release' ? 0 : 1); });
  process.on('disconnect', () => { process.exit(1); });
  process.send('tuple-ready');
}
