# Reusable acquisition retry classification

Status: engineering design candidate for [#220](https://github.com/mike-north/microdelta/issues/220),
pending independent review and supervisory acceptance. This document elaborates
[the accepted acquisition decisions](data-acquisition-retries.md#accepted-decisions-and-supersession),
[RUN-011](../spec/operations.md#run-011--finite-acquisition-retries-belong-to-each-run)
and [A-12d/i](../spec/acceptance.md#acquisition-retry-and-rate-admission-cases).
It does not claim implementation, change the accepted three-way decision or
select a full source/service/credential authoring DSL. The
[implementation handoff](retry-classification-implementation.md) is a subsequent
bounded runtime task, not authorization to implement runtime in this revision.

## Caller situations before representation

1. **Ordinary acquisition with no configuration.** A POST-like model-data request
   loses its response. With no custom registration or retry options, its next
   attempts may run after 2 seconds and then 4 seconds, at most three actual sends
   in this run. The earlier usage stays unknown. Neither HTTP method nor absent
   `safeToRepeat`/provider idempotency blocks acquisition retry.
2. **One policy reused by many calls.** Two source steps use the same catalog
   adapter and connection. Its shared policy sees a 404 plus the adapter's
   `resource-expected-later` condition and chooses a delay, even if the generic
   adapter initially returned `failed, transient: false`. The same status for a
   confirmed missing catalog entry produces stop. The matched policy decides
   before the built-in interpretation; an extra permanent-failure gate must not
   bypass it.
3. **403 is not enough information.** `bad_credentials` means stop; a documented
   provider `secondary_rate_limit` code can mean delayed retry. If the source
   supplies a known not-before at time 12,000 and the policy asks to retry at
   4,000, 12,000 remains the earliest permitted send. A policy's observation of
   a rate code does not itself invent remaining quota or shared limit membership.
4. **409 is contextual too.** An unchanged invalid revision can stop, while a
   documented temporary contention response can delay. An HTTP status, GET/POST
   distinction, or retry count is not proof of provider meaning.
5. **Classification is waiting, not execution.** A matched callback is awaiting
   an asynchronous local assessment when a stop arrives. The run ends that policy
   wait without holding a network permit or charging another attempt. A later
   callback resolution cannot revive the retry. Tests use controlled promises;
   this example authorizes no live or paid assessment.

These examples preserve the source adapter's responsibility to interpret its
provider. A genuine unchanged authentication/authorization or bad-request failure
must not be automatically retried by a correctly configured source policy. A
matched policy may have context that corrects a coarse `transient: false`; that
coarse classification is not immutable execution authority.

## Meanings, responsibilities and invariants

A **retry policy registration** selects reusable classification for a named
remote data-source adapter in one service/access context. It does not declare a
Definition source step, choose source-result finality, route credentials, define
a rate-limit bucket, or create a new bounded context. The same callback can serve
several explicitly registered contexts without combining their attempt histories.

A **retry observation** is a source-authored description of the just-ended
request attempt, not a response value or permission. The source adapter extracts
small non-secret facts from its provider response. The matched callback interprets
those facts and selects immediate retry, a delay duration, or stop. If no callback
matches, the existing adapter-normalized response feeds built-in classification.
There is no implicit fourth decision, no fallback after a matched callback fails,
and no need to configure a policy for ordinary calls.

**Known not-before** is an independent timing restriction, not one of those
observational facts. Supervision preserves its strongest known floor and its
own selected delay. A custom decision can add a later restriction but cannot
shorten an existing one. Timing eligibility still does not authorize a send.

Supervision owns exact operation/attempt correspondence, per-run allowance,
policy invocation, wait/stop races, durable decision timing and pre-send gates.
History stores its opaque records; Accounting preserves actual usage and gaps;
Machine supplies host context/timing. Core composes the existing owners and
reexports intentional alpha declarations. Neither policy callbacks nor this seam
acquire History/Accounting mutation, dispatch or allowance-grant capabilities.

The [#213 direct-path design](https://github.com/mike-north/microdelta/issues/213)
is the runtime dependency. Its implementation is evolving; reconcile its actual
merged API and journal version before implementation. The inspected design uses
three total sent attempts, a private run-instance discriminator and 2s/4s default
backoff. The public run ID remains a caller-unique attribution label. A private
instance defensively separates tallies if that contract is violated; it does not
make repeated public IDs supported attribution or expose private instance tokens
to callbacks.

## Selection: exact, scoped and optional

The proposed alpha run options accept an optional immutable list of registrations.
Each has a unique non-secret policy identifier, an exact scope and a callback.
A request optionally supplies the corresponding scope:

- `source`: the reusable remote data-source adapter family, not a step/result ID;
- `service`: the logical remote service identity, not an inferred hostname;
- `connection`: the configured access-context identity, never credentials or a token.

Run analysis and environment scope are supplied by Supervision, not overridable
request fields. All three request identifiers must be present together and match
exactly. Registrations exist only in that run configuration; there is no mutable
global registry, inheritance, URL parsing, wildcard, first-match priority or
user-code predicate. Two registrations for the same exact tuple are invalid even
when their callbacks are equal; duplicate policy identifiers are invalid too.
Reject malformed/ambiguous configuration before initial admission or send.

An omitted request scope or a tuple with no exact registration uses defaults.
An invalid supplied tuple is an error, not an absent match. A different connection,
service, source, analysis or environment must not silently borrow another scope's
registration or evidence. Validate and snapshot registration data and callable
references at run creation, and request scope at operation entry. Throwing getters
or malformed matching data fail as configuration/request errors; they do not
invoke a fallback policy. There is no asynchronous matching phase to race.

Within one run, an operation's selected source tuple cannot change between retries
or passes; reject such a request before another send. This check uses the existing
logical-operation identity, not a new identity that resets allowance. A later run
may deliberately use revised configuration, subject to the existing request
binding and environment/access contracts; it receives no implicit cross-run
backoff history. Source wrappers can attach their tuple once, so callers do not
repeat a policy function or a DSL at every operation.

Exact matching gives up automatic broad domain matching in this slice. A source
adapter can map its supported endpoints to the same explicit tuple. More general
matching can be designed later without making registration order or hostname
synonyms an accidental authority boundary.

## Minimal observation and decision surface

The following names and layout are the proposed alpha representation, not current
exports. Existing `IOperationResponse`, `IRunContext`, `IAbortSignal` and
`IAttemptUsage` retain their owners. All object properties and arrays below are
readonly; constructors/normalizers must make detached immutable framework
snapshots rather than retaining caller-owned mutable objects.

```ts
interface IRetrySourceScope {
  readonly source: string;
  readonly service: string;
  readonly connection: string;
}
interface IRetryFacts {
  readonly httpStatus?: number;
  readonly providerCode?: string;
  readonly conditions?: readonly string[];
}
type IRetryDecision =
  | { readonly kind: 'retry-now' }
  | { readonly kind: 'retry-after'; readonly delayMilliseconds: number }
  | { readonly kind: 'stop' };
type IRetryOutcome =
  | { readonly kind: 'failed'; readonly transient: boolean }
  | { readonly kind: 'rate-limited' }
  | { readonly kind: 'unknown' };
interface IRetryAttemptSummary {
  readonly requestAttempt: string;
  readonly status: 'failed' | 'rate-limited' | 'unknown';
  readonly usage: IAttemptUsage;
  readonly decision?: IRetryDecision;
}
interface IRetryHistory {
  readonly sentAttempts: number;
  readonly prior: readonly IRetryAttemptSummary[];
  readonly omittedPriorAttempts: number;
  readonly previousDelayMilliseconds?: number;
}
interface IRetryDecisionInput {
  readonly context: IRunContext;
  readonly source: IRetrySourceScope;
  readonly operation: string;
  readonly requestAttempt: string;
  readonly outcome: IRetryOutcome;
  readonly facts: IRetryFacts;
  readonly knownNotBefore?: number;
  readonly history: IRetryHistory;
  readonly signal: IAbortSignal;
}
interface ISourceRetryPolicy {
  readonly id: string;
  readonly scope: IRetrySourceScope;
  decide(input: IRetryDecisionInput): IRetryDecision | Promise<IRetryDecision>;
}
```

Add `retryPolicies?: readonly ISourceRetryPolicy[]` to the existing Supervision
and Core run options, and `retrySource?: IRetrySourceScope` to the existing operation
request. Nonsuccess response arms gain optional `retryFacts` and a separate
optional `notBefore` epoch value. Success never invokes classification or exposes
its result to a policy. The existing `rate-limited.retryAt` field remains compatible;
when both timing fields exist, take their maximum together with any durable floor.
No timing field is accepted inside `retryFacts` or a policy registration.

Facts are bounded: HTTP status is an integer from 100 through 599; provider code
and condition names are non-secret identifiers of at most 128 characters; at most
eight unique conditions are allowed. Identifier characters are ASCII letters,
digits, `_`, `.`, `:`, and `-`, with a nonempty value. Source/service/connection and
policy identifiers use the same nonempty bounded identifier rule. No raw response
body, header collection, URL/query, request parameters, request binding, arbitrary
error, credential value, usage quantities or generic metadata bag crosses this
boundary. The identifier validation bounds structure; it cannot prove a string
is not a secret. Adapter authors must extract documented codes/conditions rather
than copying private payloads, and privacy fixtures must test that boundary.

Malformed source facts produce an invalid-response error with no classification
fallback or retry. Facts remain provider observations, never provider guarantees:
`resource-expected-later` must come from the adapter's documented operation
context, not a library guess based on 404. The field is not sent to public run
events or interpolated into durable diagnostics. Existing provider error detail
can still follow the existing local author-error path; it is not callback input.

## Bounded prior-attempt evidence

The callback's `history` covers only actual sent attempts of this logical operation
in the selected analysis/environment and current private run instance. It excludes
allocated-but-unsent intents, unrelated operations, other connections and previous
runs. The current nonsuccess attempt is separate from `prior` but is included in
`sentAttempts`. That count comes from Supervision's authoritative tally, not the
length of a truncated array or a caller-supplied public run ID.

Expose at most the latest eight prior ended sent attempts in chronological order.
`omittedPriorAttempts` counts earlier eligible attempts not shown; an empty array
with an omitted count is never presented as no history. Each summary keeps its
actual request-attempt identity, recorded status, usage-acknowledgment state and
recorded decision if one exists. `none`/`unrecorded` usage is unknown evidence, not
zero cost. Neither callbacks nor a later success rewrite it.

`previousDelayMilliseconds` is the most recent accepted scheduled retry duration
before the current attempt in this run, including zero for an immediate retry;
it is absent when no such duration is known. It is not elapsed wall time, the
provider's floor, a summed delay, or a value inferred by subtracting `notBefore`
from an unknown historical clock reading. Thus a policy can calculate, for example,
`Math.ceil(previousDelayMilliseconds * 1.7)` without loading an unbounded journal.
No previous-run delay is silently carried into new-run default backoff.

Supervision must persist selected duration and effective not-before alongside the
corresponding attempt decision so same-run passes reuse the decision and deadline,
rather than invoking the callback again and sliding the wait forward. Existing
#213 records do not yet expose this evidence. The implementation must version its
extension against #213's actual accepted format, preserving v1 and subsequent
attempt identities, unknown usage and consumed-address semantics. Missing legacy
decision/fact fields mean unknown/absent evidence, not fabricated zero delay. The
bounded callback view is not a new retention or deletion policy for durable history.

## Precedence, defaults and timing

After a nonsuccess response and its actual usage state are durably recorded,
Supervision applies this order:

1. Preserve the strongest valid known provider/durable not-before restriction.
   If stop, ended/stale execution or exhausted independent allowance already
   forbids a retry, do not invoke a policy merely to seek permission.
2. Select the exact registration. A match invokes its callback even when the
   normalized response says `failed, transient: false`. Otherwise apply built-in
   classification. No default permanent/authentication decision runs ahead of a
   matched policy; no callback exception/invalid return falls through to defaults.
3. Validate and snapshot one of the three decisions. `stop` schedules no retry
   and is not by itself operator rejection, a whole-run cancellation, acquired
   data or complete-success coverage.
4. For a retry, recheck allowance, stop/deadline, operation/attempt identity and
   source scope. Combine timing as described below and persist the accepted
   decision/deadline under the current fence before it can govern a later pass.
5. Before actual send, independently recheck all current runtime gates: allowance,
   stop/taint/ended execution, known not-before, any applicable rate admission,
   permit, durable intent and current lease/fence. Policy completion grants none
   of these. Waiting neither consumes a sent attempt nor holds a network permit.

| Input or option | Chosen behavior |
| --- | --- |
| No matching policy; normalized `unknown`, `rate-limited`, or `failed, transient: true` | Retry with the #213 built-in delay if independent authority permits |
| No matching policy; normalized `failed, transient: false` | Stop; no blanket retry from status/method alone |
| Matching custom policy | Its immediate/delayed/stop result replaces built-in classification and delay, including conservative normalized failure |
| Omitted `maxAttempts` | Three total actual sends in this run; all kinds share it |
| Explicit finite positive safe-integer `maxAttempts` | Changes only that hard allowance; no callback can increase it |
| Omitted direct `backoffMilliseconds`, no custom match | 2,000ms after first sent failure, 4,000ms after second; doubling capped at 60,000ms for larger finite overrides, matching #213's chosen direct-path schedule |
| Explicit nonnegative safe-integer `backoffMilliseconds`, no custom match | Existing fixed-delay override, including zero; does not make a permanent normalized response retryable |
| Explicit fixed backoff plus custom match | Custom delay wins; do not add or maximize the legacy fixed backoff against it |
| Legacy `rateLimitRetries` | Restricts all normalized `rate-limited` responses, with or without `retryAt`, under default or custom classification (the deliberate alpha correction below), even when a custom policy chooses immediate/delayed retry; never an independent pool or permission beyond `maxAttempts` |
| Known not-before plus any retry decision | The later floor wins, regardless of custom/default/fixed delay or new-run allowance |

The rate-only subcap refers to the adapter's actual `rate-limited` response
category. This deliberately corrects the inspected #213 alpha behavior, which
consults `rateLimitRetries` only when that response also has `retryAt`; untimed
rate refusals currently take its ordinary transient branch. This candidate applies
the restrictive cap to all normalized rate refusals, under both built-in and
matched custom classification. It is not unchanged #213 compatibility. Preserve
the normalized rate category in durable attempt evidence even without a timestamp,
so the authoritative current-run rate-refusal count is not lost as generic failure.

After recording the current rate refusal, a retry is forbidden when the count of
current-run normalized rate refusals exceeds `rateLimitRetries`, or the total sent
count reaches `maxAttempts`. Thus `rateLimitRetries: 0` permits no retry after the
first refusal; `1` permits one, provided the independent total allowance permits it.
Neither callback timing nor a missing provider timestamp bypasses this rule.
A provider-code string, HTTP status, `notBefore` field or callback decision never
changes the normalized category or expands this cap to other failures. Adapters
should normalize known rate refusals accordingly. All actual sends, including a
custom reinterpretation of a conservatively normalized failure, still consume the
common finite allowance.

For a validated `retry-after`, require a positive safe-integer duration in
milliseconds. Zero is expressed by `retry-now`; the old fixed-backoff zero remains
supported through that normalization. Reject negative/fractional/NaN/infinite or
unsafe durations and overflow when adding duration to the decision clock. Known
epoch restrictions follow the host's finite safe-integer time contract; a past
restriction is already eligible, not a negative delay.

At decision acceptance time `t`, compute the effective floor as the maximum of
`t + selectedDuration`, the current durable floor, response `notBefore`, and
legacy response `retryAt`, omitting absent entries. An immediate decision uses
zero duration. Persist that absolute floor once; re-entry does not restart the
duration. A restriction discovered later can extend the floor, never shorten it.
No source policy decision creates proactive rate configuration or shared cooldown
membership; those belong to the separately designed RUN-019 coordinator.

## Contextual provider examples and limits

| Source observation | Adapter normalization/default | Matching custom example |
| --- | --- | --- |
| 401 or 403, documented `bad_credentials`/`permission_denied`, unchanged request/access | `failed, transient: false`; stop | Stop; do not spend the remaining allowance hoping unchanged credentials work |
| 403, documented `secondary_rate_limit` with known retry time | `rate-limited`; delayed default and provider floor | Select an appropriate delay or immediate eligibility, still behind the floor and both applicable caps |
| 404, confirmed absence | `failed, transient: false`; stop | Stop |
| 404, operation context says a just-created resource is not yet visible | Adapter may normalize transient; a generic adapter may conservatively say false | A matched source policy sees `resource-expected-later` and returns delayed retry before default stop |
| 409, unchanged invalid revision/precondition | `failed, transient: false`; stop | Stop unless documented source context establishes a different recoverable situation |
| 409, documented temporary contention | `failed, transient: true`; delayed default | Immediate or source-specific delay, without bypassing known timing/allowance |
| 429 or recoverable service unavailable, interpreted in provider context | `rate-limited` or transient failure; delayed default | Context may choose a longer delay or stop, for example a nonrecoverable quota condition |
| Timeout/lost response/rejected transport | `unknown`; delayed default | Any of the three decisions, with unknown usage preserved and no replay-safety prerequisite |

The built-in implementation consumes the existing adapter-normalized outcome.
It does not ship a universal HTTP/provider-code registry or infer semantics from
these illustrative codes. A small source-owned facts seam is preferable to
passing arbitrary errors/bodies to a global predicate: it preserves context for
custom precedence without making Supervision parse provider payloads or secrets.

## Durable classification lifecycle and address ownership

The following semantic states belong to Supervision's durable operation record;
codec spelling is an implementation choice. They are separate from the recorded
provider attempt status and the outward member outcome. A known failed response
is not a still-in-flight request, and a policy error is not another provider
failure. Preserve the same logical operation, request-attempt identity, request
binding, source scope and originating private run instance throughout classification.

Before invoking a callback, commit the normalized nonsuccess response, validated
facts, actual usage acknowledgement and strongest known timing floor under the
current fence, together with `decision-pending`. The record and address index must
retain their association atomically under the existing persistence protocol.
Do not use a terminal `failed` operation settlement that frees the address. If the
response commit fails, do not invoke classification; retain the existing unrecorded
or unknown-outcome recovery path rather than fabricate durable response evidence.

| Durable classification state | Outward behavior and same-run address rule |
| --- | --- |
| `decision-pending`, owning generation still live | The member is waiting/pending with its required input incomplete. Re-entry attaches to or observes the existing wait; it never invokes a second callback or allocates a fresh operation. |
| Accepted `retry-now` or `retry-after` | Decision, selected duration and absolute effective floor commit together before retry admission. Re-entry reuses them and the same operation; the next actual request gets a new attempt identity and charges the existing run tally. |
| Accepted `stop` | Retain the decision and operation/address for this run. Re-entry reports the same stopped acquisition without reclassification, default retry, fresh operation or allowance reset. It supplies no acquired data or complete-success coverage. |
| `decision-failed` | Persist a bounded policy-error reason, retaining the known response, attempt and address. The waiting member may fail with the typed local policy error; same-run re-entry returns that error without callback/default/send. |
| Retry forbidden by an independent runtime gate | Persist a bounded no-retry reason under the current fence, retaining response, attempt and address; expose the existing exhaustion/block or stop outcome without invoking a callback for permission. Same-run re-entry cannot bypass that gate with a fresh operation. This is a framework outcome, not a callback-selected stop. |
| `decision-cancelled` | When still fenced, persist interruption by stop/deadline, retaining address and evidence. The required input remains incomplete under existing stop/coverage semantics; same-run re-entry cannot revive classification or retry. |
| Pending after ownership/generation loss | The persisted response is still known, but there is no accepted decision or live authorized wait. Report an interrupted classification block with incomplete required input. It remains blocked even within the same invocation until an explicit new run. |

Only the captured live generation may accept its answer, and only while its
operation/attempt, private instance, source scope, record revision and lease/fence
are current. Losing that authority does not authorize a cancellation write: leave
pending or the newer writer's state untouched. Discard late answers without any
journal, address-index, usage, decision or publication mutation. These states are
framework lifecycle outcomes, not a fourth callback decision. The broader #214
known-failure/fold-coverage repair remains separate; this seam must not claim
complete coverage merely because classification ended.

An explicit ordinary new run can recover a retained pending, failed, cancelled or
stopped classification using its normal fresh allowance and configuration. It
keeps the existing logical operation/address and prior attempt identities, checks
request-binding/environment/access compatibility, and appends a fresh request
attempt if all send gates permit. It does not rerun a classifier against the old
response. Preserve actual historical usage, the durable provider floor and any
compatible already accepted future not-before; fresh default backoff history does
not erase an existing timing restriction. No within-run repair, grant, or new
process/run-resume API is introduced.

Crash boundaries must remain distinguishable. Before response commitment, existing
in-flight/unknown recovery applies. After response commitment but before decision
commitment, known response/facts/usage survive as pending; a missing live generation
blocks re-entry, even if a callback computed an answer before crashing. An answer
that never committed is not authoritative. After accepted decision commitment,
existing same-run continuation reuses the recorded decision/deadline without
callback reinvocation; a genuinely new run follows the fresh-run rules above.
This specifies durable record handling, not support for resuming a process or
reconstructing an old run identity. All retained records preserve unknown usage as
unknown and do not debit a send merely for callback execution or recovery.

## Callback errors, stopped waits and stale answers

Invoke classification outside a live author request-execution capability, with
only the readonly input and an abort signal for this decision. A policy cannot
use `currentExecution().operation` to acquire another supervised send. Ordinary
JavaScript can still perform out-of-band effects; the callback contract grants
none, and tests never call live providers. Policy assessment holds no network
permit and releases/lends the waiting member's execution lane through the existing
wait integration rather than blocking unrelated eligible work.

A synchronous throw, rejected promise, invalid/extra-key decision, throwing result
accessor, malformed duration or attempted allowance field is a typed local policy
failure. Return `undefined` is invalid, not no opinion. Do not call defaults, send,
charge an attempt, fabricate data, or clear the actual provider/usage evidence.
Use bounded error codes without copying source facts or exception text into events
or durable diagnostics. Commit `decision-failed` under the current fence and retain the address as defined
in the [durable lifecycle](#durable-classification-lifecycle-and-address-ownership).
If ownership was lost, make no stale write; unresolved pending remains blocked.
A repaired explicit new run follows that lifecycle's fresh-attempt path; no
within-run repair/grant API is added.

An async decision wait races any stop or deadline escalation. Abort its decision
signal, detach the wait without requiring cooperative settlement, and handle a
late rejection so it cannot become an unhandled process error. A late success is
ignored. No new policy timeout/default deadline is invented; an operator-supplied
run deadline and stop controls remain the liveness boundary.

Before applying an async answer, compare the captured operation, failed request
attempt, private run instance, source scope and decision generation with current
state, and recheck stop and fence. An ended run/step, superseded attempt or lost
ownership cannot acquire send/publication authority from the answer. A stale
answer is discarded, not applied to another attempt or a later run. Reuse an
already committed decision/deadline across a continuation; never rerun a callback
merely because a timer woke. Local journal/Accounting errors remain their existing
owned failure paths, not provider outcomes fed to the source classifier.

A policy failure, discarded answer and cancelled wait are framework execution
outcomes, not extra callback decisions. Existing failed/unknown acquisition and
fold coverage stay truthful. Repair of broader known-failure exhaustion/coverage
behavior is not silently absorbed from #213 into this classifier slice.

## Delivery boundary

No runtime code, exported declaration or journal codec changes in this design
revision. No subscription, rate-coordinator implementation, source/credential DSL,
manual result injection, within-run allowance grants, cross-process scheduler,
provider execution, package publication or release change. The runtime handoff
must reconcile #213 first, add strict Jest/tsd failures before implementation, and
prove the precedence, scoping, bounded history, timing and error/race examples.
The accepted three-way precedence and independent authority are settled; this
candidate's representation, bounds and default seam require review, not a new
owner decision solely because API spelling is being chosen.
