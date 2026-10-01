/**
 * The example's paid-like fake assessor service: a deterministic stand-in for
 * a paid language-model provider that never costs anything. The paid-like
 * rubric (`P`) sends it one assessment request per authored PR through the
 * live run's external operation handle; the framework, not this module,
 * decides retries, deferral, stop and accounting.
 *
 * Behavior, all of it deterministic:
 *
 * - **Latency.** Every request is answered after a fixed latency (10 ms
 *   unless the script sets `latencyMilliseconds`). A send's abort signal ends
 *   the wait at once, and the provider records the abort.
 * - **Scoring.** It scores a merged PR 2 and an unmerged PR 1, as rubric A
 *   does, so the report reads the same under either assessor.
 * - **Usage reports.** An answered assessment reports 100 tokens and a
 *   refusal 1 request, each under a report identity unique to that request.
 *   A lost response, a stalled request or a dead client reports nothing.
 * - **Script.** `script.json` in the provider directory lists, per PR number,
 *   the responses of its successive requests (`{"responses": {"201":
 *   ["rate-limit:1500"]}}`); a request beyond its list is answered `ok`.
 *   Because the position is the count of requests the ledger already holds,
 *   a script spans processes. Responses:
 *   - `ok`: answer the assessment;
 *   - `slow:<ms>`: answer it after `<ms>` instead of the usual latency;
 *   - `rate-limit:<ms>`: refuse with a retry time `<ms>` after receipt;
 *   - `refuse`: refuse permanently;
 *   - `lost`: perform the assessment, then lose the response;
 *   - `stall`: accept the request and never answer until the send aborts.
 * - **Ledger.** `ledger.jsonl` records every request `received`, every
 *   assessment `applied` (performed, whether or not its response then
 *   arrives) and every `aborted` request, with the PR number, the operation
 *   and request attempt identities and the provider's clock time, so tests
 *   see exactly what was sent, across processes.
 *
 * The request carries the PR's merged flag (the provider needs it to score);
 * like any provider body, it never appears in framework events.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { IOperationResponse, IOperationSend } from 'microdelta';

/** The provider's answer to one assessment request. */
export interface IPaidAssessment {
  readonly score: number;
  readonly explanation: string;
}

/** One scripted response; see the module comment. */
export type IScriptedResponse = 'ok' | 'refuse' | 'lost' | 'stall' | `slow:${number}` | `rate-limit:${number}`;

/** One ledger line. */
export interface ILedgerEntry {
  readonly kind: 'received' | 'applied' | 'aborted';
  readonly pullRequest: number;
  readonly operation: string;
  readonly requestAttempt: string;
  /** The provider's clock time, in epoch milliseconds. */
  readonly at: number;
}

/** The default latency of every answer, in milliseconds. */
const defaultLatencyMilliseconds = 10;

/** Tokens an answered assessment reports. */
const tokensPerAssessment = 100;

/** The provider's script file, validated. */
interface IScript {
  readonly latencyMilliseconds: number;
  readonly responses: Readonly<Record<string, readonly IScriptedResponse[]>>;
}

/** Whether a value is one scripted response. */
function isScriptedResponse(value: unknown): value is IScriptedResponse {
  return typeof value === 'string' && (value === 'ok' || value === 'refuse' || value === 'lost' || value === 'stall' || /^(slow|rate-limit):\d+$/u.test(value));
}

/** Read and validate the script; an absent script answers everything `ok`. */
function readScript(directory: string): IScript {
  const file = join(directory, 'script.json');
  if (!existsSync(file)) {
    return { latencyMilliseconds: defaultLatencyMilliseconds, responses: {} };
  }
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const latency: unknown = typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'latencyMilliseconds') : undefined;
  const responses: unknown = typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'responses') : undefined;
  const validLatency = latency === undefined || (typeof latency === 'number' && Number.isSafeInteger(latency) && latency >= 0);
  const validResponses = responses === undefined || (typeof responses === 'object' && responses !== null && !Array.isArray(responses) &&
    Object.values(responses).every((list: unknown) => Array.isArray(list) && list.every(isScriptedResponse)));
  if (!validLatency || !validResponses) {
    throw new Error(`${file} is not a provider script`);
  }
  const listed: Record<string, readonly IScriptedResponse[]> = {};
  if (typeof responses === 'object' && responses !== null) {
    for (const [number, list] of Object.entries(responses)) {
      // Validated above: every list holds scripted responses only.
      listed[number] = Array.isArray(list) ? list.filter(isScriptedResponse) : [];
    }
  }
  return { latencyMilliseconds: typeof latency === 'number' ? latency : defaultLatencyMilliseconds, responses: listed };
}

/** Whether a parsed ledger line is a ledger entry. */
function isLedgerEntry(value: unknown): value is ILedgerEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const kind: unknown = Reflect.get(value, 'kind');
  return (kind === 'received' || kind === 'applied' || kind === 'aborted') && typeof Reflect.get(value, 'pullRequest') === 'number' &&
    typeof Reflect.get(value, 'operation') === 'string' && typeof Reflect.get(value, 'requestAttempt') === 'string' && typeof Reflect.get(value, 'at') === 'number';
}

/** The paid-like assessor service over one provider directory. */
export interface IPaidAssessor {
  /** Perform one assessment request for PR `number`, whose merged flag the request carries. */
  assess(number: number, merged: boolean, send: IOperationSend): Promise<IOperationResponse<IPaidAssessment>>;
}

/** Wait `milliseconds`, or reject at once when the send aborts. */
function wait(milliseconds: number, send: IOperationSend, onAbort: () => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let removeListener: () => void = () => undefined;
    const timer = setTimeout(() => {
      removeListener();
      resolve();
    }, milliseconds);
    removeListener = send.signal.onAbort(() => {
      clearTimeout(timer);
      onAbort();
      reject(new Error('the assessment request was abandoned after an abort'));
    });
  });
}

/** Never answer; reject only when the send aborts. */
function stall(send: IOperationSend, onAbort: () => void): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    // The stalled request keeps the process alive until the run aborts it.
    const keepAlive = setInterval(() => undefined, 60_000);
    send.signal.onAbort(() => {
      clearInterval(keepAlive);
      onAbort();
      reject(new Error('the stalled assessment request was abandoned after an abort'));
    });
  });
}

/**
 * Open the paid-like assessor over `directory`, created when absent. The
 * script is read once per request, so a test may rewrite it between
 * processes.
 */
export function paidAssessor(directory: string): IPaidAssessor {
  const ledgerFile = join(directory, 'ledger.jsonl');
  const ledger = (): readonly ILedgerEntry[] => existsSync(ledgerFile)
    ? readFileSync(ledgerFile, 'utf8').split('\n').filter((line) => line.length > 0).map((line) => {
      const parsed: unknown = JSON.parse(line);
      if (!isLedgerEntry(parsed)) {
        throw new Error(`${ledgerFile} holds a malformed line`);
      }
      return parsed;
    })
    : [];
  const record = (entry: ILedgerEntry): void => {
    // The directory is created on the first request, so commands that send nothing leave no provider state.
    mkdirSync(directory, { recursive: true });
    appendFileSync(ledgerFile, `${JSON.stringify(entry)}\n`);
  };
  return Object.freeze({
    async assess(number: number, merged: boolean, send: IOperationSend): Promise<IOperationResponse<IPaidAssessment>> {
      const script = readScript(directory);
      const position = ledger().filter((entry) => entry.kind === 'received' && entry.pullRequest === number).length;
      const response: IScriptedResponse = script.responses[String(number)]?.[position] ?? 'ok';
      const line = { pullRequest: number, operation: send.operation, requestAttempt: send.requestAttempt };
      const receivedAt = Date.now();
      record({ kind: 'received', ...line, at: receivedAt });
      const aborted = (): void => {
        record({ kind: 'aborted', ...line, at: Date.now() });
      };
      const report = `${String(number)}-${String(position + 1)}`;
      if (response === 'stall') {
        return stall(send, aborted);
      }
      const latency = response.startsWith('slow:') ? Number(response.slice('slow:'.length)) : script.latencyMilliseconds;
      await wait(latency, send, aborted);
      if (response.startsWith('rate-limit:')) {
        return { kind: 'rate-limited', retryAt: receivedAt + Number(response.slice('rate-limit:'.length)), usage: { report: `refusal-${report}`, quantities: [{ unit: 'requests', amount: 1 }] } };
      }
      if (response === 'refuse') {
        return { kind: 'failed', transient: false, usage: { report: `refusal-${report}`, quantities: [{ unit: 'requests', amount: 1 }] } };
      }
      const score = merged ? 2 : 1;
      record({ kind: 'applied', ...line, at: Date.now() });
      if (response === 'lost') {
        throw new Error('the assessment response was lost');
      }
      return {
        kind: 'succeeded',
        value: { score, explanation: `The paid-like assessor scores ${merged ? 'merged' : 'unmerged'} pull request ${String(number)} ${String(score)}.` },
        usage: { report: `usage-${report}`, quantities: [{ unit: 'tokens', amount: tokensPerAssessment }] },
      };
    },
  });
}
