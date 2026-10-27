/** One fresh held-out lineage seals both failures and the original author/partial-held-out root. @packageDocumentation */
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { artifactInventory, writeTupleArtifact } from './tuple-driver.js';
import { inventoryFingerprint } from './tuple-retention.js';
import { coldProvenance } from './guards.js';
/** @internal Exact prior file set, never an accepted output by virtue of being retained. */
export interface ISealedHeldoutRoot { readonly directory: string; readonly fingerprint: string; readonly bytes: number }
/** @internal Original accepted author evidence remains attributable to its unmodified source revision. */
export interface IOriginalAuthorPins { readonly sourceCommit: string; readonly manifestSha256: string; readonly analysisSha256: string; readonly batchSha256: string; readonly workerPrefixSha256: string; readonly errorsSourceSha256: string }
/** @internal Fixed four-root accounting is not an arbitrary collection or a reset of prior attempts. */
export interface IHeldoutRetentionPlan { readonly firstFailure: ISealedHeldoutRoot; readonly secondFailure: ISealedHeldoutRoot; readonly prior: ISealedHeldoutRoot; readonly externalEvidenceAllowanceBytes: number; readonly originalAuthor: IOriginalAuthorPins }
/** @internal Caller pins name exact complete inventories before any fresh plan write. */
export interface ISealedHeldoutRequest { readonly directory: string; readonly fingerprint: string }
/** @internal Every inventory includes all three immutable prior roots and the one fresh root. */
export interface IHeldoutInventory { readonly bytes: number; readonly fileBytes: number; readonly externalEvidenceAllowanceBytes: number; readonly frozen: readonly ReturnType<typeof artifactInventory>[]; readonly fresh: ReturnType<typeof artifactInventory> }
/** Ordinary parsed plan records have no executable properties or array surface. */
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
/** Preserve exactly the named sealed-root fields, including independently expected inventory bytes. */
function sealed(value: unknown): ISealedHeldoutRoot {
  if (!record(value) || Object.keys(value).join(',') !== 'directory,fingerprint,bytes' || typeof value['directory'] !== 'string' || typeof value['fingerprint'] !== 'string' || !/^[a-f0-9]{64}$/u.test(value['fingerprint']) || typeof value['bytes'] !== 'number' || !Number.isSafeInteger(value['bytes']) || value['bytes'] < 0) { throw new Error('heldout sealed root shape'); }
  return { directory: value['directory'], fingerprint: value['fingerprint'], bytes: value['bytes'] };
}
/** Original source and receipt identities are provenance, never current-harness execution claims. */
function authorPins(value: unknown): IOriginalAuthorPins {
  if (!record(value) || Object.keys(value).join(',') !== 'sourceCommit,manifestSha256,analysisSha256,batchSha256,workerPrefixSha256,errorsSourceSha256' || typeof value['sourceCommit'] !== 'string' || !/^[a-f0-9]{40}$/u.test(value['sourceCommit']) || typeof value['manifestSha256'] !== 'string' || !/^[a-f0-9]{64}$/u.test(value['manifestSha256']) || typeof value['analysisSha256'] !== 'string' || !/^[a-f0-9]{64}$/u.test(value['analysisSha256']) || typeof value['batchSha256'] !== 'string' || !/^[a-f0-9]{64}$/u.test(value['batchSha256']) || typeof value['workerPrefixSha256'] !== 'string' || !/^[a-f0-9]{64}$/u.test(value['workerPrefixSha256']) || typeof value['errorsSourceSha256'] !== 'string' || !/^[a-f0-9]{64}$/u.test(value['errorsSourceSha256'])) { throw new Error('heldout original author pins'); }
  return { sourceCommit: value['sourceCommit'], manifestSha256: value['manifestSha256'], analysisSha256: value['analysisSha256'], batchSha256: value['batchSha256'], workerPrefixSha256: value['workerPrefixSha256'], errorsSourceSha256: value['errorsSourceSha256'] };
}
/** All four real directories are distinct; each old complete file set remains immutable. */
function verifiedInventory(fresh: string, plan: IHeldoutRetentionPlan): IHeldoutInventory {
  const roots = [plan.firstFailure, plan.secondFailure, plan.prior]; const next = artifactInventory(fresh);
  const frozen = roots.map((root) => {
    const inventory = artifactInventory(root.directory);
    if (inventory.bytes !== root.bytes || inventoryFingerprint(inventory) !== root.fingerprint) { throw new Error('heldout prior evidence changed'); }
    return inventory;
  });
  if (new Set([realpathSync(fresh), ...roots.map((root) => realpathSync(root.directory))]).size !== 4 || plan.externalEvidenceAllowanceBytes !== 49152) { throw new Error('heldout root alias or allowance'); }
  const fileBytes = frozen.reduce((sum, inventory) => sum + inventory.bytes, next.bytes); const bytes = fileBytes + plan.externalEvidenceAllowanceBytes;
  if (bytes > 1048576) { throw new Error('heldout global retained cap'); }
  return { bytes, fileBytes, externalEvidenceAllowanceBytes: plan.externalEvidenceAllowanceBytes, frozen, fresh: next };
}
/** @internal Establish a single fresh held-out lineage without copying old inputs or outputs. */
export function createHeldoutRetentionPlan(fresh: string, first: ISealedHeldoutRequest, second: ISealedHeldoutRequest, prior: ISealedHeldoutRequest, author: IOriginalAuthorPins): void {
  const seal = (request: ISealedHeldoutRequest): ISealedHeldoutRoot => {
    const inventory = artifactInventory(request.directory);
    if (!/^[a-f0-9]{64}$/u.test(request.fingerprint) || inventoryFingerprint(inventory) !== request.fingerprint) { throw new Error('heldout expected seal'); }
    return { directory: realpathSync(request.directory), fingerprint: request.fingerprint, bytes: inventory.bytes };
  };
  const plan: IHeldoutRetentionPlan = { firstFailure: seal(first), secondFailure: seal(second), prior: seal(prior), externalEvidenceAllowanceBytes: 49152, originalAuthor: authorPins(author) };
  const inventory = verifiedInventory(fresh, plan); const text = JSON.stringify(plan);
  if (inventory.fresh.files.length !== 0 || inventory.bytes + Buffer.byteLength(text) > 1048576) { throw new Error('heldout fresh plan or budget'); }
  writeTupleArtifact(fresh, 'retention-plan.json', text); heldoutRetainedInventory(fresh);
}
/** @internal Read the exact sealed plan; historical three-root plans are not accepted here. */
export function readHeldoutRetentionPlan(fresh: string): IHeldoutRetentionPlan {
  artifactInventory(fresh);
  const value: unknown = JSON.parse(readFileSync(join(fresh, 'retention-plan.json'), 'utf8'));
  if (!record(value) || Object.keys(value).join(',') !== 'firstFailure,secondFailure,prior,externalEvidenceAllowanceBytes,originalAuthor' || value['externalEvidenceAllowanceBytes'] !== 49152) { throw new Error('heldout fixed plan'); }
  const plan = { firstFailure: sealed(value['firstFailure']), secondFailure: sealed(value['secondFailure']), prior: sealed(value['prior']), externalEvidenceAllowanceBytes: value['externalEvidenceAllowanceBytes'], originalAuthor: authorPins(value['originalAuthor']) };
  verifiedInventory(fresh, plan); return plan;
}
/** @internal A directly passed parent plan must equal the fresh directory's actual retained plan. */
export function heldoutInventoryForPlan(fresh: string, plan: IHeldoutRetentionPlan): IHeldoutInventory {
  const actual = readHeldoutRetentionPlan(fresh);
  if (JSON.stringify(plan) !== JSON.stringify(actual)) { throw new Error('heldout parent plan substituted'); }
  return verifiedInventory(fresh, actual);
}
/** @internal No additional root may reset the fixed total retained allowance. */
export function heldoutRetainedInventory(fresh: string): IHeldoutInventory { return verifiedInventory(fresh, readHeldoutRetentionPlan(fresh)); }
/** @internal Check the global allowance and immutable prior roots before and after writing. */
export function writeHeldoutArtifact(fresh: string, name: string, text: string): void {
  if (heldoutRetainedInventory(fresh).bytes + Buffer.byteLength(text) > 1048576) { throw new Error('heldout global write budget'); }
  writeTupleArtifact(fresh, name, text); heldoutRetainedInventory(fresh);
}
/** @internal Only four current-corpus inputs in the sealed original root can feed fresh workers. */
export function heldoutInputPath(fresh: string, population: number): string {
  if (![3, 9, 17, 64].includes(population)) { throw new Error('heldout fixed input population'); }
  return join(readHeldoutRetentionPlan(fresh).prior.directory, `input-${String(population)}.json`);
}
/** @internal Hashes alone do not replace comparison with the entire current expected cold corpus. */
export function validateHeldoutInputs(fresh: string): void {
  for (const population of [3, 9, 17, 64]) {
    const text = readFileSync(heldoutInputPath(fresh, population), 'utf8');
    if (text !== JSON.stringify({ population, input: coldProvenance(population, 'a'.repeat(64)) })) { throw new Error('heldout input is not current complete cold corpus'); }
  }
}
