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

`npm run test:controlled-report` compiles and runs runtime, fresh-process and
generated type contracts. `npm run check:fixtures`, `npm run check:imports`,
`npm run build:fixtures` and the root check/test/build gates include this role.

`npm run test:controlled-report:workload` runs the standalone150000-distinct-PR
cold and independent-process restart qualification. `-- --smoke` selects only a
500-PR harness smoke; it does not satisfy the workload gate. The workload driver
retains compact measured receipts beneath its printed temporary directory.
No fixture reaches a live provider or reads credentials.
