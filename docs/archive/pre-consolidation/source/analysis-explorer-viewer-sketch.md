> Historical artifact. Superseded by the [active specification](../../../spec/README.md). Do not implement from this document.

# Analysis explorer — viewer architecture sketch

Sketch, 2026-09-12. Companion to `incremental-analysis-deep-design-rev9.md`. This document describes a **consumer** of the library; it introduces nothing into core, and anything here that would need to is a defect in this sketch, not a requirement on the library. Layer tags as in rev 9, plus [viewer] = belongs to the viewer and must stay there.

---

## 1. The vision

Someone who has built an analysis should be able to stand up a viewer for it with **one way to articulate results derived from inputs** — the same way they already used for the expensive precalculation. The cache on disk *is* the data store. Session state — a filter selection, a slice, an ad hoc question to an agent, a request for an expensive aggregate — is treated exactly as inputs and steps are treated in the batch run. The viewer's backend is a continuation of the analysis, not a second system fed by it.

---

## 2. What the viewer needs, and already has

Every item below is a rev 9 mechanism reached from a new direction. None is new.

**Session state is an input.** A filter selection is a tracked value that changes often. An expensive aggregate over a slice is a memoized step whose subject includes that selection. Two users who pick the same slice converge on one subject; the claim mechanism serves the second from the first's execution or makes them wait on it. Convergence was designed for workers; it needs nothing extra to serve people.

**One code path, two arrival paths.** A step does not know whether it was reached by a batch run at three in the morning or by a click. Pre-warming the slices you predict is running the pipeline; a cold click is the same work arriving late. This is incremental static regeneration: serve the stored result while nothing it read has changed; recompute when something has. The invalidation rule is the one the library already applies — nothing is added, it is pointed at a new arrival path. The only real difference between the two phases is whether a human is watching.

**The store is the data store.** There is no separate database. A viewer reads results by subject, at whatever grain it needs.

**Progressive population.** While an analysis is running, a viewer request reaches subjects in one of three states. *Current* — render now. *Claimed* — wait on the claim, the same wait a converging worker performs; progress reported for lease renewal is displayed as "page 340 of 2,000" rather than a spinner. *Neither computed nor claimed* — the request would start work. Pull evaluation produces the fill-in order for free: a chart that needs only leaf-level data reaches current subjects early; a page that needs the final reduce waits on the last claim. Nobody schedules that; the page asks for what it needs and gets what exists.

**Blocking versus streaming is a grain, not a binding kind.** A timeline of PRs is a fan-out with a reduce over it. Bind to the reduce and you wait, because the reduce is not current until every member is. Bind to the collection at member grain and members arrive as each becomes current. Same data, two grains; the two-grain property expresses the distinction without a new concept. A CLI binds to the reduce; a chart binds to the members.

**Values are immutable and tracked**, so an explorer builds ordinary mutable reactive state — filters, selections, hover — directly on top of results, with no adapter and no copy into a second reactive system. This is why rev 9 keeps the tag half of autotracking (§2.7 there).

---

## 3. Where a click can spend money [viewer, using a core region]

A request that reaches an uncomputed, unclaimed subject starts an execution. Interactively, that is a click that spends money, or that jumps the queue ahead of the batch. This wants a **gate** — the middleware region that already exists for budget stops. The viewer's gate policy is its own: refuse interactive-initiated misses above a cost, or queue them behind the batch, or allow them for some users. The mechanism is the library's; the policy is the viewer's.

A note the deep-design skill's own example makes directly: whether to memoize a slice is decided by **cost**; whether the user goes into the subject is decided by **variance per user**. A team-wide aggregate that is identical for everyone must not carry the user's identity in its subject, or every user pays for it once. Authentication does no work in either decision.

---

## 4. Policy knobs, not mechanisms [viewer]

- **Retention by arrival path.** Batch results keep generations, because they are priced and explained. Session slices keep the current generation and are reclaimed — nobody wants every filter combination anyone ever tried retained forever. Same lifecycle, different reclamation policy, keyed on recorded cost and arrival path. This is where rev 9's OQ5 gets its second consumer.
- **Deadline versus latency budget.** Verification cost that is invisible in a six-hour run is visible in a click. This may motivate the materialization contract's prefetching sooner than the batch run would; it does not change what verification does.

---

## 5. Client–server shape [viewer]

The viewer is not a local process reading fields off disk. It is a client against a server that holds the store.

**Server.** Holds the store and the claim registry, which is already cross-process. Emits **one stream of subject updates** — a subject became current, a claim reported progress, an execution was abandoned — over one connection. There is one provider of that stream.

**Client.** A **routing table keyed by subject** — the same key everything else in the system uses. Components subscribe locally to subjects. **Mounting a component never initiates a network request**; it registers against traffic that is already arriving. That kills request amplification when a page mounts forty charts, the fan-out of sockets, and the per-component lifecycle racing a fetch.

**Field resolution.** Reading a field of a storage-backed value is asynchronous whether the value is on local disk or across a wire; the transport changes, the shape does not. A render's read set is partitioned into *resolved*, *in flight*, and *unrequested*; one batch is issued for the third group; the render awaits all three. The in-flight registry is a map from field to pending resolution. Nothing is cancelled, because nothing is wasted: a field loaded for a superseded render is a field you now have. This is the claim's move — someone is already fetching this, join rather than duplicate — one layer down, on the client. It is a loader, not a saga: a set of reads, batched, resolved, one completion signal.

**Cancellation is purely local.** Unmount drops the listener. The server never hears about it and does not care: the work continues, because someone else may want that subject, and abandoning it would be the double payment the whole library exists to avoid. Nothing is ever actually cancelled; a listener goes away.

**Failure surfaces as failure.** An execution can be abandoned — swept lease, refusal, error. A subscriber must see that as an error with a reason, never as a handle that hangs. This is "never leave a key locked," projected outward.

**The stream carries pending-with-position.** Progress values from lease renewal are forwarded. A subscriber gets *pending at page 340*, which a bare promise cannot express.

---

## 6. React integration [viewer; a separate adapter package]

React does not discover what a component read; a re-render happens because a setter was called. So a tracked value cannot simply be handed to a component. The supported seam for an external, notifying source is `useSyncExternalStore`-style subscription: run the render's reads in a tracking frame, obtain the dependency set, subscribe to those subjects on the routing table, and call React's notify when any of them moves. Every signals library ships this shape.

**The hook is a view of the subscription, not the thing itself.** It presents request-like state — pending, resolved, errored — over a subscription that outlives any one component. It looks like an ordinary request to the person writing the component; underneath, it is a local registration against the one stream.

**Lazy values meet synchronous render** by materializing at the boundary: the loader resolves the render's read set, then there is one transition from pending to resolved, not a cascade of per-field suspensions.

The adapter is its own package — neither core nor helpers. Nothing in it is a library concern.

---

## 7. The presentation boundary [viewer, explicitly outside]

The reactive system's job ends at *this member is current, at this grain*. Everything after that is untracked, client-side, and owned by presentation:

- throttling incoming member updates so a chart does not re-render per data point landing microseconds apart;
- reshaping current values into whatever D3 or a table wants;
- batching for frame rate;
- tolerating a partial collection while members are still landing.

None of it has invalidation semantics and none of it depends on the analysis system. Stating this boundary is what keeps viewer concerns from leaking inward.

---

## 8. Open questions [open]

- **Transport.** WebSocket versus server-sent events; how member-grain subscription is expressed over the wire (subscribe to a collection subject and receive member updates, or subscribe per member).
- **Gate policy for interactive misses.** Who may start paid work from a click; whether it queues behind the batch or runs ahead of it.
- **Session-slice reclamation.** The concrete policy, and whether "arrival path" is recorded on the result or inferred from the subject.
- **Topology.** Whether the viewer backend is the batch runner's process, or a separate service sharing the store; multi-tenant considerations if the latter.
- **Partial collections in charts.** How a chart declares it tolerates missing members, so a partial fan-out renders rather than blocks.
- **Agent calls from the viewer.** An ad hoc question to an agent is a memoized step whose subject includes the question; whether questions are identified (stable concept) or content (verified by read) is the same identity decision as anywhere else, made per type.

---

## 9. What must not leak inward

- No streaming binding kind — grain expresses it.
- No cancellation reaching the server — listeners go away; work does not.
- No user identity in a subject unless the result varies per user.
- No throttling, batching, or chart-shaping inside tracking.
- No React, socket, or transport type anywhere in core or helpers.
- No second reactive system holding copies of results.

---

## 10. Graveyard for this sketch

- **A distinct streaming binding** — the two grains already express it.
- **Real cancellation of server work on unmount** — the double payment, reintroduced from the client.
- **A saga for field loading** — a loader with a completion signal is the whole need.
- **A promise as the subscription** — a promise settles once; the subscription carries pending-with-position and can error late. The promise is a view over it.
- **Per-component network requests** — one stream, local routing.
- **A separate database for the viewer** — the store is the data store.
