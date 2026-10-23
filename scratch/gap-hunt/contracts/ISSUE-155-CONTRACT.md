# #155 contract addendum: tracked container guards

Implementer: Codex worker (gpt-6.1-sol), operating for Mike North.

Priority: highest correctness queue priority. A retained result can be observably
wrong under ordinary declared tracked input; no hidden capture is needed.

## Governing clauses

- `docs/spec/tracking.md:41–50` TRK-4: every influence intended to affect reuse,
  **including branch selection**, must be tracked or covered by explicit policy.
- `docs/spec/tracking.md:55–64` TRK-5: observe the operation performed; the guard
  consumes its actual value, not merely its coercion result.
- `docs/spec/tracking.md:94–98` TRK-8: a changed tracked guard invalidates the prior
  execution as required, then a fresh frame records the newly taken branch.
- `docs/spec/tracking.md:196–202`: container navigation alone does not record a
  whole-object dependency. This precision requirement does not authorize losing
  branch-changing container/null/undefined facts.
- `docs/spec/composition.md:164–169` CMP-9: arbitrary JavaScript is not sandboxed.
  That disclaimer does not remove the tracked declared-input obligations above.

## Numbered acceptance criteria

1. A normal memo reading `inputs.config.detail ? 'present' : 'absent'` produces the
   correct current value after a record becomes null or an absent property, across
   complete process shutdown. The second result must agree with a separate cold
   current computation. It must never reuse the earlier `present` result.
2. Cover explicit `detail !== null`, `typeof detail` when its result changes, and
   a nullish fallback branch. Record→null, record→missing and reverse transitions
   must be independently tested. Missing and present undefined remain equivalent
   for an ordinary value read under TRK-5.
3. A scalar boolean guard remains a passing control. Nested optional leaf reads
   and record→record replacement with equal consumed leaf values must preserve
   their existing precision and detect later changed current leaves.
4. After a branch changes, current evidence excludes abandoned branch reads.
   Unread sibling/identity edits must not become whole-object dependencies.
5. Add both observer-level operation assertions and assembled durable memo
   assertions using two independent processes, stable declarations, and only
   supported declared input snapshots. A reopened handle alone is insufficient
   process-isolation evidence.
6. The focused strict TypeScript and type-aware lint checks pass. Any unsupported
   builtin diagnostic probes remain explicitly labelled; in particular the
   adversarial `Array.isArray` extension is outside the current documented builtin
   lint allowlist and is not required to expand that allowlist in this issue.

## Scope, exclusions, dependencies

Scope: semantic evidence for supported container/scalar transitions used by ordinary
tracked consumers, and preservation of selected-path precision. No representation
or patch is prescribed. A conservative shape dependency may be acceptable if it
preserves the stated no-whole-payload contract; review that choice explicitly.

Out of scope: arbitrary untracked closure soundness, native reflection support,
new host implementations, package publication, scalar result-root support (#156),
and builtin allowlist expansion. Intrinsic presence overrejection is a separate
candidate root cause, not this issue.

Dependencies: no prerequisite issue is required to reproduce or characterize this
failure. Coordinate with Tracking's no-whole-object navigation invariant and
Resolution's current-fact reconstruction; do not weaken either to silence a test.

## One clean-checkout Linux reproduction command

Run from a clean checkout of branch `gap-hunt-contracts` with Node >=20 and npm installed. The fixed script revision is recorded in the handoff; the script prints the exact checkout revision before installing pinned dependencies and building all generated declarations:

```sh
node scratch/gap-hunt/contracts/reproduce.mjs 155
```

Expected current result: four intentionally failing container guard assertions,
one passing scalar control. `packages/core/test/gap-hunt-contracts-guard-worker.ts`
is part of the same commit and supplies the independent-process reproduction.
No paid provider or external service is involved. The broader operation oracle is
`gap-hunt-contracts-operation-matrix.test.ts` (six red, seven green).

Fixed reproduction revision: `9267a44e1a203966e6ccd73db188e5826506326b` on branch `gap-hunt-contracts`.
The script and all required fixture modules are present in that commit.
