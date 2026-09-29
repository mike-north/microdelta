# EXP-4 nested arguments, supplied callables, keyed fanout and strict-fold skips

This is the bounded issue #78 experiment for
[EXP-4](../../docs/spec/experiments.md). It is not a production runtime,
package or durable History schema. The [decision record](decision.md) gives
the per-mechanism results, process-B variants, counterexamples and the
decisions left to the supervisor.

The portable candidate lives in `src/`: `data.ts` (value grammar and canonical
text), `definition.ts` (frozen composition, slots, fanout template, fold),
`evidence.ts` (invocation record v2 and argument recipes) and `runtime.ts`
(nested validation, gates and the strict fold). Only `test/` uses Node file and
child-process APIs. `test/process-entry.ts` is run as two separate processes
per scenario. `test-d/` checks the authoring type boundary.

```sh
npm run build:experiments
npm run check:experiments
npm run check:imports
npm run test:exp4
```

To reproduce one restart case directly after the build:

```sh
node experiments/exp-4/.test-build/test/process-entry.js A /private/tmp/microdelta-exp4-history.json unchanged
node experiments/exp-4/.test-build/test/process-entry.js B /private/tmp/microdelta-exp4-history.json unchanged
```

Process A executes six fake paid bodies and writes the fixture. Process B
rebuilds the composition with reversed declaration and member order. It
reports no body executions and the same exact references. Scenario names are
the keys handled in `test/process-entry.ts`.
