/**
 * Request-scoped execution identity (plan: "Explicit recovery request").
 *
 * An **attempt key** names one admitted execution: it is derived canonically
 * from the caller's saved request key and the complete structural invocation
 * descriptor (scope, role, slot and member key), so one top-level request
 * yields one key per direct invocation it executes. It is not a subject-level
 * cache key; History scopes it further by store, analysis, environment and
 * subject.
 *
 * An **intent digest** describes the complete current invocation that key is
 * meant to run: History scope, structural step, kind, subject, compatibility
 * version, the explicit empty-argument form, the source text of the step's
 * callbacks and of its declared children, the content of every declared input
 * slot and the source text of every declared helper slot. It is recovery
 * identity, deliberately broader than the consumed evidence reuse compares, so
 * a saved key can never recover an execution of different intent.
 *
 * Deriving either never invokes an author callback: implementations are read
 * with `Function.prototype.toString`, and input content is fingerprinted by
 * Tracking's canonical output encoding over an observer that records into no
 * author capture.
 */
import type { IBindingDescriptor, IComposition, IStepDeclaration } from '@microdelta/definition';
import type { ISha256Capability, ITrackingObserver } from '@microdelta/tracking';

import type { ICurrentSlots } from './current.js';
import { inputRecord, siblingStep } from './current.js';
import { bindingPaths } from './evidence.js';
import type { IResolutionFamily } from './family.js';

/** The source text of a callback, or null when absent. */
function sourceText(callback: unknown): string | null {
  return typeof callback === 'function' ? Function.prototype.toString.call(callback) : null;
}

/** The canonical structural tuple of a descriptor. */
function structural(step: IBindingDescriptor): readonly (string | null)[] {
  return [step.scope, step.role, step.slot, step.memberKey ?? null];
}

/** Derive the attempt key of one direct invocation within one saved request. */
export function attemptKey(host: ISha256Capability, requestKey: string, step: IBindingDescriptor): string {
  return `mdr1:${host.sha256(JSON.stringify(['microdelta.resolution.attempt-key', 1, requestKey, structural(step)]))}`;
}

/**
 * Fingerprint the current input record's complete content with Tracking's
 * canonical output encoding (MDS1). The validation observer's capture holds
 * only this framework selection; no author capture is involved.
 */
function inputContent(validation: ITrackingObserver, slots: ICurrentSlots): string {
  // Slot order is declaration layout, not intent: fingerprint the record in slot-name order.
  const record = Object.fromEntries(Object.entries(inputRecord(slots)).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
  const view = validation.tracked(record, { path: bindingPaths.inputs });
  // Framework-owned fingerprinting: the validation observer detaches the tracked current input record; no author callback runs here.
  const captured = validation.capture(() => validation.snapshotOutput(view));
  const [output] = captured.observations;
  if (output === undefined) {
    throw new TypeError('Tracking produced no content evidence for the current input record');
  }
  return output.fingerprint;
}

/** The complete current intent of one step invocation. */
export function intentDigest<TInputs extends object, THelpers extends object>(options: {
  readonly host: ISha256Capability;
  readonly validation: ITrackingObserver;
  readonly composition: IComposition<IResolutionFamily<TInputs, THelpers>>;
  readonly environment: string;
  readonly step: IBindingDescriptor;
  readonly declaration: IStepDeclaration<IResolutionFamily<TInputs, THelpers>>;
  readonly slots: ICurrentSlots;
}): string {
  const { declaration } = options;
  const children = declaration.kind === 'memo'
    ? [...declaration.children].sort().map((slot) => {
        const resolution = options.composition.resolve(siblingStep(options.step, slot));
        if (resolution.status !== 'bound' || resolution.target.role !== 'step') {
          return [slot, resolution.status];
        }
        const child = resolution.target.declaration;
        return [slot, child.kind, child.subject, child.version, sourceText(child.run), child.kind === 'source' ? sourceText(child.finality) : null];
      })
    : [];
  const inputs = [...options.slots.inputs].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([slot, state]) => [slot, state.status]);
  const helpers = [...options.slots.helpers].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([slot, state]) => [slot, state.status, state.status === 'bound' ? sourceText(state.value) : null]);
  const intent = [
    'microdelta.resolution.intent',
    1,
    options.composition.scope,
    options.environment,
    structural(options.step),
    declaration.kind,
    declaration.subject,
    declaration.version,
    { form: 'empty' },
    sourceText(declaration.run),
    declaration.kind === 'source' ? sourceText(declaration.finality) : null,
    children,
    inputs,
    inputContent(options.validation, options.slots),
    helpers,
  ];
  return `mdi1:${options.host.sha256(JSON.stringify(intent))}`;
}
