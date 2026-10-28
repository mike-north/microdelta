# Finite read-snapshot qualification

This EXP-0 fixture qualifies one existing better-sqlite3 readonly/DEFERRED
candidate against [issue296](https://github.com/mike-north/microdelta/issues/296).
The [protocol](protocol.md) separates useful committed inspection from the
stronger no-source-filesystem-effects hypothesis. The [observed result](result.md)
rejects that candidate; it adopts no production API and delivers no M6 inspector.

With Node24 or later and dependencies installed, run `npm run build` to produce
the normal generated package entries. Reproduce the bounded evidence with:

```sh
npm run test:read-snapshot
```

The command prints `candidateVerdict` and a retained temporary artifact directory.
Jest success means the harness reported evidence honestly; **REJECT is the
candidate's result**. Raw source-stage byte images, child commands/acknowledgments,
exits, control values and source/emitted/runtime pins remain under that directory.
Measurement images are never opened as databases or used as a read fallback.

`npm run check:experiments` includes strict compilation, the portable evidence
boundary and type-aware lint. `npm run check:imports` covers portable source;
native probes stay in experiment test tooling. `npm run build:experiments` emits
the fixture and `npm run test:experiments` includes its assertions, so root
check/test/build exercise this evidence rather than unrelated baseline suites.

The protocol's closed-first rejection rule stops later candidate cells. Their
unexecuted status is part of the result, not support inferred from the controls.
There is no tracing platform or operation-wide native absence proof.
