# RUN-001 lazy iteration audit

Strict TypeScript/Jest probe: `packages/core/test/gap-hunt-durability-lazy.test.ts`. No async generator is stored as a memo/source result. The probe uses actual `workspace.run` and `run.ordinary` for nonmemoized work.

```sh
npx tsc -p packages/core/tsconfig.test.json
npx eslint packages/core/test/gap-hunt-durability-lazy.test.ts
node --experimental-vm-modules node_modules/jest/bin/jest.js --config packages/core/jest.config.mjs --runInBand --runTestsByPath packages/core/.test-build/test/gap-hunt-durability-lazy.test.js
```

All4cases pass. Normal iteration, explicit iterator return and a thrown generator all retain the same run/environment through yields, resumed awaits and `finally` cleanup. Ordinary lifecycle remains at `begin` after the first yield; completion/return emits `end`, uncaught generator error emits `fail`, and parent context is restored after catching it. Once the run actually closes, late ordinary work rejects `run-closed`. `lazy-jest.log` preserves compilation/lint-verified runtime output; `lazy-iteration.mjs`/log provide a compact direct consumer replay.

Separate interface boundary: generic `ordinary<T>` accepts and returns an `AsyncGenerator` as a value. Returning that iterator from a run does not wrap iteration or extend lifetime: the run is closed before its first externally invoked `next`, and `currentRun()` there fails `outside-run`. The strict test includes an explicit `AsyncGenerator` assignment proving the return is admitted by current types. Source: `supervision/src/supervision.ts:968–987` awaits the callback result, emits ordinary `end`, and returns that value; the signature in `supervision/src/contracts.ts:673` does not promise an owning iterator wrapper.

This is an **ownership-interface ambiguity**, not automatically a detached-lifetime bug. RUN-001 says an execution's lifetime includes actual lazy asynchronous work; current callbacks can satisfy it by consuming/awaiting iteration inside their body. The docs do not state that every iterator returned as ordinary application data becomes framework-owned. Before filing a defect, decide whether returned lazy values are owned or whether the authoring docs/types should expressly require iteration within the live callback. The passing in-body control prevents claiming lazy execution is wholly unsupported. No issue filed here.

Implementer: Codex worker (gpt-6.1-sol).
