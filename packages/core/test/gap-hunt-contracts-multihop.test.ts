/** Earlier-child forwarding and derived subjects must follow current call results across equal-output cutoff. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
interface ICandidate { readonly reference: string; readonly dependencies: readonly string[]; readonly acceptances: readonly (readonly string[])[] }
interface IResult {
  readonly kind: string;
  readonly reference: string;
  readonly value: unknown;
  readonly accepted: readonly string[];
  readonly subjects: Readonly<Record<string, readonly ICandidate[]>>;
  readonly bodies: readonly string[];
}
function strings(value: unknown): readonly string[] {
  if (!Array.isArray(value) || !value.every((item: unknown) => typeof item === 'string')) { throw new Error('Expected string list'); }
  return value;
}
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) { throw new Error('Expected record'); }
  return Object.fromEntries(Object.entries(value));
}
const worker = fileURLToPath(new URL('./gap-hunt-contracts-multihop-worker.js', import.meta.url));
function run(location: string, variant: string, request: string): IResult {
  const child = spawnSync(process.execPath, [worker, location, variant, request], { encoding: 'utf8' });
  if (child.status !== 0) { throw new Error(child.stderr); }
  const result = record(JSON.parse(child.stdout));
  if (typeof result.kind !== 'string' || typeof result.reference !== 'string') { throw new Error('Malformed outcome'); }
  const subjects = Object.fromEntries(Object.entries(record(result.subjects)).map(([subject, entries]) => {
    if (!Array.isArray(entries)) { throw new Error('Expected candidates'); }
    const candidates: readonly ICandidate[] = entries.map((entry: unknown) => {
      const candidate = record(entry);
      if (typeof candidate.reference !== 'string' || !Array.isArray(candidate.acceptances)) { throw new Error('Malformed candidate'); }
      return { reference: candidate.reference, dependencies: strings(candidate.dependencies), acceptances: candidate.acceptances.map((acceptance: unknown) => strings(acceptance)) };
    });
    return [subject, candidates];
  }));
  return { kind: result.kind, reference: result.reference, value: result.value, accepted: strings(result.accepted), subjects, bodies: child.stderr.split('\n').filter(line => line.startsWith('BODY:')).map(line => line.slice(5)) };
}
function latest(result: IResult, subject: string): ICandidate {
  const found = result.subjects[subject]?.[0];
  if (found === undefined) { throw new Error(`Missing subject ${subject}`); }
  return found;
}

describe('gap hunt CMP-7 multi-hop current argument reconstruction', () => {
  test('equal-output rebinding refreshes earlier-child forwarding and derived subjects without rewriting original provenance', () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-multihop-'));
    try {
      const store = join(directory, 'retained.sqlite');
      const first = run(store, 'base', 'first');
      expect(first.value).toEqual({ score: 3 });
      const originalOuter = latest(first, 'outer');
      const originalRoot = latest(first, 'root');

      // Both earlier results change exactly; the selected name and score do not.
      const rebound = run(store, 'equal-rebound', 'second');
      expect(rebound.bodies).toEqual(['listing', 'normalize']);
      expect(rebound.reference).toBe(first.reference);
      expect(latest(rebound, 'outer').reference).toBe(originalOuter.reference);
      expect(latest(rebound, 'listing').reference).not.toBe(latest(first, 'listing').reference);
      expect(latest(rebound, 'normalize').reference).not.toBe(latest(first, 'normalize').reference);
      expect(latest(rebound, 'outer').dependencies).toEqual(originalOuter.dependencies);
      expect(latest(rebound, 'outer').acceptances.at(-1)).toEqual([
        latest(rebound, 'listing').reference, latest(rebound, 'normalize').reference, latest(first, 'score:Ada').reference,
      ]);

      // A new derived subject has equal score: inner parent reruns, outermost root cuts off.
      const equalScore = run(store, 'equal-score-new-name', 'third');
      const coldEqual = run(join(directory, 'cold-equal.sqlite'), 'equal-score-new-name', 'cold');
      expect(equalScore.value).toEqual(coldEqual.value);
      expect(equalScore.bodies).toEqual(['listing', 'normalize', 'outer', 'score:score:Eve']);
      expect(equalScore.reference).toBe(first.reference);
      expect(equalScore.accepted).toEqual([latest(equalScore, 'outer').reference]);
      expect(latest(equalScore, 'root').dependencies).toEqual(originalRoot.dependencies);
      expect(latest(equalScore, 'score:Eve').reference).not.toBe(latest(first, 'score:Ada').reference);

      const changed = run(store, 'changed-score', 'fourth');
      const coldChanged = run(join(directory, 'cold-changed.sqlite'), 'changed-score', 'cold');
      expect(changed.value).toEqual(coldChanged.value);
      expect(changed.value).toEqual({ score: 5 });
      expect(changed.bodies).toEqual(['listing', 'normalize', 'outer', 'score:score:Grace', 'root']);
      expect(changed.kind).toBe('published');
      expect(changed.reference).not.toBe(first.reference);

      const unread = run(store, 'unread-edit', 'fifth');
      expect(unread.bodies).toEqual(['listing']);
      expect(unread.reference).toBe(changed.reference);
      expect(latest(unread, 'normalize').reference).toBe(latest(changed, 'normalize').reference);

      const rollback = run(store, 'base', 'sixth');
      expect(rollback.value).toEqual(first.value);
      expect(rollback.kind).toBe('reused');
      expect(rollback.reference).toBe(first.reference);
      expect(rollback.bodies).toEqual(['listing']);
      const oldOuter = rollback.subjects.outer?.find(candidate => candidate.reference === originalOuter.reference);
      expect(oldOuter?.dependencies).toEqual(originalOuter.dependencies);
      expect(oldOuter?.acceptances.at(-1)).toEqual([
        latest(rollback, 'listing').reference, latest(first, 'normalize').reference, latest(first, 'score:Ada').reference,
      ]);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
