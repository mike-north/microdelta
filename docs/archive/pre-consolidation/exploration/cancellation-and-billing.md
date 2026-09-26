> Historical artifact. Superseded by the [active specification](../../../spec/README.md). Do not implement from this document.

# Cancellation, durable completion, and avoidable spending

**Status:** research and proposed contract, 2026-09-15. No cancellation API or
default stop policy is selected or implemented. This records the user's request
to investigate whether interrupting expensive LLM work can save money, including
the case where an operator discovers a mistake in the prompt during execution.
Sources below were checked on this date; no paid experiments were performed.

**Later discussion:** cancellation support is now required. The user proposed
first-Ctrl+C soft stopping and second-Ctrl+C escalation to abort everything
possible. Exact soft-stop boundaries and escalation lifecycle remain open. See
the later cancellation entry in [decisions](../decisions.md); earlier statements
about unselected defaults concern those semantics, not whether cancellation is
supported at all.

## Findings from provider documentation

| API surface | Documented cancellation behavior | Accounting implication |
| --- | --- | --- |
| OpenAI synchronous Responses | Terminating the connection cancels the response. | Actual cancellation is supported; the documentation reviewed does not establish an exact billing cutoff. |
| OpenAI background Responses | An explicit cancel operation is available. A disconnected stream leaves the response running. | Disconnect alone is insufficient. Preserve response identity for cancellation and reconciliation. |
| Gemini `generateContent` | The JavaScript SDK explicitly describes `AbortSignal` as client-only and says it does not cancel the service request. | Applicable usage remains chargeable after client abort. |
| Gemini background Interactions | Explicit cancellation stops a running task; observing cancelled status may lag cleanup. | Remote cancellation exists, but an exact billing cutoff and universally complete cancellation usage were not established. |
| Anthropic ordinary Messages | The SDK supports stream/request abort. The reviewed documentation does not establish backend termination or cancellation billing guarantees. | Treat remote outcome and final usage as potentially unknown. This is a documentation limit, not proof that backend work continues. |
| Claude Managed Agents | `user.interrupt` stops an in-progress model response; running tools can delay application. Queuing an interrupt and applying it are distinct events. | Stronger remote control exists on this separate API; it is not a billing/refund guarantee. |

Primary sources: [OpenAI background mode and limits](https://developers.openai.com/api/docs/guides/background),
[Gemini SDK abort semantics](https://googleapis.github.io/js-genai/release_docs/interfaces/types.GenerateContentConfig.html#abortSignal),
[Gemini background execution](https://ai.google.dev/gemini-api/docs/background-execution?hl=en),
[Anthropic SDK streaming helpers](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/helpers.md#streaming-responses),
and [Managed Agents events](https://platform.claude.com/docs/en/managed-agents/events-and-streaming).

Received text is not the billing boundary. OpenAI documents billable reasoning
before any visible answer. Anthropic bills internal thinking even when its text
is omitted or summarized. Google includes thinking in output pricing. Stopping
before receiving visible output therefore does not imply a free request.
See [OpenAI reasoning](https://developers.openai.com/api/docs/guides/reasoning),
[Anthropic thinking](https://platform.claude.com/docs/en/about-claude/models/extended-thinking-models),
and [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing).

**Engineering inference:** stopping further generation or preventing later tool
and model calls can avoid additional work and potentially reduce charges. The
sources establish useful cancellation mechanisms, not a universal monetary
savings amount, refund, or precise charging cutoff. Exact savings remain
unmeasured. A local `AbortController` can express intent consistently, while the
adapter must implement the actual provider-specific mechanism.

## Two useful operator choices

These are proposals, not approved names, defaults, or API syntax:

- **Finish active steps:** stop admitting independent work; allow executing
  memoized bodies and dependencies necessary to finish them to complete and
  persist reusable results. A long agentic step may continue spending for a
  substantial period, so this choice needs an honest description.
- **Cancel now:** prevent new participating model calls, tools, retries, and
  queued work for the cancelled scope. Signal executing bodies cooperatively
  and request remote cancellation through capable adapters. Keep previously
  completed results and observed usage; do not automatically restart cancelled
  work. Report remote cancellation separately from merely stopping local waiting.

The second choice addresses the mistaken-prompt case: completing an invalid
analysis has little value, so conserving avoidable remaining work can be more
important than producing a cacheable result. Even if a provider cannot interrupt
the current inference, preventing the next tool or model request is useful.
When tools run remotely, the remote agent's interruption contract determines
whether and when those tools stop; a local admission gate cannot control them.

## Preserve the durable boundary

A memoized step remains the unit of durable result reuse. If its body makes three
requests and cancellation interrupts it after the first, that response does not
constitute a completed step result. Persisting trace/usage evidence does not make
the partial output cacheable. Durable substeps can provide finer reuse boundaries
when an author intentionally defines them; general request checkpointing and
resuming arbitrary JavaScript at an interrupted line have not been selected.

The earlier suggestion to finish only in-flight requests and then resume the
step later assumed checkpointing that is absent from the current model. Neither
request draining nor step draining should be treated as an approved default.

## Proposed contract and acceptance cases

These requirements still need a concrete lifecycle/API design before coding:

- A cancellation signal is available to participating step bodies/adapters, and
  new work checks cancellation at its admission boundary. Test cancellation
  before admission, during a request, and between requests; the latter must
  prevent requests two and three in the example above.
- Cancellation propagates through owned child work and waits. Define ownership
  for shared work before implementing propagation; cancelling one consumer must
  not silently cancel another consumer's required work.
- Operator cancellation is distinct from recoverable provider failure. Assert
  that automatic retry and an hours-long quota wait cannot revive a cancelled
  run without an explicit restart.
- Trace local cancellation, provider cancellation requested, provider-confirmed
  cancellation where available, and uncertain remote outcomes as separate facts.
  Test a client-only abort and a lost cancellation response without claiming
  that the server stopped.
- Keep known usage and its completeness. Missing final usage stays unknown;
  it is never zero by default. Reconciliation must not count cumulative usage
  snapshots multiple times.
- Specify races with normal completion and persistence. A partially completed
  body must never publish a successful memoized value. A fully completed,
  validated result racing with cancellation needs an explicit commit rule.
- Cooperative cancellation cannot forcibly interrupt arbitrary synchronous
  JavaScript or unintegrated network calls. Define what run completion means
  while uncooperative work remains, how claims are fenced, and whether shutdown
  has a separate bounded wait or process-termination policy.

Still open: default stop behavior, names, cancellation scopes, signal access in
the authoring surface, adapter capabilities, completion/commit races, shared-work
ownership, claim handling, and durable restart/accounting reconciliation.
