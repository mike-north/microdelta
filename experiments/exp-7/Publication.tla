--------------------------- MODULE Publication ---------------------------
EXTENDS Naturals, FiniteSets

\* This finite model preserves the EXP-3 publication authority boundary while
\* separating durable records from process-local credentials and ghost evidence.
\* It also represents production History's abandonment and acceptance
\* transitions. WriterLease.tla owns the writer lease under the owner-decided
\* waiting policy and the clock high-water; here time is a global tick.
CONSTANTS
  Contenders,
  AttemptKeys,
  MaxGeneration,
  MaxFence,
  MaxTime,
  LeaseLength,
  Fault

\* Each known-bad configuration weakens exactly one guard; "none" is the
\* protocol. "omit-publish-fence" drops holder/fence equality from
\* publication; "abandon-completed" lets abandonment end a completed attempt;
\* "accept-moves-current" lets an acceptance record rewind the current pointer.
Faults == {"none", "omit-publish-fence", "abandon-completed", "accept-moves-current"}

\* Sentinels represent absent credentials and references; stable attempt keys
\* retain identity across process death and successor rebinding.
NoHolder == "no-holder"
NoKey == "no-key"
NoRef == 0
SeedKey == "seed"
AbandonedKey == "abandoned"
SuccessorKey == "successor"

\* Lifecycle phases distinguish reserved/staged work from retained success.
\* "ended" is production's failed or interrupted attempt: terminal, without a
\* result, its generation consumed.
PhaseNames == {"unused", "allocated", "staged", "completed", "ended"}
\* Event labels select only the witness relevant to the latest transition.
ActionNames == {"init", "acquire", "held", "reclaim", "tick", "renew",
  "reject-renew", "release", "reject-release", "allocate", "rebind", "execute",
  "stage", "publish", "abort-publish", "ack", "retry-completed",
  "read-exact", "crash", "restart", "abandon", "accept"}

\* An acceptance names an existing result; the witness keeps the accepted
\* reference and the current pointer the acceptance found.
AcceptanceWitnessType ==
  [ ref : 0..MaxGeneration,
    currentBefore : 0..MaxGeneration ]

\* Independent pre-state authority evidence prevents a guard from proving itself.
PublishWitnessType ==
  [ actor : Contenders \cup {NoHolder},
    priorHolder : Contenders \cup {NoHolder},
    suppliedFence : 0..MaxFence,
    durableFence : 0..MaxFence,
    priorExpiry : 0..(MaxTime + LeaseLength),
    operationTime : 0..MaxTime,
    actorWasAlive : BOOLEAN ]

\* These fields survive every process transition and belong to History authority.
DurableType ==
  [ holder : Contenders \cup {NoHolder},
    expires : 0..(MaxTime + LeaseLength),
    fence : 0..MaxFence,
    generation : 1..MaxGeneration,
    phase : [AttemptKeys -> PhaseNames],
    ref : [AttemptKeys -> 0..MaxGeneration],
    snapshots : [1..MaxGeneration -> AttemptKeys \cup {NoKey}],
    current : 0..MaxGeneration ]

\* The stale-operation witness needs only the successor lease and current
\* pointer facts whose preservation defines safe renewal/release rejection.
\* A rejection witness preserves the successor authority and current result.
RejectedLeaseType ==
  [ holder : Contenders \cup {NoHolder},
    expires : 0..(MaxTime + LeaseLength),
    fence : 0..MaxFence,
    current : 0..MaxGeneration ]

\* Credentials and pending acknowledgments are lost with the owning process.
ProcessType ==
  [ alive : [Contenders -> BOOLEAN],
    token : [Contenders -> 0..MaxFence],
    activeKey : [Contenders -> AttemptKeys \cup {NoKey}],
    bodyDone : [Contenders -> BOOLEAN],
    pendingAck : [Contenders -> BOOLEAN],
    pendingRef : [Contenders -> 0..MaxGeneration] ]

\* Ghost evidence checks transition meaning without adding storage obligations.
ObservationType ==
  [ highFence : 0..MaxFence,
    highGeneration : 1..MaxGeneration,
    lastAction : ActionNames,
    publish : PublishWitnessType,
    rejectedLease : RejectedLeaseType,
    retryKey : AttemptKeys \cup {NoKey},
    retryRef : 0..MaxGeneration,
    retryCallsBefore : 0..2,
    readRef : 0..MaxGeneration,
    readKey : AttemptKeys \cup {NoKey},
    acceptance : AcceptanceWitnessType,
    acknowledged : SUBSET (1..MaxGeneration) ]

VARIABLES durable, process, bodyCalls, now, observations

\* Canonical empty witnesses avoid remembering facts irrelevant to this event.
EmptyPublishWitness ==
  [ actor |-> NoHolder,
    priorHolder |-> NoHolder,
    suppliedFence |-> 0,
    durableFence |-> 0,
    priorExpiry |-> 0,
    operationTime |-> 0,
    actorWasAlive |-> FALSE ]

EmptyRejectedLease ==
  [ holder |-> NoHolder,
    expires |-> 0,
    fence |-> 0,
    current |-> 0 ]

EmptyAcceptance == [ ref |-> NoRef, currentBefore |-> NoRef ]

\* Event-specific witnesses describe only the latest event; clearing stale
\* payloads keeps unrelated history out of the finite state cross-product.
Observe(actionName) ==
  [observations EXCEPT
    !.lastAction = actionName,
    !.publish = EmptyPublishWitness,
    !.rejectedLease = EmptyRejectedLease,
    !.retryKey = NoKey,
    !.retryRef = NoRef,
    !.retryCallsBefore = 0,
    !.readRef = NoRef,
    !.readKey = NoKey,
    !.acceptance = EmptyAcceptance]

vars == <<durable, process, bodyCalls, now, observations>>

\* Durable records carry the claim, attempt lifecycle, immutable snapshots, and
\* current pointer. Acknowledgment is tracked only as a ghost observation below.
TypeOK ==
  /\ Fault \in Faults
  /\ durable \in DurableType
  /\ process \in ProcessType
  /\ bodyCalls \in [AttemptKeys -> 0..2]
  /\ now \in 0..MaxTime
  /\ observations \in ObservationType

\* A current pointer must identify the exact retained, completed attempt.
CurrentIsComplete ==
  durable.current = NoRef
    \/ \E key \in AttemptKeys:
        /\ durable.phase[key] = "completed"
        /\ durable.ref[key] = durable.current
        /\ durable.snapshots[durable.current] = key

\* A snapshot can name only a completed attempt, and every completed attempt
\* keeps its immutable generation reference available for historical reads.
CompletedHistoryIsRetained ==
  /\ \A key \in AttemptKeys:
       durable.phase[key] = "completed" =>
         /\ durable.ref[key] \in 1..MaxGeneration
         /\ durable.snapshots[durable.ref[key]] = key
  /\ \A generation \in 1..MaxGeneration:
       durable.snapshots[generation] # NoKey =>
         \E key \in AttemptKeys:
           /\ durable.phase[key] = "completed"
           /\ durable.ref[key] = generation
           /\ durable.snapshots[generation] = key

\* Ghost observations of delivered acknowledgments remain readable through the
\* durable exact-reference store; EXP-3 does not implement an acknowledgment table.
AcknowledgedHistoryIsReadable ==
  \A generation \in observations.acknowledged:
    \E key \in AttemptKeys:
      /\ durable.snapshots[generation] = key
      /\ durable.phase[key] = "completed"
      /\ durable.ref[key] = generation

\* The witness captures holder, token, expiry, and time from the publication's
\* pre-state; it does not reuse a boolean copied from the authorization guard.
PublicationUsedCurrentAuthority ==
  observations.lastAction = "publish" =>
    /\ observations.publish.actor = observations.publish.priorHolder
    /\ observations.publish.suppliedFence = observations.publish.durableFence
    /\ observations.publish.operationTime < observations.publish.priorExpiry
    /\ observations.publish.actorWasAlive

\* A rejected stale renewal or release is a read-side observation only: it
\* cannot mutate the successor lease or current publication pointer.
RejectedStaleMutationPreservesDurableState ==
  observations.lastAction \in {"reject-renew", "reject-release"} =>
    /\ durable.holder = observations.rejectedLease.holder
    /\ durable.expires = observations.rejectedLease.expires
    /\ durable.fence = observations.rejectedLease.fence
    /\ durable.current = observations.rejectedLease.current

\* These ghost maxima retain the strongest issued values, so restart or an
\* abandoned attempt cannot hide a regression in durable allocation state.
DurableHighWaterNeverRegresses ==
  /\ durable.fence >= observations.highFence
  /\ durable.generation >= observations.highGeneration

\* Retrying a completed idempotency key returns its original exact reference
\* without crossing the body-execution boundary a second time.
CompletedRetryKeepsReferenceAndSkipsBody ==
  observations.lastAction = "retry-completed" =>
    /\ durable.phase[observations.retryKey] = "completed"
    /\ durable.ref[observations.retryKey] = observations.retryRef
    /\ bodyCalls[observations.retryKey] = observations.retryCallsBefore

\* Exact-reference reads resolve the retained generation selected at the read.
ExactReferenceReadIsStable ==
  observations.lastAction = "read-exact" =>
    durable.snapshots[observations.readRef] = observations.readKey

\* An abandoned (failed or interrupted) attempt is never a result and never
\* current, and keeps the generation it consumed so it is never reissued.
EndedAttemptIsNeverAResult ==
  \A key \in AttemptKeys:
    durable.phase[key] = "ended" =>
      /\ durable.ref[key] \in 1..MaxGeneration
      /\ durable.snapshots[durable.ref[key]] # key
      /\ durable.current # durable.ref[key]

\* Recording an acceptance names an existing retained result and never moves
\* the current pointer or rewrites retained history (RES-007).
AcceptanceKeepsCurrentAndHistory ==
  observations.lastAction = "accept" =>
    /\ durable.current = observations.acceptance.currentBefore
    /\ durable.snapshots[observations.acceptance.ref] # NoKey

\* The seed is a retained successful result; the two later keys model an
\* abandoned attempt and its successor without inventing partial commit states.
Init ==
  /\ durable =
       [ holder |-> NoHolder,
         expires |-> 0,
         fence |-> 0,
         generation |-> 1,
         phase |-> [key \in AttemptKeys |-> IF key = SeedKey THEN "completed" ELSE "unused"],
         ref |-> [key \in AttemptKeys |-> IF key = SeedKey THEN 1 ELSE NoRef],
         snapshots |-> [generation \in 1..MaxGeneration |-> IF generation = 1 THEN SeedKey ELSE NoKey],
         current |-> 1 ]
  /\ process =
       [ alive |-> [c \in Contenders |-> TRUE],
         token |-> [c \in Contenders |-> 0],
         activeKey |-> [c \in Contenders |-> NoKey],
         bodyDone |-> [c \in Contenders |-> FALSE],
         pendingAck |-> [c \in Contenders |-> FALSE],
         pendingRef |-> [c \in Contenders |-> NoRef] ]
  /\ bodyCalls = [key \in AttemptKeys |-> IF key = SeedKey THEN 1 ELSE 0]
  /\ now = 0
  /\ observations =
       [ highFence |-> 0,
         highGeneration |-> 1,
         lastAction |-> "init",
         publish |->
           [ actor |-> NoHolder,
             priorHolder |-> NoHolder,
             suppliedFence |-> 0,
             durableFence |-> 0,
             priorExpiry |-> 0,
             operationTime |-> 0,
             actorWasAlive |-> FALSE ],
         rejectedLease |->
           [ holder |-> NoHolder,
             expires |-> 0,
             fence |-> 0,
             current |-> 0 ],
         retryKey |-> NoKey,
         retryRef |-> NoRef,
         retryCallsBefore |-> 0,
         readRef |-> NoRef,
         readKey |-> NoKey,
         acceptance |-> EmptyAcceptance,
         acknowledged |-> {} ]

\* An unexpired lease is necessary but not sufficient: publication and every
\* fenced mutation also require the caller's local token and holder identity.
LeaseIsLive(c) == process.alive[c] /\ now < durable.expires
CurrentFence(c) == durable.holder = c /\ process.token[c] = durable.fence
Authorized(c) == LeaseIsLive(c) /\ CurrentFence(c)

\* Acquisition and reclamation differ only in their precondition; both advance
\* the durable fence before granting a process-local copy of that token.
Claim(c, actionName) ==
  /\ process.alive[c]
  /\ durable.fence < MaxFence
  /\ durable' =
       [durable EXCEPT
         !.holder = c,
         !.expires = now + LeaseLength,
         !.fence = @ + 1]
  /\ process' =
       [process EXCEPT
         !.token[c] = durable.fence + 1,
         !.activeKey[c] = NoKey,
         !.bodyDone[c] = FALSE]
  /\ observations' =
       [Observe(actionName) EXCEPT
         !.highFence = durable.fence + 1]
  /\ UNCHANGED <<bodyCalls, now>>

Acquire(c) ==
  /\ c \in Contenders
  /\ durable.holder = NoHolder
  /\ Claim(c, "acquire")

Reclaim(c) ==
  /\ c \in Contenders
  /\ durable.holder # NoHolder
  /\ now >= durable.expires
  /\ Claim(c, "reclaim")

Held(c) ==
  /\ c \in Contenders
  /\ durable.holder # NoHolder
  /\ c # durable.holder
  /\ now < durable.expires
  /\ observations' = Observe("held")
  /\ UNCHANGED <<durable, process, bodyCalls, now>>

Tick ==
  /\ now < MaxTime
  /\ now' = now + 1
  /\ observations' = Observe("tick")
  /\ UNCHANGED <<durable, process, bodyCalls>>

Renew(c) ==
  /\ c \in Contenders
  /\ Authorized(c)
  /\ durable' = [durable EXCEPT !.expires = now + LeaseLength]
  /\ observations' = Observe("renew")
  /\ UNCHANGED <<process, bodyCalls, now>>

RejectRenew(c) ==
  /\ c \in Contenders
  /\ process.alive[c]
  /\ process.token[c] # 0
  /\ ~Authorized(c)
  /\ observations' =
       [Observe("reject-renew") EXCEPT
         !.rejectedLease =
           [ holder |-> durable.holder,
             expires |-> durable.expires,
             fence |-> durable.fence,
             current |-> durable.current ]]
  /\ UNCHANGED <<durable, process, bodyCalls, now>>

Release(c) ==
  /\ c \in Contenders
  /\ Authorized(c)
  /\ durable' = [durable EXCEPT !.holder = NoHolder, !.expires = now]
  /\ observations' = Observe("release")
  /\ UNCHANGED <<process, bodyCalls, now>>

RejectRelease(c) ==
  /\ c \in Contenders
  /\ process.alive[c]
  /\ process.token[c] # 0
  /\ ~Authorized(c)
  /\ observations' =
       [Observe("reject-release") EXCEPT
         !.rejectedLease =
           [ holder |-> durable.holder,
             expires |-> durable.expires,
             fence |-> durable.fence,
             current |-> durable.current ]]
  /\ UNCHANGED <<durable, process, bodyCalls, now>>

Allocate(c, key) ==
  /\ c \in Contenders
  /\ key \in AttemptKeys
  /\ Authorized(c)
  /\ durable.phase[key] = "unused"
  /\ durable.generation < MaxGeneration
  /\ LET nextGeneration == durable.generation + 1
     IN /\ durable' =
              [durable EXCEPT
                !.generation = nextGeneration,
                !.phase[key] = "allocated",
                !.ref[key] = nextGeneration]
        /\ process' =
              [process EXCEPT
                !.activeKey[c] = key,
                !.bodyDone[c] = FALSE]
        /\ observations' =
              [Observe("allocate") EXCEPT
                !.highGeneration = nextGeneration]
  /\ UNCHANGED <<bodyCalls, now>>

\* Allocation under a stable key returns an existing attempt; rebinding an
\* allocated or staged attempt lets a successor holder safely resume it.
RebindAttempt(c, key) ==
  /\ c \in Contenders
  /\ key \in AttemptKeys
  /\ Authorized(c)
  /\ durable.phase[key] \in {"allocated", "staged", "completed"}
  /\ process' =
       [process EXCEPT
         !.activeKey[c] = key,
         !.bodyDone[c] = FALSE]
  /\ observations' = Observe("rebind")
  /\ UNCHANGED <<durable, bodyCalls, now>>

Execute(c, key) ==
  /\ c \in Contenders
  /\ key \in AttemptKeys
  /\ process.alive[c]
  /\ process.activeKey[c] = key
  /\ durable.phase[key] = "allocated"
  /\ bodyCalls[key] < 2
  /\ process' = [process EXCEPT !.bodyDone[c] = TRUE]
  /\ bodyCalls' = [bodyCalls EXCEPT ![key] = @ + 1]
  /\ observations' = Observe("execute")
  /\ UNCHANGED <<durable, now>>

Stage(c, key) ==
  /\ c \in Contenders
  /\ key \in AttemptKeys
  /\ Authorized(c)
  /\ process.activeKey[c] = key
  /\ process.bodyDone[c]
  /\ durable.phase[key] = "allocated"
  /\ durable' = [durable EXCEPT !.phase[key] = "staged"]
  /\ process' = [process EXCEPT !.bodyDone[c] = FALSE]
  /\ observations' = Observe("stage")
  /\ UNCHANGED <<bodyCalls, now>>

AtomicPublish(c, key) ==
  /\ c \in Contenders
  /\ key \in AttemptKeys
  /\ process.alive[c]
  /\ process.activeKey[c] = key
  /\ durable.phase[key] = "staged"
  /\ LeaseIsLive(c)
  /\ (Fault = "omit-publish-fence" \/ CurrentFence(c))
  /\ LET generation == durable.ref[key]
     IN /\ durable' =
              [durable EXCEPT
                !.phase[key] = "completed",
                !.snapshots[generation] = key,
                !.current = generation]
        /\ process' =
              [process EXCEPT
                !.pendingAck[c] = TRUE,
                !.pendingRef[c] = generation,
                !.bodyDone[c] = FALSE]
        /\ observations' =
              [Observe("publish") EXCEPT
                !.publish =
                  [ actor |-> c,
                    priorHolder |-> durable.holder,
                    suppliedFence |-> process.token[c],
                    durableFence |-> durable.fence,
                    priorExpiry |-> durable.expires,
                    operationTime |-> now,
                    actorWasAlive |-> process.alive[c] ]]
  /\ UNCHANGED <<bodyCalls, now>>

AbortPublish(c, key) ==
  /\ c \in Contenders
  /\ key \in AttemptKeys
  /\ process.alive[c]
  /\ process.activeKey[c] = key
  /\ durable.phase[key] = "staged"
  /\ observations' = Observe("abort-publish")
  /\ UNCHANGED <<durable, process, bodyCalls, now>>

\* abandonAttempt: under current authority, an incomplete attempt ends without
\* a result. Its generation stays consumed and its evidence is retained.
Abandon(c, key) ==
  /\ c \in Contenders
  /\ key \in AttemptKeys
  /\ Authorized(c)
  /\ \/ durable.phase[key] \in {"allocated", "staged"}
     \/ (Fault = "abandon-completed" /\ durable.phase[key] = "completed")
  /\ durable' = [durable EXCEPT !.phase[key] = "ended"]
  /\ process' =
       [process EXCEPT
         !.activeKey[c] = IF @ = key THEN NoKey ELSE @,
         !.bodyDone[c] = IF process.activeKey[c] = key THEN FALSE ELSE @]
  /\ observations' = Observe("abandon")
  /\ UNCHANGED <<bodyCalls, now>>

\* recordAcceptance: under current authority, record that an existing
\* retained result was accepted. No model transition reads acceptance records,
\* so they are witnessed rather than stored; only the current pointer and
\* retained history are durable facts an acceptance could disturb.
Accept(c, generation) ==
  /\ c \in Contenders
  /\ generation \in 1..MaxGeneration
  /\ Authorized(c)
  /\ durable.snapshots[generation] # NoKey
  /\ durable' =
       IF Fault = "accept-moves-current"
         THEN [durable EXCEPT !.current = generation]
         ELSE durable
  /\ observations' =
       [Observe("accept") EXCEPT
         !.acceptance = [ ref |-> generation, currentBefore |-> durable.current ]]
  /\ UNCHANGED <<process, bodyCalls, now>>

Ack(c) ==
  /\ c \in Contenders
  /\ process.alive[c]
  /\ process.pendingAck[c]
  /\ LET generation == process.pendingRef[c]
     IN /\ durable.snapshots[generation] # NoKey
        /\ process' =
             [process EXCEPT !.pendingAck[c] = FALSE, !.pendingRef[c] = NoRef]
        /\ observations' =
             [Observe("ack") EXCEPT !.acknowledged = @ \cup {generation}]
  /\ UNCHANGED <<durable, bodyCalls, now>>

RetryCompleted(key) ==
  /\ key \in AttemptKeys
  /\ durable.phase[key] = "completed"
  /\ durable.ref[key] # NoRef
  /\ durable.snapshots[durable.ref[key]] = key
  /\ observations' =
       [Observe("retry-completed") EXCEPT
         !.retryKey = key,
         !.retryRef = durable.ref[key],
         !.retryCallsBefore = bodyCalls[key]]
  /\ UNCHANGED <<durable, process, bodyCalls, now>>

ReadExact(generation) ==
  /\ generation \in 1..MaxGeneration
  /\ durable.snapshots[generation] # NoKey
  /\ observations' =
       [Observe("read-exact") EXCEPT
         !.readRef = generation,
         !.readKey = durable.snapshots[generation]]
  /\ UNCHANGED <<durable, process, bodyCalls, now>>

Crash(c) ==
  /\ c \in Contenders
  /\ process.alive[c]
  /\ process' =
       [process EXCEPT
         !.alive[c] = FALSE,
         !.token[c] = 0,
         !.activeKey[c] = NoKey,
         !.bodyDone[c] = FALSE,
         !.pendingAck[c] = FALSE,
         !.pendingRef[c] = NoRef]
  /\ observations' = Observe("crash")
  /\ UNCHANGED <<durable, bodyCalls, now>>

Restart(c) ==
  /\ c \in Contenders
  /\ ~process.alive[c]
  /\ process' =
       [process EXCEPT
         !.alive[c] = TRUE,
         !.token[c] = 0,
         !.activeKey[c] = NoKey,
         !.bodyDone[c] = FALSE,
         !.pendingAck[c] = FALSE,
         !.pendingRef[c] = NoRef]
  /\ observations' = Observe("restart")
  /\ UNCHANGED <<durable, bodyCalls, now>>

Next ==
  \/ \E c \in Contenders: Acquire(c)
  \/ \E c \in Contenders: Held(c)
  \/ \E c \in Contenders: Reclaim(c)
  \/ Tick
  \/ \E c \in Contenders: Renew(c)
  \/ \E c \in Contenders: RejectRenew(c)
  \/ \E c \in Contenders: Release(c)
  \/ \E c \in Contenders: RejectRelease(c)
  \/ \E c \in Contenders, key \in AttemptKeys: Allocate(c, key)
  \/ \E c \in Contenders, key \in AttemptKeys: RebindAttempt(c, key)
  \/ \E c \in Contenders, key \in AttemptKeys: Execute(c, key)
  \/ \E c \in Contenders, key \in AttemptKeys: Stage(c, key)
  \/ \E c \in Contenders, key \in AttemptKeys: AtomicPublish(c, key)
  \/ \E c \in Contenders, key \in AttemptKeys: AbortPublish(c, key)
  \/ \E c \in Contenders, key \in AttemptKeys: Abandon(c, key)
  \/ \E c \in Contenders, generation \in 1..MaxGeneration: Accept(c, generation)
  \/ \E c \in Contenders: Ack(c)
  \/ \E key \in AttemptKeys: RetryCompleted(key)
  \/ \E generation \in 1..MaxGeneration: ReadExact(generation)
  \/ \E c \in Contenders: Crash(c)
  \/ \E c \in Contenders: Restart(c)

\* TLC checks finite safety only; no fairness or liveness is asserted.
Spec == Init /\ [][Next]_vars

=============================================================================
