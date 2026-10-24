# Combined input identity consumption across durable reuse

Authority/runtime: `7a629f94d83366131e4aa25e541a24e41db744fa`. Executed clean archive source: `00ad762` (full pin in manifest). No product code, API, publication or provider execution changed.

TRK-7 permits consuming several input identities without defining the output identity. The author designates each input record's `id` field as identity, reads both explicitly inside one memo, and chooses the independent output key `output:fixed` and complete subject `combined:fixed-subject`. No experimental identity brand or helper is invented. The memo subject is fixed by the unchanged author declaration, not derived from either input ID. The assertion verifies output data and exact references; it does not inspect private History rows to infer subjects.

| Fresh process | Changed input | Actual bodies | Result | Exact reference |
| --- | --- | --- | --- | --- |
| 1 | Cold | 1 | first:a / second:a; key output:fixed | New A |
| 2 | None | 0 | first:a / second:a; key output:fixed | A retained |
| 3 | Both unread content fields | 0 | first:a / second:a; key output:fixed | A retained |
| 4 | First consumed id | 1 | first:b / second:a; key output:fixed | New B |
| 5 | Second consumed id | 1 | first:b / second:b; key output:fixed | New C |
| 6 | None | 0 | first:b / second:b; key output:fixed | C retained |

The single Jest assertion `two consumed input identities invalidate independently while the explicit output identity and memo subject stay fixed across six fresh processes` checks every process exit, observed body marker, complete output fields, publication/reuse kind, each reference equality/inequality and exactly three references. `reproduce.py` independently verifies the capture matrix before returning success. Malformed worker output is narrowed and rejected rather than cast.

Reproduction from a checkout of this evidence commit using Node24/npm:

```sh
python3 scratch/gap-hunt/identity-combination/reproduce.py
```

The command installs the lockfile, builds generated package declarations, runs strict Core typechecking, type-aware lint of both new fixtures, then the one named Jest test. All stages passed in a disposable clean archive on Darwin, Node24.22.1. Production source remains frozen7a. This measures one supported record-valued memo and six process exits, not arbitrary identity brands, universal closure safety, a collision guarantee or full roster scale. There is no product fix and therefore no test-first product implementation chronology claim; the existing supported outcome passed directly.

Output uniqueness remains an explicit keyed-collection responsibility, not a side effect of reading IDs. Separate prior proof is `packages/core/test/m4-acceptance/keyed.test.ts:188` (duplicate/missing designated-key table): duplicate `person:ben` rejects discovery, names the key/custom-key option, admits no member/report work and a corrected listing reconnects the members. This is the COL-1 gate and is not a claim that the new memo automatically validates keyed output collections. Its exact passed assertion is #229 in the owner audit at `8cdb4d95d9d37987e98976b7ca8da1d18d727684`, `scratch/gap-hunt/contract-operations/execution.log`: `duplicate-and-missing-identity a duplicate designated key rejects discovery with a diagnostic naming the collection and key and pointing to the custom key; no member work is admitted, and a corrected listing reconnects every member`. This named assertion's semantics, rather than a related COL-1 ledger row, establish the gate. No duplicate-key suite was rerun for this matrix.

Captures normalize temporary checkout/output/home paths; manifest retains raw and normalized hashes. Test and worker hashes equal the executed clean archive bytes. Green install/build/lint/type logs are limited to this recipe, not a full CI/default-branch rerun.
