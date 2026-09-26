> Historical artifact. Superseded by the [active specification](../../../spec/README.md). Do not implement from this document.

# Incremental analysis — deep-design output

Rev 9, 2026-09-12. Supersedes all earlier revisions in full. Output of a conceptual-architecture session; sits **upstream** of any spec. A companion, `analysis-explorer-viewer-sketch.md`, describes a consumer of this library and changes nothing in it. Supersedes `incremental-graph-library-requirements.md` and `two-graphs-model.md` where they conflict (§13). Implementation is out of scope.

Layer tags: [reality] = true regardless of design; [core] = the library; [built] = built on top of the library; [mechanism] = one realization that satisfies a contract, *not* a commitment; [authoring] = discipline for analysis authors; [product] = what it is for; [open] = undecided.

### Vocabulary

- **Step** — a function. Two of its properties are independent of each other: whether it is **named**, and whether it is **memoized**. A name is read from the declared function or class; the author supplies a string only for something that has no name of its own.
- **Memoized step** — a step the author wraps so the library stores its results. Durable memoization, tolerant of nondeterminism, with retained generations. Memoization *requires* a durable name and a revision, because stored results are keyed by them across processes and code changes. Wrapping something with no derivable name is an error at wrap time.
- **Pinned input** — a value the author holds fixed until they deliberately bump it, in the lock-file sense: a prompt version, a model name, a re-roll counter, a rubric. Bumping it is a nameable cause of re-execution. Whether a pinned value has an identity is a separate question.
- **Unmemoized code** — everything that is not memoized. Ordinary TypeScript; runs every time; its reads are tracked. It may contain named steps. Nothing else about it differs from memoized code.
- **Identity** — what a value *is*, as distinct from what it currently *contains*. A PR's URL, not its diff. Declared once per type; applied by whatever produces the value; derived for everything downstream. Orthogonal to memoization.
- **Subject** — a memoized step's name plus the identities of the identified values it was given. The key under which its results are found and its executions are claimed. The one place memoization uses identity.
- **Claim** — a result row that exists before its output does: someone is executing this subject. Carries a lease, and the last progress value reported by whoever holds it.
- **Abandoned attempt** — a result row whose execution ended without an output: an error, a refusal, or a lease that expired.

---

## 0. Changes since rev 7

### 0.1 Rev 9 — two confirmations and one check

**The thesis sentence was re-checked** against the landed design and revised to name identity and exploration (§1); the prior form is retained beneath it.

**Naming is settled.** A step's name is read from the declared function or class the author already wrote; no string is required. An explicit override exists for the anonymous case. On the unmemoized side a bad or missing name is cosmetic — it labels tracing and identity paths. On the memoized side the name is the storage key, so inference from anything unstable (source position, a hash of the body) is refused: **memoizing something with no derivable name throws at wrap time**, because an invented key changes under an unrelated edit and silently orphans every stored result. A lint rule catches it before anything runs; the ecosystem's named-function-expressions rules already do this for stack-trace reasons, so the library ships none. Rev 8's OQ8 is closed by this; the literal wrapper surface remains phase-10.

**Autotracking was checked against persistence** (§2.7). Nothing from the tag half of autotracking persists; the trace does. Values are immutable; change is a new generation under a stable identity. Within one run the tag machinery does the small job it does in a server-side render — memoizing derivations within a pass — and it is kept anyway because it pays at the consumer boundary, where interactive state gets built on top of results.

**A viewer was thought through and changed nothing in core.** It lives in the companion sketch. It did confirm three mechanisms in a context they were not designed for: a claim is a wait whether a worker or a human is on the other end; the two grains are what express blocking versus streaming; progress reported for lease renewal is an honest loading indicator. Evidence, not features.

### 0.2 Rev 8 — audit of rev 7 under the axis principle

The principle, now in the deep-design skill: **name the dimension a rule lives on before attaching it to a split.** Memoized versus unmemoized is a split on exactly one dimension — whether results are stored and verified. Any rule attached to that split that is not about storage or invalidation is on the wrong axis, and it will look correct as long as the examples happen to carry both properties.

Rev 7 was scanned for every rule qualified by "memoized" or "unmemoized." Most were legitimately about storage or invalidation and stand. Five were not.

1. **Identity derivation had two rules keyed on memoization.** Rev 7 §2.1 said a value derived by unmemoized code composes identity from what it read, while the output of a memoized step gets `step name + subject`. Same dimension — what a value is — split by an unrelated property. Replaced by one rule (§2.1): a type's declared identity function if there is one; otherwise the producing step's name plus the identities it consumed; otherwise, for unnamed code, the identities consumed. Memoization does not appear in it.
2. **Both of rev 7's open confirmations dissolve as consequences.** *OQ1* — the rubric parsed from disk is produced by a step that declares its output type's identity; whether that step is memoized was never relevant. *OQ2* — two reshapes of one PR fed to one step share a subject because the reshapes are *unnamed*, not because they are unmemoized; the fix is to name the reshape. Rev 7's proposed fix, "memoize the reshape," was the axis error in action: adding storage in order to obtain a name.
3. **Naming and memoizing are independent properties of a step.** Memoization requires a durable name (storage needs a key that survives the process); naming requires nothing. A named unmemoized step is an ordinary function with a label the library can see. The vocabulary bucket "unmemoized code" stays as a bucket; the only rule attached to it is "runs every time; no store."
4. **"Pinned inputs are unidentified on purpose" was wrong.** Pinning is about *who* changes a value and *when*; identity is about whether it has a stable concept. A rubric is both pinned and identified, and bumping it works exactly as bumping a model version does: the content changes under an unchanged identity, verification catches it, the old generation is superseded and priced. What forks a subject is passing a *different identity*, not passing an identified value. The pattern *identity forks; content bumps* survives; its justification is corrected in §2.1, §4, §7. The graveyard entry "identity on every value by default" was really "content as the subject" and is merged into it.
5. **The middleware stack was attached to memoized steps only**, which contradicted §8: tracing that says "this step took four seconds, consider memoizing" has to observe unmemoized steps. Observation is orthogonal to storage. Corrected in §2.6: the stack wraps any named step; the library's reserved block exists only where there is a store; the *around* region exists everywhere; the *gate* region exists only where there can be a miss.

Two smaller precision fixes fell out of the same scan. A fan-out's output collection now has a stated identity — the member step's name once, at collection grain, plus the source collection's identity — which is what the reducer closes over (§2.5). And verification of a recorded read of an *in-memory* value compares fingerprints, so the memoized wrapper fingerprints in-memory reads at record time; revision tags do not survive the process (§2.4). "No hashing" in unmemoized tracking stands — this is value fingerprinting at the boundary, not source hashing.

**Status of the rev-7 findings after scrutiny:** (1) subject is identity — holds. (2) identity is declared per type for stable concepts; unidentified values are content — the rule holds, the framing that tied it to memoization is withdrawn. (3) the identity path follows dataflow — holds, and now applies uniformly. (4) the reducer closes the bracket — holds, made precise. (5) the claim-grain caveat dissolves — holds. (6) progress-gated renewal — holds; on the concurrency axis, untouched. (7) middleware with reserved positions — holds; scope corrected. (8) gate after verification — holds. (9) three concepts — holds, with *step* now carrying two explicitly independent properties. (10) two edges to confirm — both dissolved; nothing remains open at the conceptual level.

---

## 1. The thesis

**Pull-based autotracking over durably identified results, where the author decides — per function — whether it recalculates every time or is stored, so that an analysis stays current at minimum cost, and can be explored.**

That sentence is the whole library. Nondeterminism, cost classes, re-roll, freshness, fan-out, fan-in, services, subjects, runs, workers — all things an author builds with it.

Re-checked at the end of the session (rev 9) against where the design landed. The previous form — *pull-based autotracking as data binding to potentially memoizable steps, where the author decides per function whether it recalculates every time or has its results stored* — did the work through every collapse pass and is kept here for that reason. It under-sold two things that arrived later: **identity** (results have addresses that survive content change, which is what buys retention, pricing, explanation, and convergence — not a detail inside "memoizable"), and **exploration** (an interactive consumer needs nothing added; see the companion sketch). "Durably" carries the cross-process point that the tag half of autotracking cannot.

### The problem it exists for

Keeping an analysis current as its inputs change, at minimum cost of whatever the author has declared expensive. Mike's organizing statement, verbatim: *"You should be able to set up an analysis pipeline that operates on data which may change, and you should be able to do only as much work and spend only as many LLM tokens as is necessary in order to respond to input changes by producing an updated analysis."*

- **PS1** — Re-running costs as much as the first run. Thread B: ~150k PRs, ~30 min of rate-limited fetching, ~$5–6k in agentic leaves per pass. [reality]
- **PS2** — Nondeterministic judgments have no stable home. [reality]
- **PS3** — When a result changes, nobody can say what caused it or what it changed from. [reality]
- **PS4** — Existing incremental systems re-run to discover whether a re-run was needed; here the leaf is what you cannot run to find out. [reality]
- **PS5** — Systems that know dataflow precisely tend to need a compiler or a custom runner. [reality]
- **PS6** — Analyses over data that cannot fit in memory force authors to hand-write down-projections, which shifts the cost to garbage collection and breaks the moment two consumers need different fields. [reality]

### Use-case agnosticism [product]

The library does not know what is expensive, slow, or large. It protects whatever the author memoizes, materializes whatever the author reads, and stays neutral on everything else. This is a commitment with a price: it cannot assume CPU is free, and so it owes an answer for CPU-bound work (§6).

**Facts about the driving consumers, not about the library** [reality]: for threads A and B the scarce resource is inference spend; CPU, storage, and disk IO are free; wall clock is a deadline, never a target. Explainability is a standing constraint that costs the other goals nothing. A provider call that is billed and never returns is an accepted cost of the provider relationship, not a fault the analysis is expected to recover.

### The two regimes [reality]

The same abstraction must serve both without the author choosing a mode:

| Regime | Example | What matters | What doesn't |
|---|---|---|---|
| **Expensive and small** | $100 agentic judgment, a few KB | Retention, re-roll, explanation, never running twice | Access cost, storage cost |
| **Cheap and enormous** | 150k PR payloads with reviews and comments | Access pattern, memory footprint, locality | Per-result retention |

---

## 2. The core [core]

Three concepts. Nothing else is a framework object.

### 2.1 Tracked values — three coordinates, two grains, backed by storage

Every tracked value carries three things:

| Coordinate | What it answers | Who sets it | Changes when |
|---|---|---|---|
| **Revision tag** | has anything I depend on moved, in-process | the tracking layer | any read it composes from changes |
| **Content fingerprint** | what does this contain, durably, per field | the store at write; the memoized wrapper at record, for in-memory reads | the content changes |
| **Identity** | what *is* this, regardless of content | declared once per type; applied by the producer; derived downstream | never, for a stable concept |

Reads entangle: whatever is read inside a tracking frame becomes a dependency of that frame. Derived values compose the tags — and the identities — of what they were derived from.

**Every value is trackable at two grains simultaneously, and this is load-bearing:**

| Grain | What you bind to | Sensitive to |
|---|---|---|
| **Whole** | the value itself — the array, the object | replacement; for collections, length and membership |
| **Member** | a member — `pages[3]`, `pr.createdAt` | that member's content only |

Field names and indices are addressing, not data. Passing `obj` makes the callee sensitive to `obj`'s shape; passing `obj.body` makes it sensitive to the body. **Member-grain tracking is what makes fan-out exist.**

**A value is a query, not an object.** The output of a memoized step is written to the store with a fingerprint per field, recursively. Downstream code receives an addressable value whose fields resolve on read. `pr.createdAt` is a lookup, not a materialization. Ten steps reading ten different fields of the same record do ten cheap reads; the payload is never reified.

Two kinds of tracked value coexist: **storage-backed** (outputs of memoized steps; lazy, per-field fingerprints in the store) and **in-memory** (created by unmemoized code). Both track. Only storage-backed values are lazy. This is a split on the storage axis and it is the only thing the split governs.

**Identity — one rule, on its own axis:**

- A type may declare an **identity function** — the canonical, stable name of a value of that type: a PR's `host/org/repo/number`, a page's path, a rubric's name. Declared once. Whatever step produces a value of that type applies it, memoized or not; the type system relates a step's output type to the function, so two steps cannot disagree about what a PR is.
- A value whose type declares **no** identity function has no identity of its own. It is content, verified by read. A model version string is the canonical case: there is no concept of "the same version string after an edit." Types with no stable concept declare nothing.
- An **unidentified member** of an identified value (`pr.title` passed on its own) inherits its parent's identity plus its path. Field names are addressing here too.
- A value produced by a **named step**, of a type with no identity function, has identity `step name + identities of what the step consumed`. Recursively, a path (§2.5). A memoized step's output is this case: the identities it consumed are exactly its subject.
- A value produced by **unnamed code** composes identity from what was read to derive it, as it composes tags. A reshape of a PR still *is* that PR. To tell two reshapes apart, declare the second as a function — its name is its name, and no store is involved.

**Pinned inputs are ordinary tracked values.** What makes them "pinned" is the author's discipline; what makes a bump explainable is that it is a tracked read like any other; what makes it *priceable* is that a bump changes content under an unchanged identity — true whether the pinned value is a bare string or an identified rubric.

### 2.2 The persistence boundary — a memoized step

A step the author wraps because they want its results stored. It has a **durable name** and an **explicit revision** — both required by storage, not by anything else: results are keyed by them across processes and code changes, and the revision is how a body change invalidates without source hashing. The name is read from the declared function or class, as for any step; where nothing wrapped has a derivable name, wrapping fails at that moment rather than inventing a key. Its output type may carry an identity function, applied here as by any producer. Its only extension point is the **middleware stack** (§2.6). Nothing else: no cost class, no nondeterminism flag, no freshness policy, no scheduler. **The library does not care what happens inside the boundary.**

This is memoization in the plain sense — cache the result by what it read — with three departures from the textbook: it is durable across processes, it tolerates nondeterminism (a memoized function may contain a random number or a model call; the stored answer is simply *the* answer until an input changes), and it retains prior generations rather than overwriting.

The library never detects what is expensive. Memoizing is opt-in. Forgetting to memoize costs money every run and is noticed quickly — the safe failure direction.

### 2.3 Results, with a subject, retention, and a lifecycle

A result belongs to a **subject**: the step's name plus the identities of the identified values it was given. A step given no identified values has a single subject — itself. The subject is stored as structure (readable in explanation) and indexed by its hash (cheap to compare, cheap to lock). The lookup key is **(step, revision, subject)**.

Under that key a result stores: **recorded reads** (path + fingerprint, at the grain read), the output (written per-field, with its derived identity), generation, start and end time, author-reported cost, and the memoized results invoked during execution. One subject may have **many generations with one current pointer.** Retention is in core because an author cannot add "keep the old answer" if the store overwrites by default. Nothing paid for is ever deleted by the library. There is no expiry: a result stays current until something proves otherwise.

**A result row has a lifecycle:**

```
claimed ──(output written)──▶ current ──(newer generation)──▶ superseded
   │
   └──(error, refusal, or lease expired)──▶ abandoned
```

A **claim** is a result row written *before* execution: this subject is being computed, by whom, until when, and — once the holder has reported any — the last progress value. An **abandoned attempt** is a row whose execution ended with no output, kept with whatever cost the author reported. Neither is a new concept; both are states of a result. Retention applies to all four states.

### 2.4 Evaluation semantics

1. Call the entry function. Unmemoized code executes under tracking — a frame push per computation, a compare per read, no hashing, no store. **Unmemoized code always executes.** That is why its code changes are free to detect and why no source hashing exists anywhere.
2. At a memoized call, the wrapper computes the subject from its arguments' identities (known now — identities travel with values), locates the current result for (name, revision, subject), and **verifies** it: for each recorded read, resolve the path in the current tracked arguments and compare fingerprints. A recorded read of a storage-backed field compares two stored fingerprints and loads nothing. A recorded read of an in-memory value requires unmemoized code to have recomputed it, and compares the fingerprint the wrapper took at record time against one taken now — the only place in-memory values are hashed. All equal → serve. Any differ, or no result → pass through the gate region of the middleware stack (§2.6) → **claim** the key (§6.5), execute the body under a fresh frame, record reads and nested memoized calls, write a new generation per-field, and the claim becomes the current result.
3. **Served outputs re-enter tracking as storage-backed values**, carrying their derived identity. Load-bearing for chains.
4. **The recorded read set is a prefetch prediction, not a contract.** A body that takes a different branch and reaches for an unfetched field falls back to a single-field read and records the new set. **A miss is never a change.** Static analysis to infer the query is rejected: it is a build step.
5. **The task is the arbiter of eligibility.** Nothing external can know whether a subtree needs work before it runs, because dependencies are discovered by reading. There is no readiness scheduler; there is no frontier.
6. A **dry run** is the same evaluation with memoized steps in check-only mode: verify, report, never claim or execute.
7. **The price of verification:** unmemoized code executes; fields it merely routes are compared by stored fingerprint; fields it transforms are loaded. Disk IO is the expected bottleneck; prefetching from the recorded read set is the lever and never changes an invalidation outcome.

### 2.5 The mechanics of fan-out and fan-in — and the identity path

**Fan-out is a loop over members.** Each call binds to the member's value, not the collection. The collection's identity (length, membership) is a separate whole-grain dependency.

**Identity is a path with brackets.** A result's identity is its step's name plus the identities it was given, recursively. A fan-out opens a bracket: each member's result is `member step + member identity`, and the fan-out's output collection is `member step + source collection identity` — the step's name appears once at collection grain, never per member. A reducer closes the bracket: its subject is the collection's identity plus its own name; the members never appear, and the path resumes where the collection left off. So identity depth is *depth within a closure plus the depth of whatever preceded that closure*: bounded by nesting, not by pipeline length. Engineer → PR → review → paragraph is four.

**The path follows dataflow, not the call stack.** A nested memoized call that reads the raw PR has the same subject it would have at the top level. That is what makes convergence collapse: two pages containing the same paragraph, two PRs referencing the same ticket, one subject, one result.

**A chain of per-member steps stays per-member.** 14,000 members, three changed, enriched by a memoized step: 13,997 verify by fingerprint, three execute.

**Fan-in is passing a collection.** A cheap reducer re-runs. An expensive reducer that reads the whole collection re-pays on any member change; there is **no framework mechanism for partially re-evaluating a single step**. Partial re-evaluation is achieved by decomposition (§7).

**Fan-out never holds the collection live.** It pulls members lazily and keeps N in flight. Peak memory is the in-flight window, not the collection.

### 2.6 The middleware stack

The extension point around a named step's execution is a stack of middleware, composed in the ordinary way — each receives the call and decides whether and how to invoke the next. Not subclassing; nothing to forget to call.

**The library owns fixed positions in the stack of a memoized step.** Its own middleware — verify, gate, claim, execute, write, release — occupies the innermost block. Those positions are *visible* when the stack is inspected, so a trace makes sense, and *immovable*: nothing can be placed between them, and nothing can remove them. The store's consistency never depends on user code running. This is the firewall-rule pattern: the built-in rules are shown so you can debug, and you do not get to put anything in front of or behind them. An unmemoized step has no reserved block, because it has no store.

**User middleware lives in named regions outside that block.** At minimum two:

| Region | Exists on | Sees | Can |
|---|---|---|---|
| **Around** — outermost | every named step | every call: served, executed, refused, failed, abandoned; duration; reported cost | observe; not affect |
| **Gate** — after verify, before claim | memoized steps only | only misses — calls that *would* execute | refuse, by not calling next |

The around region exists on unmemoized steps because observation is on a different axis from storage: tracing that says "this step took four seconds; consider memoizing" is looking at exactly the steps that have no store. The gate region exists only where a miss can occur.

A refusal in the gate region is a first-class outcome: nothing is claimed, nothing is written, the call rejects with a typed refusal, and the around region sees it. Budget stops live here. Tracing lives in the around region. The gate sits after verification for a reason worth stating: placed before it, a budget stop would refuse free cache hits along with paid executions.

A middleware that throws is contained to that call and reported; it cannot corrupt the store because the store is inside the block it sits outside of.

**Check-only mode** is core for the same reason the reserved block is: only the wrapper knows the difference between serving and executing.

### 2.7 Autotracking across processes — what persists, and why the tag half stays

Autotracking has two halves. **Entanglement on read** — dependency discovery without declaration — is what builds the recorded read set, and is why there is no build step and no declared graph. That half is irreplaceable. **Tags and bumps** — revision counters that let a mutation propagate to exactly its readers — are what autotracking was built to make fast, and they are process-local by construction.

**Nothing from the tag half persists.** A revision tag is a counter meaningful in one process; the entangled dependency set is a scheduling artifact. Persisting either would be persisting a graph — M0 — and it would be wrong on restart regardless. **What persists is the trace:** recorded reads with fingerprints, identities, subjects, results. Across processes, invalidation is not "has my tag moved" but re-derivation: unmemoized code runs, the memoized wrapper compares fingerprints.

So there are two invalidation systems with a seam, and the seam is the memoized wrapper. A stored trace is consulted only there; a served result re-enters this process as a storage-backed value with fresh tags. Inside a single run the tag half does something much smaller than it was built for — it memoizes derivations within the pass, exactly as it does in a server-side render, where nothing mutates after the fact and no tag bumps twice.

**Values are immutable.** A stored result is a generation, and a retained generation cannot be a value mutated in place — retention, supersession, and pricing would all lose their referent. Change is a new generation under a stable identity; identity plus fingerprint does across processes what mutation does in a web application. Nothing arriving from outside is mutated either: it is re-fetched as new content under the same identity.

Why keep the tag half, if the run underuses it and the driving consumers have free CPU? Because it pays at the boundary. A consumer that builds interactive, mutable state on top of results — a filter over a report — gets ordinary reactive composition over tracked values with no adapter and no copy into a second reactive system. Stripping tracking down to read-recording would force every such consumer to rebuild it, worse, over opaque values. The companion sketch is the case for this. [core commitment; the reason is a consumer's, the property is the library's]

---

## 3. The three contracts [core]

Reconciling "use-case agnostic" with "just a library": core defines interfaces, ships a boring default for each, and lets something else be clever.

| Contract | Question it answers | Shipped default | A future implementer |
|---|---|---|---|
| **Storage** | Where results, per-field fingerprints, identities, claims, progress, and abandoned attempts live; how they are read, written, indexed, and swept | In-memory for tests; SQLite on disk; row state as the claim mutex; subject hash as the index; a periodic sweep of expired leases | An IO manager that spills, tiers, or shards; notification instead of polling for claim waits |
| **Materialization** | When a field is resolved, cached, prefetched, evicted | Resolve on read; cache field values weakly; prefetch the recorded read set | A manager that trades storage for CPU when it can see which is saturated |
| **Concurrency** | May another member start now; where should this member's subtree run | A fixed in-flight limit and the author's partition hint; single process | A load manager with live pressure signals; a worker pool |

Storage and materialization defaults ship in `core`. The concurrency default ships in `helpers` because it lives in `fanOut`.

The discipline: **fixed policy now, measured, and let real bottlenecks justify the manager.**

---

## 4. What is built on top [built]

| Former concept | How you build it |
|---|---|
| Re-roll / regeneration | A **pinned input** — a counter bound to the step. Bumping it is the re-roll; the counter value is the generation label. |
| Model version / prompt version | A **pinned input**. A bump is a content change under an unchanged identity: verified, explained, priced. |
| Freshness / TTL | An input that is a function of the clock. Not a framework timer. |
| Experiment vs production | A distinguishing input with a **different identity**. Identity forks the subject; the two never supersede each other. |
| Nondeterminism | Not special. |
| Cost classes | The author's reason for memoizing. |
| Subject | Derived from identities. Not authored per step; authored once per type at the entry boundary. |
| Hierarchical result IDs | The identity path, derived. Never authored. |
| Telling two reshapes of one value apart | Declare the function; its name is the label. No store. |
| Operation vs step | A portable function vs a partial application with opinion bound in. |
| Fan-out, fan-in, enrichment, workers | `fanOut` / `fanIn` helpers over a loop (§6). |
| Services, rate pacing, retries, provider timeouts | Inside the step body, or the concurrency contract. **Retry is never the library's.** |
| Budget stop | Gate middleware that does not call next. |
| Cost recording, tracing | Around middleware, on any named step. |
| Lease renewal for a long step | Progress reports interleaved with the body's own calls (§6.5). |
| Resumability | Call it again. |
| Obviation tool, flame graph | Check-only mode plus recorded cost, presented on the identity path (§8). |
| Down-projection to save memory | **Unnecessary.** |
| Recovering a lost provider call | **Not built, anywhere.** See §6.6. |

---

## 5. Packaging [product]

A monorepo:

- **`core`** — §2 and §3 and nothing else. **No helpers.**
- **`helpers`** — the patterns in §7 as functions. `fanOut` and `fanIn` ship first, because they are the seam for concurrency, pacing, locality, and eventually workers. Then a neighbour-aware fan-out, hierarchical reduce, a re-roll counter, a date-bucket freshness input, a budget-stop gate, a cost-reporting around, a determinism diagnostic, a max-attempts-per-subject policy — each added when usage shows it earns its place.
- Presentation layers (obviation flame graph, tracing report) are not core.

The test for core membership: *could an author build this on the public surface?* Retention, the result lifecycle, identity, the middleware stack with its reserved positions, and the three contracts are in core because the answer is no.

---

## 6. The worker story [built, with core obligations]

Owed because the library is agnostic; an escape hatch for the driving consumers, who are bound by network, model latency, and disk — all awaits, all served by one event loop. The one thing that would make it necessary for them is verification at scale turning out CPU-bound rather than IO-bound; measurable in the scale thread.

### 6.1 Boundary and unit

The boundary is **`fanOut` / `fanIn`**, never a step's body. The unit of work is **a member's subtree**. What crosses the wire is a member handle in and a result identity out; storage-backed values mean payloads never cross. A **pool** sized to cores, fed by a shared queue; nested fan-out submits tasks to the same pool.

### 6.2 Eligibility and permits [mechanism]

The pool cannot schedule by readiness; it starts tasks and lets them discover. **Permits guard the actual fetches, not whole subtrees** — and a task waiting on another's claim holds no permit. The real Node failure is heap, not stack, which the lazy in-flight window prevents.

### 6.3 Locality over balance [core commitment]

Pull-based evaluation cannot plan a balanced partition. Imbalance is a tail cost; lost locality multiplies real work. The author's **partition hint** on `fanOut` is a **locality hint, not a balance hint**. Work stealing is a pressure valve, used late. **Duplicate cheap work rather than leave workers idle.**

### 6.4 Where duplicates come from [reality]

Not from the queue. Duplicates come from **convergence**: two distinct members' subtrees reach the same memoized call with the same subject. Both look up the key, both find no result, both would execute. Discovered by reading, after dequeue, on a key the queue never saw.

Duplicating **unmemoized** work is safe. Duplicating a **memoized** execution is double spend and, for a nondeterministic step, an unrequested generation with an arbitrary current pointer.

### 6.5 Claims, leases, and progress [core obligation]

**The claim is a state on the result row, keyed by (step, revision, subject hash).** The store already keeps a row per key; "being computed" is one more state of it, and the database's own row locking is the mutex. No coordination service. The key is knowable before execution because the subject is built from identities, which arrive with the arguments, not from reads, which are discovered by running. Because the subject includes every identified argument, two legitimately different executions never share a claim.

**A memoized step whose key is claimed waits by default.** The waiting task holds no permit; it awaits the row's transition and then verifies the result like any other. A step may opt out where duplication is acceptable. Memoizing is already the author's declaration that this is the thing they cannot afford to run twice; the protection belongs with the declaration.

**A claim carries a lease, not a heartbeat.** A lease plus a **periodic sweep** — one query that resets expired claims to unclaimed — scales with the sweep interval, not with in-flight work. After a reset the key is open; the next task to reach it executes.

**Lease duration** is derived from the step's own recorded durations, with a conservative default on a step's first run. A first run longer than that default would be swept and paid twice — so a running body may **extend its lease, and extending requires reporting progress.** The affordance takes a progress value; the store rejects a value identical to the one already on the claim row; a rejection is an error the author sees. Progress is whatever describes where the work actually is — page 340 of 2,000, chunk 12, the paragraph in hand — supplied by the caller. No monotonic counter: the library could only check one by generating it, and generating it is the loop again.

**Renewal is pulled by progress, never pushed by a clock.** This is the rule to document in the loudest available font. A `setInterval` that extends the lease keeps extending it after the work has hung; the lease then means "a process exists" instead of "someone is working on this," and a waiter waits forever. That failure is worse than the double payment renewal prevents. Renewals belong *between* the calls a body is already making, so a hung call means no renewal, an expired lease, and a sweep that does its job. The progress requirement is what makes the timer version feel wrong to write: it would have to invent differing values for work that is not happening.

The claim row keeps only the current progress value — enough for liveness and for "what is it stuck on." Tracing, if listening, captures the sequence as events; the lease mechanism does not keep a history.

**Failure releases the claim promptly.** The wrapper's own middleware marks the row abandoned and re-raises; the body's error handling and provider timeouts are the author's, and are the first line of defence. Waiting for a lease to expire is the backstop for a process that died, not the normal path.

### 6.6 What the library does not do about lost provider calls [product]

A provider call bills for the request whether or not a response arrives. The driving consumers have priced this into the provider relationship. The library's whole obligation on failure is **not to compound the loss**: never pay twice for the same key, never leave a key locked, always leave a record. The abandoned-attempt row is **bookkeeping, not recovery**. There is no reconciliation machinery and no retry in core.

### 6.7 Core's obligations, summarized

1. Nothing in evaluation may assume a member's subtree runs to completion before the next starts, or that it runs in the same process.
2. A memoized step never executes concurrently for the same key unless it opted out.
3. A claim never outlives its lease without a progress report; a failed or refused execution never leaves a claim.
4. Nothing paid for is deleted.
5. The library's own middleware runs regardless of what the user registers.

---

## 7. Design patterns — hazards and the modeling choice that avoids each [authoring]

None of these are framework limits. Helpers exist to make the good choice the easy one.

| Hazard | What happens | Pattern |
|---|---|---|
| Binding to the collection when you meant the member | Every element re-pays on any change | **Pass members, not collections.** |
| Passing member *and* collection "for context" | Collapses member grain silently | Pass the specific context needed. |
| Fanning over unidentified members | Members inherit the collection's identity plus their index; an insertion shifts every subject and orphans every result | **Give members an identity.** A URL, a path — or content, for a value with no stable concept. |
| A value with no stable concept | A paragraph has no "same paragraph after an edit" | **Content is its identity.** Verification is then trivial; the read-grain property is unavailable for that value because there is nothing to preserve. Correct, and cheap. |
| Position by index | An insertion at the top re-pays the whole array | **Express position relatively.** |
| Two reshapes of one value fed to one step | Same subject; the second supersedes the first | **Name the reshape.** Naming is free; it does not require memoizing. |
| Forking a subject by changing content | Experiment and production supersede each other | **Identity forks; content bumps.** Give the distinguishing input a different identity. |
| Making content the identity of a value you intend to bump | The bump becomes a new subject with no candidate; nothing is superseded, nothing is priced | Declare identity only for stable concepts. |
| Expensive work on the aggregate | One member changes, the reduction re-pays | **Push expensive work to the smallest unit, then aggregate cheap summaries.** |
| Flat reduction over a huge collection | Memory and re-pay scale with N | **Reduce hierarchically.** |
| Hand-written down-projection | GC churn; breaks with two consumers | **Read the fields you need.** |
| Ignoring locality in a worker fan-out | Same records re-read on every worker | **Partition by the key that scopes the shared subtree.** |
| A memoized body reading outside tracking | Silently stale paid result — the body does not re-execute, so the read is never seen again | Convention plus harness. (Unmemoized code re-executes, so the same read there is caught by the fingerprint of what it produces.) |
| A memoized body with no provider timeout | A stalled call holds the claim until the lease expires | **Timeout every provider call.** |
| Extending a lease on a timer | The lease stops meaning liveness; a waiter waits forever | **Report progress between calls.** The affordance will not accept a repeat. |
| Reformatting what feeds a leaf | The leaf re-pays | **Batch disruptive changes** with a pinned-input bump. |
| Bumping a pinned input casually | Everything downstream re-pays | **Price the bump first.** |
| Opinion in the operation | Operation stops being reusable | **Opinion lives in the step.** |
| Forgetting to memoize | Paid every run | Noticed quickly; tracing nudges. |
| Memoizing an anonymous function | No stable key; an invented one changes under an unrelated edit and orphans every result | **Core throws at wrap time.** An ecosystem named-function-expressions lint rule catches it statically. |
| A build step that renames functions | Memoized names change; results orphaned wholesale | Not a concern for server-side analysis code. If a bundler is ever in play, preserve names or name explicitly. |
| Mutating a stored result through its handle | Retention, supersession, and pricing lose their referent | **Values are immutable.** Emit a new generation. |

---

## 8. Explainability and product surfaces

**Explainability.** From a result's recorded reads, follow the tracking chain through unmemoized code to the root value that differed. A proof of propagation, not a correlation. Diff outputs between generations; diff read values. And every result has an **address**: its identity path, readable as "complexity of PR 4521 of engineer X." Store requirements: per-field fingerprints, retained generations, the subject index, read values or references to them.

**Obviation tool — "price what you will obviate."** A check-only dry run; misses grouped by step, summed over recorded cost of superseded results. A flame graph whose frames *are* the identity path — the entry at the root, brackets for fan-outs, width in recorded dollars. It stops at a memoized fetch whose subject is new. A result whose subject is no longer reached is not obviated but *orphaned*; reported separately.

**Tracing.** Around-middleware on every named step times everything. A slow unmemoized step gets "consider memoizing"; a lopsided partition gets shown; a subject with three abandoned attempts gets shown with what each cost; a claim that has been on the same progress value for twenty minutes is shown as "stuck on page 340 of 2,000." Reports, never actions. Tracing is the beginning of the live signal any future load manager would need.

---

## 9. Open questions [open]

Nothing conceptual remains. Everything below is measurement or a storage-contract detail.

- **OQ1 — Values that leave tracking.** Proxy leaks — spread, `JSON.stringify`, equality, third-party code. Invalidation stays correct at the boundary; provenance degrades. Whether boundaries re-attach.
- **OQ2 — Collection identity in tracking.** Length and membership as a whole-grain dependency; the fiddly part of Ember's model.
- **OQ3 — Fingerprint granularity at write.** Every scalar leaf, recursively; the CPU cost for 150k payloads is the thing to measure. Includes the in-memory fingerprints taken at memoized boundaries.
- **OQ4 — Cross-process store.** The mutex is answered. Remaining: how a waiter learns a claim resolved (poll vs notify — a storage-contract detail); SQLite single-writer contention at 150k rows; how a child's recorded reads return to the parent's provenance chain.
- **OQ5 — Reclamation for cheap memoized results.** Policy keyed on recorded cost.
- **OQ6 — Tracing thresholds.** The memoize nudge, the imbalance report, the abandoned-attempt report, the stuck-progress report.
- **OQ7 — Lease parameters.** First-run default, multiple over recorded duration, sweep interval.
- **OQ8 — The in-process derivation cache.** Whether tags should memoize unmemoized derivations within a run at all when CPU is free, or whether eager recomputation is simpler. Measurement. The tag half is kept for the boundary (§2.7) either way.

---

## 10. Jobs to be done

**Author** — Editing a rubric costs what it changes. Refactoring unmemoized code costs nothing wherever the values read are unchanged. I write ordinary TypeScript with no build step. I declare what a PR *is* once, on its type, and never think about subjects again. I declare a function and its name is its name; when two reshapes must be told apart I give the second a declared name, without memoizing it. If I try to memoize an anonymous function I find out before anything runs. I read the three fields I need from a 150k-record fan-out without writing a projection. Before I bump a pinned input I see what it will obviate. I hand `fanOut` a partition key and a concurrency limit and nothing else changes. I put timeouts on my provider calls, report progress between them in a long step, and the library does the rest.

**Operator** — New or changed subjects are all I pay for. An interrupted run resumes by being called again. Re-rolling one item touches one item. Slow steps, lopsided partitions, failing subjects, and stuck claims are reported with an address I can read. I can set a budget stop that never blocks a free hit. A crashed worker never locks a key for good. I can swap in a storage or concurrency implementation without touching an analysis.

**Reviewer** — A finding is the same as yesterday unless something visible changed; when it changed, I see the root, its diff, and the output diff, at an address that names the thing.

**Third consumer** — I build an analysis with a different cost shape — including a CPU-bound one — without changing the library.

---

## 11. Success criteria

- **SC1** — Unchanged inputs: zero paid calls; verification within the deadline.
- **SC2** — Edit one shared value: exactly its readers re-run; explanation names it.
- **SC3** — **The thesis.** A refactor of unmemoized code leaving the values *read* by memoized steps unchanged makes zero paid calls.
- **SC4** — **The fan-out property.** Insert one of N: one paid call. Change three of N through an enrichment chain: three.
- **SC5** — **The memory property.** Peak memory bounded by the in-flight window, not N, with no projection step. Verification of routed fields loads nothing.
- **SC6** — A conditional read that misses the prefetch set falls back correctly and is never reported as a change.
- **SC7** — Bump a pinned re-roll counter on one item: one changes, old generation retrievable, queue does not reorder.
- **SC8** — Root cause, input diff, output diff for any result without executing anything.
- **SC9** — Killed mid-run, resumed after an edit: no recorded paid call repeats.
- **SC10** — 150k results verify within the deadline; prefetching added with identical invalidation outcomes.
- **SC11** — Dry-run prediction equals the actual re-run set and its cost.
- **SC12** — **The duplication property.** Two tasks converging on the same subject produce one execution and one generation unless the step opted out.
- **SC13** — **The contract property.** Storage, materialization, or concurrency substituted without changing any analysis.
- **SC14** — Third consumer with an inverted cost shape, and a CPU-bound one, with no library changes.
- **SC15** — `core` installs and runs with no build configuration; every helper is expressible on `core`'s public surface.
- **SC16** — **The failure property.** A killed worker's claim expires and is swept; the subject is retried once; an abandoned record exists. A throwing body releases immediately. No key is ever locked past its lease.
- **SC17** — **The identity property.** A PR whose unread fields change is served from its prior result; a PR whose read field changes gets a new generation under the *same* subject with the old one retained. Bumping a model version supersedes and is priced; so does editing an identified, pinned rubric. Passing a value with a different identity forks and is not priced as a bump. Two pages containing one paragraph produce one result. A reducer's subject is unchanged by membership change. An identity declared on a type is applied identically whether the producing step is memoized or not; two named reshapes of one PR are two subjects, two unnamed ones are one.
- **SC18** — **The renewal property.** A step longer than the first-run lease completes without duplication when it reports progress between calls. A step that reports the same progress value twice gets an error. A step that hangs after its last report is swept when its lease expires — a timer cannot keep it alive.
- **SC19** — **The stack property.** A gate middleware refusing over budget never refuses a served hit. Removing or reordering the library's own middleware is impossible from user code; inspecting the stack shows it. A throwing user middleware fails its call and nothing else. An around middleware observes an unmemoized named step.
- **SC20** — **The naming property.** A declared function or class is a named step with no further input from the author. Memoizing an anonymous function fails at wrap time. An explicit name wins over an inferred one.
- **SC21** — **The boundary property.** Nothing process-local — tags, entangled dependency sets — is ever written to the store. A served result re-enters tracking with fresh tags. A stored value cannot be mutated through the handle downstream code receives.

---

## 12. Steel threads

- **ST0 — Memo.** One memoized function, durable store, second run zero calls.
- **ST1 — Proof through unmemoized code.** Raw input → tracked reshape → memoized judgment with a mocked model and spend counter. Rename an unread field: zero. Change a read one: one. Style guide passing through untouched: named as unchanged root. Bump the revision: all obviated. (SC3, SC8)
- **ST2 — Identity.** A type with an identity function; a memoized fetch and an unmemoized named read both producing it; incidental churn served; read-field change superseding under the same subject; a pinned model string and a pinned identified rubric both bumped and priced; a different-identity environment forking; a named vs an unnamed reshape; a declared function named with no extra input; an anonymous function passed to the memoize wrapper, throwing; two pages sharing a paragraph; a reducer over a collection whose membership changes; the identity path inspected as an address. (SC17)
- **ST3 — Two grains.** One collection bound at whole grain by one step and member grain by another; insert and reorder. (SC4)
- **ST4 — Storage-backed values.** N large synthetic records; ten steps reading ten fields; peak memory vs N; routed-field verification with the store instrumented to prove nothing loads; prefetch; a conditional miss. (SC5, SC6)
- **ST5 — Fan-out chain.** Members → enrichment → per-member judgment → cheap reduce; three of N changed. Neighbour-aware helper. Lazy in-flight window. (SC4)
- **ST6 — Shared value.** (SC2)
- **ST7 — Generations and pinned inputs.** Re-roll counter; prompt version; date-bucket freshness; all as helpers over core. (SC7, SC15)
- **ST8 — Interrupt and resume.** (SC9)
- **ST9 — Middleware.** A budget-stop gate that never blocks a hit; a tracing around on a memoized and an unmemoized step; a throwing user middleware; an attempt to reorder the reserved block; the stack inspected. (SC19)
- **ST10 — Obviation and tracing.** Check-only dry run; flame graph on the identity path; stop at a new subject; orphaned results reported; nudge, imbalance, abandoned-attempt, and stuck-progress reports. (SC11)
- **ST11 — Scale.** 150k subjects; disk IO vs CPU profile of verification; prefetching; hierarchical reduce; SQLite write contention with claims. **Decides whether workers are ever needed by the driving consumers.** (SC10)
- **ST12 — Workers, claims, leases.** A synthetic CPU-bound step; pool; partition hint; locality as store reads per record; convergence on one subject; a substituted concurrency policy. Then failure: a killed worker; a throwing body; a mocked provider behind a body timeout; a step longer than the first-run lease reporting progress; the same step with a timer instead, swept; a repeated progress value rejected. (SC12, SC13, SC16, SC18)
- **ST13 — Thread A end to end.**
- **ST14 — Thread B end to end.** Including the "dot on a timeline" case.
- **ST15 — Third consumers.** Cheap leaves with an expensive terminal; a CPU-bound analysis. (SC14)
- **ST16 — Consumer reactivity.** A mutable filter value composed over tracked results in one process; only the derivations that read the filter recompute; the store sees nothing. Restart the process: the same results serve, with new tags. (SC21)

---

## 13. What this supersedes in the source docs

| Source | Verdict |
|---|---|
| Two graphs (D1, R4.4) | Author/store split is real; two-graph machinery is not. |
| Fan-out produces instances (D2); fan-in may re-run (D3) | Instance → result. D3 dead. |
| Projections deleted (D4); fetch vs reshape (D5) | Kept; projections doubly dead. |
| Dual identifiers (D6) | **Confirmed in a sharper form:** identity vs content fingerprint are the two, and revision tag is the third coordinate. |
| Hierarchical IDs (D7) | **Returns, derived:** the identity path. Never authored; follows dataflow; bounded by nesting depth. |
| Explicit operation names (D8) | Kept, on any named step; durable and required on memoized ones. |
| Pre-execution structural validation (D9) | Unnecessary. |
| Storage adapter, SQLite, query catalog (D10–D12) | The storage contract. Add per-field fingerprints, generations, subject structure + hash index, read values, row state with lease expiry and progress, abandoned attempts, durations, a sweep. |
| Nondeterminism flag (D13, R6) | Not core. |
| Services, rate policy, pacing (D14–D15) | Concurrency contract, or inside the body. |
| Single process (D16) | The shipped default. |
| Version declaration (R4.2) | Memoized steps only — it is an invalidation concept. |
| Freshness policy (R5.4) | An author-built clock-derived input. |
| Input identity (R5) | Declared once per type; applied by any producer; derived thereafter. |
| Reclamation (R9.5) | Forbidden for paid results. |
| Resumability (R8.3) | A consequence of having no run state. |
| Operation/step (R4.6) | A convention. |
| Static topology (A3); consumers produce content states (A5) | Reframed. |

---

## 14. Prior art placement [reality]

A **suspending scheduler over verifying traces** — Shake's coordinates in *Build Systems à la Carte*; Salsa's and Ember autotracking's, with revisions in place of hashes. Ember's `@tracked` is the direct model for the tracking layer. The identity/content split is the entity-identity distinction ORMs have always drawn, applied to memoization keys; the identity path is closest to Salsa's interned query keys and to hierarchical build coordinates, except that here it is derived from dataflow rather than declared. Storage-backed values resemble lazy ORM proxies and columnar reads. Locality-over-balance is from distributed data processing. Claims with leases and a sweep are the ordinary shape of a database-backed job queue. Progress-gated renewal is a known idea in job systems; requiring the value to *change* is the small twist that makes the timer version unnatural. The middleware stack with reserved positions is Express and Koa, plus the firewall convention that built-in rules are visible and immovable. The tag half of autotracking is doing here what it does in a server-side render: memoizing within one pass, never bumping twice.

Genuinely new and narrow: traces where one key maps to many retained outputs with a current pointer; memoization restricted to the boundary the author is already deliberate about; universal tracking without memoization; verifying traces whose reads resolve against per-field fingerprints so that routing a value costs no load; a subject built from identities that arrive with arguments while verification runs on fingerprints discovered by reading — which is what lets the mutex exist before the trace key does.

---

## 15. Graveyard — do not resurrect

- **M0–M4** — single dynamic graph; projections as primitive; analysis as a scaled step; universal fundamentals; declared structure.
- **M5's categories** as framework-visible.
- **Cheap steps as framework objects.**
- **Source hashing at any grain; static analysis to infer queries** — both a build step.
- **Tracking only at memoized boundaries.**
- **TTL as a framework feature.**
- **Partial re-evaluation of a single step.**
- **Memoize the projection to keep the payload out of memory.**
- **"CPU is free" as a library principle.**
- **One worker per member; primary-with-N-workers; a readiness scheduler; permits on whole subtrees; work stealing as default.**
- **Duplicate-prevention as opt-in.**
- **A queue lock as the duplicate guard; a claim on the result key; a coordination service for claims; a naive heartbeat.**
- **A fixed lease with no renewal** — reproduces the duplicate on the first long run.
- **Timer-driven lease renewal** — turns liveness into "a process exists"; infinite wait.
- **An auto-incremented progress counter** — the loop with extra steps.
- **Storing progress history in the claim** — tracing's job.
- **Content as the subject** — plain memoization-by-hash; kills the read-grain property. (Absorbs "identity on every value by default," whose only possible default was content.)
- **Identity declared per step** — restated everywhere, free to disagree; it belongs to the type.
- **Identity derived differently for memoized and unmemoized producers** — the axis error; one rule.
- **Memoizing a step in order to name it** — storage added to obtain a label.
- **Pinned inputs as necessarily unidentified** — pinning is about who changes a value; identity is about what it is.
- **Middleware only on memoized steps** — observation is not a storage concept.
- **Identity composed from members in a reducer** — enormous and wrong; membership is content.
- **Hooks as subclass overrides requiring `super`** — the forgetting problem.
- **Observer-only hooks with a veto elsewhere** — an overcorrection; a stack with reserved positions is both safer and ordinary.
- **A budget gate before verification** — refuses free hits.
- **A required name string** — the declared function already has one.
- **Inferred keys for memoized steps** — position, source hash; any of them orphans results under an unrelated edit.
- **Persisting revision tags or the entangled dependency set** — M0 again, and wrong on restart.
- **Stripping autotracking to read-recording** — sound for the run, ruinous for every consumer.
- **Mutable stored results** — contradicts retention.
- **Reconciling lost provider calls; retry in core; managers before measurement; helpers in core; "pinned" for a memoized step; "price what you will throw away."**

---

## Appendix — stress scenarios (acceptance tests)

- **S1** Expensive adjudicator over a page's findings — decompose.
- **S2** Remediation → new draft → parse → lint — identical paragraphs served.
- **S3** Rule reading "this page plus what a reader saw first" — the neighbourhood is a value.
- **S4** One paragraph verbatim on 400 pages — one subject, one result.
- **S5** One ticket referenced by 30 PRs — one subject, one result.
- **S6** Glossary edit — exactly its readers.
- **S7** Bump one item's re-roll counter — queue stable, old generation visible.
- **S8** Killed at hour three, resumed after a rule edit.
- **S9** Two analyses sharing a store — names unique per store.
- **S10** Cheap leaves, expensive terminal — decompose or accept.
- **S11** Prompt rewritten (pinned input bumped) vs body changed (revision bumped).
- **S12** Experiment vs production — a distinguishing input with a *different identity* forks the subject; a content difference alone would make them supersede each other.
- **S13** Field renamed or regrouped — served wherever read values are unchanged.
- **S14** Agentic step chooses which pages to read — nested memoized reads recorded; their subjects follow dataflow.
- **S15** Memoized body reads a file directly — harness catches it. The same read in unmemoized code is caught by the fingerprint of what that code produces.
- **S16** Four inputs, style guide passes through untouched — provenance proves it.
- **S17** Whole object passed, one member read — other members change freely; subject unchanged.
- **S18** Expensive function left unmemoized — tracing nudges, because the around region observes it.
- **S19** Dry run reaches a new-subject fetch — stops, prices only what exists.
- **S20** Document reassembled from paragraphs — cheap; only whole-document readers re-pay.
- **S21** Enrichment chain, three of 14,000 changed — three, three, cheap reduce.
- **S22** Whole-document vs per-paragraph sentiment — the modeling choice.
- **S23** Insertion at the top, index vs neighbour position — N re-pays vs two; and at the identity layer, index-derived identities orphan N results vs content or neighbour identities orphaning one.
- **S24** Member plus collection "for context" — grain collapses.
- **S25** Timeline dots from 150k PRs — three fields read per record, no projection.
- **S26** Two consumers needing different fields — neither projects.
- **S27** Conditional field read on a new branch — fallback, read set updated, no change.
- **S28** Memory pressure under a deep fan-out — weakly cached fields reclaimed.
- **S29** Nested fan-out on a pool — same pool, no explosion, no primary bottleneck.
- **S30** Two pages, same paragraph, two workers — one claims and executes, one waits and is served.
- **S31** Partition by user; 12,000 vs 400 PRs — imbalance tolerated; locality preserved.
- **S32** Model name bumped — content change under an unchanged (absent) identity; every judgment obviated under its existing subject; priced before the bump; old generations retained.
- **S33** *Retired.* Same paragraph, different rubric is two subjects; no serialization.
- **S34** Worker killed holding a claim — lease expires, sweep resets, retried once; one abandoned record.
- **S35** Provider stalls after input tokens sent; body has a timeout — claim released immediately; abandoned attempt recorded with tokens sent; nothing reconciled.
- **S36** Forty-minute agentic step, first run — reports progress between its calls; lease extended each time; never swept; one execution.
- **S37** Same step with a `setInterval` extending the lease and a hung call — the rejected design: the lease outlives the work. Under the shipped rule the interval's repeated value is rejected on its second tick.
- **S38** A body reports the same progress value twice — error surfaced to the author.
- **S39** PR 4521 gets a label — unread field; served from the prior result; subject unchanged.
- **S40** PR 4521 gets a commit — read field; new generation under the same subject; old one retained; explanation names the diff.
- **S41** Two unnamed reshapes of one PR fed to one step — shared subject; second supersedes first; tracing flags a same-subject different-reads pattern. Name either reshape and they are two subjects. Memoization changes nothing here.
- **S42** Rubric read from disk by an unmemoized named step declaring `Rubric`'s identity — identified on production; a rubric edit supersedes under the same subject; a second rubric is a second subject. Memoizing the read would change nothing about identity.
- **S43** Budget exhausted mid-run — gate refuses the next miss; hits continue to be served; refusals counted; run report names what was not executed.
- **S44** Reducer over "all PRs of engineer X" after two PRs are added — subject unchanged; membership is a content change; the reducer re-runs once.
- **S45** Identified pinned rubric edited — content change under an unchanged identity; supersedes and is priced exactly as a model-version bump is.
- **S46** An anonymous arrow passed to the memoize wrapper — throws at wrap time; the lint rule would have flagged it first.
- **S47** A declared function memoized — its name is the key; the author typed nothing extra.
- **S48** A filter value mutated over tracked results in one process — its readers recompute; the store is untouched; nothing process-local persists.
