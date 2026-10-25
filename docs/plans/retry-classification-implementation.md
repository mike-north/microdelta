# Retry classification implementation handoff

Status: scoped follow-up issue draft under [#220](https://github.com/mike-north/microdelta/issues/220),
not a runtime delivery claim or permission to begin implementation before design
acceptance. The [design candidate](retry-classification.md) owns the proposed
engineering details; RUN-011, RUN-012/014/017 and A-12d/i own accepted semantics.

## Task and readiness

Implement the reusable alpha retry-classification seam on the direct operation
path after #213 is accepted and its actual API/journal changes are reconciled.
Do not duplicate its allowance counter, public/private run identity handling,
intent/fence protocol, unknown-usage records or backoff defaults. The supervisor
must accept the #220 design and record any review revisions before marking this
follow-up ready. No additional owner question is required for routine interface
spelling consistent with the design; raise demonstrated semantic conflicts.

Supervision owns policy normalization, exact matching, attempt/history snapshots,
async decision lifecycle, durable chosen delays and independent gate rechecks.
Core forwards the optional configuration and reexports generated alpha types.
History/Accounting stay opaque persistence/evidence ports, and Machine remains a
host-capability provider. Source adapters extract bounded facts. No sibling source
aliases, new context ownership, weak casts, `skipLibCheck` or untracked credential
objects are acceptable shortcuts.

## Proposed consumer examples

This is an example for future strict generated-alpha consumer tests, not an API
already exported by this documentation revision. `retrySource` belongs in a shared
adapter wrapper so ordinary author calls do not repeat matching configuration.

```ts
const catalogPolicy: ISourceRetryPolicy = {
  id: 'catalog-retry',
  scope: { source: 'catalog', service: 'catalog-api', connection: 'org-a-read' },
  decide(input) {
    if (input.facts.providerCode === 'bad_credentials') {
      return { kind: 'stop' };
    }
    if (input.facts.conditions?.includes('resource-expected-later')) {
      return { kind: 'retry-after', delayMilliseconds: 3_000 };
    }
    if (input.facts.providerCode === 'secondary_rate_limit'
        || input.outcome.kind === 'rate-limited'
        || input.outcome.kind === 'unknown'
        || (input.outcome.kind === 'failed' && input.outcome.transient)) {
      const prior = input.history.previousDelayMilliseconds;
      return { kind: 'retry-after', delayMilliseconds:
        prior === undefined ? 2_000 : Math.max(1, Math.ceil(prior * 1.7)) };
    }
    return { kind: 'stop' };
  },
};
// Proposed existing-run option: retryPolicies: [catalogPolicy].
// Proposed shared operation wrapper: retrySource: catalogPolicy.scope.
// A conservative failed/transient:false 404 can carry:
// retryFacts: { httpStatus: 404, conditions: ['resource-expected-later'] }.
// A known provider restriction is a SEPARATE response notBefore field.
```

A matched callback must make its own complete three-way choice; returning
`undefined` is not delegation to defaults. A second connection has no match and
uses built-ins unless explicitly registered. A no-policy consumer supplies neither
`retryPolicies` nor `retrySource` and retains the three-total/2s/4s defaults, subject
to the deliberate normalized-rate subcap correction below.

Negative generated-alpha cases must reject `kind: 'no-opinion'`, a decision that
adds `maxAttempts`, a source scope missing `connection`, a raw `headers`/`error`
metadata bag, mutation of history/facts, and a promise resolving to no decision.
Numeric types cannot prove duration finiteness: Jest must reject NaN, infinities,
fractions, unsafe integers, zero delayed duration and time-addition overflow.

## Outcome tests before implementation

Write assertions from this matrix, observe their expected missing-seam failures
on the reconciled #213 baseline, then implement. A missing export/type failure is
necessary API red evidence; use minimal documented stubs if needed to observe
runtime behavioral failures too. Do not count an unrelated fixture failure as red.

| Test-first scenario | Required assertion / acceptance mapping |
| --- | --- |
| `custom-match-before-default-stop` | Exact matched source policy changes conservative `failed, transient:false` + contextual 404/403 facts to delay; built-in stop is never invoked first. A matching stop overrides normalized transient success-at-retry expectation. A-12d |
| `no-match-and-no-configuration` | Omitted source/config and unmatched valid tuples use defaults; no mandatory setup or synthetic rate cap. Initial plus two retries at 2s/4s, then no fourth send. A-12i |
| `all-three-decisions` | Immediate, positive delayed and stop have their documented meanings; undefined/no-opinion is invalid, not defaults. Stop schedules no retry or whole-run cancellation. A-12d |
| `exact-selection-and-scope-isolation` | Change each source/service/connection, analysis/environment and operation identity independently; no borrowed registration/history. Duplicate keys/IDs, malformed matching data and throwing getters fail before any initial send. Source tuple mutation after capture has no effect; changing it on the same operation/run rejects. RUN-017 |
| `history-driven-backoff` | First delay and prior-delay ×1.7 produce expected controlled deadlines. More than eight prior attempts exposes latest eight in order, correct omitted count and authoritative sent tally, not array-length authority. Unknown usage stays unknown; other operation/run/access evidence absent. A-12d/i |
| `pass-versus-new-run` | Same-run pass reuses persisted decision/deadline, never reruns callback or replenishes allowance. A fresh run resets tally/backoff while historical attempts/usage remain. Repeated public labels do not merge private tally/history, without claiming those labels supported attribution. A-12c/i |
| `custom-cannot-grant` | Immediate/delay with exhausted total allowance sends nothing; a gate that already forbids retry records its no-retry outcome and retains the address without callback invocation or fresh-operation bypass. Custom timing overrides fixed backoff only; an applicable restrictive rate subcap still forbids retry. No result changes `maxAttempts`, intent, fence or usage. A-12d/i |
| `rate-subcap-four-combinations` | With `rateLimitRetries: 1` and `maxAttempts: 5`, test normalized rate refusals with/without `retryAt`, each under defaults and a matched custom retry. All four permit one retry then stop after the second refusal, not five sends; with subcap zero, all stop after the first. Timed cases honor the known floor. A failed response carrying rate-like code/status/timing facts never becomes rate-limited solely from those fields. This deliberately changes #213's timed-only trigger. A-12d/i |
| `provider-context-table` | Genuine unchanged auth/bad request and confirmed absence stop; contextual 403 rate, eventual 404, recoverable 409 and permanent 409 behave distinctly. Status/method alone never supplies a blanket rule. No safety flag is required for unknown acquisition. A-12a/d/h |
| `not-before-is-independent` | Custom immediate/shorter duration, fixed backoff, two timing fields and a new run all preserve the maximum provider/durable floor. A long duration survives re-entry without restarting; no early send, overflow or implicit permission from a timestamp. A-12f/i |
| `invalid-policy-result-or-error` | Throws, rejected promises, malformed/extra-key decisions, getter failures and invalid durations produce a bounded typed error; no default fallthrough, retry, fabricated value or attempt charge. Same-run continuation does not repeatedly invoke the failed callback. Actual provider/usage evidence is retained. A-12d/f |
| `async-stop-and-stale-answer` | Soft stop and hard stop/deadline each end decision/retry waits; late resolve/reject cannot send or publish, and late rejection is handled. Superseded attempt, ended run and lost fence cannot accept stale decisions. A-12b/f |
| `durable-pending-address-and-crash` | Crash after fenced response/usage commit but before decision commit: the recorded provider status/facts/usage remain known, classification remains pending, and the same operation/address/attempt is retained. Re-entry with a live owner attaches to the one callback; after generation/fence loss it reports an interrupted block with incomplete required input and zero callback/default/send calls. A computed but uncommitted answer has no effect. Before response commit, existing unknown recovery applies. A-12f/g |
| `durable-policy-failure-and-new-run` | Rejection/invalid result commits decision-failed while provider evidence stays unchanged; outward member gets the typed policy error. Same-run re-entry retains address and attempt, repeats the error without callback/default/new operation or attempt charge. A repaired explicit ordinary new run preserves that operation and prior identities/usage, checks binding/environment/access, uses fresh allowance/config and appends a fresh attempt behind all retained floors; it never classifies the old response. A-12d/f/i |
| `durable-stop-cancel-and-decision-commit` | Accepted stop retains address/decision and cannot yield same-run reclassification or fresh operation; no acquired data or complete-success claim. Fenced cancellation records cancelled with incomplete required input. Lost fence or a stale answer writes nothing, preserving pending/newer state. Crash after accepted retry commitment reuses decision/deadline within an existing continuation without sliding the wait; a distinct new run retains compatible future not-before. No process-resume API is assumed. A-12b/f/i |
| `wait-is-not-a-send` | During async decision and durable delay, no sent-attempt debit or network permit; unrelated eligible work proceeds and existing lane/lease wait behavior is preserved. No policy access to a live author operation capability. A-12f |
| `legacy-and-durability` | Reopen #213-supported record versions and new decision records; no invented prior delay/facts or erased usage. Crash around recording response/decision and lease loss never yield an unrecorded authorized send. Missing old fields remain unknown; malformed new fields fail integrity checks. A-12f/g |
| `privacy-and-generated-consumers` | Seed response bodies, headers, URLs, errors and credentials with sentinels; only bounded extracted facts reach policy, and none leak into public events/durable diagnostics. Positive alpha consumer compiles through generated owner declarations; public-only negative and strict immutable/root boundaries remain. RUN-013/017, PKG-002/004 |

Use Jest and tsd, controlled providers/clocks/barriers and real assembled
Supervision/Core/History/Accounting paths for durable and restart claims. Preserve
existing request-intent, taint, stop/drain, writer/fence and usage negative controls.
Do not claim that a pure matcher unit test establishes actual send authority.
No paid or live-provider calls are part of these proofs.

## Compatibility and migration work to record before code

Reconcile the actual #213 request/response signatures, default backoff cap,
private-run-instance handling and versioned record codec. Record the smallest
compatible extension for source context, bounded source facts, decision/failure
state, selected duration and effective deadline. Implement the
[durable lifecycle](retry-classification.md#durable-classification-lifecycle-and-address-ownership),
including atomic address retention and the distinction between provider status,
classification state and outward member failure/block. Existing terminal-failure
address release must not bypass these retained classification states.
Existing finite `maxAttempts`,
fixed `backoffMilliseconds`, restrictive normalized-rate `rateLimitRetries`,
`rate-limited.retryAt`, historical safety hints and usage identities retain the
[design's precedence](retry-classification.md#precedence-defaults-and-timing).
Unlike #213's inspected timed-only rate branch, this design intentionally applies
`rateLimitRetries` to every normalized rate refusal with or without `retryAt`,
under default and matched policy. This is a bounded alpha behavior correction;
preserve the normalized category in attempt records so its tally is authoritative.
Document it in the runtime changeset and test all four combinations above. The
independent total cap and maximum known timing floor remain unchanged. No
callback-selected grant or new meaning for a legacy operator assertion.

Because this adds intentional alpha signatures, update API reports, generated
consumer closure/configuration if needed, and a package changeset for changed
runtime packages. Verify all strict compiler/lint/import/declaration gates,
`npm run check`, `npm test` and `npm run build`. Prepare acceptance-to-test and
observed red/green evidence, then stop for a different exact-head adversarial
review before publication and supervisory acceptance.

## Exclusions and separate work

No full source/service/credential DSL, generic metadata escape hatch, universal
HTTP-provider classifier, shared rate coordinator, adaptive strategy, new run
resume mechanism, within-run grant/repair API, manual supplied result, approval
batching, transport/CLI, live spend, publication or release automation. Known
failure exhaustion/fold-coverage repair outside #213's delivered boundary remains
its separately scoped work. Do not make retry-classifier delivery claim full #212
or RUN-019 completion.
