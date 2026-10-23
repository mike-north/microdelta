/** Primitive authoring must prove both levels of restart reuse and output cutoff in separate processes. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from '@jest/globals';

/** Checked evidence for one step, built only from runtime lifecycle events. */
interface INodeReceipt { readonly executions: number; readonly publications: number; readonly reference: string }
/** One process's observable primitive result and per-step execution/publication identities. */
interface IReceipt { readonly data: number; readonly kind: string; readonly reference: string; readonly nodes: Readonly<Record<string, INodeReceipt>>; readonly rawStorage: unknown }

/** Validate JSON at the process boundary instead of casting reports into the expected shape. */
function receipt(value: unknown): IReceipt {
  if (value === null || typeof value !== 'object' || !('data' in value) || typeof value.data !== 'number'
    || !('kind' in value) || typeof value.kind !== 'string' || !('reference' in value) || typeof value.reference !== 'string'
    || !('nodes' in value) || value.nodes === null || typeof value.nodes !== 'object' || !('rawStorage' in value)) {
    throw new Error('Malformed authoring process receipt');
  }
  const nodes: Record<string, INodeReceipt> = {};
  const entries: readonly (readonly [string, unknown])[] = Object.entries(value.nodes);
  for (const [name, node] of entries) {
    if (node === null || typeof node !== 'object' || !('executions' in node) || typeof node.executions !== 'number'
      || !('publications' in node) || typeof node.publications !== 'number' || !('reference' in node) || typeof node.reference !== 'string') {
      throw new Error('Malformed node lifecycle receipt');
    }
    Object.defineProperty(nodes, name, { enumerable: true, value: { executions: node.executions, publications: node.publications, reference: node.reference } });
  }
  return { data: value.data, kind: value.kind, reference: value.reference, nodes, rawStorage: value.rawStorage };
}

/** Each invocation reconstructs declarations in a fresh process and reopens the same durable store. */
function inStore(callback: (run: (scenario: string, mode?: string) => IReceipt) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-authoring-'));
  const worker = fileURLToPath(new URL('./worker.js', import.meta.url));
  let request = 0;
  try {
    callback((scenario, mode = 'composed') => {
      request += 1;
      const result = spawnSync(process.execPath, [worker, join(directory, 'history.sqlite'), scenario, String(request), mode], { encoding: 'utf8', timeout: 30_000 });
      if (result.status !== 0) { throw new Error(result.stderr); }
      const parsed: unknown = JSON.parse(result.stdout);
      return receipt(parsed);
    });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

describe('bounded primitive authoring across process shutdown', () => {
  test('one numeric memo publishes once, reuses unchanged/unread edits and detects later consumed edits', () => {
    inStore((run) => {
      const cold = run('base', 'single');
      const unchanged = run('base', 'single');
      const unread = run('unread', 'single');
      const changed = run('changed', 'single');
      const later = run('changed', 'single');
      expect(cold.data).toBe(4);
      expect(cold.nodes['length']).toMatchObject({ executions: 1, publications: 1 });
      for (const kept of [unchanged, unread]) {
        expect(kept.reference).toBe(cold.reference);
        expect(kept.nodes['length']).toMatchObject({ executions: 0, publications: 0 });
      }
      expect(changed.data).toBe(8);
      expect(changed.reference).not.toBe(cold.reference);
      expect(changed.nodes['length']).toMatchObject({ executions: 1, publications: 1 });
      expect(later.reference).toBe(changed.reference);
      expect(later.nodes['length']).toMatchObject({ executions: 0, publications: 0 });
      expect(cold.rawStorage).toEqual({ value: 4 });
    });
  });

  test('both levels reuse, equal child output cuts off parent, and changed child output reruns both', () => {
    inStore((run) => {
      const cold = run('base');
      const unchanged = run('base');
      const unread = run('unread');
      const equal = run('equal');
      const changed = run('changed');
      expect(cold.data).toBe(10);
      expect(cold.nodes['score']).toMatchObject({ executions: 1, publications: 1 });
      expect(cold.nodes['report']).toMatchObject({ executions: 1, publications: 1 });
      for (const kept of [unchanged, unread]) {
        expect(kept.nodes).toMatchObject({ score: { executions: 0, publications: 0, reference: cold.nodes['score']?.reference }, report: { executions: 0, publications: 0, reference: cold.reference } });
      }
      expect(equal.data).toBe(10);
      expect(equal.nodes['score']).toMatchObject({ executions: 1, publications: 1 });
      expect(equal.nodes['score']?.reference).not.toBe(cold.nodes['score']?.reference);
      expect(equal.nodes['report']).toMatchObject({ executions: 0, publications: 0, reference: cold.reference });
      expect(changed.data).toBe(20);
      expect(changed.nodes).toMatchObject({ score: { executions: 1, publications: 1 }, report: { executions: 1, publications: 1 } });
      expect(changed.reference).not.toBe(cold.reference);
    });
  });

  test('changing only the authored callback invalidates the child while equal output retains parent', () => {
    inStore((run) => {
      const cold = run('base');
      const equalCode = run('callback-equal');
      const changedCode = run('callback-changed');
      expect(equalCode.data).toBe(cold.data);
      expect(equalCode.nodes['score']).toMatchObject({ executions: 1, publications: 1 });
      expect(equalCode.nodes['score']?.reference).not.toBe(cold.nodes['score']?.reference);
      expect(equalCode.nodes['report']).toMatchObject({ executions: 0, publications: 0, reference: cold.reference });
      expect(changedCode.data).toBe(20);
      expect(changedCode.nodes).toMatchObject({ score: { executions: 1, publications: 1 }, report: { executions: 1, publications: 1 } });
      expect(changedCode.nodes['score']?.reference).not.toBe(equalCode.nodes['score']?.reference);
      expect(changedCode.reference).not.toBe(equalCode.reference);
      const later = run('callback-changed');
      expect(later.nodes).toMatchObject({ score: { executions: 0, publications: 0, reference: changedCode.nodes['score']?.reference }, report: { executions: 0, publications: 0, reference: changedCode.reference } });
    });
  });
});

/** Current from correspondence, rather than old selected paths or equal callback text, governs input origin. */
test('a changed symbolic input target invalidates both levels and then reuses its current binding', () => {
  inStore((run) => {
    const cold = run('base');
    const changed = run('rebound');
    expect(changed.data).toBe(20);
    expect(changed.nodes).toMatchObject({ score: { executions: 1, publications: 1 }, report: { executions: 1, publications: 1 } });
    expect(changed.nodes['score']?.reference).not.toBe(cold.nodes['score']?.reference);
    expect(changed.reference).not.toBe(cold.reference);
    const later = run('rebound');
    expect(later.nodes).toMatchObject({ score: { executions: 0, publications: 0, reference: changed.nodes['score']?.reference }, report: { executions: 0, publications: 0, reference: changed.reference } });
  });
});

/** Dictionary-shaped adapter plumbing must preserve literal author strings, not object prototypes. */
test('reserved input, occurrence and alias spellings remain own bindings across restart', () => {
  inStore((run) => {
    const cold = run('base', 'reserved');
    const kept = run('base', 'reserved');
    expect(cold.data).toBe(5);
    expect(cold.nodes).toMatchObject({ ['__proto__']: { executions: 1, publications: 1 }, constructor: { executions: 1, publications: 1 } });
    expect(kept.nodes).toMatchObject({ ['__proto__']: { executions: 0, publications: 0, reference: cold.nodes['__proto__']?.reference }, constructor: { executions: 0, publications: 0, reference: cold.reference } });
  });
});

/** Aliases and ignored child outputs retain explicit declared-call behavior. */
test('same-child aliases execute successfully and ignored child output changes do not invalidate the parent', () => {
  inStore((run) => {
    const cold = run('base', 'aliased');
    expect(cold.data).toBe(2);
    expect(cold.nodes['score']).toMatchObject({ executions: 1, publications: 1 });
    const kept = run('base', 'aliased');
    expect(kept.reference).toBe(cold.reference);
  });
  inStore((run) => {
    const cold = run('base', 'ignored');
    const changed = run('changed', 'ignored');
    expect(changed.data).toBe(7);
    expect(changed.nodes['score']).toMatchObject({ executions: 1, publications: 1 });
    expect(changed.nodes['report']).toMatchObject({ executions: 0, publications: 0, reference: cold.reference });
  });
});
