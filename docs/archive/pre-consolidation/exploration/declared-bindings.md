> Historical artifact. Superseded by the [active specification](../../../spec/README.md). Do not implement from this document.

# Candidate binding surface for a known pipeline

2026-09-15. Recommendation for discussion, not approved or implemented API.
Examples are illustrative and have not been typechecked. They apply the user's
[known-structure decision](../decisions.md) to the
[GitHub contribution scenario](../scenarios/github-contribution-analysis.md).

## Leading candidate after the user's conventional-TypeScript preference

The user subsequently emphasized conventional TypeScript and a happy path that
matches what authors would naturally try first. Prefer testing ordinary calls to
wrapped functions before exposing a separate binding operation:

```ts
// fetchPRFacts, countLanguages, and analyze are already declared wrapped steps.
// prs describes the person's period; its member identities are not yet known.
const prFacts = fanOut(prs, fetchPRFacts);
const histograms = countLanguages(prFacts);
const assessment = analyze(prFacts, rubricRef);

// Read one verified result field, or deliberately observe provisional state.
const summary = await assessment.summary;
const preview = peek(histograms);
```

Calls to wrapped functions construct bindings and return typed result references;
they do not execute paid bodies while constructing the pipeline. Ordinary unwrapped
functions retain ordinary JavaScript execution semantics. Wrapping a function
with `step` or `memo` is what makes its invocation available to the composition
mechanism, not source inspection or magical interception of all function calls.

This preserves normal positional or object arguments instead of mandating one
named-input convention. Memoized callees default to complete verified inputs;
unmemoized callees may evaluate previews, while verified reads of their outputs
still require verified inputs. A collection reference is one argument regardless
of how many members are eventually discovered. Its readiness is a property of
the binding, not a requirement to materialize all payloads eagerly.

The nonstandard behavior must be honest in TypeScript: a wrapped call returns a
reference, not an already-computed result or a conventional async function's
native Promise. Test natural first attempts and errors, including passing an
ordinary value, awaiting a field, awaiting a collection, destructuring references,
and using async helpers. Whole-result awaiting and async thenable assimilation
remain design questions; no new public type is approved here.

The standalone `bind` examples below are retained as an explicit comparison and
possible low-level representation. They are no longer the preferred happy path.
Likewise, named bags remain useful ordinary object arguments or field combinator
inputs, not a mandatory graph declaration language.

## Explicit alternative: named input bags over references

Keep calculation functions, memoization, and input binding distinct. A binding
connects a function's named inputs to references and returns a reference to its
result. Constructing the binding neither loads data nor executes paid work. The
composition is declared before execution; fan-out supplies instances of its
declared member calculation as membership becomes known.

```ts
// prFacts is a collection reference, even before its membership is known.
const prFacts = fanOut(prs, fetchPRFacts);

// Unmemoized calculation: provisional recomputation is the default.
const histograms = bind(countLanguages, { prs: prFacts });

// Memoized calculation: complete, verified inputs are the default.
const analyze = memo(analyzeContributions, { revision: 1 });
const assessment = bind(analyze, {
  corpus: prFacts,
  rubric: rubricRef,
});
```

In this short example, `prs` is the source for one person's period. The same
pattern composes into team and organization aggregates. `fetchPRFacts` is a
previously declared member step with the memoization policy appropriate to API
work. These calls describe topology; they are not eager Promise-based loops.

The input bag's keys correspond to the calculation's object argument, so a typed
implementation should infer required input names and value types. This is an
author-facing signature convention to assess, not a settled replacement of the
draft's positional-argument API. Readiness wrappers are binding metadata, not
new identities. Stable naming and revision rules continue to apply to steps.

## Defaults plus an explicit complete binding

The spelling can expose the policy when useful:

```ts
const finalHistogram = bind(countLanguages, {
  prs: complete(prFacts),
});
```

Here an otherwise inexpensive function waits for complete input. Ordinary
unmemoized bindings may use available provisional inputs. Memoized bindings
require complete verified inputs before invoking the body; they may still serve
available prior results through observation without executing the body.

Do not initially make an input wrapper such as `preview(ref)` an implicit escape
hatch that allows a memoized body to execute on provisional input. Any such
override needs an explicit policy decision. Previewing a memoized result remains
supported and distinct from authorizing speculative execution.

A complete collection binding waits for enumeration to close and all required
members to resolve for the evaluation. It does not mean copying all payloads into
an array, resolving every unused field, or recording a whole-content dependency
merely to establish readiness. Collection membership/readiness and the fields
actually consumed need separate treatment. Precise field reads remain tracked.

## Preview observation versus verified consumption

```ts
// Subscribes to provisional changes; does not drive memoized execution.
observe(histograms, state => renderHistogramPreview(state));

// Immediate observation of available state, potentially with no value.
const previousAssessment = peek(assessment);

// Verified consumption drives the required evaluation and awaits this field.
const summary = await assessment.summary;
```

An observation carries availability, validity, coverage, pending/error information,
and an optional value. The renderer handles those states rather than receiving a
default masquerading as verified data. Observation can cause allowed unmemoized
preview calculations; it cannot trigger upstream memoized bodies. A verified root
request supplies the demand that drives required memoized work. Observer lifetime,
refresh coalescing, and exact state types require design before implementation.

Unmemoized calculation bodies must have a clear missing-input contract. For this
histogram example, a provisional collection exposes available members and coverage.
For a scalar with no available value, this sketch recommends withholding that
calculation until an explicit default/pending handler is supplied. Zero, null,
and an empty collection must not be silently substituted by the framework. A
separate preview-state callback could express such defaults; its syntax remains
open. Unmemoized verified consumption still requires verified inputs even though
the same node also supports provisional preview evaluation.

## Individual awaits and collective reads still fit

```ts
const summary = await assessment.summary;

const { summary, rationale } = await refs.all({
  summary: assessment.summary,
  rationale: assessment.rationale,
});
```

These consume the selected references, recording the selected dependencies in an
executing tracked consumer. They resolve ordinary values rather than a ready view
whose later accesses record reads. This is the simpler selection-as-consumption
candidate from the conversation, not a selected final API. It permits one shared
resolver and in-flight loader beneath both forms.

`bind` wires the pipeline before execution; `refs.all` consumes fields at a read
boundary. They share references, but have distinct jobs. Returning thenable field
references through async helpers still assimilates them; upfront binding should
route references without accidentally awaiting them. The reference/value type
contract and asynchronous helper examples remain mandatory validation exercises.

## Advantages of the explicit alternative

- Dataflow appears in a small composition layer, separate from paid bodies.
- Named inputs make multi-source bindings and parameter intent visible.
- Memoization supplies the desired default; an explicit complete binding is
  useful for inexpensive calculations that should also wait.
- A collection is one stable dependency expression regardless of cardinality.
- Observation and verified consumption are visibly different operations.
- No class hierarchy, string-based node registry, or build-time source analysis
  is required by these sketches.

Another alternative is binding through callbacks, such as a callback that reads
references from a closure. That retains ordinary function style but can hide
pipeline edges and makes upfront structure harder to expose without running the
callback. Compare this with directly calling wrapped functions. Do not use
the JavaScript function method name `.bind` for a different binding contract;
a standalone operation avoids that ambiguity while preserving ordinary functions.

## Remaining design work and acceptance probes

1. Type-test named input inference, optional inputs, field references, collections,
   scalar defaults, and errors; show whether positional adapters are necessary.
2. Run the product scenario with zero, one, and many PRs through the same declared
   pipeline. Verify that the closed empty corpus is ready, but pending discovery
   with zero known members is not.
3. Prove zero memoized body invocations from observation alone, including nested
   unmemoized preview calculations and repeated subscription updates.
4. Prove verified consumption of an unmemoized node cannot return its provisional
   cached preview as a verified value.
5. Verify complete-binding readiness without whole-payload materialization or
   unread-field dependencies, and bounded member storage/query behavior.
6. Define how input bags map to durable subjects and nested-call replay addresses;
   the named-bag convention cannot silently change argument-order identity rules.
7. Decide whether ordinary conditional field reads remain unrestricted inside a
   declared step while conditional step topology must be declared upfront. New
   topology cannot be introduced by executing an arbitrary paid body.
8. Specify the evaluation target and immutable generation binding separately from
   global atomic source snapshots, which these combinators do not manufacture.

This recommendation resolves a concrete syntax direction to compare, not these
remaining contracts. No production exports or tests change with this document.
