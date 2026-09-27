# EXP-1 current binding and implementation evidence

This is the bounded issue #5 experiment for
[EXP-1](../../docs/spec/experiments.md), not a production runtime or durable
History schema. The [decision record](decision.md) gives the observations,
counterexample, build constraints, and proposed contract amendment.

The portable candidate is in `src/protocol.ts`. Only `test/` uses Node file
and child-process APIs; two invocations of `process-entry.js` serialize and
reload the fixture after the first process exits. `test-d/` exercises the
tracked-value and declared-role type boundary.

```sh
npm run build:experiments
npm run check:experiments
npm run check:imports
npm run test:experiments
```

To reproduce one restart case directly after the build:

```sh
node experiments/exp-1/.test-build/test/process-entry.js A /private/tmp/microdelta-exp1-history.json unchanged
node experiments/exp-1/.test-build/test/process-entry.js B /private/tmp/microdelta-exp1-history.json unchanged
```

The first command emits two newly created exact references. The second
rebuilds declarations in a new process, invokes members in reverse order, and
reports zero body executions and those same references. The Jest suite uses
fresh temporary files for every scenario and removes them afterward.
