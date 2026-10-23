# Intrinsic presence overrejection: pickup-ready issue contract

Implementer: Codex worker (gpt-6.1-sol), operating for Mike North.

No issue filed by this worker. Supervisor independently reproduced and confirmed
the contract divergence. This is visible rejection, not false reuse and not the
nullable-container cause in #155.

The minimal fixture is
`packages/tracking/test/gap-hunt-contracts-intrinsic-presence.test.ts`.
Ordinary supported `{}` with Property `constructor`, `__proto__`, `toString` or
`hasOwnProperty` rejects both an own-presence observation and a lookup-membership
observation as `intrinsic inherited data`. A tracked `'constructor' in input`
rejects too. Current focused result: nine intentionally red presence assertions,
two passing controls (selected intrinsic *value* rejection; supported own data and
custom plain-data prototype shadowing).

Exact governing citations:

- `docs/spec/tracking.md:55–56`: TRK-5 observes the operation performed; its table
  is normative JavaScript semantics.
- `docs/spec/tracking.md:63`: an own-property check consumes whether this object
  owns that key, **not inherited existence or sibling keys**.
- `docs/spec/tracking.md:64`: inherited membership consumes presence along the
  supported lookup chain, **not the value at that key**.
- `docs/spec/tracking.md:76–78`: own/inherited distinctions are required where
  supported; unsupported prototype domains must be rejected clearly.
- `docs/spec/tracking.md:135–141`: supported plain-data prototype chains may end
  in null or **Object.prototype**; **selected intrinsic prototype member values**
  are rejected. The repro requests boolean presence, not those values.

Source cause: `packages/value/src/value.ts` `observeAt` calls `lookupValidated`
for all property operations before selecting the `own`/`membership` boolean.
`lookupValidated` rejects intrinsic names even when no value is consumed. This
couples presence support to the intrinsic selected-value restriction. It differs
from #155's omitted container evidence and warrants separate owner review.

One clean-checkout Linux invocation (Node >=20/npm, no other prestep):

```sh
node scratch/gap-hunt/contracts/reproduce.mjs intrinsic
```

The script installs pinned dependencies, builds all generated declarations,
compiles the focused tests and runs only this suite. It returns the actual nonzero
red-suite status. The addendum's pushed branch is `gap-hunt-contracts`; exact
checkout revision is printed before work begins. A fixed reproduction revision
will be recorded with the handoff commit.

## Proposed issue title

Own/inherited presence checks on supported plain records reject intrinsic names by selecting their values

## Numbered acceptance criteria

1. For a supported ordinary `{}`, own-presence of `constructor`, `__proto__`,
   `toString`, and `hasOwnProperty` returns false; inherited membership returns
   true. Both operations record only their boolean semantic fact and structured
   address, without evaluating or encoding the intrinsic member's value.
2. Ordinary tracked `'constructor' in input` succeeds and records one membership
   observation. The owning explicit own-property helper agrees with Value's own
   observation. Do not implement membership as an own-only check.
3. Transition an own supported data property to inherited intrinsic presence:
   own-presence changes true→false, while inherited membership remains true.
   Unrelated sibling edits do not alter those facts; deletion under a null-ending
   chain produces the actual absent membership result.
4. Selected intrinsic **value** reads continue to reject explicitly; this issue
   must not add native function/accessor data support. Preserve rejection of user
   accessors without invoking them, unsupported class/native prototypes, and
   prototype-depth violations. Preserve supported custom plain-data prototypes
   and own-data shadowing of intrinsic names.
5. Assertions cover Value and Tracking, include positive/negative controls,
   and pass strict TypeScript and type-aware lint. Add current-fact comparison
   or assembled durable acceptance coverage so this is not merely a direct lookup
   special case. No discarded or fabricated dependency fact is acceptable.

Scope: operation-specific presence semantics within the already selected supported
plain-data prototype domain. Out of scope: #155 container evidence, arbitrary
prototype/native data support, native reflection as an alternative observation
API, provider work or publication. No design-policy expansion is required.

Reproduction expected today: nine red assertions, two green controls. The script
returns that failure status. The parent supervisor independently reproduced the
same result and confirmed the contract divergence; issue creation remains theirs.

Fixed reproduction revision: `9267a44e1a203966e6ccd73db188e5826506326b` on branch `gap-hunt-contracts`.
The script and all required fixture modules are present in that commit.
