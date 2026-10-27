/** Bounded owned-process RSS observations preserve evidence; stop policy remains in the parent. @packageDocumentation */
import { spawnSync } from 'node:child_process';

/** @internal Existing resource classification distinguishes a measurement from positive termination. */
export type IRssReading = number | 'not-running' | 'zombie' | undefined;
/** @internal Raw bounded ps completion, before trimming or interpreting any output. */
export interface IPsCompletion { readonly status: number | null; readonly signal: string | null; readonly code: string | null; readonly stdout: string | null; readonly stderr: string | null }
/** @internal Kernel lookup distinguishes an absent PID from permission/error or a live PID. */
export type IKernelLookup = 'ESRCH' | 'present' | 'error' | 'not-attempted';
/** @internal An individual observation stays below 1024 serialized bytes; raw text truncation is explicit. */
export interface IRssObservation {
  readonly ownedPid: number; readonly expectedParentPid: number;
  readonly ps: { readonly status: number | null; readonly signal: string | null; readonly code: string | null; readonly stdout: string | null; readonly stdoutBytes: number | null; readonly stdoutTruncated: boolean; readonly stderr: string | null; readonly stderrBytes: number | null; readonly stderrTruncated: boolean };
  readonly parsed: { readonly pid: number | null; readonly parentPid: number | null; readonly state: string | null; readonly rssKiB: number | null };
  readonly kernelLookup: IKernelLookup; readonly classification: 'observed' | 'not-running' | 'zombie' | 'unavailable'; readonly reason: string;
}
/** @internal First/last/failing slots retain at most three observations and 4096 serialized bytes. */
export interface IRssTrace { readonly probes: number; readonly first: IRssObservation | null; readonly last: IRssObservation | null; readonly failing: IRssObservation | null }
/** @internal A reading and the evidence for accepting/refusing it cross one fixture-local boundary. */
export interface IRssProbeResult { readonly reading: IRssReading; readonly observation: IRssObservation }
/** @internal Classify a raw completion without losing why a value was refused. */
export function classifyRssProbe(pid: number, parent: number, raw: IPsCompletion, lookup: () => IKernelLookup): { readonly reading: IRssReading; readonly observation: IRssObservation } {
  const fields = /^(\d+)\s+(\d+)\s+(\S+)\s+(\d+)$/u.exec(raw.stdout?.trim() ?? '');
  const integer = (text: string | undefined): number | null => text !== undefined && Number.isSafeInteger(Number(text)) ? Number(text) : null;
  const parsed = { pid: integer(fields?.[1]), parentPid: integer(fields?.[2]), state: fields?.[3] ?? null, rssKiB: integer(fields?.[4]) };
  let kernelLookup: IKernelLookup = 'not-attempted'; let reading: IRssReading;
  let classification: IRssObservation['classification'] = 'unavailable'; let reason = 'ps-failed';
  if (raw.status === 0) {
    if (fields === null || fields[3] === undefined || fields[4] === undefined) { reason = 'malformed-ps-output'; }
    else if (fields[1] !== String(pid)) { reason = 'pid-mismatch'; }
    else if (fields[2] !== String(parent)) { reason = 'parent-pid-mismatch'; }
    else {
      const bytes = Number(fields[4]) * 1024;
      if (fields[3].startsWith('Z') && bytes === 0) { reading = 'zombie'; classification = 'zombie'; reason = 'owned-zombie-rss-zero'; }
      else if (Number.isSafeInteger(bytes) && bytes > 0) { reading = bytes; classification = 'observed'; reason = 'positive-rss'; }
      else { reason = 'invalid-rss'; }
    }
  } else if (raw.status === 1 && raw.stdout === '' && raw.stderr === '') {
    try { kernelLookup = lookup(); } catch { kernelLookup = 'error'; }
    if (kernelLookup === 'ESRCH') { reading = 'not-running'; classification = 'not-running'; reason = 'ps-no-match-and-kernel-esrch'; }
    else { reason = kernelLookup === 'present' ? 'no-match-but-pid-present' : 'kernel-lookup-unavailable'; }
  }
  // Diagnostic storage caps serialized text, including JSON escape expansion.
  // The original byte counts and truncation flags distinguish a retained prefix
  // from exact short raw output. Classification always uses the original probe.
  const stdout = boundedText(raw.stdout, 128); const stderr = boundedText(raw.stderr, 128);
  const observation: IRssObservation = { ownedPid: pid, expectedParentPid: parent,
    ps: { status: raw.status, signal: boundedText(raw.signal, 24), code: boundedText(raw.code, 32), stdout, stdoutBytes: raw.stdout === null ? null : Buffer.byteLength(raw.stdout), stdoutTruncated: stdout !== raw.stdout, stderr, stderrBytes: raw.stderr === null ? null : Buffer.byteLength(raw.stderr), stderrTruncated: stderr !== raw.stderr },
    parsed: { ...parsed, state: boundedText(parsed.state, 32) }, kernelLookup, classification, reason };
  if (Buffer.byteLength(JSON.stringify(observation)) > 1024) { throw new Error('RSS observation evidence budget'); }
  return { reading, observation };
}
/** Keep an exact short string or explicit prefix under its own JSON byte budget. */
function boundedText(value: string | null, jsonBytes: number): string | null {
  if (value === null) { return null; }
  let prefix = value.slice(0, jsonBytes);
  while (Buffer.byteLength(JSON.stringify(prefix)) > jsonBytes) { prefix = prefix.slice(0, -1); }
  return prefix;
}
/** Inspect Node's own command error data without invoking arbitrary accessors. */
function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) { return undefined; }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value as unknown : undefined;
}
/** Kernel lookup is only used when ps supplied its exact no-match completion. */
function kernelState(pid: number): IKernelLookup {
  try { process.kill(pid, 0); return 'present'; }
  catch (error) { return field(error, 'code') === 'ESRCH' ? 'ESRCH' : 'error'; }
}
/** @internal Execute only the fixed bounded ps query for one owned PID. */
export function probeOwnedRss(pid: number, parent: number): { readonly reading: IRssReading; readonly observation: IRssObservation } {
  const result = spawnSync('/bin/ps', ['-o', 'pid=,ppid=,stat=,rss=', '-p', String(pid)], { encoding: 'utf8', timeout: 1000, maxBuffer: 1024 });
  const code = field(result.error, 'code');
  return classifyRssProbe(pid, parent, { status: result.status, signal: result.signal, code: typeof code === 'string' ? code : null, stdout: result.stdout, stderr: result.stderr }, () => kernelState(pid));
}
/** @internal Keep bounded diagnosis slots across normal probes and terminal-marker confirmation. */
export function retainRssObservation(trace: IRssTrace, observation: IRssObservation): IRssTrace {
  const next: IRssTrace = { probes: trace.probes + 1, first: trace.first ?? observation, last: observation, failing: observation.classification === 'unavailable' ? observation : trace.failing };
  if (!Number.isSafeInteger(next.probes) || Buffer.byteLength(JSON.stringify(next)) > 4096) { throw new Error('RSS trace evidence budget'); }
  return next;
}
