/**
 * A deterministic fake paid provider for the external-operation suites. It
 * never costs anything. Responses are scripted per operation name and member
 * key, consumed in call order; every response body and error message carries
 * a planted value so privacy tests can prove it never reaches events,
 * diagnostics, stdout or stderr. Its ledger of received requests, applied
 * effects and cancellations can persist to a JSON-lines file, so "applied
 * once" holds across separate processes.
 *
 * Script entries:
 * - `ok`: apply the effect, answer `succeeded` with a 100-token usage report;
 * - `ok-no-usage`: apply and succeed without a usage report;
 * - `permanent` / `transient`: refuse without applying (a permanent or
 *   transient failure, each with a 1-request usage report);
 * - `rate-limit:<ms>`: refuse without applying, retry `<ms>` after now;
 * - `rate-limit`: refuse without applying and without a retry time;
 * - `lost`: apply the effect, then lose the response (the adapter rejects);
 * - `lost-unapplied`: lose the request before the provider applies it;
 * - `hang`: wait until released (then `ok`), or until the send's signal aborts.
 *
 * With provider idempotency, a request whose idempotency key already applied
 * is answered `succeeded` without applying the effect again.
 *
 * @see ../../../../experiments/exp-8/decision.md (bounded domain: the fake paid provider)
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

import type { IOperationResponse, IOperationSend } from '@microdelta/supervision';

/** The planted value every response body and error message carries. */
export const planted = 'PLANTED-c0ffee-SECRET';

/** One scripted response. */
export type IScriptEntry = 'ok' | 'ok-no-usage' | 'permanent' | 'transient' | 'rate-limit' | `rate-limit:${number}` | 'lost' | 'lost-unapplied' | 'hang';

/** One ledger line: a request the provider received, an effect it applied, or a cancellation. */
export interface ILedgerEntry {
  readonly kind: 'received' | 'applied' | 'cancelled';
  readonly name: string;
  readonly key: string;
  readonly operation: string;
  readonly requestAttempt: string;
  readonly idempotencyKey: string | null;
}

/** An assessment the provider answers: it carries the planted value. */
export interface IAssessment {
  readonly key: string;
  readonly verdict: string;
}

/** The fake provider. */
export interface IFakeProvider {
  /** Every ledger line, including lines earlier processes persisted. */
  ledger(): readonly ILedgerEntry[];
  /** Script the next responses for `name` on member `key`. */
  script(name: string, key: string, entries: readonly IScriptEntry[]): void;
  /** Perform one request attempt. */
  perform(name: string, key: string, send: IOperationSend): Promise<IOperationResponse<IAssessment>>;
  /** Release a hanging request. */
  release(name: string, key: string): void;
  /** How many requests are in flight now. */
  readonly inFlight: number;
  /** The most requests ever in flight at once. */
  readonly peak: number;
}

/** Narrow one parsed ledger line. */
function isLedgerEntry(value: unknown): value is ILedgerEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const kind: unknown = Reflect.get(value, 'kind');
  const key: unknown = Reflect.get(value, 'idempotencyKey');
  return (kind === 'received' || kind === 'applied' || kind === 'cancelled')
    && ['name', 'key', 'operation', 'requestAttempt'].every((field) => typeof Reflect.get(value, field) === 'string')
    && (key === null || typeof key === 'string');
}

/**
 * Create a fake provider over an optional persisted ledger file. `now` is the
 * clock rate-limit retry times are relative to.
 */
export function fakeProvider(now: () => number, ledgerPath?: string): IFakeProvider {
  const memory: ILedgerEntry[] = [];
  const scripts = new Map<string, IScriptEntry[]>();
  const hanging = new Map<string, () => void>();
  const counts = { inFlight: 0, peak: 0 };

  const ledger = (): readonly ILedgerEntry[] => {
    if (ledgerPath === undefined) {
      return memory;
    }
    if (!existsSync(ledgerPath)) {
      return [];
    }
    return readFileSync(ledgerPath, 'utf8').split('\n').filter((line) => line.length > 0).map((line) => {
      const parsed: unknown = JSON.parse(line);
      if (!isLedgerEntry(parsed)) {
        throw new Error(`malformed ledger line ${line}`);
      }
      return parsed;
    });
  };
  const record = (entry: ILedgerEntry): void => {
    if (ledgerPath === undefined) {
      memory.push(entry);
    } else {
      appendFileSync(ledgerPath, `${JSON.stringify(entry)}\n`);
    }
  };
  const label = (name: string, key: string): string => `${name}@${key}`;

  return {
    ledger,
    get inFlight(): number {
      return counts.inFlight;
    },
    get peak(): number {
      return counts.peak;
    },
    script(name, key, entries) {
      scripts.set(label(name, key), [...entries]);
    },
    release(name, key) {
      hanging.get(label(name, key))?.();
    },
    async perform(name, key, send) {
      const entry: IScriptEntry = scripts.get(label(name, key))?.shift() ?? 'ok';
      const line = { name, key, operation: send.operation, requestAttempt: send.requestAttempt, idempotencyKey: send.idempotencyKey ?? null };
      record({ kind: 'received', ...line });
      const received = ledger().filter((item) => item.kind === 'received' && item.name === name && item.key === key).length;
      const usage = { report: `usage-${name}-${key}-${String(received)}`, quantities: [{ unit: 'tokens', amount: 100 }] };
      const refusal = { report: `refusal-${name}-${key}-${String(received)}`, quantities: [{ unit: 'requests', amount: 1 }] };
      const value: IAssessment = { key, verdict: `assessed ${key}: ${planted}` };
      const apply = (): boolean => {
        if (send.idempotencyKey !== undefined && ledger().some((item) => item.kind === 'applied' && item.idempotencyKey === send.idempotencyKey)) {
          return false;
        }
        record({ kind: 'applied', ...line });
        return true;
      };
      counts.inFlight += 1;
      counts.peak = Math.max(counts.peak, counts.inFlight);
      try {
        if (entry === 'hang') {
          await new Promise<void>((resolve, reject) => {
            const stop = send.signal.onAbort(() => {
              record({ kind: 'cancelled', ...line });
              reject(new Error(`request abandoned after abort: ${planted}`));
            });
            hanging.set(label(name, key), () => {
              stop();
              resolve();
            });
          });
          apply();
          return { kind: 'succeeded', value, usage };
        }
        if (entry.startsWith('rate-limit:')) {
          return { kind: 'rate-limited', retryAt: now() + Number(entry.slice('rate-limit:'.length)), usage: refusal };
        }
        switch (entry) {
          case 'ok':
            apply();
            return { kind: 'succeeded', value, usage };
          case 'ok-no-usage':
            apply();
            return { kind: 'succeeded', value };
          case 'permanent':
            return { kind: 'failed', transient: false, error: new Error(`provider refused: ${planted}`), usage: refusal };
          case 'transient':
            return { kind: 'failed', transient: true, error: new Error(`provider unavailable: ${planted}`), usage: refusal };
          case 'rate-limit':
            return { kind: 'rate-limited', usage: refusal };
          case 'lost':
            apply();
            throw new Error(`response lost after applying: ${planted}`);
          case 'lost-unapplied':
            throw new Error(`request lost before the provider: ${planted}`);
          default:
            throw new Error(`unscripted response ${entry}`);
        }
      } finally {
        counts.inFlight -= 1;
      }
    },
  };
}
