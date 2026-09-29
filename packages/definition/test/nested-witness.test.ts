/**
 * Outcome tests for reconnecting historical invocation witnesses.
 *
 * `resolveWitness` accepts the M3 version-1 witness with its original meaning
 * and the version-2 nested invocation witness
 * `{ version: 2, parent, child, index, arguments }`, whose arguments are the
 * `{ form: 'empty' }` form or an ordered recipe list of `forwarded { origin }`,
 * `derived { value, justified }` and `unreconstructible { reason }`. Unknown
 * versions, unknown argument or recipe forms and malformed data are
 * unsupported with a precise reason; nothing is guessed. Witnesses are written
 * here by hand from the contract, as durable JSON, never captured from
 * Definition's own output.
 *
 * @see ../../../docs/spec/composition.md (CMP-6, CMP-7, EXP-4 argument recipe)
 * @see ../../../docs/spec/execution.md (REUSE-006, REUSE-007)
 * @see ../../../docs/plans/m4-composition.md ("Nested invocation evidence")
 */
import { describe, expect, test } from '@jest/globals';
import { encodeSnapshot } from '@microdelta/value';

import type { IBindingDescriptor, IWitnessResolution } from '../src/index.js';
import { compose, memo, type ITestFamily } from './fixtures/contributors.js';
import { assessmentSubject, buildNested, nestedScope, rubric, stepSlot, supply, type IAssessment, type IAssessorParameters } from './fixtures/nested.js';
import { expectDefinitionError } from './fixtures/port.js';

/** A member step descriptor. */
function memberStep(memberKey: string, slot: string): IBindingDescriptor {
  return { scope: nestedScope, role: 'step', slot, memberKey };
}

/** A composition-level step descriptor. */
function levelStep(slot: string): IBindingDescriptor {
  return { scope: nestedScope, role: 'step', slot };
}

/** A callable slot descriptor. */
function callable(slot: string): IBindingDescriptor {
  return { scope: nestedScope, role: 'callable', slot };
}

/** Round-trip through JSON as durable evidence would. */
function durable<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

/** The durable assessor call a summary made: derived PR number and a forwarded earlier activity output. */
function assessorWitness(memberKey: string, overrides: Readonly<Record<string, unknown>> = {}): unknown {
  return durable({
    version: 2,
    parent: memberStep(memberKey, 'summary'),
    child: callable('assessor'),
    index: 2,
    arguments: [
      { form: 'derived', value: encodeSnapshot(7), justified: true },
      { form: 'forwarded', origin: { binding: 'child', call: 0, path: [{ kind: 'property', key: 'pullRequests' }, { kind: 'index', index: 0 }] }, justified: true },
    ],
    ...overrides,
  });
}

/** The status and reason of a resolution, for compact unsupported assertions. */
function outcome(resolution: IWitnessResolution<ITestFamily>): string {
  return resolution.status === 'unsupported' ? `unsupported:${resolution.reason}` : resolution.status;
}

describe('version-2 witness reconnection (acceptance 5)', () => {
  test('REUSE-006: a restarted, reordered composition reconnects each v2 witness to its own member and the current slot implementation', () => {
    const after = buildNested({ order: 'reversed', rubric: 'B' });
    for (const key of ['person:ada', 'person:ben'] as const) {
      const witness = assessorWitness(key);
      const resolution = after.composition.resolveWitness(witness);
      expect(resolution).toMatchObject({
        status: 'bound',
        parent: { role: 'step', declaration: after.members[key].summary },
        child: { role: 'callable', kind: 'supplied-step', declaration: after.rubric },
      });
      if (resolution.status === 'bound') {
        expect(resolution.witness).toEqual(witness);
        expect(Object.isFrozen(resolution.witness)).toBe(true);
      }
    }
  });

  test('REUSE-006: v2 witnesses reconnect sibling memo and source children with the empty argument form', () => {
    const { composition, members } = buildNested();
    const profile = composition.resolveWitness(durable({
      version: 2, parent: memberStep('person:ada', 'summary'), child: memberStep('person:ada', 'profile'), index: 1, arguments: { form: 'empty' },
    }));
    expect(profile).toMatchObject({ status: 'bound', child: { role: 'step', declaration: members['person:ada'].profile } });
    const activity = composition.resolveWitness(durable({
      version: 2, parent: memberStep('person:ada', 'profile'), child: memberStep('person:ada', 'activity'), index: 0, arguments: { form: 'empty' },
    }));
    expect(activity).toMatchObject({ status: 'bound', child: { role: 'step', declaration: members['person:ada'].activity } });
  });

  test('REUSE-006: version-1 witnesses keep their M3 meaning, including for composition-level parents', () => {
    const { composition, discovery } = buildNested();
    const witness = durable({ version: 1, parent: levelStep('report'), child: levelStep('discovery'), arguments: { form: 'empty' } });
    expect(composition.resolveWitness(witness)).toMatchObject({ status: 'bound', child: { role: 'step', declaration: discovery }, witness });
  });

  test('REUSE-007: a version-1 witness binds only to a source child; a memo or slot child is an unsupported argument form', () => {
    const { composition } = buildNested();
    const memoChild = durable({ version: 1, parent: memberStep('person:ada', 'summary'), child: memberStep('person:ada', 'profile'), arguments: { form: 'empty' } });
    const slotChild = durable({ version: 1, parent: memberStep('person:ada', 'summary'), child: callable('assessor'), arguments: { form: 'empty' } });
    expect(outcome(composition.resolveWitness(memoChild))).toBe('unsupported:argument-form');
    expect(outcome(composition.resolveWitness(slotChild))).toBe('unsupported:argument-form');
    const sourceChild = durable({ version: 1, parent: memberStep('person:ada', 'summary'), child: memberStep('person:ada', 'activity'), arguments: { form: 'empty' } });
    expect(outcome(composition.resolveWitness(sourceChild))).toBe('bound');
  });

  test('REUSE-007: the version is read first; any other version is unsupported before other fields are parsed', () => {
    const { composition } = buildNested();
    expect(outcome(composition.resolveWitness(durable({ version: 3, parent: 'garbage' })))).toBe('unsupported:witness-version');
    expect(outcome(composition.resolveWitness(durable({ parent: memberStep('person:ada', 'summary') })))).toBe('unsupported:witness-version');
    expect(outcome(composition.resolveWitness('summary->assessor'))).toBe('unsupported:witness-version');
  });

  test('REUSE-007: extra fields on a version-1 or version-2 witness record are malformed, not ignored', () => {
    const { composition } = buildNested();
    const v1 = { version: 1, parent: levelStep('report'), child: levelStep('discovery'), arguments: { form: 'empty' } };
    expect(outcome(composition.resolveWitness(durable({ ...v1, note: 'extra' })))).toBe('unsupported:malformed');
    expect(outcome(composition.resolveWitness(durable({ ...v1, index: 0 })))).toBe('unsupported:malformed');
    expect(outcome(composition.resolveWitness(assessorWitness('person:ada', { implementation: 'rubric A' })))).toBe('unsupported:malformed');
    expect(outcome(composition.resolveWitness(durable(v1)))).toBe('bound');
  });

  test('REUSE-006: a parsed version-2 witness is deeply frozen: recipes, origins, paths and segments', () => {
    const resolution = buildNested().composition.resolveWitness(assessorWitness('person:ada'));
    if (resolution.status !== 'bound' || resolution.witness.version !== 2) {
      throw new Error('expected a bound v2 witness');
    }
    const { witness } = resolution;
    const recipes = witness.arguments;
    if ('form' in recipes) {
      throw new Error('expected recipes');
    }
    const [, forwarded] = recipes;
    expect(Object.isFrozen(witness)).toBe(true);
    expect(Object.isFrozen(witness.parent)).toBe(true);
    expect(Object.isFrozen(witness.child)).toBe(true);
    expect(Object.isFrozen(recipes)).toBe(true);
    expect(recipes.every(recipe => Object.isFrozen(recipe))).toBe(true);
    if (forwarded?.form !== 'forwarded') {
      throw new Error('expected a forwarded recipe');
    }
    expect(Object.isFrozen(forwarded.origin)).toBe(true);
    expect(Object.isFrozen(forwarded.origin.path)).toBe(true);
    expect(forwarded.origin.path.every(segment => Object.isFrozen(segment))).toBe(true);
  });

  test('CMP-7: justification is read back for forwarded and derived recipes alike, never inferred', () => {
    const witness = assessorWitness('person:ada', {
      arguments: [
        { form: 'derived', value: encodeSnapshot(7), justified: false },
        { form: 'forwarded', origin: { binding: 'child', call: 0, path: [] }, justified: false },
      ],
    });
    const resolved = buildNested().composition.resolveWitness(witness);
    expect(resolved.status).toBe('bound');
    expect(resolved.status === 'bound' ? resolved.witness.version === 2 && resolved.witness.arguments : undefined).toEqual([
      { form: 'derived', value: encodeSnapshot(7), justified: false },
      { form: 'forwarded', origin: { binding: 'child', call: 0, path: [] }, justified: false },
    ]);
  });

  test('REUSE-007: unknown versions, argument forms and recipe forms, and malformed data, are unsupported with precise reasons', () => {
    const { composition } = buildNested();
    const derived = { form: 'derived', value: encodeSnapshot(7), justified: true };
    const cases: readonly (readonly [string, unknown])[] = [
      ['unsupported:witness-version', assessorWitness('person:ada', { version: 3 })],
      ['unsupported:witness-version', assessorWitness('person:ada', { version: '2' })],
      ['unsupported:malformed', assessorWitness('person:ada', { index: -1 })],
      ['unsupported:malformed', assessorWitness('person:ada', { index: 1.5 })],
      ['unsupported:malformed', assessorWitness('person:ada', { index: '2' })],
      ['unsupported:malformed', durable({ version: 2, parent: memberStep('person:ada', 'summary'), child: callable('assessor'), arguments: { form: 'empty' } })],
      ['unsupported:argument-form', assessorWitness('person:ada', { arguments: [] })],
      ['unsupported:argument-form', assessorWitness('person:ada', { arguments: { form: 'list', items: [derived] } })],
      ['unsupported:argument-form', assessorWitness('person:ada', { arguments: { form: 'empty', items: [] } })],
      ['unsupported:argument-form', assessorWitness('person:ada', { arguments: undefined })],
      ['unsupported:recipe-form', assessorWitness('person:ada', { arguments: [derived, { form: 'closure', source: '() => 1' }] })],
      ['unsupported:recipe-form', assessorWitness('person:ada', { arguments: [derived, { form: 'forwarded', origin: { binding: 'global', path: [] }, justified: true }] })],
      ['unsupported:malformed', assessorWitness('person:ada', { arguments: [derived, { value: 1 }] })],
      ['unsupported:malformed', assessorWitness('person:ada', { arguments: [{ form: 'derived', value: 'not canonical', justified: true }] })],
      ['unsupported:malformed', assessorWitness('person:ada', { arguments: [{ form: 'derived', value: encodeSnapshot(7) }] })],
      ['unsupported:malformed', assessorWitness('person:ada', { arguments: [{ form: 'derived', value: encodeSnapshot(7), justified: 'yes' }] })],
      ['unsupported:malformed', assessorWitness('person:ada', { arguments: [{ ...derived, extra: true }] })],
      ['unsupported:malformed', assessorWitness('person:ada', { arguments: [{ form: 'unreconstructible', reason: '' }] })],
      ['unsupported:malformed', assessorWitness('person:ada', { arguments: [{ form: 'unreconstructible', reason: 'Unsupported value at $: function' }] })],
      // A forwarded recipe records whether its path was chosen with no observed untracked read before it; strictly required.
      ['unsupported:malformed', assessorWitness('person:ada', { arguments: [{ form: 'forwarded', origin: { binding: 'child', call: 0, path: [] } }] })],
      ['unsupported:malformed', assessorWitness('person:ada', { arguments: [{ form: 'forwarded', origin: { binding: 'child', call: 0, path: [] }, justified: 'yes' }] })],
      ['unsupported:malformed', assessorWitness('person:ada', { arguments: [{ form: 'forwarded', origin: { binding: 'child', call: 2, path: [] }, justified: true }] })],
      ['unsupported:malformed', assessorWitness('person:ada', { arguments: [{ form: 'forwarded', origin: { binding: 'input', slot: '', path: [] }, justified: true }] })],
      ['unsupported:malformed', assessorWitness('person:ada', { arguments: [{ form: 'forwarded', origin: { binding: 'input', slot: 'config', path: ['minimumAuthored'] }, justified: true }] })],
      ['unsupported:malformed', assessorWitness('person:ada', { arguments: [{ form: 'forwarded', origin: { binding: 'member', path: [{ kind: 'index', index: -1 }] }, justified: true }] })],
      ['unsupported:malformed', assessorWitness('person:ada', { parent: { slot: 'summary' } })],
      ['unsupported:witness-version', 'summary->assessor'],
    ];
    for (const [expected, witness] of cases) {
      expect(`${JSON.stringify(witness)} => ${outcome(composition.resolveWitness(witness))}`).toBe(`${JSON.stringify(witness)} => ${expected}`);
    }
  });

  test('REUSE-007: accessor-bearing witness data is unsupported without running the accessor', () => {
    const { composition } = buildNested();
    let read = false;
    const base = assessorWitness('person:ada');
    if (typeof base !== 'object' || base === null) {
      throw new Error('expected a witness record');
    }
    const witness = Object.defineProperty(base, 'index', { get: () => {
      read = true;
      return 2;
    }, enumerable: true });
    expect(outcome(composition.resolveWitness(witness))).toBe('unsupported:malformed');
    expect(read).toBe(false);
  });

  test('CMP-7: a v2 witness for an undeclared edge, or naming a helper slot, is not reconnected', () => {
    const helperFormat = (): string => 'x';
    const build = buildNested();
    const composition = compose({ ...build.options, helpers: [{ slot: 'format', helper: helperFormat }] });
    const undeclared = durable({ version: 2, parent: memberStep('person:ada', 'profile'), child: callable('assessor'), index: 1, arguments: { form: 'empty' } });
    expect(composition.resolveWitness(undeclared)).toEqual({ status: 'undeclared-edge' });
    const helper = durable({ version: 2, parent: memberStep('person:ada', 'summary'), child: callable('format'), index: 0, arguments: { form: 'empty' } });
    expect(composition.resolveWitness(helper)).toEqual({ status: 'undeclared-edge' });
    const crossMember = durable({ version: 2, parent: memberStep('person:ada', 'summary'), child: memberStep('person:ben', 'profile'), index: 0, arguments: { form: 'empty' } });
    expect(composition.resolveWitness(crossMember)).toEqual({ status: 'undeclared-edge' });
  });

  test('EXP-4: a v2 witness naming an unsupplied or doubly supplied slot is missing or ambiguous, never remapped', () => {
    expect(buildNested({ supplied: 'none' }).composition.resolveWitness(assessorWitness('person:ada')))
      .toEqual({ status: 'missing', descriptor: callable('assessor') });
    expect(buildNested({ supplied: 'twice' }).composition.resolveWitness(assessorWitness('person:ada')))
      .toEqual({ status: 'ambiguous', descriptor: callable('assessor'), occupants: 2 });
    expect(buildNested().composition.resolveWitness(assessorWitness('person:ada', { child: callable('scorer') })))
      .toEqual({ status: 'missing', descriptor: callable('scorer') });
  });

  test('CMP-7: runtime arguments on a sibling edge are an unsupported argument form', () => {
    const { composition } = buildNested();
    const witness = durable({
      version: 2,
      parent: memberStep('person:ada', 'summary'),
      child: memberStep('person:ada', 'profile'),
      index: 1,
      arguments: [{ form: 'derived', value: encodeSnapshot(1), justified: true }],
    });
    expect(outcome(composition.resolveWitness(witness))).toBe('unsupported:argument-form');
  });

  test('CMP-7: a member-binding origin is an unsupported argument form for a parent that is not a template instance', () => {
    const memberParent = assessorWitness('person:ada', { arguments: [{ form: 'forwarded', origin: { binding: 'member', path: [] }, justified: true }] });
    expect(outcome(buildNested().composition.resolveWitness(memberParent))).toBe('unsupported:argument-form');
  });

  test('CMP-7: a member-binding origin under a composition-level parent is an unsupported argument form', () => {
    const assessor = stepSlot<IAssessorParameters, IAssessment>({ slot: 'assessor' });
    const report = memo({ subject: 'report:slot', children: { assess: assessor }, run: () => 1 });
    const composition = compose({
      scope: nestedScope,
      steps: [{ slot: 'report', declaration: report }],
      supplied: [supply({ slot: assessor, declaration: rubric('A'), subject: assessmentSubject })],
    });
    const witness = durable({
      version: 2,
      parent: levelStep('report'),
      child: callable('assessor'),
      index: 0,
      arguments: [{ form: 'forwarded', origin: { binding: 'member', path: [] }, justified: true }],
    });
    expect(outcome(composition.resolveWitness(witness))).toBe('unsupported:argument-form');
  });
});

describe('recomputed slot subjects (acceptance 6)', () => {
  test('RES-001: the reconnected slot recomputes the call subject from recorded recipes, equal across implementations', () => {
    const subjects: unknown[] = [];
    for (const which of ['A', 'B'] as const) {
      const resolution = buildNested({ rubric: which }).composition.resolveWitness(assessorWitness('person:ada'));
      if (resolution.status !== 'bound' || resolution.child.role !== 'callable' || resolution.witness.version !== 2) {
        throw new Error(`expected a bound slot witness, got ${JSON.stringify(resolution)}`);
      }
      subjects.push(resolution.child.subjectFor(resolution.witness.arguments));
    }
    expect(subjects).toEqual([
      { scope: nestedScope, subject: 'assessment:acme/widget:7' },
      { scope: nestedScope, subject: 'assessment:acme/widget:7' },
    ]);
  });

  test('RES-001: recomputing a subject equal to a declared step subject rejects with conflicting-subject', () => {
    const resolution = buildNested({ subject: () => 'contributors:acme/widget:2026-Q1' }).composition.resolveWitness(assessorWitness('person:ada'));
    if (resolution.status !== 'bound' || resolution.child.role !== 'callable' || resolution.witness.version !== 2) {
      throw new Error('expected a bound slot witness');
    }
    const { child, witness } = resolution;
    expectDefinitionError(() => child.subjectFor(witness.arguments), 'conflicting-subject');
  });

  test('RES-001: recomputing a subject whose function returns an incomplete subject rejects with invalid-subject', () => {
    const resolution = buildNested({ subject: () => '' }).composition.resolveWitness(assessorWitness('person:ada'));
    if (resolution.status !== 'bound' || resolution.child.role !== 'callable' || resolution.witness.version !== 2) {
      throw new Error('expected a bound slot witness');
    }
    const { child, witness } = resolution;
    expectDefinitionError(() => child.subjectFor(witness.arguments), 'invalid-subject');
  });

});
