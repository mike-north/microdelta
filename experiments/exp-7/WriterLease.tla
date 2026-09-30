--------------------------- MODULE WriterLease ---------------------------
EXTENDS Naturals, FiniteSets

\* This finite model is the production durable History writer protocol
\* (packages/history/src/durable/index.ts) under the owner-decided concurrency
\* policy: one fenced writer per store; a contending process observes the
\* holder and waits, taking over only after the lease expires, and always
\* through a fresh fence; inspection needs no lease. It complements
\* Publication.tla, which owns the attempt lifecycle and exact references, by
\* checking the one authority guard every holder mutation shares, the waiter's
\* durable footprint and the clock high-water policy under arbitrary host
\* readings. Attempt, result, current-pointer and acceptance rows are
\* abstracted to the fence that last wrote them.
CONSTANTS
  Processes,
  HolderNames,
  MaxFence,
  MaxTime,
  LeaseLength,
  Fault

\* Sentinels for an absent holder or actor.
NoHolder == "no-holder"
NoProcess == "no-process"

\* Each known-bad configuration removes or weakens exactly one production
\* guard; "none" is the production protocol.
Faults ==
  { "none",
    "takeover-without-fence",
    "renew-ignores-fence",
    "holder-ignores-fence",
    "holder-ignores-expiry",
    "acquire-ignores-expiry",
    "waiter-advances-fence",
    "ignore-high-water" }

\* Every lease-guarded History mutation. The five data operations write rows
\* that record the writing fence (allocated_fence, ended_fence,
\* published_fence, acceptance fence); renew and release write the lease row.
DataOps == {"allocate", "stage", "publish", "abandon", "accept"}
HolderOps == {"renew", "release"} \cup DataOps

\* Event labels select which pre-state witness an invariant reads.
ActionNames == {"init", "grant", "held", "accepted", "rejected", "inspect"}

Max(a, b) == IF a >= b THEN a ELSE b

\* The durable writer row plus the latest data-writing fence. `highWater` is
\* the persisted clock high-water (history_writer.time_high_water).
DurableType ==
  [ holder : HolderNames \cup {NoHolder},
    fence : 0..MaxFence,
    expires : 0..(MaxTime + LeaseLength),
    highWater : 0..MaxTime,
    dataFence : 0..MaxFence ]

\* A process's in-memory lease object: the holder name and fence it was
\* granted. A lease object is never discarded, so a process can present a
\* stale one at any later step; a crashed process is one that takes no
\* further step, and a restarted one acquires a new lease object.
ProcessType ==
  [ name : [Processes -> HolderNames \cup {NoHolder}],
    token : [Processes -> 0..MaxFence] ]

\* Ghost evidence. `prior` is the durable pre-state of the latest event;
\* `grantee` is the process that received the latest grant, tracked
\* independently of the holder name so a shared name cannot hide a stale
\* actor; `ended` holds fences some evaluation found expired, released or
\* superseded; the high marks are the strongest values ever issued/observed.
ObservationType ==
  [ lastAction : ActionNames,
    op : HolderOps \cup {"none"},
    actor : Processes \cup {NoProcess},
    now : 0..MaxTime,
    prior : DurableType,
    presentedName : HolderNames \cup {NoHolder},
    presentedFence : 0..MaxFence,
    presentedWasEnded : BOOLEAN,
    grantee : Processes \cup {NoProcess},
    ended : SUBSET (1..MaxFence),
    highFence : 0..MaxFence,
    highNow : 0..MaxTime ]

VARIABLES durable, process, observations

vars == <<durable, process, observations>>

EmptyDurable ==
  [ holder |-> NoHolder, fence |-> 0, expires |-> 0, highWater |-> 0, dataFence |-> 0 ]

TypeOK ==
  /\ Fault \in Faults
  /\ durable \in DurableType
  /\ process \in ProcessType
  /\ observations \in ObservationType

Init ==
  /\ durable = EmptyDurable
  /\ process = [ name |-> [p \in Processes |-> NoHolder], token |-> [p \in Processes |-> 0] ]
  /\ observations =
       [ lastAction |-> "init", op |-> "none", actor |-> NoProcess, now |-> 0,
         prior |-> EmptyDurable, presentedName |-> NoHolder, presentedFence |-> 0,
         presentedWasEnded |-> FALSE, grantee |-> NoProcess, ended |-> {}, highFence |-> 0, highNow |-> 0 ]

\* History evaluates "now" inside each writer transaction as the larger of the
\* host reading and the persisted high-water, then persists it. The host
\* reading is arbitrary on every evaluation: the clock may move backwards or
\* jump forwards between any two readings.
Effective(reading) ==
  IF Fault = "ignore-high-water" THEN reading ELSE Max(reading, durable.highWater)

\* An evaluation at `now` that finds the recorded lease expired ends its fence.
EndedAt(now) ==
  IF durable.holder # NoHolder /\ durable.expires <= now THEN {durable.fence} ELSE {}

\* The ghost record of one evaluation, shared by every event kind.
Witness(action, op, p, now, name, fence) ==
  [observations EXCEPT
    !.lastAction = action,
    !.op = op,
    !.actor = p,
    !.now = now,
    !.prior = durable,
    !.presentedName = name,
    !.presentedFence = fence,
    !.presentedWasEnded = fence \in (observations.ended \cup EndedAt(now)),
    !.highNow = Max(observations.highNow, now)]

\* acquireWriter: an unexpired recorded holder (any holder, including the
\* caller's own name) yields `held`; otherwise the caller takes the lease with
\* the next fence. Release leaves no holder, so the next grant needs no expiry.
HeldAt(now) == durable.holder # NoHolder /\ durable.expires > now

Grant(p, name, reading) ==
  LET now == Effective(reading)
      fresh == IF Fault = "takeover-without-fence" /\ durable.fence > 0
                 THEN durable.fence
                 ELSE durable.fence + 1
  IN /\ (~HeldAt(now) \/ Fault = "acquire-ignores-expiry")
     /\ durable.fence < MaxFence
     /\ durable' = [durable EXCEPT !.holder = name, !.fence = fresh,
                      !.expires = now + LeaseLength, !.highWater = now]
     /\ process' = [process EXCEPT !.name[p] = name, !.token[p] = fresh]
     /\ observations' =
          [Witness("grant", "none", p, now, name, fresh) EXCEPT
            !.grantee = p,
            !.ended = observations.ended \cup EndedAt(now)
                        \cup (IF durable.fence > 0 /\ durable.fence # fresh THEN {durable.fence} ELSE {}),
            !.highFence = Max(observations.highFence, fresh)]

\* The waiter's observation. Its only durable effect in production is the
\* persisted clock high-water; it grants, extends and advances nothing.
Held(p, reading) ==
  LET now == Effective(reading)
  IN /\ HeldAt(now)
     /\ Fault # "acquire-ignores-expiry"
     /\ (Fault # "waiter-advances-fence" \/ durable.fence < MaxFence)
     /\ durable' =
          [durable EXCEPT
            !.highWater = now,
            !.fence = IF Fault = "waiter-advances-fence" THEN @ + 1 ELSE @]
     /\ observations' = Witness("held", "none", p, now, NoHolder, 0)
     /\ UNCHANGED process

\* The shared asHolder guard: holder name, fence and unexpired lease must all
\* match the durable row at the evaluated time. Faults weaken one conjunct.
Authorized(p, op, now) ==
  /\ durable.holder = process.name[p]
  /\ \/ durable.fence = process.token[p]
     \/ Fault = "holder-ignores-fence"
     \/ (Fault = "renew-ignores-fence" /\ op = "renew")
  /\ (now < durable.expires \/ Fault = "holder-ignores-expiry")

\* Accepted effects mirror the production statements, which write the
\* presented lease's fence back into the writer row on renew and release.
Effect(p, op, now) ==
  CASE op = "renew" ->
         [durable EXCEPT !.fence = process.token[p], !.expires = now + LeaseLength, !.highWater = now]
    [] op = "release" ->
         [durable EXCEPT !.holder = NoHolder, !.fence = process.token[p], !.expires = now, !.highWater = now]
    [] op \in DataOps ->
         [durable EXCEPT !.dataFence = process.token[p], !.highWater = now]

HolderOp(p, op, reading) ==
  LET now == Effective(reading)
  IN /\ process.token[p] # 0
     /\ IF Authorized(p, op, now)
          THEN /\ durable' = Effect(p, op, now)
               /\ observations' =
                    [Witness("accepted", op, p, now, process.name[p], process.token[p]) EXCEPT
                      !.ended = observations.ended \cup EndedAt(now)
                                  \cup (IF op = "release" THEN {process.token[p]} ELSE {})]
          ELSE \* A rejected mutation commits only the time observation.
               /\ durable' = [durable EXCEPT !.highWater = now]
               /\ observations' =
                    [Witness("rejected", op, p, now, process.name[p], process.token[p]) EXCEPT
                      !.ended = observations.ended \cup EndedAt(now)]
     /\ UNCHANGED process

\* Check and inspection (currentWriter, readCurrent, recoverAttempt, exact
\* reads) need no lease and run no writer statement.
Inspect(p) ==
  /\ observations' = Witness("inspect", "none", p, observations.now, NoHolder, 0)
  /\ UNCHANGED <<durable, process>>

Next ==
  \/ \E p \in Processes, name \in HolderNames, r \in 0..MaxTime: Grant(p, name, r)
  \/ \E p \in Processes, r \in 0..MaxTime: Held(p, r)
  \/ \E p \in Processes, op \in HolderOps, r \in 0..MaxTime: HolderOp(p, op, r)
  \/ \E p \in Processes: Inspect(p)

\* TLC checks finite safety only; no fairness or liveness is asserted.
Spec == Init /\ [][Next]_vars

----------------------------------------------------------------------------
\* Protocol statements from the owner's decision.

\* Every grant issues a fence exactly one larger than the last issued.
GrantIssuesFreshFence ==
  observations.lastAction = "grant" => durable.fence = observations.prior.fence + 1

\* A recorded holder is taken over only once its lease has expired.
TakeoverOnlyAfterExpiry ==
  (observations.lastAction = "grant" /\ observations.prior.holder # NoHolder)
    => observations.now >= observations.prior.expires

\* A waiter's observation leaves holder, fence, expiry and data untouched and
\* can only raise the clock high-water.
WaiterPreservesAuthorityState ==
  observations.lastAction = "held" =>
    /\ durable.holder = observations.prior.holder
    /\ durable.fence = observations.prior.fence
    /\ durable.expires = observations.prior.expires
    /\ durable.dataFence = observations.prior.dataFence
    /\ durable.highWater >= observations.prior.highWater

\* Inspection changes no durable state at all, including the high-water.
InspectionChangesNothing ==
  observations.lastAction = "inspect" => durable = observations.prior

\* Consequences a guard defect must not be able to hide.

\* An accepted mutation came from the process that received the latest grant,
\* presenting that grant's name and fence inside its unexpired lease.
AcceptedByCurrentAuthority ==
  observations.lastAction = "accepted" =>
    /\ observations.actor = observations.grantee
    /\ observations.presentedName = observations.prior.holder
    /\ observations.presentedFence = observations.prior.fence
    /\ observations.now < observations.prior.expires

\* Once any evaluation found a fence expired, released or superseded, that
\* fence never again mutates the store, whatever the host clock later reads.
\* The witness is taken at evaluation, before the step's own effect, so a
\* legitimate release is not judged by the ending it causes.
EndedAuthorityNeverActs ==
  observations.lastAction = "accepted" => ~observations.presentedWasEnded

\* A rejected mutation changes nothing except the clock high-water.
RejectedPreservesAuthorityState ==
  observations.lastAction = "rejected" =>
    /\ durable.holder = observations.prior.holder
    /\ durable.fence = observations.prior.fence
    /\ durable.expires = observations.prior.expires
    /\ durable.dataFence = observations.prior.dataFence

\* Storage receives data writes in non-decreasing fence order.
StorageSeesNonDecreasingFences ==
  (observations.lastAction = "accepted" /\ observations.op \in DataOps)
    => observations.presentedFence >= observations.prior.dataFence

\* The durable fence is never below any fence already issued.
FenceNeverRegresses == durable.fence >= observations.highFence

\* At most one process holds a lease object the durable row would accept.
AtMostOneAuthority ==
  Cardinality({ p \in Processes :
                  /\ process.token[p] # 0
                  /\ process.token[p] = durable.fence
                  /\ process.name[p] = durable.holder }) <= 1

\* The persisted high-water is never below any time History evaluated.
EffectiveTimeNeverRegresses == durable.highWater >= observations.highNow

=============================================================================
