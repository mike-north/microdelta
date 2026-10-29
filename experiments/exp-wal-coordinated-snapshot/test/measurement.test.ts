/** Ordinary files exercise the Q9 measurement contract without a SQLite connection. */
import { describe, expect, test } from '@jest/globals';
import { chmod, mkdtemp, open, readFile, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rawMeasurementPort, withRetainedShm } from '../node/measurement.js';
import type { IMeasurementBudget, IMeasurementPort, IMeasurementHandle, IMeasurementImage } from '../node/measurement.js';

/** Every image shares the caller's finite image/retention account. */
function budget(): IMeasurementBudget {
  return { imagesUsed: 0, bytesUsed: 0, maxImages: 12, maxBytes: 3 * 1024 * 1024, maxFileBytes: 256 * 1024, maxImageBytes: 256 * 1024 };
}

/** The test owns restoration and deletion independently of measurement cleanup. */
async function fixture(body: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'wal302-measurement-'));
  const path = join(dir, 'fixture-shm');
  try { await writeFile(path, 'initial'); await body(path); }
  finally { await chmod(dir, 0o700); await chmod(path, 0o600).catch(() => undefined); await rm(dir, { recursive: true, force: true }); }
}

/** Fault ports wrap an actual owned FD; the harness closes it if the injected close refuses. */
function injected(overrides: Partial<IMeasurementHandle>, handles: IMeasurementHandle[]): IMeasurementPort {
  return { ...rawMeasurementPort, async open(path) { const handle = await rawMeasurementPort.open(path); handles.push(handle); return { ...handle, ...overrides }; } };
}

describe('retained Q9 measurement', () => {
  test('actual denied fresh opens coexist with current retained-descriptor bytes', async () => {
    await fixture(async path => {
      const result = await withRetainedShm(path, budget(), async measurement => {
        await writeFile(path, 'current');
        await chmod(path, 0o000);
        for (const mode of ['r', 'r+']) {
          const fresh = await open(path, mode).then(async fd => { await fd.close(); return 'bypassed'; }, (error: unknown) => error);
          expect(fresh).toMatchObject({ code: expect.stringMatching(/^(EACCES|EPERM)$/) });
        }
        const image = await measurement.capture('denied-path');
        expect(image.complete).toBe(true);
        expect(Buffer.from(image.bytes).toString()).toBe('current');
        expect(image.sha256).toMatch(/^[a-f0-9]{64}$/);
      });
      expect(result.completed).toBe(true);
      expect(result.closure).toEqual({ attempted: true, resolved: true });
    });
  });

  test.each(['replaced', 'missing', 'symlink'] as const)('%s path cannot label stale inode bytes current', async kind => {
    await fixture(async path => {
      const result = await withRetainedShm(path, budget(), async measurement => {
        if (kind === 'replaced') { await rename(path, `${path}-old`); await writeFile(path, 'initial'); }
        else if (kind === 'missing') { await unlink(path); }
        else { await rename(path, `${path}-old`); await symlink(`${path}-old`, path); }
        const image = await measurement.capture(kind);
        expect(image.complete).toBe(false);
        expect(image.bytes.byteLength).toBe(0);
        expect(image.sha256).toBeUndefined();
        expect(image.issues.length).toBeGreaterThan(0);
        expect(image.observations.length).toBeGreaterThan(0);
      });
      expect(result.completed).toBe(true);
      expect(result.closure.resolved).toBe(true);
    });
  });

  test('refuses initial symlinks before callback without following them', async () => {
    await fixture(async path => {
      await symlink(path, `${path}-link`);
      let entered = false;
      const result = await withRetainedShm(`${path}-link`, budget(), async () => { entered = true; });
      expect(entered).toBe(false);
      expect(result.completed).toBe(false);
      expect(result.failures).toHaveLength(1);
      expect(result.closure.attempted).toBe(false);
    });
  });

  test('unexplained growth is retained as invalid measurement', async () => {
    await fixture(async path => {
      const result = await withRetainedShm(path, budget(), async measurement => {
        expect((await measurement.capture('baseline')).complete).toBe(true);
        await writeFile(path, 'longer current bytes');
        const image = await measurement.capture('growth');
        expect(image.complete).toBe(false);
        expect(image.issues).toContain('size changed from initial pin');
      });
      expect(result.completed).toBe(true);
      expect(result.closure.resolved).toBe(true);
    });
  });

  test('short read retains partial bytes and never retries', async () => {
    await fixture(async path => {
      const handles: IMeasurementHandle[] = [];
      let reads = 0;
      const port = injected({ async read(target, offset) { reads += 1; target[0] = 0x70; expect(offset).toBe(0); return 1; } }, handles);
      try {
        const result = await withRetainedShm(path, budget(), async measurement => {
          const image = await measurement.capture('short');
          expect(image.complete).toBe(false);
          expect(image.issues).toContain('short positional read');
          expect(Buffer.from(image.bytes).toString()).toBe('p');
          expect(image.sha256).toBeUndefined();
        }, port);
        expect(reads).toBe(1);
        expect(result.completed).toBe(true);
      expect(result.closure.resolved).toBe(true);
      } finally { await Promise.all(handles.map(handle => handle.close().catch(() => undefined))); }
    });
  });

  test('image and byte overflow refuse without expanding budgets', async () => {
    await fixture(async path => {
      const account = budget(); account.maxImages = 1; account.maxBytes = 6;
      const result = await withRetainedShm(path, account, async measurement => {
        const first = await measurement.capture('byte-overflow');
        expect(first.complete).toBe(false);
        expect(first.issues).toContain('image retention quota exceeded');
        const second = await measurement.capture('image-overflow');
        expect(second.complete).toBe(false);
        expect(second.issues).toContain('image count quota exceeded');
      });
      expect(result.completed).toBe(true);
      expect(result.closure.resolved).toBe(true);
      expect(account.maxImages).toBe(1);
      expect(account.maxBytes).toBe(6);
      expect(account.bytesUsed).toBe(0);
    });
  });

  test('reads at explicit positions with at most 64 KiB per call', async () => {
    await fixture(async path => {
      await writeFile(path, Buffer.alloc(130 * 1024, 0x41));
      const handles: IMeasurementHandle[] = [];
      const positions: number[] = [];
      const port: IMeasurementPort = { ...rawMeasurementPort, async open(target) {
        const handle = await rawMeasurementPort.open(target); handles.push(handle);
        return { ...handle, async read(bytes, offset) { expect(bytes.byteLength).toBeLessThanOrEqual(65536); positions.push(offset); return handle.read(bytes, offset); } };
      } };
      try {
        const result = await withRetainedShm(path, budget(), async measurement => {
          const image = await measurement.capture('chunked');
          expect(image.complete).toBe(true);
          expect(Buffer.from(image.bytes)).toEqual(await readFile(path));
        }, port);
        expect(result.completed).toBe(true);
      expect(result.closure.resolved).toBe(true);
        expect(positions).toEqual([0, 65536, 131072]);
      } finally { await Promise.all(handles.map(handle => handle.close().catch(() => undefined))); }
    });
  });

  test.each(['native refusal', 'persistence failure', 'deadline'] as const)('%s preserves primary failure and closes once', async reason => {
    await fixture(async path => {
      const primary = new Error(reason);
      const result = await withRetainedShm(path, budget(), async () => { throw primary; });
      expect(result.completed).toBe(false);
      expect(result.failures).toEqual([primary]);
      expect(result.closure).toEqual({ attempted: true, resolved: true });
    });
  });

  test('undefined primary and injected close failure stay distinct without close retry', async () => {
    await fixture(async path => {
      const handles: IMeasurementHandle[] = [];
      const closeFailure = new Error('measurement-adapter close');
      let closes = 0;
      const port = injected({ async close() { closes += 1; throw closeFailure; } }, handles);
      try {
        const result = await withRetainedShm(path, budget(), async measurement => {
          const first = await measurement.close();
          const second = await measurement.close();
          expect(second).toBe(first);
          throw undefined;
        }, port);
        expect(result.failures).toEqual([undefined, closeFailure]);
        expect(result).toMatchObject({ callbackReturned: false });
        expect(Object.hasOwn(result, 'value')).toBe(false);
        expect(result.closure).toEqual({ attempted: true, resolved: false, error: closeFailure });
        expect(closes).toBe(1);
      } finally { await Promise.all(handles.map(handle => handle.close())); }
    });
  });

  test('initial fstat failure still closes immediately owned FD', async () => {
    await fixture(async path => {
      const handles: IMeasurementHandle[] = [];
      const primary = new Error('stat failed');
      const result = await withRetainedShm(path, budget(), async () => undefined, injected({ async stat() { throw primary; } }, handles));
      expect(result.failures).toEqual([primary]);
      expect(result.closure.resolved).toBe(true);
      expect(handles).toHaveLength(1);
    });
  });
});


/** Faults here are measurement-adapter outcomes, never native release evidence. */
describe('measurement attribution and all-exit cleanup', () => {
  test('initial directory is refused after owning and closing its FD', async () => {
    await fixture(async path => {
      let entered = false;
      const result = await withRetainedShm(join(path, '..'), budget(), async () => { entered = true; });
      expect(entered).toBe(false);
      expect(result.completed).toBe(false);
      expect(result.failures).toHaveLength(1);
      expect(result.closure).toEqual({ attempted: true, resolved: true });
    });
  });

  test('oversized initial source refuses before callback and closes', async () => {
    await fixture(async path => {
      const account = budget(); account.maxFileBytes = 6;
      let entered = false;
      const result = await withRetainedShm(path, account, async () => { entered = true; });
      expect(entered).toBe(false);
      expect(result.completed).toBe(false);
      expect(result.failures).toHaveLength(1);
      expect(result.closure.resolved).toBe(true);
      expect(account.imagesUsed).toBe(0);
    });
  });

  test('path/descriptor size disagreement is retained before reading', async () => {
    await fixture(async path => {
      let calls = 0;
      const port: IMeasurementPort = { ...rawMeasurementPort, async lstat(target) {
        const stat = await rawMeasurementPort.lstat(target); calls += 1;
        return calls === 1 ? stat : { ...stat, size: stat.size + 1 };
      } };
      const result = await withRetainedShm(path, budget(), async measurement => {
        const image = await measurement.capture('disagreement');
        expect(image.complete).toBe(false);
        expect(image.issues).toContain('path/descriptor size disagreement');
        expect(image.bytes.byteLength).toBe(0);
      }, port);
      expect(result.completed).toBe(true);
      expect(result.closure.resolved).toBe(true);
    });
  });

  test('replacement during read retains bytes but withholds current-path hash', async () => {
    await fixture(async path => {
      const handles: IMeasurementHandle[] = [];
      const port: IMeasurementPort = { ...rawMeasurementPort, async open(target) {
        const handle = await rawMeasurementPort.open(target); handles.push(handle);
        return { ...handle, async read(bytes, offset) {
          const count = await handle.read(bytes, offset);
          await rename(path, `${path}-old`); await writeFile(path, 'initial');
          return count;
        } };
      } };
      try {
        const account = budget();
        const result = await withRetainedShm(path, account, async measurement => {
          const image = await measurement.capture('replaced-during-read');
          expect(image.complete).toBe(false);
          expect(image.issues).toContain('pathname identity changed');
          expect(Buffer.from(image.bytes).toString()).toBe('initial');
          expect(image.sha256).toBeUndefined();
          expect(image.observations).toHaveLength(4);
        }, port);
        expect(result.completed).toBe(true);
        expect(result.closure.resolved).toBe(true);
        expect(account.bytesUsed).toBe(7);
      } finally { await Promise.all(handles.map(handle => handle.close().catch(() => undefined))); }
    });
  });

  test('read error retains partial bytes and after-read identity observations', async () => {
    await fixture(async path => {
      await writeFile(path, Buffer.alloc(70 * 1024, 0x41));
      const handles: IMeasurementHandle[] = [];
      const readFailure = new Error('measurement-adapter read');
      const port: IMeasurementPort = { ...rawMeasurementPort, async open(target) {
        const handle = await rawMeasurementPort.open(target); handles.push(handle);
        return { ...handle, async read(bytes, offset) {
          if (offset > 0) { throw readFailure; }
          return handle.read(bytes, offset);
        } };
      } };
      try {
        const account = budget();
        const result = await withRetainedShm(path, account, async measurement => {
          const image = await measurement.capture('failed-second-read');
          expect(image.complete).toBe(false);
          expect(image.bytes.byteLength).toBe(65536);
          expect(image.observations.filter(fact => fact.stage === 'after')).toHaveLength(2);
          expect(image.observations).toContainEqual({ stage: 'read', source: 'descriptor', error: readFailure });
          expect(image.sha256).toBeUndefined();
        }, port);
        expect(result.completed).toBe(true);
        expect(result.closure.resolved).toBe(true);
        expect(account.bytesUsed).toBe(65536);
      } finally { await Promise.all(handles.map(handle => handle.close().catch(() => undefined))); }
    });
  });

  test('close failure alone is the primary harness error', async () => {
    await fixture(async path => {
      const handles: IMeasurementHandle[] = [];
      const error = new Error('measurement-adapter close only');
      const port = injected({ async close() { throw error; } }, handles);
      try {
        const result = await withRetainedShm(path, budget(), async () => 'done', port);
        expect(result.completed).toBe(false);
        expect(result.failures).toEqual([error]);
        expect(result.closure).toEqual({ attempted: true, resolved: false, error });
      } finally { await Promise.all(handles.map(handle => handle.close())); }
    });
  });
});


/** Cleanup failure cannot erase an image already returned by the measured callback. */
describe('returned measurement evidence survives cleanup failure', () => {
  test('actual replaced-path incomplete image remains exact alongside close failure', async () => {
    await fixture(async path => {
      const handles: IMeasurementHandle[] = [];
      const closeFailure = new Error('measurement-adapter close after counterexample');
      const port = injected({ async close() { throw closeFailure; } }, handles);
      let observed: IMeasurementImage | undefined;
      try {
        const result = await withRetainedShm(path, budget(), async measurement => {
          await rename(path, `${path}-old`);
          await writeFile(path, 'replacement');
          observed = await measurement.capture('replaced-path-before-failed-close');
          return observed;
        }, port);
        expect(observed).toBeDefined();
        expect(observed?.complete).toBe(false);
        expect(observed?.issues).toContain('pathname identity changed');
        expect(observed?.observations.length).toBeGreaterThan(0);
        expect(result.completed).toBe(false);
        expect(result.value).toBe(observed);
        expect(result).toMatchObject({ callbackReturned: true });
        expect(result.failures).toEqual([closeFailure]);
        expect(result.closure).toEqual({ attempted: true, resolved: false, error: closeFailure });
      } finally { await Promise.all(handles.map(handle => handle.close())); }
    });
  });

  test('returned undefined is distinct from callback throwing undefined after failed close', async () => {
    await fixture(async path => {
      const handles: IMeasurementHandle[] = [];
      const closeFailure = new Error('measurement-adapter close after undefined return');
      const port = injected({ async close() { throw closeFailure; } }, handles);
      try {
        const result = await withRetainedShm(path, budget(), async () => undefined, port);
        expect(result.completed).toBe(false);
        expect(result).toMatchObject({ callbackReturned: true });
        expect(Object.hasOwn(result, 'value')).toBe(true);
        expect(result.value).toBeUndefined();
        expect(result.failures).toEqual([closeFailure]);
        expect(result.closure).toEqual({ attempted: true, resolved: false, error: closeFailure });
      } finally { await Promise.all(handles.map(handle => handle.close())); }
    });
  });
});
