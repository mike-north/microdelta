# Bounded private-alpha facade traversal evidence (#315)

**Observed result:** the first and only released facade proof passed on
`a52ed40c0e0085517738f4ec722de2ba203bbd09` on 2026-10-30. Outer exit was 0;
Jest reported one suite/one test passed. Independent receipt review returned
PASS and root accepted the bounded local behavior. Protected PR checks,
Copilot/supervisory acceptance and exact-main integration were outstanding at
this evidence checkpoint; [PR #316](https://github.com/mike-north/microdelta/pull/316)
tracks current acceptance. This is the
[staged #315 capability](../plans/within-person-bounded-traversal-delivery.md),
not full #301/GREEN, WPD-1–11, report, M6/M7 or scale acceptance.

## Source, release and exact invocation

Final `npm run check`, `npm test` and `npm run build` passed on that source before
execution. Independent runtime/extraction/generation and fixture source reviews
were accepted. Root rechecked the frozen source/emissions and generated alpha
contracts, then released exactly one invocation at 17:43:39 UTC. No rerun is
needed or authorized by this record.

From `/Users/mnorth/.codex/worktrees/bounded-traversal-delivery/perdure`:

```sh
MICRODELTA_SLICE_EVIDENCE=/private/tmp/microdelta-315-facade-proof-1 exec /opt/homebrew/bin/gtimeout --signal=KILL 40s /Users/mnorth/.nodenv/versions/24.14.0/bin/node --experimental-vm-modules node_modules/jest/bin/jest.js --config fixtures/within-person-slice/jest.config.mjs --runInBand
```

GNU gtimeout 9.11 provided the independent whole-invocation cutoff, including
synchronous parent History work. Node was 24.14.0; there was no npm/build/version
shim inside this invocation. The proof used the generated facade, real durable
History/Accounting owners and controlled operations, with no live/paid provider.

## Consumer outcome and causal evidence

Sequences below are local to each worker, not a clock shared across processes.
The parent awaited each actual child `close` before independent exact readback
or recovery. Failure PID 14483 and recovery PID 14484 each closed with code 0 and
no signal, with one actual run/traversal each, closed owners, zero in-flight work,
no diagnostics/interruptions and no cleanup/resource faults.

| Failure worker | Actual sequence / result |
| --- | --- |
| Root and held later page | Root send 5; page-two send 20 and actual hold 21 |
| Useful A work while held | A discussion/detail/assessment sends 40/52/58; committed A publication 63; definite-failure release 64 |
| Truthful terminal | 5 sends total, peak 2 concurrent; `discovery-failed`, soft stop, no summary and zero strict admission/body/publication |
| Post-close parent readback | Exact A `id` and `statement` assertions passed before recovery launch |

Recovery received only the durable directory and fixed mode/configuration in an
empty child environment. It rebuilt authoring and began at the root, with a fresh
caller request key and stable page/member subjects and operation binding.

| Recovery worker | Actual sequence / result |
| --- | --- |
| Fresh discovery | Root send 6; page-two send 21/hold 22; open frontier publication 30 |
| Current A under open frontier | Actual discussion/detail sends 39/52 precede exact A acceptance 58; page release 59 |
| New certified closure | Adapter closure 64; closed frontier publication 72 |
| Current A under closed frontier | Actual discussion/detail sends 95/120 precede exact A acceptance 130 |
| B and strict summary | B assessment publishes 136; strict admission/body/publication 139/143/145, after closure, final A acceptance and B publication |
| Required counts | Exactly 9 sends, peak 2 concurrent; zero A assessment body/send, one B assessment body/send, one strict summary with A+B |

Both recovery acceptances retain the failure worker's exact A reference:

```text
mdh1|["store:within-person-fixed","within-person:fixture-person-1","env:within-person-fixed",4]
```

Parent exact readback after both closes confirmed `id = fixture/repo#101` and
`statement = discussion:fixture/repo#101:content-v1|detail:fixture/repo#101:content-v1`.
The selected failed page retained operation
`op-10e1f3880dde8c1cac0d989f885bf5af` and binding
`sha256:a274421dcf0d96dc521bca907f43d11a1958c675dd5bcb033fed2492565f97ab`.
Its first attempt stayed failed, permanently classified with `maxAttempts=1`,
acknowledged usage, provider code `fixture-page2-refused`, and unchanged complete
attempt digest `01b628c403e4b7514d8d7d1751abc6471118451d2cd621d60d67c135ce4ea18b`.
Recovery added a second succeeded attempt under a different run/run-instance;
it did not clear or replace the historical attempt. The operation ended succeeded.

## Finite allowance and observations

The approved topology was one independent timeout supervisor, one Jest parent
and at most one live worker, with exactly two sequential workers/runs/traversals.
Limits were 5+9 controlled sends, 2 concurrent sends per worker, child
live/kill/terminal bounds 12/15/16 seconds, 40 seconds whole invocation, 512 MiB
sampled child RSS, 64 MiB combined stores/sidecars and 8 MiB retained evidence.
Each spawn required a full remaining 16-second terminal allowance.

Parent scenario elapsed time was 227 ms, Jest reported 0.302 s and the outer
command receipt measured 0.405081667 s; these are distinct measurement scopes.
Child-close intervals were 95/113 ms. Largest sampled child RSS was 76,431,360 B;
largest live combined-store sample was 2,412,344 B. Root's final post-close
inventory records 503,808 B of stores/sidecars and 69,746 B of non-store evidence.
The parent receipt's 69,731 B is an earlier pre-finalization measurement including
a directory stat, not the final retained-file sum. Sampling is not continuous-peak
or scale certification; this short successful run did not exercise timeout/kill paths.

## Retained evidence and hashes

Raw evidence remains unmodified at `/private/tmp/microdelta-315-facade-proof-1`.
The release is `/private/tmp/microdelta-315-proof-release-1.md`; outer exit is
`/private/tmp/microdelta-315-proof-run-1.json`; root's post-close inventory is
`/private/tmp/microdelta-315-proof-evidence-manifest.json`. This documentation
adds no proof invocation, native read or raw-artifact rewrite.

| Artifact | SHA-256 |
| --- | --- |
| `failure.stdout.json` | `99ae622e0092a02a118b86918a6d1c247948b183248db304b2ef4c0c040be056` |
| `recovery.stdout.json` | `6ed6738399f45e32be3287a9e0a30207fb9a7c743767f74e4400fd960abfce35` |
| `parent.json` | `c58d54fe20ba1d1ca324de18b62e20851bccd2152690b82eead4f7f69db8c74a` |
| `failure.close.json` | `f2045ca7f3c2ff3372654e437c45b403d8399e103b793cf005301513e2055c54` |
| `recovery.close.json` | `5a38ce9587a7ec52ff7f3d452a7e655e42cf51ea8cfd5101091a60f76e5c14c1` |
| Outer command receipt | `50a4b07a879fea0b248d443379d63fb87d9d27d4b9bb3c54343c62b408ce85b3` |
| Frozen 11-file fixture source/emission manifest | `7bcca8c5754f2da588d4082c4c71a120f620fee7497236890dc9650aa38fe945` |
| Frozen 24-file alpha/config/export manifest | `0a3325d9845d56b381f05e006b0a4b401d2ec89e366a743ef29e27d0de537339` |

Independent receipt review is retained at
`/private/tmp/microdelta-315-proof-evidence-review.md`; it evaluated saved
JSON/text, hashes and size metadata and made no additional native read.

The two frozen manifest files are retained at
`/private/tmp/microdelta-315-final-fixture-sha256.txt` and
`/private/tmp/microdelta-315-fixture-review-dependencies/sha256.txt`.
