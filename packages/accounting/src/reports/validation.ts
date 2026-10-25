/** Validate and canonically represent raw evidence without inferring missing qualification. @packageDocumentation */
import type { ISqliteRow } from '@microdelta/machine';
import type { IResourceReport, IRetainedResourceReport } from './contracts.js';

/** Local fallback retention is one hour from observation, never from delivery or reopen. */
const defaultLifetime = 3_600_000;

/** Identifiers are bounded opaque caller labels; credentials are forbidden by the intake contract. */
export function identity(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256 || /[\u0000-\u001f]/u.test(value)) {
    throw new TypeError('Resource report identity must be a nonempty bounded opaque label');
  }
  return value;
}

/** Exact nonnegative time/quantity arithmetic excludes coercion, infinity and unsafe precision. */
export function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('Resource report time or quantity must be a nonnegative safe integer');
  }
  return value;
}

/** Unknown text remains null; absent or malformed fields do not silently become unknown. */
function nullableText(value: unknown): string | null { return value === null ? null : identity(value); }

/** Unknown numeric evidence remains null and reported zero stays zero. */
function nullableNumber(value: unknown): number | null { return value === null ? null : integer(value); }

/** Canonical field order makes retained duplicate comparison independent of caller object order. */
export function normalize(report: IResourceReport): IRetainedResourceReport {
  const observedAt = integer(report.observedAt);
  const validUntil = nullableNumber(report.validUntil);
  const override = nullableNumber(report.localRetentionMilliseconds ?? null);
  if ((validUntil !== null && validUntil <= observedAt) || override === 0) {
    throw new TypeError('Resource report validity must follow observation and local retention must be positive');
  }
  const expiresAt = integer(validUntil ?? observedAt + (override ?? defaultLifetime));
  return Object.freeze({
    environment: identity(report.environment), report: identity(report.report), observedAt, validUntil,
    localRetentionMilliseconds: override,
    provider: nullableText(report.provider), service: nullableText(report.service), account: nullableText(report.account),
    pool: nullableText(report.pool), resource: nullableText(report.resource), unit: nullableText(report.unit), window: nullableText(report.window),
    allowed: nullableNumber(report.allowed), remaining: nullableNumber(report.remaining), expiresAt,
    retentionBasis: validUntil !== null ? 'provider' : override === null ? 'local-default' : 'local-override',
  });
}

/** Decode persisted fields through the same domain validation and verify derived retention evidence. */
export function fromRow(row: ISqliteRow): IRetainedResourceReport {
  const report = normalize({
    environment: identity(row['environment']), report: identity(row['report']), observedAt: integer(row['observed_at']),
    validUntil: nullableNumber(row['valid_until']), localRetentionMilliseconds: nullableNumber(row['local_retention']),
    provider: nullableText(row['provider']), service: nullableText(row['service']), account: nullableText(row['account']),
    pool: nullableText(row['pool']), resource: nullableText(row['resource']), unit: nullableText(row['unit']), window: nullableText(row['window']),
    allowed: nullableNumber(row['allowed']), remaining: nullableNumber(row['remaining']),
  });
  if (report.expiresAt !== row['expires_at'] || report.retentionBasis !== row['retention_basis']) {
    throw new TypeError('Resource report stored retention evidence is inconsistent');
  }
  return report;
}
