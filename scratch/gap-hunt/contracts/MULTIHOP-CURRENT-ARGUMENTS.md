# Multi-hop current argument and provenance oracle

Implementer: Codex worker (gpt-6.1-sol), operating for Mike North.

One passing scenario uses eight independent processes and three SQLite stores.
It authors the production generated alpha facade: root memo -> outer memo ->
listing source, normalize supplied step, then score supplied step. The outer call
order is fixed. Normalize receives a profile forwarded from the listing result;
score receives a payload forwarded from normalize's output and a string subject
transformed from normalize's selected name. All emitted output is newly built
plain data; this avoids #164's returned-tracked-subtree path. Guards do not test
container truthiness, avoiding #155.

Executed assertions:

1. Cold Ada produces score3. Listing and normalize publish exact results;
   original root/outer historical dependencies are saved.
2. New listing revision/unread data and new normalize decoration produce new exact
   earlier-child results, while selected name and score remain equal. Only listing
   and normalize bodies run. Both parents retain their original exact results.
   Outer current acceptance names the new listing/normalize results and the old
   eligible score. Its original dependencies still name the cold exact results.
3. Ada->Eve changes the transformed derived subject but preserves score3. The
   current Eve child runs; outer republishes; root retains its original result
   and its current acceptance names the new outer result. Root historical
   dependencies remain unchanged. Data matches an independent cold Eve store.
4. Eve->Grace changes score to5. Current Grace child and both parent bodies run;
   data matches an independent cold Grace store, and the root publishes.
5. A later unread profile edit/new source revision runs only listing. Normalize,
   outer and root retain their eligible exact results.
6. Rollback to the initial input runs only listing. The original root and outer
   work become eligible again. Original outer provenance remains unchanged; its
   new acceptance names the current listing and original normalize/Ada results.

Governing clauses: CMP-7 argument recipe and recorded call-order validation,
TRK-6 current paths vs historical provenance, REUSE-005 selected child output
cutoff, REUSE-006 current/justified argument reconstruction, RES-007 separately
recorded acceptance. The assertion observes author bodies, exact candidates,
immutable dependencies, current acceptance dependencies and cold-current values.
No false reuse or new defect was found in this bounded chain.

Reproduce (install/build included):

```sh
node scratch/gap-hunt/contracts/reproduce.mjs multihop
```

The exact compile/Jest command and core strict TypeScript/type-aware lint ran
successfully; the new script mode has not yet been separately exercised through
installation. See `multihop-results.log` and `multihop-check.log`.

## Remaining assertions versus owner questions

Concrete unproved assertions: more than two supplied calls, multiple forwarded
arguments with different earlier-child origins, array-position origins after
reorder, a nested path whose intermediate container changes kind, and concurrent
independent parent resolutions with overlapping call slots. These are variations
of delivered recipes; this single scenario does not certify all of them. Current
fixtures elsewhere cover some independently; their combination is not inferred.

This probe creates no new owner design question. Unsupported closure capture,
serialized function arguments and dynamic topology remain outside its contract;
the existing unjustified/unreconstructible/missing/ambiguous tests already require
honest parent misses. Classifying the known #164 forced-rerun gap is separate from
whether this supported scalar-selected argument chain is sound.

## Platform evidence boundary

The owner's `.worktrees/linux-parity-results.md` records all eight isolated
installs/builds passing on Linux aarch64 with Node24.13.0 and26.12.1. It reproduced
known contracts failures at43444bb; that old revision does not include this
scenario or #164. Main's full npm test passed on both versions. This new scenario
has only been executed locally on Node24.22.1; no Linux parity is inferred.
