/**
 * Deterministic fake "paid" bodies shared by both fixture processes. Each body
 * appends its own invocation to `paid`, so invocation counts come from the
 * work itself rather than from the driver's claims. Their emitted text is
 * the implementation evidence the candidate records.
 */
import { forward, isList } from '../src/protocol.js';
import type { IContext, IData, IFoldContext } from '../src/protocol.js';

/** Paid invocations in this process, e.g. `summary:c-1`, `assess:pr-2`, `report`. */
export const paid: string[] = [];

/** Gate evaluations are cheap and nonmemoized, but counted to prove "no member work". */
export const gateEvaluations: string[] = [];

/** The standard member summary: derived PR ids, one forwarded input, consumed child scores. */
export function summaryBody(context: IContext): IData {
  paid.push(`summary:${context.key ?? ''}`);
  const login = context.read(['member', 'login']);
  const prs = context.read(['member', 'prs']);
  if (!isList(prs)) {
    throw new TypeError('prs must be a list');
  }
  let total = 0;
  for (const prId of prs) {
    const score = context.call('assessor', prId, forward(['input', 'pulls'])).read(['score']);
    if (typeof score !== 'number') {
      throw new TypeError('score must be numeric');
    }
    total += score;
  }
  return { login, total, count: prs.length };
}

/** Variant passing an intentionally unreconstructible function argument to every assessment. */
export function summaryWithCallback(context: IContext): IData {
  paid.push(`summary:${context.key ?? ''}`);
  const login = context.read(['member', 'login']);
  const prs = context.read(['member', 'prs']);
  if (!isList(prs)) {
    throw new TypeError('prs must be a list');
  }
  let total = 0;
  for (const prId of prs) {
    const format = (text: string): string => text.toUpperCase();
    const score = context.call('assessor', prId, forward(['input', 'pulls']), format).read(['score']);
    if (typeof score !== 'number') {
      throw new TypeError('score must be numeric');
    }
    total += score;
  }
  return { login, total, count: prs.length };
}

/** Variant that consults untracked configuration before deriving its child arguments. */
export function summaryWithPeek(context: IContext): IData {
  paid.push(`summary:${context.key ?? ''}`);
  const mode = context.peek(['input', 'config', 'unread']);
  const login = context.read(['member', 'login']);
  const prs = context.read(['member', 'prs']);
  if (!isList(prs)) {
    throw new TypeError('prs must be a list');
  }
  let total = 0;
  for (const prId of prs) {
    const score = context.call('assessor', mode === 'reverse' ? String(prId) : prId, forward(['input', 'pulls'])).read(['score']);
    if (typeof score !== 'number') {
      throw new TypeError('score must be numeric');
    }
    total += score;
  }
  return { login, total, count: prs.length };
}

/** Variant whose success can be `undefined`: members without PRs produce no value. */
export function summaryOptional(context: IContext): IData | undefined {
  paid.push(`summary:${context.key ?? ''}`);
  const prs = context.read(['member', 'prs']);
  if (!isList(prs) || prs.length === 0) {
    return undefined;
  }
  let total = 0;
  for (const prId of prs) {
    const score = context.call('assessor', prId, forward(['input', 'pulls'])).read(['score']);
    total += typeof score === 'number' ? score : 0;
  }
  return { total };
}

/** Assessor A: large changes score 3; the explanation reads the title. */
export function assessorA(context: IContext): IData {
  const prId = context.read(['argument', 0]);
  if (typeof prId !== 'string') {
    throw new TypeError('assessor expects a PR id');
  }
  paid.push(`assess:${prId}`);
  const size = context.read(['argument', 1, prId, 'size']);
  const title = context.read(['argument', 1, prId, 'title']);
  if (typeof size !== 'number' || size < 0) {
    throw new Error(`PR ${prId} evidence is broken`);
  }
  return { score: size > 100 ? 3 : 1, explanation: `A: ${String(title)}` };
}

/** Assessor B: different code and explanation, equal scores to A on every fixture PR. */
export function assessorB(context: IContext): IData {
  const prId = context.read(['argument', 0]);
  if (typeof prId !== 'string') {
    throw new TypeError('assessor expects a PR id');
  }
  paid.push(`assess:${prId}`);
  const size = context.read(['argument', 1, prId, 'size']);
  if (typeof size !== 'number' || size < 0) {
    throw new Error(`PR ${prId} evidence is broken`);
  }
  const large = size > 100;
  return { score: large ? 3 : 1, explanation: `B: ${large ? 'large' : 'small'} change` };
}

/** Assessor C: a lower threshold, so `pr-4` (size 80) changes its selected score. */
export function assessorC(context: IContext): IData {
  const prId = context.read(['argument', 0]);
  if (typeof prId !== 'string') {
    throw new TypeError('assessor expects a PR id');
  }
  paid.push(`assess:${prId}`);
  const size = context.read(['argument', 1, prId, 'size']);
  if (typeof size !== 'number' || size < 0) {
    throw new Error(`PR ${prId} evidence is broken`);
  }
  return { score: size > 50 ? 3 : 1, explanation: 'C' };
}

/** Relay assessor for forwarded-origin chains: upper-cases a forwarded record's `bio`. */
export function relayAssessor(context: IContext): IData {
  const text = context.read(['argument', 0, 'bio']);
  if (typeof text !== 'string') {
    throw new TypeError('relay expects bio text');
  }
  paid.push(`relay:${text}`);
  return { bio: text.toUpperCase(), long: text.length > 5 };
}

/** A member computation that forwards an earlier child's output to a later child. */
export function relayBody(context: IContext): IData {
  paid.push(`chain:${context.key ?? ''}`);
  const first = context.call('assessor', forward(['member']));
  const long = first.read(['long']);
  const second = context.call('assessor', forward(['child', 0]));
  return { long, text: second.read(['bio']) };
}

/** A zero-argument assessor, exercising the M3 `empty` argument form. */
export function constantAssessor(context: IContext): IData {
  paid.push(`constant:${context.key ?? ''}`);
  return { score: 1 };
}

/** A member computation making one argument-free child call. */
export function emptyCallBody(context: IContext): IData {
  paid.push(`empty:${context.key ?? ''}`);
  return context.call('assessor').read(['score']);
}

/** The tracked activity gate: member activity against configured minimum. */
export function activityGate(context: IContext): boolean {
  gateEvaluations.push(context.key ?? '');
  const activity = context.read(['member', 'activity']);
  const minimum = context.read(['input', 'config', 'minActivity']);
  if (typeof activity !== 'number' || typeof minimum !== 'number') {
    throw new TypeError('gate evidence must be numeric');
  }
  return activity >= minimum;
}

/** A gate returning a truthy number; registered untyped, it must fail rather than skip or run. */
export function truthyGate(context: IContext): number {
  gateEvaluations.push(context.key ?? '');
  const activity = context.read(['member', 'activity']);
  return typeof activity === 'number' ? activity : 0;
}

/** The strict repository report: consumes each included member's total and lists skips. */
export function reportBody(context: IFoldContext): IData {
  paid.push('report');
  const included: string[] = [];
  const skipped: string[] = [];
  let total = 0;
  for (const entry of context.members()) {
    if (entry.status === 'skipped') {
      skipped.push(entry.key);
      continue;
    }
    const value = context.read(['member', entry.key, 'total']);
    if (typeof value !== 'number') {
      throw new TypeError('member total must be numeric');
    }
    total += value;
    included.push(entry.key);
  }
  return { total, included, skipped };
}

/** A fold that tries to read a skipped member's data, which must never look like `undefined`. */
export function greedyReport(context: IFoldContext): IData {
  paid.push('report');
  const values: IData[] = [];
  for (const entry of context.members()) {
    values.push(context.read(['member', entry.key, 'total']));
  }
  return values;
}
