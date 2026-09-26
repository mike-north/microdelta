import { expectAssignable, expectError, expectType } from 'tsd';
import { explicit, scoped } from './surface.js';
import type { AnalysisContext, Collection, Ref } from './surface.js';
import { createContributionAnalysis as createScoped } from './scoped.js';
import { createContributionAnalysis as createExplicit } from './explicit.js';
import type { Analysis, Environment } from './surface.js';
import type { Input, Report, Services } from './domain.js';
// These examples specify the proposed author's experience before declarations.
declare const person: Ref<{ readonly name: string; readonly role: string }>;
declare const people: Collection<{ readonly name: string; readonly role: string }>;
const label = scoped.memo(async function label(p: typeof person) { return await p.name; }, { revision: 1 });
expectType<Ref<string>>(label(person));
expectError(label({ name: 42, role: 'designer' }));
expectError(person.missingField);
expectError(label(person, 'extra context argument'));

// Context is opt-in, supplied by execution, and excluded from ordinary callsites.
const contextual = explicit.memo.withContext(async function contextualLabel(
  context: AnalysisContext,
  p: typeof person,
) { return `${context.environment}: ${await p.name}`; }, { revision: 1 });
expectType<Ref<string>>(contextual(person));
expectType<AnalysisContext>(scoped.analysisContext());
expectError(contextual({}, person));

// References preserve selected-field types; batches return ordinary values.
expectType<string>(await person.name);
expectType<{ name: string; role: string }>(await scoped.refs.all({
  name: person.name, role: person.role,
}));
expectType<Collection<string>>(scoped.fanOut(people, label));
// Composition callbacks must not await or resolve their references.
expectError(scoped.fanOut(people, async p => label(p)));
// Collections deliberately do not masquerade as native arrays.
expectError(people.map((p: { readonly name: string }) => p.name));
expectAssignable<AsyncIterable<{ readonly name: string; readonly role: string }>>(people);

// Observed usage is numeric; currencies and resource pools are explicit labels.
const context = scoped.analysisContext();
context.record({ metric: 'inputTokens', unit: 'token', amount: 100, resource: 'llm' });
expectError(context.record({ metric: 'inputTokens', unit: 'token', amount: '100', resource: 'llm' }));
expectError(context.environment = 'trial');

// Array membership needs stable keys; changing array order must not rename work.
declare const employeeArray: Ref<readonly { readonly id: string; readonly name: string; readonly role: string }[]>;
expectError(scoped.fanOut(employeeArray, label));
expectType<Collection<string>>(scoped.fanOut(employeeArray, label, { key: employee => employee.id }));

// Durable memo definitions require an explicit revision in this comparison.
expectError(scoped.memo(async function missingRevision(p: typeof person) { return await p.name; }));

// Complete candidate programs preserve the same input and output contract.
declare const environment: Environment<Services>;
expectType<Analysis<Input, Report>>(createScoped(environment).definition);
expectType<Analysis<Input, Report>>(createExplicit(environment).definition);

// Wrapped bodies receive refs/collections; plain helpers remain ordinary functions.
expectError(scoped.memo(async function unsupportedPlainInput(person: { readonly name: string }) {
  return person.name;
}, { revision: 1 }));
