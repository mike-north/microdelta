/** Q9 alone retains one raw read-only SHM descriptor across denied-path barriers.
 * This measurement adapter owns neither SQLite authority nor fixture permissions.
 * Its images establish current retained-inode bytes only after pathname identity
 * and size remain validated; they do not prove absence of transient native writes.
 */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';

/** A common mutable account prevents this collector from granting extra image or byte slots. @internal */
export interface IMeasurementBudget {
  imagesUsed: number;
  bytesUsed: number;
  maxImages: number;
  maxBytes: number;
  maxFileBytes: number;
  maxImageBytes: number;
}

/** Device/inode pinning distinguishes retained bytes from replaced pathname content. @internal */
export interface IMeasurementStat { readonly device: string; readonly inode: string; readonly size: number; readonly regular: boolean }
/** Raw authority is deliberately smaller than FileHandle: no writes, locks or descriptor transport. @internal */
export interface IMeasurementHandle {
  readonly stat: () => Promise<IMeasurementStat>;
  readonly read: (target: Uint8Array, position: number) => Promise<number>;
  readonly close: () => Promise<void>;
}
/** The seam permits deterministic measurement failures without fabricating native SQLite evidence. @internal */
export interface IMeasurementPort {
  readonly open: (path: string) => Promise<IMeasurementHandle>;
  readonly lstat: (path: string) => Promise<IMeasurementStat>;
}
/** Observations remain evidence even when incomplete imaging prevents a hash claim. @internal */
export interface IMeasurementObservation { readonly stage: string; readonly source: 'path' | 'descriptor'; readonly stat?: IMeasurementStat; readonly error?: unknown }
/** Partial bytes stay charged to the same image slot; only validated complete images have hashes. @internal */
export interface IMeasurementImage {
  readonly label: string;
  readonly complete: boolean;
  readonly bytes: Uint8Array;
  readonly sha256?: string;
  readonly issues: readonly string[];
  readonly observations: readonly IMeasurementObservation[];
}
/** Descriptor release evidence is separate from native/worker release and caches failure. @internal */
export interface IMeasurementClosure { readonly attempted: boolean; readonly resolved: boolean; readonly error?: unknown }
/** The coordinator receives bounded images and closure, never the raw descriptor. @internal */
export interface IRetainedMeasurement {
  readonly pin: IMeasurementStat;
  readonly capture: (label: string) => Promise<IMeasurementImage>;
  readonly close: () => Promise<IMeasurementClosure>;
}
/** Callback return and cleanup success are independent facts: later release failure
 * cannot erase returned counterexamples, including a legitimate undefined value.
 * Undefined thrown values remain positional causes instead of truthiness. @internal */
export interface IMeasurementOutcome<T> {
  readonly completed: boolean;
  readonly callbackReturned: boolean;
  readonly value?: T | undefined;
  readonly failures: readonly unknown[];
  readonly closure: IMeasurementClosure;
}

/** Full stat identity uses decimal strings so inode/device comparisons cannot lose integer precision. */
function statIdentity(stat: BigIntStats): IMeasurementStat {
  const size = Number(stat.size);
  if (!Number.isSafeInteger(size) || size < 0) { throw new Error('unrepresentable measurement file size'); }
  return { device: stat.dev.toString(), inode: stat.ino.toString(), size, regular: stat.isFile() };
}

/** One no-follow read-only open is the only native filesystem authority acquired here. @internal */
export const rawMeasurementPort: IMeasurementPort = {
  async open(path) {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    return {
      async stat() { return statIdentity(await handle.stat({ bigint: true })); },
      async read(target, position) { return (await handle.read(target, 0, target.byteLength, position)).bytesRead; },
      async close() { await handle.close(); },
    };
  },
  async lstat(path) { return statIdentity(await lstat(path, { bigint: true })); },
};

/** A pin has meaning only while both current identities still name the original regular file. */
function sameIdentity(left: IMeasurementStat, right: IMeasurementStat): boolean {
  return left.regular && right.regular && left.device === right.device && left.inode === right.inode;
}

/** Scope ownership starts at successful open, including failures before initial pin validation. @internal */
export async function withRetainedShm<T>(
  path: string,
  budget: IMeasurementBudget,
  body: (measurement: IRetainedMeasurement) => Promise<T>,
  port: IMeasurementPort = rawMeasurementPort,
): Promise<IMeasurementOutcome<T>> {
  let handle: IMeasurementHandle | undefined;
  let closeResult: Promise<IMeasurementClosure> | undefined;
  const failures: unknown[] = [];
  let completed = false;
  let callbackReturned = false;
  let value: T | undefined;
  /** First attempt is final evidence; repeated cleanup must never convert failure to success. */
  function close(): Promise<IMeasurementClosure> {
    closeResult ??= (async () => {
      if (handle === undefined) { return { attempted: false, resolved: true }; }
      try { await handle.close(); return { attempted: true, resolved: true }; }
      catch (error) { return { attempted: true, resolved: false, error }; }
    })();
    return closeResult;
  }
  let closure: IMeasurementClosure = { attempted: false, resolved: true };
  try {
    handle = await port.open(path);
    const pin = await handle.stat();
    const pathname = await port.lstat(path);
    if (!sameIdentity(pin, pathname) || pin.size !== pathname.size) { throw new Error('invalid initial measurement identity'); }
    if (pin.size > budget.maxFileBytes || pin.size > budget.maxImageBytes) { throw new Error('initial measurement quota exceeded'); }
    const owned = handle;
    let previousSize = pin.size;
    let imaging = false;
    /** Captures one declared barrier. No recovery, reopen or scan growth is available. */
    async function capture(label: string): Promise<IMeasurementImage> {
      const issues: string[] = [];
      const observations: IMeasurementObservation[] = [];
      const chunks: Uint8Array[] = [];
      let bytesRead = 0;
      /** Failed stats are retained alongside successful facts rather than hiding replacement. */
      async function observe(stage: string, source: 'path' | 'descriptor'): Promise<IMeasurementStat | undefined> {
        try {
          const stat = await (source === 'path' ? port.lstat(path) : owned.stat());
          observations.push({ stage, source, stat });
          return stat;
        } catch (error) {
          observations.push({ stage, source, error });
          issues.push(`${source} ${stage} stat failed`);
          return undefined;
        }
      }
      /** Every observed disagreement remains invalid even if a later stat appears healthy. */
      function validate(pathStat: IMeasurementStat | undefined, fdStat: IMeasurementStat | undefined, expectedSize?: number): void {
        if (pathStat === undefined || fdStat === undefined) { return; }
        if (!sameIdentity(pathStat, pin)) { issues.push('pathname identity changed'); }
        if (!sameIdentity(fdStat, pin)) { issues.push('descriptor identity changed'); }
        if (pathStat.size !== fdStat.size) { issues.push('path/descriptor size disagreement'); }
        if (fdStat.size !== pin.size) { issues.push('size changed from initial pin'); }
        if (fdStat.size !== previousSize) { issues.push('size changed from previous barrier'); }
        if (expectedSize !== undefined && (pathStat.size !== expectedSize || fdStat.size !== expectedSize)) { issues.push('size changed during image'); }
        if (!Number.isSafeInteger(fdStat.size) || fdStat.size < 0 || fdStat.size > budget.maxFileBytes || fdStat.size > budget.maxImageBytes) { issues.push('image source quota exceeded'); }
      }
      if (imaging) { return { label, complete: false, bytes: new Uint8Array(), issues: ['concurrent image refused'], observations }; }
      imaging = true;
      try {
        budget.imagesUsed += 1;
        if (budget.imagesUsed > budget.maxImages) { issues.push('image count quota exceeded'); }
        if (closeResult !== undefined) { issues.push('measurement already closed'); }
        if (issues.length === 0) {
          const pathBefore = await observe('before', 'path');
          const fdBefore = await observe('before', 'descriptor');
          validate(pathBefore, fdBefore);
          if (fdBefore !== undefined) {
            const size = fdBefore.size;
            if (size > budget.maxBytes - budget.bytesUsed) { issues.push('image retention quota exceeded'); }
            if (issues.length === 0) {
              try {
                while (bytesRead < size) {
                  const target = new Uint8Array(Math.min(64 * 1024, size - bytesRead));
                  const count = await owned.read(target, bytesRead);
                  if (!Number.isInteger(count) || count < 0 || count > target.byteLength) { issues.push('invalid positional read count'); break; }
                  chunks.push(target.subarray(0, count));
                  bytesRead += count;
                  budget.bytesUsed += count;
                  if (count !== target.byteLength) { issues.push('short positional read'); break; }
                }
              } catch (error) {
                observations.push({ stage: 'read', source: 'descriptor', error });
                issues.push('positional image read failed');
              } finally {
                const pathAfter = await observe('after', 'path');
                const fdAfter = await observe('after', 'descriptor');
                validate(pathAfter, fdAfter, size);
              }
            }
            previousSize = size;
          }
        }
      } catch (error) {
        observations.push({ stage: 'read', source: 'descriptor', error });
        issues.push('positional image read failed');
      } finally { imaging = false; }
      const bytes = new Uint8Array(bytesRead);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      if (issues.length !== 0) { return { label, complete: false, bytes, issues, observations }; }
      return { label, complete: true, bytes, sha256: createHash('sha256').update(bytes).digest('hex'), issues, observations };
    }
    value = await body({ pin, close, capture });
    callbackReturned = true;
    completed = true;
  } catch (error) { failures.push(error); }
  finally {
    closure = await close();
    if (!closure.resolved) { failures.push(closure.error); completed = false; }
  }
  return callbackReturned ? { completed, callbackReturned, value, failures, closure } : { completed, callbackReturned, failures, closure };
}
