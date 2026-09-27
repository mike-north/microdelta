# Typed tracked-capture lint

The microdelta/tracked-captures rule is a type-aware TRK-4 check for documented
observer callback forms. It reports untracked external references that can
change a result without contributing a tracked observation. It is a bounded
correctness aid, not a JavaScript closure, purity, or runtime-ownership proof.

The recognized boundaries are calls whose resolved TypeScript member comes from
ITrackingObserver: capture, captureAsync, derived, and tracked when its value
argument is callable. A callback may be an inline arrow/function or a same-file
function declaration passed directly by identifier. Factories, conditionals,
bind, aliases to callback variables, and other constructed forms are reported
as unsupported at an actual observer boundary. Literal-computed observer methods
such as `observer['capture']` are also reported as unsupported, and `this`
references anywhere inside a recognized callback are reported as unsupported
because the receiver is an external influence that the lexical-reference check
cannot represent. A same-spelled non-framework function does not create a
boundary.

Parameters and declarations inside a callback are local inputs. External
captures are accepted when their declared type carries the canonical tracked
brand, when they are one of the explicit observer capabilities (tracked,
capture, captureAsync, derived, keys, hasOwn, or snapshotOutput), or when the
receiver is used with one of Materialization's exact observation methods:
materializeOutput, project, projectFrom, and observeMemberOrder. Receiver
allowances resolve from the owning Tracking and Materialization declarations
and cover only that receiver; arguments and referenced values must still carry
their own tracked evidence or be locally declared. Other Materialization methods
do not inherit receiver authority. A lazy scalar view returned by Materialization
preserves Tracking's canonical brand through its generated alpha declaration;
detached output does not become tracked because Materialization produced it.

External captures are also accepted when the reference is one of the allowlisted
standard-library calls: selected deterministic Math numeric methods,
Number.isFinite, Number.isInteger, Number.isNaN, Number.isSafeInteger, and
Object.is. Calls are matched by resolved symbol and standard-library declaration.
This list is compatibility policy, not a defense against runtime monkey-patching.

The observer's keys and hasOwn operations and tracked in checks are supported.
Native object reflection is not: Object.keys, Object.hasOwn,
descriptor/prototype access, and own-key reflection do not substitute for the
observer operations. A recognized local cell.get() is accepted only when its
declared result is itself branded, as when the cell contains a tracked record.
An actual observer.derived(...).get() can return a scalar because that
derivation replays its semantic observations, including cached success and
failure. A bare scalar cell remains untracked.

The rule checks actual TypeScript programs and generated declarations. Missing
type services fail with a diagnostic. The declaration fixture compiles an
alpha consumer against generated Tracking, Materialization, Value, and producer
rollups; it proves lazy scalar-view brand preservation, detached-output
isolation, and exact receiver identity, then separately asserts that producer
public rollups hide their alpha-only contracts.

This rule does not infer arbitrary alias/reassignment history, dynamically
computed observer method names, dynamic reflection, runtime prototype mutation,
source freshness for builtins, or nondeterminism policy. A dynamically computed
method name is outside the recognized syntax, so use a direct method call to
receive boundary diagnostics. A changed untracked closure may still evade
source-based analysis, as EXP-1 demonstrates. It has no autofix.
