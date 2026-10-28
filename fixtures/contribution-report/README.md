# Controlled report verification role

This directory owns independent synthetic provider scaffolding, immutable
History/Accounting oracles, generated declaration contracts, fresh-process
workers and workload measurements for the concrete report. The application
remains under `examples/contribution-report/src/controlled` and consumes the
generated `microdelta` facade. Moving the oracles here grants the application no
additional package access.

The strict fixture compiler inherits the example's generated alpha declaration
paths. Runtime workers load public package entries through normal Node package
resolution. The repository import gate permits public owner entries for these
oracles while rejecting deep owner paths, owner source, undeclared aliases and
nonliteral module edges. Root type-aware lint includes all fixture TypeScript;
the existing example facade-only rule remains unchanged. Tooling tests exercise
both roles together, including URL-encoded source escapes.

This fixture role excludes `node:module`/`module`: no provider oracle needs a
Node module-loader factory, and `createRequire` would conceal private package
imports behind local function calls. Named, aliased, namespace, dynamic and
re-export access share that restriction. A caller-supplied function parameter
named `require` remains an ordinary call.
Explicit `createRequire` property access/destructuring is excluded as well,
including extraction through `process.getBuiltinModule`. These supported module
edge checks do not claim a host sandbox or arbitrary runtime dataflow analysis.

`npm run test:controlled-report` compiles and runs runtime, fresh-process and
generated type contracts. `npm run check:fixtures`, `npm run check:imports`,
`npm run build:fixtures` and the root check/test/build gates include this role.

The compiled `cli-workload.ts` composes the actual two-person controlled report
with the installed foreground command. Its factory prepares resources without
starting report work; the command owns the active run and final disposal. The
shared application body supplies current strict completion and the exact retained
report locator. Private `outcome.json` files retain fixture fold/usage evidence;
they are not an exported report format.

After `npm ci --offline` and `npm run build`, reproduce this small executable
composition proof with:

```sh
node --experimental-vm-modules node_modules/jest/bin/jest.js --config fixtures/contribution-report/jest.config.mjs --runInBand --runTestsByPath fixtures/contribution-report/.test-build/fixtures/contribution-report/cli-workload.test.js
```

The test installs the local packages into a disposable consumer, compiles the
checked-in caller against their generated alpha declarations, and invokes its
installed `microdelta start` and separate finite `microdelta observe` processes.
Independent owner reads establish report content/reference and durable usage.
Fresh processes establish exact reuse and actual current incomplete work after
an earlier success. The active-reader counter proof pauses before graph admission
(recorded phase `prepared`); it makes no concurrent-provider claim. Byte/directory
immutability is checked only after run acknowledgment, disposal, process exit and
independent History/Accounting oracle closure. This small proof adds no large
qualification or endurance evidence.

`npm run test:controlled-report:workload` runs the standalone 150,000-distinct-PR
cold and independent-process restart qualification. `-- --smoke` selects only a
500-PR harness smoke; it does not satisfy the workload gate. The workload driver
retains compact measured receipts beneath its printed temporary directory.
No fixture reaches a live provider or reads credentials.

Each qualification phase is one supervised fold request with a parent process
deadline of 12 hours. Its isolated workspace explicitly budgets a writer lease
of 12 hours and 60 seconds, including a bounded shutdown allowance. The existing writer
contract renews at request boundaries, not during one request. This harness
configuration accepts correspondingly long recovery after a killed holder;
it changes no production default, fencing, heartbeat, admission window, retry
policy or performance requirement. The controlled-clock worker regression
crosses the default 30-second lease within that phase budget, while a separate
nine-person/two-slot test pins normal bounded-window completion.

An incomplete worker emits a compact failure receipt with member-status and
usage counts, the first pending key/reason, one bounded diagnostic and its
total count, stop state and any observed retry floor. Actual route, payload,
concurrency and memory observations are explicitly partial through the run's
return. Whole membership, diagnostic and usage arrays stay out of the receipt.
The parent writes `<phase>-failure.json` with its measured elapsed time and
exit status, preserving that child evidence. If the worker exits without a
receipt, child measurements remain unavailable (`null`), with only a bounded
stderr tail retained. Exit-zero output still has to parse as this worker's
basic success envelope; empty, malformed and wrong-shape output writes the
same failure artifact with actual `exitStatus` 0 and a bounded protocol reason.
Failure evidence never satisfies the qualification gate.
