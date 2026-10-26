/**
 * Run Supervision's process-local coordinator for shared rate constraints.
 * It interns non-secret logical surfaces, maintains overlapping gate state,
 * and offers a controlled final admission transition; it never dispatches,
 * classifies provider responses, or owns retry policy. Elapsed time measures
 * rolling windows and local pacing, while accepted absolute floors use the
 * independent epoch clock (RUN-019, ARC-001, ARC-010).
 * @packageDocumentation
 */

/**
 * Structural port for process-local monotonic elapsed time. A matching Machine
 * capability supplies arbitrary-origin, safe whole milliseconds that never
 * decrease during its lifetime; elapsed values have no epoch or persistence
 * meaning. Supervision validates readings and owns their admission semantics.
 * @alpha
 */
export interface IRunElapsedClock {
  /** Return a safe whole-millisecond duration from an arbitrary process-local origin, never decreasing within its lifetime. */
  currentElapsedMilliseconds(): number;
}

/**
 * Structural port for absolute epoch floors. This independent wall-clock
 * domain may be corrected forwards or backwards and never measures debit age.
 * @alpha
 */
export interface IRunEpochClock {
  /** Return current absolute epoch milliseconds; corrections do not alter elapsed debit age. */
  currentEpochMilliseconds(): number;
}

/** Failure categories keep bad declarations separate from time-contract failures. @alpha */
export type ISharedRateErrorCode = 'invalid-declaration' | 'conflicting-declaration' | 'unknown-association' | 'invalid-plan';

/** A checked refusal to intern a declaration or association that cannot be trusted. @alpha */
export class SharedRateCoordinatorError extends Error {
  /** The contract boundary that rejected the operation. */
  public readonly code: ISharedRateErrorCode;

  /** Create a typed coordinator configuration failure. */
  public constructor(code: ISharedRateErrorCode, message: string) {
    super(message);
    this.name = 'SharedRateCoordinatorError';
    this.code = code;
  }
}

/** A positive integer unit ceiling over a rolling elapsed-time interval. @alpha */
export interface ISharedRateLimit {
  /** Maximum admitted request or quantity units retained in the rolling interval. */
  readonly units: number;
  /** Rolling elapsed-time interval over which committed possible-send cost is counted. */
  readonly intervalMilliseconds: number;
  /** Whether each possible send consumes exactly one request or an explicit quantity cost. */
  readonly costBasis: 'requests' | 'quantity';
}

/** One stable, non-secret gate association declared for a surface. @alpha */
export interface ISharedRateGateDeclaration {
  /** Stable, non-secret association name shared by surfaces in the same service/access scope. */
  readonly id: string;
  /** Optional numeric pacing bound; omission retains membership without inventing a limit. */
  readonly limit?: ISharedRateLimit;
}

/** A non-secret scope identity that is interned by one coordinator owner. @alpha */
export interface ISharedRateSurfaceDeclaration {
  /** Exact non-secret deployment identity; it is never inferred from a host name. */
  readonly environment: string;
  /** Exact service identity that scopes shared gate associations. */
  readonly service: string;
  /** Exact non-secret authorization/account scope for independent rate ledgers. */
  readonly accessContext: string;
  /** Logical API surface identity used to intern repeated declarations. */
  readonly surface: string;
  /** Immutable mandatory memberships and configured bounds for this surface. */
  readonly gates?: readonly ISharedRateGateDeclaration[];
}

/** Opaque coordinator-owned reference to one registered surface. @alpha */
export interface ISharedRateSurface {
  /** Opaque coordinator-issued identity; object identity, not caller-created IDs, authenticates it. */
  readonly id: string;
}

/** A provisional admission whose final commit is checked before possible send. @alpha */
export interface ISharedRateReservation {
  /** Release this uncommitted preview while transport is known not to have started; the token never authorizes sending. */
  rollbackBeforeSend(): void;
  /** Recheck current coordinator state and stamp possible-send evidence; #238 must bind this to its synchronous transport boundary. */
  commitPossibleSend(): ISharedRateCommitResult;
}

/** Result of the final fresh pre-invocation check. @alpha */
export type ISharedRateCommitResult =
  | { readonly kind: 'committed' }
  | { readonly kind: 'wait'; readonly notBefore?: number; readonly retryAtElapsed?: number }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'timing-failure'; readonly reason: string };

/** One provisional admission outcome; waiting and invalid input stay distinct. @alpha */
export type ISharedRateAdmission =
  | ({ readonly kind: 'admitted' } & ISharedRateReservation)
  | { readonly kind: 'wait'; readonly notBefore?: number; readonly retryAtElapsed?: number }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'timing-failure'; readonly reason: string };

/** A coordinator operation for controlled Supervision admission. @alpha */
export interface ISharedRateCoordinator {
  /** Intern a non-secret environment/service/access/surface tuple and its immutable memberships. */
  registerSurface(declaration: ISharedRateSurfaceDeclaration): ISharedRateSurface;
  /** Preview eligibility against the full coordinator-derived gate union; no gate subset is caller-controlled. */
  admit(request: {
    readonly surface: ISharedRateSurface;
    readonly run: string;
    /** Exact or conservative pre-send application quantity, never post-send billed usage. Required when any gate uses quantity units. */
    readonly quantityCost?: number;
    /** Immutable snapshot of an already accepted absolute floor; #238 must re-read current operation state at final send composition. */
    readonly acceptedNotBefore?: number;
  }): ISharedRateAdmission;
  /** Merge an authoritative absolute epoch floor into a registered mandatory gate. */
  observeCooldown(surface: ISharedRateSurface, gateId: string, epochFloor: number): void;
}

/** Factory options make both independent time domains explicit. @alpha */
export interface ISharedRateCoordinatorOptions {
  /** Monotonic duration source for rolling debit age and local pacing. */
  readonly elapsedClock: IRunElapsedClock;
  /** Correctable absolute time source for accepted cooldown and operation floors. */
  readonly epochClock: IRunEpochClock;
}

/** Operations deliberately available only to Supervision's controlled implementation tests. */
interface ISharedRateTestSeam {
  installConstantPlan(surface: ISharedRateSurface, plan: { readonly gate: ISharedRateGateDeclaration; readonly paceMilliseconds: number }): void;
  inspectDebits(surface: ISharedRateSurface, gateId: string): readonly IDebit[];
}

/** Test seams are held by owner identity; their methods never become dispatch authority. */
const testSeams = new WeakMap<ISharedRateCoordinator, ISharedRateTestSeam>();

/** @internal Install an additive constant plan in controlled coordinator tests before admission. */
export function _installSharedRateConstantPlan(coordinator: ISharedRateCoordinator, surface: ISharedRateSurface, plan: { readonly gate: ISharedRateGateDeclaration; readonly paceMilliseconds: number }): void {
  const seam = testSeams.get(coordinator);
  if (seam === undefined) {
    throw new SharedRateCoordinatorError('unknown-association', 'Coordinator test seam is unavailable for this owner');
  }
  seam.installConstantPlan(surface, plan);
}

/** @internal Inspect retained debit evidence without exposing ledger state to consumers. */
export function _inspectSharedRateDebits(coordinator: ISharedRateCoordinator, surface: ISharedRateSurface, gateId: string): readonly IDebit[] {
  const seam = testSeams.get(coordinator);
  if (seam === undefined) {
    throw new SharedRateCoordinatorError('unknown-association', 'Coordinator test seam is unavailable for this owner');
  }
  return seam.inspectDebits(surface, gateId);
}

/** Immutable coordinator-owned evidence for one committed possible-send transition. */
interface IDebit {
  readonly at: number;
  readonly cost: number;
}

/** One logical gate shared only within its declared service/access scope. */
interface IGateState {
  readonly id: string;
  readonly limit: ISharedRateLimit | undefined;
  readonly debits: IDebit[];
  cooldownFloor: number | undefined;
}

/** Interned surface memberships plus optional constant-plan pacing. */
interface ISurfaceState {
  readonly handle: ISharedRateSurface;
  readonly identity: string;
  readonly gateKeys: Set<string>;
  readonly gates: Map<string, IGateState>;
  readonly scope: readonly [string, string, string];
  readonly gatesSignature: string;
  planPaceMilliseconds: number | undefined;
  nextPlanAdmission: number | undefined;
  hasCommittedDebit: boolean;
}

/** A gate outcome is computed before any provisional request becomes a debit. */
type IGateCheck =
  | { readonly kind: 'ready' }
  | { readonly kind: 'wait'; readonly notBefore?: number; readonly retryAtElapsed?: number }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'timing-failure'; readonly reason: string };

/** Positive safe-integer values are the only supported units and durations. */
function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/** Stable JSON tuple keys preserve exact declared identity without hostname or secret inference. */
function tupleKey(parts: readonly string[]): string {
  return JSON.stringify(parts);
}

/** A configured gate is copied before storage so later caller mutation cannot revise its contract. */
function checkedLimit(limit: ISharedRateLimit | undefined): ISharedRateLimit | undefined {
  if (limit === undefined) {
    return undefined;
  }
  if (!isPositiveSafeInteger(limit.units) || !isPositiveSafeInteger(limit.intervalMilliseconds) || (limit.costBasis !== 'requests' && limit.costBasis !== 'quantity')) {
    throw new SharedRateCoordinatorError('invalid-declaration', 'Rate limit units and interval must be positive safe integers with a supported cost basis');
  }
  return Object.freeze({ units: limit.units, intervalMilliseconds: limit.intervalMilliseconds, costBasis: limit.costBasis });
}

/** Omitted limit differs from an explicit configured bound in an interned declaration. */
function limitSignature(limit: ISharedRateLimit | undefined): string {
  return limit === undefined ? 'unconfigured' : `${String(limit.units)}:${String(limit.intervalMilliseconds)}:${limit.costBasis}`;
}

/** Convert host read failures to bounded diagnostics without exposing exception details. */
function readClock(read: () => number, label: string): { readonly value: number } | { readonly reason: string } {
  try {
    const value = read();
    if (!Number.isSafeInteger(value)) {
      return { reason: `${label} clock did not return a safe whole millisecond value` };
    }
    return { value };
  } catch {
    return { reason: `${label} clock read failed` };
  }
}

/**
 * Create one owner for interning surfaces and sharing volatile rate state.
 * State is shared only when composed consumers share this exact instance.
 * @alpha
 */
export function createSharedRateCoordinator(options: ISharedRateCoordinatorOptions): ISharedRateCoordinator {
  const surfacesByIdentity = new Map<string, ISurfaceState>();
  const gatesByKey = new Map<string, IGateState>();
  const statesByHandle = new Map<ISharedRateSurface, ISurfaceState>();
  let nextSurfaceNumber = 0;
  let lastElapsed: number | undefined;
  let elapsedFailure: string | undefined;

  /** Validate Machine's duration reading and retain the first contract violation. */
  const elapsedNow = (): { readonly value: number } | { readonly reason: string } => {
    if (elapsedFailure !== undefined) {
      return { reason: elapsedFailure };
    }
    const reading = readClock(() => options.elapsedClock.currentElapsedMilliseconds(), 'Elapsed');
    if ('reason' in reading) {
      elapsedFailure = reading.reason;
      return reading;
    }
    if (reading.value < 0 || (lastElapsed !== undefined && reading.value < lastElapsed)) {
      elapsedFailure = 'Elapsed clock returned a negative or decreasing value';
      return { reason: elapsedFailure };
    }
    lastElapsed = reading.value;
    return reading;
  };

  /** Epoch corrections are accepted as observations; only invalid samples close the current check. */
  const epochNow = (): { readonly value: number } | { readonly reason: string } => {
    return readClock(() => options.epochClock.currentEpochMilliseconds(), 'Epoch');
  };

  /** Resolve an opaque handle by object identity so callers cannot forge a matching public ID. */
  const stateFor = (surface: ISharedRateSurface): ISurfaceState => {
    const state = statesByHandle.get(surface);
    if (state === undefined) {
      throw new SharedRateCoordinatorError('unknown-association', 'Surface handle was not registered by this coordinator');
    }
    return state;
  };

  /** Convert a limit wait into the first elapsed instant at which enough historical weight expires. */
  const capacityWait = (gate: IGateState, now: number, cost: number): IGateCheck => {
    const limit = gate.limit;
    if (limit === undefined) {
      return { kind: 'ready' };
    }
    const cutoff = now - limit.intervalMilliseconds;
    if (!Number.isSafeInteger(cutoff)) {
      return { kind: 'refused', reason: `Rolling cutoff overflow for gate ${gate.id}` };
    }
    for (let index = gate.debits.length - 1; index >= 0; index -= 1) {
      const debit = gate.debits[index];
      if (debit !== undefined && debit.at <= cutoff) {
        gate.debits.splice(index, 1);
      }
    }
    let total = 0;
    for (const debit of gate.debits) {
      total += debit.cost;
      if (!Number.isSafeInteger(total)) {
        return { kind: 'refused', reason: `Rolling debit sum overflow for gate ${gate.id}` };
      }
    }
    const combined = total + cost;
    if (!Number.isSafeInteger(combined)) {
      return { kind: 'refused', reason: `Proposed debit sum overflow for gate ${gate.id}` };
    }
    if (combined <= limit.units) {
      return { kind: 'ready' };
    }
    let remaining = total;
    for (const debit of gate.debits) {
      remaining -= debit.cost;
      const retryAtElapsed = debit.at + limit.intervalMilliseconds;
      if (!Number.isSafeInteger(retryAtElapsed)) {
        return { kind: 'refused', reason: `Rolling expiry overflow for gate ${gate.id}` };
      }
      if (remaining + cost <= limit.units) {
        return { kind: 'wait', retryAtElapsed };
      }
    }
    return { kind: 'refused', reason: `Cost exceeds configured capacity for gate ${gate.id}` };
  };

  /** Assess every current gate without placing a debit; all gates must pass together. */
  const check = (state: ISurfaceState, quantityCost: number | undefined, acceptedNotBefore: number | undefined, elapsed: number, epoch: number): IGateCheck => {
    const gates = Array.from(state.gateKeys, (key) => gatesByKey.get(key)).filter((gate): gate is IGateState => gate !== undefined);
    const quantityGates = gates.filter((gate) => gate.limit?.costBasis === 'quantity');
    if (quantityCost !== undefined && !isPositiveSafeInteger(quantityCost)) {
      return { kind: 'refused', reason: 'Quantity cost must be a positive safe integer when supplied' };
    }
    if (quantityGates.length > 0 && quantityCost === undefined) {
      return { kind: 'refused', reason: 'A quantity gate requires exact or conservative quantity cost evidence' };
    }
    if (acceptedNotBefore !== undefined && !Number.isSafeInteger(acceptedNotBefore)) {
      return { kind: 'refused', reason: 'Accepted operation floor must be a safe whole epoch millisecond value' };
    }
    if (state.nextPlanAdmission !== undefined && elapsed < state.nextPlanAdmission) {
      return { kind: 'wait', retryAtElapsed: state.nextPlanAdmission };
    }
    let retryAtElapsed: number | undefined;
    let notBefore: number | undefined = acceptedNotBefore !== undefined && epoch < acceptedNotBefore ? acceptedNotBefore : undefined;
    for (const gate of gates) {
      if (gate.cooldownFloor !== undefined && epoch < gate.cooldownFloor) {
        notBefore = notBefore === undefined ? gate.cooldownFloor : Math.max(notBefore, gate.cooldownFloor);
      }
      if (gate.limit !== undefined) {
        const cost = gate.limit.costBasis === 'requests' ? 1 : quantityCost;
        if (cost === undefined) {
          return { kind: 'refused', reason: `Quantity cost is unavailable for gate ${gate.id}` };
        }
        if (cost > gate.limit.units) {
          return { kind: 'refused', reason: `Cost exceeds configured capacity for gate ${gate.id}` };
        }
        const result = capacityWait(gate, elapsed, cost);
        if (result.kind === 'refused' || result.kind === 'timing-failure') {
          return result;
        }
        if (result.kind === 'wait' && result.retryAtElapsed !== undefined) {
          retryAtElapsed = retryAtElapsed === undefined ? result.retryAtElapsed : Math.max(retryAtElapsed, result.retryAtElapsed);
        }
      }
    }
    if (notBefore !== undefined || retryAtElapsed !== undefined) {
      return { kind: 'wait', ...(notBefore === undefined ? {} : { notBefore }), ...(retryAtElapsed === undefined ? {} : { retryAtElapsed }) };
    }
    return { kind: 'ready' };
  };

  /** Return a typed outcome without collapsing epoch floors and elapsed capacity into one time value. */
  const assess = (state: ISurfaceState, quantityCost: number | undefined, acceptedNotBefore: number | undefined): IGateCheck => {
    const elapsed = elapsedNow();
    if ('reason' in elapsed) {
      return { kind: 'timing-failure', reason: elapsed.reason };
    }
    const epoch = epochNow();
    if ('reason' in epoch) {
      return { kind: 'timing-failure', reason: epoch.reason };
    }
    return check(state, quantityCost, acceptedNotBefore, elapsed.value, epoch.value);
  };

  const testSeam: ISharedRateTestSeam = {
    installConstantPlan(surface: ISharedRateSurface, plan: { readonly gate: ISharedRateGateDeclaration; readonly paceMilliseconds: number }): void {
      const state = stateFor(surface);
      if (state.hasCommittedDebit) {
        throw new SharedRateCoordinatorError('invalid-plan', 'Constant plans must be installed before the first debit');
      }
      const pace = plan.paceMilliseconds;
      if (!Number.isSafeInteger(pace) || pace < 0) {
        throw new SharedRateCoordinatorError('invalid-plan', 'Plan pacing must be a non-negative safe integer duration');
      }
      const limit = checkedLimit(plan.gate.limit);
      if (plan.gate.id.trim().length === 0 || plan.gate.id === 'base') {
        throw new SharedRateCoordinatorError('invalid-plan', 'Plan gate ID must be non-empty and cannot replace the base gate');
      }
      const key = tupleKey([...state.scope, plan.gate.id]);
      const existing = gatesByKey.get(key);
      if (existing !== undefined && limitSignature(existing.limit) !== limitSignature(limit)) {
        throw new SharedRateCoordinatorError('invalid-plan', 'Plan cannot change or weaken an existing gate bound');
      }
      const elapsed = elapsedNow();
      if ('reason' in elapsed) {
        throw new SharedRateCoordinatorError('invalid-plan', `Plan commitment time is unavailable: ${elapsed.reason}`);
      }
      const firstPacedAdmission = elapsed.value + pace;
      if (!Number.isSafeInteger(firstPacedAdmission)) {
        throw new SharedRateCoordinatorError('invalid-plan', 'Plan commitment plus pacing overflows elapsed time');
      }
      const gate = existing ?? { id: plan.gate.id, limit, debits: [], cooldownFloor: undefined };
      gatesByKey.set(key, gate);
      state.gateKeys.add(key);
      state.gates.set(key, gate);
      state.planPaceMilliseconds = pace;
      state.nextPlanAdmission = firstPacedAdmission;
    },
    inspectDebits(surface: ISharedRateSurface, gateId: string): readonly IDebit[] {
      const state = stateFor(surface);
      const key = tupleKey([...state.scope, gateId]);
      const gate = gatesByKey.get(key);
      if (gate === undefined || !state.gateKeys.has(key)) {
        throw new SharedRateCoordinatorError('unknown-association', 'Debit inspection gate is not registered on this surface');
      }
      return gate.debits.map((debit) => Object.freeze({ ...debit }));
    },
  };
  const coordinator: ISharedRateCoordinator = {
    registerSurface(declaration: ISharedRateSurfaceDeclaration): ISharedRateSurface {
      const identityParts = [declaration.environment, declaration.service, declaration.accessContext, declaration.surface] as const;
      if (identityParts.some((part) => typeof part !== 'string' || part.trim().length === 0)) {
        throw new SharedRateCoordinatorError('invalid-declaration', 'Surface identity fields must be non-empty strings');
      }
      const scope = [declaration.environment, declaration.service, declaration.accessContext] as const;
      const identity = tupleKey(identityParts);
      const declarations = declaration.gates ?? [];
      const gateDeclarations = new Map<string, ISharedRateLimit | undefined>();
      gateDeclarations.set('base', undefined);
      for (const gate of declarations) {
        if (typeof gate.id !== 'string' || gate.id.trim().length === 0 || gate.id === 'base') {
          throw new SharedRateCoordinatorError('invalid-declaration', 'Gate IDs must be non-empty and cannot use the reserved base ID');
        }
        const limit = checkedLimit(gate.limit);
        const duplicate = gateDeclarations.get(gate.id);
        if (gateDeclarations.has(gate.id) && limitSignature(duplicate) !== limitSignature(limit)) {
          throw new SharedRateCoordinatorError('conflicting-declaration', `Gate ${gate.id} has conflicting declarations on one surface`);
        }
        gateDeclarations.set(gate.id, limit);
      }
      const signatures = Array.from(gateDeclarations.entries()).sort(([left], [right]) => left.localeCompare(right));
      const gatesSignature = JSON.stringify(signatures.map(([id, limit]) => [id, limitSignature(limit)]));
      const existing = surfacesByIdentity.get(identity);
      if (existing !== undefined) {
        if (existing.gatesSignature !== gatesSignature) {
          throw new SharedRateCoordinatorError('conflicting-declaration', 'A repeated surface identity changed its registered gate declarations');
        }
        return existing.handle;
      }
      const candidateGates = Array.from(gateDeclarations, ([id, limit]) => ({ id, limit, key: tupleKey([...scope, id]) }));
      for (const candidate of candidateGates) {
        const current = gatesByKey.get(candidate.key);
        if (current !== undefined && limitSignature(current.limit) !== limitSignature(candidate.limit)) {
          throw new SharedRateCoordinatorError('conflicting-declaration', `Gate ${candidate.id} changed its immutable configured bound`);
        }
      }
      const gateKeys = new Set<string>();
      const gates = new Map<string, IGateState>();
      for (const candidate of candidateGates) {
        const { id, limit, key } = candidate;
        const current = gatesByKey.get(key);
        if (current !== undefined && limitSignature(current.limit) !== limitSignature(limit)) {
          throw new SharedRateCoordinatorError('conflicting-declaration', `Gate ${id} changed its immutable configured bound`);
        }
        const gateState = current ?? { id, limit, debits: [], cooldownFloor: undefined };
        gatesByKey.set(key, gateState);
        gateKeys.add(key);
        gates.set(key, gateState);
      }
      nextSurfaceNumber += 1;
      const handle = Object.freeze({ id: `surface-${String(nextSurfaceNumber)}` });
      const state: ISurfaceState = {
        handle,
        identity,
        gateKeys,
        gates,
        scope,
        gatesSignature,
        planPaceMilliseconds: undefined,
        nextPlanAdmission: undefined,
        hasCommittedDebit: false,
      };
      surfacesByIdentity.set(identity, state);
      statesByHandle.set(handle, state);
      return handle;
    },

    admit(request): ISharedRateAdmission {
      const state = stateFor(request.surface);
      if (typeof request.run !== 'string' || request.run.trim().length === 0) {
        return { kind: 'refused', reason: 'Run label must be a non-empty string' };
      }
      // Snapshot primitive acceptance evidence once; callers cannot mutate it during a reservation.
      const quantityCost = request.quantityCost;
      const acceptedNotBefore = request.acceptedNotBefore;
      const result = assess(state, quantityCost, acceptedNotBefore);
      if (result.kind !== 'ready') {
        return result;
      }
      let active = true;
      const reservation: ISharedRateAdmission = {
        kind: 'admitted',
        rollbackBeforeSend(): void {
          active = false;
        },
        commitPossibleSend(): ISharedRateCommitResult {
          if (!active) {
            return { kind: 'refused', reason: 'Provisional admission has already been consumed' };
          }
          active = false;
          const freshElapsed = elapsedNow();
          if ('reason' in freshElapsed) {
            return { kind: 'timing-failure', reason: freshElapsed.reason };
          }
          const freshEpoch = epochNow();
          if ('reason' in freshEpoch) {
            return { kind: 'timing-failure', reason: freshEpoch.reason };
          }
          const finalCheck = check(state, quantityCost, acceptedNotBefore, freshElapsed.value, freshEpoch.value);
          if (finalCheck.kind !== 'ready') {
            return finalCheck;
          }
          const nextPlanAdmission = state.planPaceMilliseconds === undefined
            ? undefined
            : freshElapsed.value + state.planPaceMilliseconds;
          if (nextPlanAdmission !== undefined && !Number.isSafeInteger(nextPlanAdmission)) {
            return { kind: 'refused', reason: 'Policy pacing expiry overflow' };
          }
          for (const key of state.gateKeys) {
            const gate = gatesByKey.get(key);
            if (gate?.limit !== undefined) {
              const cost = gate.limit.costBasis === 'requests' ? 1 : quantityCost;
              if (cost !== undefined) {
                gate.debits.push(Object.freeze({ at: freshElapsed.value, cost }));
              }
            }
          }
          if (nextPlanAdmission !== undefined) {
            state.nextPlanAdmission = nextPlanAdmission;
          }
          state.hasCommittedDebit = true;
          return { kind: 'committed' };
        },
      };
      return reservation;
    },

    observeCooldown(surface: ISharedRateSurface, gateId: string, epochFloor: number): void {
      const state = stateFor(surface);
      if (!Number.isSafeInteger(epochFloor)) {
        throw new SharedRateCoordinatorError('invalid-declaration', 'Cooldown floor must be a safe whole epoch millisecond value');
      }
      const key = tupleKey([...state.scope, gateId]);
      if (!state.gateKeys.has(key)) {
        throw new SharedRateCoordinatorError('unknown-association', 'Cooldown gate is not a registered membership of this surface');
      }
      const gate = gatesByKey.get(key);
      if (gate === undefined) {
        throw new SharedRateCoordinatorError('unknown-association', 'Cooldown gate association is unknown');
      }
      gate.cooldownFloor = gate.cooldownFloor === undefined ? epochFloor : Math.max(gate.cooldownFloor, epochFloor);
    },

  };
  testSeams.set(coordinator, testSeam);
  return coordinator;
}
