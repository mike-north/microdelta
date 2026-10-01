/**
 * The M5 acceptance suite's paid-like provider: a deterministic stand-in for
 * a paid assessment service that never costs anything. Every worker process
 * reaches the same provider directory, so its behavior and its ledger span
 * processes, as a real provider account would.
 *
 * - **Script.** The world file lists, per pull request key, the responses of
 *   its successive requests. A request's position is the number of requests
 *   the ledger already holds for that key, so a script continues across
 *   processes; a request beyond the list is answered `ok`.
 * - **Ledger.** `ledger.jsonl` records every request `received`, every
 *   effect `applied` (performed, whether or not its response then arrives),
 *   and every request `aborted` by a hard stop, with the operation, request
 *   attempt and idempotency key, the provider clock time and the process id.
 *   Lines are appended synchronously, so a SIGKILL leaves an honest record.
 * - **Gates.** A `gate` response holds its request until the file
 *   `gates/<name>` exists in the provider directory, which the test parent
 *   creates; a `stall` never answers. Both end at once when the send aborts.
 * - **Usage.** An answered assessment reports 100 `tokens` under
 *   `usage-<key>-<n>` (or the scripted report identity); a refusal reports 1
 *   `requests` under `refusal-<key>-<n>`; a lost response reports nothing.
 * - **Idempotency.** A request carrying an idempotency key that the provider
 *   already applied is answered from that first application: no second
 *   effect, and the same usage report identity redelivered.
 * - **Planted values.** Every answer body and error message carries
 *   {@link planted} and the request's pull request title, so the privacy case
 *   can prove neither reaches events, diagnostics, stdout or stderr.
 *
 * @see ../../../../docs/plans/m5-operations.md (Consumer outcome: the paid-like assessor)
 * @see ../../../../experiments/exp-8/decision.md (bounded domain: the fake paid provider)
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { IOperationResponse, IOperationSend } from 'microdelta';

/** The secret every answer body and provider error message carries; it must never appear in framework output. */
export const planted = 'PLANTED-m5-acceptance-5ecret';

/** Tokens one answered assessment reports. */
export const tokensPerAssessment = 100;

/**
 * One scripted response:
 * - `ok`: apply the assessment and answer it, optionally after `delayMs` and under a fixed `report` identity;
 * - `gate`: wait until the parent opens `gate`, then answer as `ok`;
 * - `stall`: never answer; only an abort ends the request;
 * - `rate-limit`: refuse with a retry time `retryMs` after receipt, applying nothing;
 * - `refuse`: refuse permanently, applying nothing;
 * - `transient`: refuse transiently, applying nothing, optionally under a fixed `report` identity;
 * - `lost`: apply the assessment, then lose the response;
 * - `lost-unapplied`: lose the request before the provider applies it.
 */
export type IScriptedResponse =
  | { readonly kind: 'ok'; readonly report?: string; readonly delayMs?: number }
  | { readonly kind: 'gate'; readonly gate: string }
  | { readonly kind: 'stall' }
  | { readonly kind: 'rate-limit'; readonly retryMs: number }
  | { readonly kind: 'refuse' }
  | { readonly kind: 'transient'; readonly report?: string }
  | { readonly kind: 'lost' }
  | { readonly kind: 'lost-unapplied' };

/** One ledger line. */
export interface ILedgerEntry {
  readonly kind: 'received' | 'applied' | 'aborted';
  readonly key: string;
  readonly operation: string;
  readonly requestAttempt: string;
  readonly idempotencyKey: string | null;
  /** The provider clock reading (the host's wall clock as the sending process sees it), in epoch milliseconds. */
  readonly at: number;
  /** The process that sent the request. */
  readonly pid: number;
}

/** What the provider answers for one assessment: it carries planted values, as a real response body would. */
export interface IProviderAnswer {
  readonly score: number;
  readonly explanation: string;
}

/** The pull request a request concerns, as the request carries it. */
export interface IProviderRequest {
  readonly key: string;
  readonly merged: boolean;
  readonly title: string;
}

/** Whether a parsed ledger line is a ledger entry. */
function isLedgerEntry(value: unknown): value is ILedgerEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const kind: unknown = Reflect.get(value, 'kind');
  const idempotencyKey: unknown = Reflect.get(value, 'idempotencyKey');
  return (kind === 'received' || kind === 'applied' || kind === 'aborted')
    && ['key', 'operation', 'requestAttempt'].every((field) => typeof Reflect.get(value, field) === 'string')
    && (idempotencyKey === null || typeof idempotencyKey === 'string')
    && typeof Reflect.get(value, 'at') === 'number'
    && typeof Reflect.get(value, 'pid') === 'number';
}

/** The ledger file of a provider directory. */
function ledgerFile(directory: string): string {
  return join(directory, 'ledger.jsonl');
}

/** Every ledger line of the provider directory, in order, including lines of earlier processes. */
export function readLedger(directory: string): readonly ILedgerEntry[] {
  const file = ledgerFile(directory);
  if (!existsSync(file)) {
    return [];
  }
  return readFileSync(file, 'utf8').split('\n').filter((line) => line.length > 0).map((line) => {
    const parsed: unknown = JSON.parse(line);
    if (!isLedgerEntry(parsed)) {
      throw new Error(`${file} holds a malformed line`);
    }
    return parsed;
  });
}

/** The gate file the parent creates to release a `gate` response. */
export function gateFile(directory: string, gate: string): string {
  return join(directory, 'gates', gate);
}

/** Observes requests as the provider receives them, for a worker's stop and kill plans. */
export type IReceiptListener = (key: string) => void;

/** The provider's view of one process: where its directory is and who listens to receipts. */
export interface IProviderProcess {
  readonly directory: string;
  /** Called synchronously when a request is about to reach the provider, before anything is recorded. */
  readonly onSend: IReceiptListener;
  /** Called synchronously after a request's receipt is recorded, before anything else happens to it. */
  readonly onReceived: IReceiptListener;
  /** Called synchronously after an effect is recorded applied, before its response is returned. */
  readonly onApplied: IReceiptListener;
}

/** Wait `milliseconds`, rejecting at once when the send aborts. */
function delay(milliseconds: number, send: IOperationSend, aborted: () => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let stopListening: () => void = () => undefined;
    const timer = setTimeout(() => {
      stopListening();
      resolve();
    }, milliseconds);
    stopListening = send.signal.onAbort(() => {
      clearTimeout(timer);
      aborted();
      reject(new Error(`the request was abandoned after an abort: ${planted}`));
    });
  });
}

/** Wait until `file` exists, polling, or reject at once when the send aborts. */
function opened(file: string, send: IOperationSend, aborted: () => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let stopListening: () => void = () => undefined;
    const poll = setInterval(() => {
      if (existsSync(file)) {
        clearInterval(poll);
        stopListening();
        resolve();
      }
    }, 10);
    stopListening = send.signal.onAbort(() => {
      clearInterval(poll);
      aborted();
      reject(new Error(`the gated request was abandoned after an abort: ${planted}`));
    });
  });
}

/** Never answer; reject only when the send aborts. */
function stall(send: IOperationSend, aborted: () => void): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    // The stalled request keeps its process alive until a hard stop aborts it or the process is killed.
    const keepAlive = setInterval(() => undefined, 60_000);
    send.signal.onAbort(() => {
      clearInterval(keepAlive);
      aborted();
      reject(new Error(`the stalled request was abandoned after an abort: ${planted}`));
    });
  });
}

/**
 * Perform one assessment request for `request` under `script`, recording it
 * in the provider's ledger. A rejection is a lost response (an unknown
 * outcome) for the framework.
 */
export async function perform(provider: IProviderProcess, script: readonly IScriptedResponse[], request: IProviderRequest, send: IOperationSend): Promise<IOperationResponse<IProviderAnswer>> {
  const { directory } = provider;
  provider.onSend(request.key);
  mkdirSync(directory, { recursive: true });
  const earlier = readLedger(directory);
  const position = earlier.filter((entry) => entry.kind === 'received' && entry.key === request.key).length;
  const response: IScriptedResponse = script[position] ?? { kind: 'ok' };
  const line = { key: request.key, operation: send.operation, requestAttempt: send.requestAttempt, idempotencyKey: send.idempotencyKey ?? null };
  const record = (kind: ILedgerEntry['kind'], at: number = Date.now()): void => {
    appendFileSync(ledgerFile(directory), `${JSON.stringify({ kind, ...line, at, pid: process.pid })}\n`);
  };
  // One clock reading is both the recorded receipt time and the base of a rate limit's retry time.
  const receivedAt = Date.now();
  record('received', receivedAt);
  provider.onReceived(request.key);
  const aborted = (): void => {
    record('aborted');
  };
  const number = String(position + 1);
  const score = request.merged ? 2 : 1;
  const answer: IProviderAnswer = { score, explanation: `${request.title} scores ${String(score)}: ${planted}` };
  const answered = (report: string | undefined): IOperationResponse<IProviderAnswer> => ({
    kind: 'succeeded',
    value: answer,
    usage: { report: report ?? `usage-${request.key}-${number}`, quantities: [{ unit: 'tokens', amount: tokensPerAssessment }] },
  });
  // A provider that deduplicates by idempotency key answers a repeated key from its first application.
  if (send.idempotencyKey !== undefined) {
    const first = earlier.findIndex((entry) => entry.kind === 'applied' && entry.idempotencyKey === send.idempotencyKey);
    if (first !== -1) {
      const firstNumber = earlier.slice(0, first).filter((entry) => entry.kind === 'received' && entry.key === request.key).length;
      return answered(`usage-${request.key}-${String(firstNumber)}`);
    }
  }
  const refusal = { report: `refusal-${request.key}-${number}`, quantities: [{ unit: 'requests', amount: 1 }] };
  const apply = (): void => {
    record('applied');
    provider.onApplied(request.key);
  };
  switch (response.kind) {
    case 'ok':
      if (response.delayMs !== undefined) {
        await delay(response.delayMs, send, aborted);
      }
      apply();
      return answered(response.report);
    case 'gate':
      await opened(gateFile(directory, response.gate), send, aborted);
      apply();
      return answered(undefined);
    case 'stall':
      return stall(send, aborted);
    case 'rate-limit':
      return { kind: 'rate-limited', retryAt: receivedAt + response.retryMs, usage: refusal };
    case 'refuse':
      return { kind: 'failed', transient: false, error: new Error(`the provider refused ${request.title}: ${planted}`), usage: refusal };
    case 'transient':
      return { kind: 'failed', transient: true, error: new Error(`the provider is unavailable for ${request.title}: ${planted}`), usage: { ...refusal, report: response.report ?? refusal.report } };
    case 'lost':
      apply();
      throw new Error(`the response for ${request.title} was lost after applying: ${planted}`);
    case 'lost-unapplied':
      throw new Error(`the request for ${request.title} was lost before the provider: ${planted}`);
    default: {
      const exhaustive: never = response;
      return exhaustive;
    }
  }
}
