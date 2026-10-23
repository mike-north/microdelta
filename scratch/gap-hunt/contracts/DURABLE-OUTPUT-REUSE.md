# Input-bound explicit output evidence cannot be revalidated after restart

Implementer: Codex worker (gpt-6.1-sol), operating for Mike North.

Status: confirmed conservative forced execution; supervisor classification pending.
No false value/reuse or lost history is claimed. No production change is included.

A memo returning `{ value: inputs.config.selected }` correctly records MDS1
`materialized-output` evidence at `inputs/config/selected`. A new process with
identical inputs nevertheless publishes a new result. Its miss is `unavailable
materialized-output at inputs`. Changing only an unread sibling also republishes.
The scalar-only same-input control reuses the exact original result.

The component Tracking output-current suite passes eight rows: its current-fact
provider supplies the selected raw subtree, so MDS1 comparison distinguishes
shape/order/presence/prototype changes while preserving equal shape. In contrast,
`packages/resolution/src/current.ts` ownFactProvider accepts only `selected`
requests for input, argument and member bindings and falls through to unavailable
for input-bound explicit output. This is the independently identified cause.
Only input-bound output has been executed here; argument/member effects remain
unproved and should not be claimed from source resemblance alone.

## Governing delivered boundaries

- TRK-5 `tracking.md:55–78`: actual returned output values/references are consumed;
  unrelated reachable but unreturned values are not added.
- TRK-8 `tracking.md:94–98`: returned tracked input is ordinary consumption.
- M3 selected-read decision `tracking.md:196–213`: existing explicit-output
  observations are retained and explicit selected subtree output records MDS1.
- REUSE-001 `execution.md:143–153`: eligibility is established from current
  bindings and observed inputs. This does not by itself establish a universal
  mandate to reuse every eligible candidate; the supervisor must classify this
  delivered-path precision/optimization gap before filing it as a bug.

## Proposed pickup acceptance criteria, if classified in scope

1. Identical supported declared-input subtree output reuses its exact original
   result after complete process exit without running/publishing the memo again.
2. Editing an unread sibling preserves that same exact result.
3. Changed returned leaf, record insertion order, missing/present undefined,
   sparse hole/present undefined, inherited data and inherited/own ownership
   produce the same MDS1 snapshot as independent cold-current computation.
4. Rollback to the original supported input reuses the original exact result.
5. Current output selection resolves only the recorded subtree/address under the
   current binding; do not substitute a stored stale value or widen to whole input.
6. Preserve visible rejection for unsupported Value data, correspondence/scope
   checks and component materialization evidence. Scalar-only controls still reuse.
7. Strict compiler and type-aware lint pass; retain red expectations until fixed.

## Reproduction

From a repository checkout with Node>=20 and npm:

```sh
node scratch/gap-hunt/contracts/reproduce.mjs durable-output
```

The script installs pinned dependencies and builds declarations before compiling
and running the fixture. Current result: **8 red/1 green**. The component suite
is `reproduce.mjs output` and passes8/8. The script's new durable-output mode has
not itself been run through installation again; the exact underlying compile/Jest
command was executed, and core strict compiler/type-aware lint both pass.

`durable-output-results.log` records the red assertions;
`durable-output-misses.log` records exact observations and miss reasons from three
independent processes. The matrix uses eight warm/cold transitions plus a scalar
control. Early expected failures prevent some rollback processes; do not claim all
planned subprocesses or all assertions executed successfully.
