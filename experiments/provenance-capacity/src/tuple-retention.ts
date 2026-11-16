/** Sealed failed roots and one fresh root share the entire tuple diagnostic allowance. @packageDocumentation */
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { coldProvenance } from './guards.js';
import { artifactInventory, writeTupleArtifact } from './tuple-driver.js';

/** @internal The second rejected attempt contributes immutable evidence, never reusable inputs. */
export interface IAdditionalFailure { readonly directory: string; readonly fingerprint: string; readonly bytes: number }
/** @internal At most two sealed failures and one fresh root share one allowance. Historical plans remain readable. */
export interface IRetentionPlan { readonly frozenDirectory: string; readonly frozenInventorySha256: string; readonly frozenBytes: number; readonly externalEvidenceAllowanceBytes: number; readonly additionalFailure?: IAdditionalFailure }
/** @internal Canonical inventory fingerprint pins file names, sizes and exact bytes. */
export function inventoryFingerprint(inventory: ReturnType<typeof artifactInventory>): string { return createHash('sha256').update(JSON.stringify(inventory)).digest('hex'); }
/** @internal Seal a previously reviewed failure inventory before emitting a new plan artifact. */
export function createRetentionPlan(fresh: string, frozen: string, expectedFingerprint: string, externalAllowance: number, additional?: { readonly directory: string; readonly fingerprint: string }): void {
  const old = artifactInventory(frozen); const next = artifactInventory(fresh);
  if (!/^[a-f0-9]{64}$/u.test(expectedFingerprint) || inventoryFingerprint(old) !== expectedFingerprint || realpathSync(frozen) === realpathSync(fresh) || next.files.length !== 0 || externalAllowance !== 49152) { throw new Error('diagnostic sealed root/identity/allowance'); }
  const extra = additional === undefined ? undefined : artifactInventory(additional.directory);
  if (additional !== undefined && (extra === undefined || !/^[a-f0-9]{64}$/u.test(additional.fingerprint) || inventoryFingerprint(extra) !== additional.fingerprint || [realpathSync(frozen), realpathSync(fresh)].includes(realpathSync(additional.directory)))) { throw new Error('diagnostic additional sealed root'); }
  const plan: IRetentionPlan = { frozenDirectory: realpathSync(frozen), frozenInventorySha256: expectedFingerprint, frozenBytes: old.bytes, externalEvidenceAllowanceBytes: externalAllowance, ...(additional === undefined || extra === undefined ? {} : { additionalFailure: { directory: realpathSync(additional.directory), fingerprint: additional.fingerprint, bytes: extra.bytes } }) };
  const text = JSON.stringify(plan);
  if (old.bytes + (extra?.bytes ?? 0) + externalAllowance + Buffer.byteLength(text) > 1048576) { throw new Error('diagnostic shared plan budget'); }
  writeTupleArtifact(fresh, 'retention-plan.json', text);
}
/** @internal Validate exact sealed bytes and distinct regular roots on every budget read. */
export function readRetentionPlan(fresh: string): IRetentionPlan {
  artifactInventory(fresh);
  const value: unknown = JSON.parse(readFileSync(join(fresh, 'retention-plan.json'), 'utf8'));
  if (typeof value !== 'object' || value === null || Array.isArray(value) || !['frozenDirectory,frozenInventorySha256,frozenBytes,externalEvidenceAllowanceBytes', 'frozenDirectory,frozenInventorySha256,frozenBytes,externalEvidenceAllowanceBytes,additionalFailure'].includes(Object.keys(value).join(',')) || !('frozenDirectory' in value) || typeof value.frozenDirectory !== 'string' || !('frozenInventorySha256' in value) || typeof value.frozenInventorySha256 !== 'string' || !('frozenBytes' in value) || typeof value.frozenBytes !== 'number' || !Number.isSafeInteger(value.frozenBytes) || value.frozenBytes < 0 || !('externalEvidenceAllowanceBytes' in value) || value.externalEvidenceAllowanceBytes !== 49152) { throw new Error('diagnostic sealed plan'); }
  const old = artifactInventory(value.frozenDirectory);
  if (realpathSync(fresh) === realpathSync(value.frozenDirectory) || old.bytes !== value.frozenBytes || inventoryFingerprint(old) !== value.frozenInventorySha256) { throw new Error('diagnostic frozen evidence changed or roots alias'); }
  let additionalFailure: IAdditionalFailure | undefined;
  if ('additionalFailure' in value) {
    const extra: unknown = value.additionalFailure;
    if (typeof extra !== 'object' || extra === null || Array.isArray(extra) || Object.keys(extra).join(',') !== 'directory,fingerprint,bytes' || !('directory' in extra) || typeof extra.directory !== 'string' || !('fingerprint' in extra) || typeof extra.fingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(extra.fingerprint) || !('bytes' in extra) || typeof extra.bytes !== 'number' || !Number.isSafeInteger(extra.bytes) || extra.bytes < 0) { throw new Error('diagnostic additional failure plan'); }
    const inventory = artifactInventory(extra.directory);
    if ([realpathSync(fresh), realpathSync(value.frozenDirectory)].includes(realpathSync(extra.directory)) || inventory.bytes !== extra.bytes || inventoryFingerprint(inventory) !== extra.fingerprint) { throw new Error('diagnostic additional failure changed or aliases'); }
    additionalFailure = { directory: extra.directory, fingerprint: extra.fingerprint, bytes: extra.bytes };
  }
  return { frozenDirectory: value.frozenDirectory, frozenInventorySha256: value.frozenInventorySha256, frozenBytes: value.frozenBytes, externalEvidenceAllowanceBytes: value.externalEvidenceAllowanceBytes, ...(additionalFailure === undefined ? {} : { additionalFailure }) };
}
/** @internal Count every sealed root plus the fresh root and reserved outside forensic/review/status bytes, without resetting. */
export function retainedInventory(fresh: string): { readonly bytes: number; readonly fileBytes: number; readonly externalEvidenceAllowanceBytes: number; readonly frozen: readonly ReturnType<typeof artifactInventory>[]; readonly fresh: ReturnType<typeof artifactInventory> } {
  const plan = readRetentionPlan(fresh); const old = artifactInventory(plan.frozenDirectory); const next = artifactInventory(fresh);
  const frozen = [old, ...(plan.additionalFailure === undefined ? [] : [artifactInventory(plan.additionalFailure.directory)])];
  const fileBytes = frozen.reduce((sum, inventory) => sum + inventory.bytes, next.bytes); const bytes = fileBytes + plan.externalEvidenceAllowanceBytes;
  if (bytes > 1048576) { throw new Error('diagnostic global retained cap'); }
  return { bytes, fileBytes, externalEvidenceAllowanceBytes: plan.externalEvidenceAllowanceBytes, frozen, fresh: next };
}
/** @internal Preflight every new artifact against the same global allowance. */
export function writeRetainedArtifact(fresh: string, name: string, text: string): void {
  if (retainedInventory(fresh).bytes + Buffer.byteLength(text) > 1048576) { throw new Error('diagnostic global write budget'); }
  writeTupleArtifact(fresh, name, text);
}
/** @internal Fresh author workers read only the six sealed inputs; held-out inputs are new. */
export function retainedInputPath(fresh: string, cohort: 'author' | 'heldout', population: number): string {
  const plan = readRetentionPlan(fresh);
  if (!(cohort === 'author' ? [1, 2, 8, 12, 32, 100] : [3, 9, 17, 64]).includes(population)) { throw new Error('diagnostic fixed input population'); }
  return join(cohort === 'author' ? plan.frozenDirectory : fresh, `input-${String(population)}.json`);
}
/** @internal Compare every sealed input with the complete current expected cold corpus. */
export function validateRetainedInputs(fresh: string): void {
  readRetentionPlan(fresh);
  for (const population of [1, 2, 8, 12, 32, 100]) {
    const text = readFileSync(retainedInputPath(fresh, 'author', population), 'utf8');
    // Exact complete current fixture bytes prove order, independent addresses,
    // operations, encoded facts and digests; this does not merely trust old hashes.
    if (text !== JSON.stringify({ population, input: coldProvenance(population, 'a'.repeat(64)) })) { throw new Error('diagnostic sealed input is not current exact cold corpus'); }
  }
}
