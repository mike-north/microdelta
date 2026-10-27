/** One-purpose test executable carrying actual private codec output, never a public codec hook. */
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { _encodeProvenanceContent } from '../src/provenance-wire.js';
import { _assertColdCorpus, _coldJson } from './provenance-cold-channel.js';

/** @internal Exact emitted files selected by the bounded parent, checked by the executable itself. */
export interface IColdWorkerIdentity { readonly workerSha256: string; readonly codecSha256: string }
/** @internal Compute the actual candidate output only for the pinned capped cold input. */
export function _coldWorker(text: string, identity: IColdWorkerIdentity, outputBudget = 1048576): string {
  if (Buffer.byteLength(text) > 1048576 || !/^[a-f0-9]{64}$/u.test(identity.workerSha256) || !/^[a-f0-9]{64}$/u.test(identity.codecSha256)) { throw new Error('cold worker input/identity bound'); }
  const request: unknown = JSON.parse(text);
  _coldJson(request);
  if (typeof request !== 'object' || request === null || Array.isArray(request) || Object.keys(request).join(',') !== 'population,input' || !('population' in request) || typeof request.population !== 'number' || !('input' in request)) { throw new Error('cold worker request'); }
  _assertColdCorpus(request.input, request.population);
  const content = _encodeProvenanceContent(request.input, 1);
  // This text is the actual owner output. JSON is admitted only after the cold
  // precondition and exact postparse equality; assembly receives this same value.
  const output = _coldJson(content);
  const highWaterRssBytes = process.resourceUsage().maxRSS * 1024;
  return _coldJson({ population: request.population, inputSha256: digest(text), ...identity, outputSha256: digest(output), highWaterRssBytes, content }, outputBudget);
}
/** Hash exact text/files rather than trusting a declared bridge identity. */
function digest(text: string | Buffer): string { return createHash('sha256').update(text).digest('hex'); }
/** The named executable accepts exactly one parent-created input and one fresh output. */
function main(): void {
  const [input, output, inputHash, workerHash, codecHash, budgetText] = process.argv.slice(2);
  if (process.argv.length !== 8 || input === undefined || output === undefined || inputHash === undefined || workerHash === undefined || codecHash === undefined || budgetText === undefined || !/^[0-9]+$/u.test(budgetText) || statSync(input).size > 1048576) { throw new Error('cold worker arguments/input bound'); }
  const workerSha256 = digest(readFileSync(fileURLToPath(import.meta.url)));
  const codecSha256 = digest(readFileSync(new URL('../src/provenance-wire.js', import.meta.url)));
  const text = readFileSync(input, 'utf8');
  if (workerSha256 !== workerHash || codecSha256 !== codecHash || digest(text) !== inputHash) { throw new Error('cold worker executable/input identity changed'); }
  const result = _coldWorker(text, { workerSha256, codecSha256 }, Number(budgetText));
  writeFileSync(output, result, { flag: 'wx' });
}
/** Test-host lifecycle stays owner-local; Resolution never imports an assembly experiment. */
function waitForParentRelease(): void {
  if (process.send === undefined || !process.connected) { throw new Error('cold worker requires owned IPC'); }
  // All work and the synchronous fresh output write precede ready. Release is
  // direct synchronous exit, with no further application work or async flush.
  process.on('message', (message: unknown) => { process.exit(message === 'tuple-release' ? 0 : 1); });
  process.on('disconnect', () => { process.exit(1); });
  process.send('tuple-ready');
}
// Importing the worker in owner tests never starts a process or writes an artifact.
if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) { main(); waitForParentRelease(); }
