/** Assembly consumes only actual test-worker output bound to exact source/input identities. @packageDocumentation */
import { createHash } from 'node:crypto';
import { measureActualTuple } from './tuple-accounting.js';

/** @internal Parent-selected identity expected in the single bounded output artifact. */
export interface IBridgeIdentity { readonly population: number; readonly inputSha256: string; readonly workerSha256: string; readonly codecSha256: string; readonly implementationDigest: string }
/** @internal Validate actual bridge data before generated Value and independent accounting. */
export function consumeColdWorker(text: string, identity: IBridgeIdentity): { readonly population: number; readonly utf16: number; readonly utf8: number; readonly canonicalSha256: string; readonly highWaterRssBytes: number } {
  if (Buffer.byteLength(text) > 1048576) { throw new Error('bridge text budget'); }
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || Object.keys(parsed).join(',') !== 'population,inputSha256,workerSha256,codecSha256,outputSha256,highWaterRssBytes,content') { throw new Error('bridge envelope'); }
  if (!('population' in parsed) || parsed.population !== identity.population || !('inputSha256' in parsed) || parsed.inputSha256 !== identity.inputSha256 || !('workerSha256' in parsed) || parsed.workerSha256 !== identity.workerSha256 || !('codecSha256' in parsed) || parsed.codecSha256 !== identity.codecSha256 || !('outputSha256' in parsed) || typeof parsed.outputSha256 !== 'string' || !('content' in parsed) || !('highWaterRssBytes' in parsed) || typeof parsed.highWaterRssBytes !== 'number' || !Number.isSafeInteger(parsed.highWaterRssBytes) || parsed.highWaterRssBytes < 1 || parsed.highWaterRssBytes > 2147483648) { throw new Error('bridge identity/resource mismatch'); }
  for (const hash of [identity.inputSha256, identity.workerSha256, identity.codecSha256, identity.implementationDigest]) { if (!/^[a-f0-9]{64}$/u.test(hash)) { throw new Error('bridge expected identity'); } }
  // JSON parsing yields ordinary own data. The shape comparison in accounting
  // additionally checks every slot/value/key order before Value sees this tree.
  const outputHash = createHash('sha256').update(JSON.stringify(parsed.content)).digest('hex');
  if (outputHash !== parsed.outputSha256) { throw new Error('bridge actual-output digest mismatch'); }
  return { population: identity.population, ...measureActualTuple(parsed.content, identity.population, identity.implementationDigest), highWaterRssBytes: parsed.highWaterRssBytes };
}
