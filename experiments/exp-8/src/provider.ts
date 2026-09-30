/**
 * The paid-provider adapter port as EXP-8 sees it. An adapter translates
 * provider evidence into these facts: a response kind, an optional retry time,
 * an optional usage report with a provider-assigned report identifier, and a
 * remote-cancellation answer. The response `body` is data for the author's step
 * body only; supervision and accounting never forward it. A rejected `send`
 * promise (other than a local abort) means the response was lost: the request
 * may or may not have taken effect remotely.
 */
import type { IAbortSignal } from './control.js';
import type { IData } from './data.js';

/** A usage report as delivered by the provider: report identity plus observed deltas by unit. @internal */
export interface IUsageReport {
  readonly reportId: string;
  readonly quantities: Readonly<Record<string, number>>;
}

/**
 * One request as sent. `operationId` is the stable logical-operation identity
 * (offered as an idempotency key); `requestAttemptId` identifies this try.
 * @internal
 */
export interface IProviderRequest {
  readonly operationId: string;
  readonly requestAttemptId: string;
  readonly name: string;
  readonly binding: IData;
}

/**
 * A received response. `rate-limited`, `unavailable` and `rejected` are
 * provider statements that the request had no effect; `retryAt` is the
 * provider's next eligible time when it states one.
 * @internal
 */
export type IProviderResponse =
  | { readonly kind: 'succeeded'; readonly body: IData; readonly usage: IUsageReport | null }
  | { readonly kind: 'rate-limited'; readonly retryAt: number | null; readonly body: IData; readonly usage: IUsageReport | null }
  | { readonly kind: 'unavailable' | 'rejected'; readonly body: IData; readonly usage: IUsageReport | null };

/**
 * A cancellation-capable provider's answer after a local abort: remote work
 * confirmed cancelled, or still running. A rejected `cancel` promise means no
 * answer, which is recorded as `unknown`.
 * @internal
 */
export type IRemoteCancel = 'cancelled' | 'running';

/** A usage report delivered out of band (late or duplicated), attributed to its request. @internal */
export interface ILateReport {
  readonly operationId: string;
  readonly requestAttemptId: string;
  readonly report: IUsageReport;
}

/**
 * The adapter port. `idempotencyKeys` states whether the provider deduplicates
 * a repeated operation identifier; `remoteCancellation` whether `cancel` may be
 * requested at all; `lateReports` drains out-of-band usage deliverable now.
 * @internal
 */
export interface IProvider {
  readonly idempotencyKeys: boolean;
  readonly remoteCancellation: boolean;
  send(request: IProviderRequest, signal: IAbortSignal): Promise<IProviderResponse>;
  cancel(operationId: string): Promise<IRemoteCancel>;
  lateReports(now: number): readonly ILateReport[];
}
