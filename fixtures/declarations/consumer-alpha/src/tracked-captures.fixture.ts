import type { ITracked, ITrackingObserver } from '@microdelta/tracking';
import type { ITrackedCaptureConfig } from '@microdelta/capture-producer';
import { forged } from '../../forged/dist/api/forged.alpha.js';

declare const observer: ITrackingObserver;
declare const configuration: ITrackedCaptureConfig;
// Producer declarations must preserve Tracking's actual generated declaration identity.
const canonicalInput: ITracked<{
  readonly enabled: boolean;
  readonly details?: { readonly count: number };
  readonly rows: readonly { readonly name: string }[];
}> = configuration.input;
const producerInput: ITrackedCaptureConfig['input'] = canonicalInput;
const canonicalCallable: ITracked<(value: boolean) => boolean> = configuration.isEnabled;
const producerCallable: ITrackedCaptureConfig['isEnabled'] = canonicalCallable;
declare const externalFlag: boolean;
declare const scalar: number;
declare const source: { readonly value: number };
declare const fake: { readonly __microdeltaTracked: unique symbol; readonly value: number };

const tracked = observer.tracked({
  enabled: true,
  nested: { count: 1 },
  optional: { value: 2 } as { value: number } | undefined,
  rows: [{ name: 'Ada' }],
}, { path: ['fixture'] });
const importedInput = configuration.input;
const importedCallable = configuration.isEnabled;

// Parameters and declarations within the capture are ordinary inputs.
observer.capture(() => {
  const local = 1;
  const read = (parameter: number): number => parameter + local;
  return read(tracked.enabled ? tracked.nested.count : 0);
});
function declaredCapture(): number { return tracked.nested.count; }
observer.capture(declaredCapture);
const trackedCallable = observer.tracked((enabled: boolean) => tracked.enabled && enabled, { path: ['callable'] });
observer.capture(() => trackedCallable(true));

// Recursive branded views preserve nested, optional, array-index, and callable brands.
observer.capture(() => [tracked.nested.count, tracked.optional?.value, tracked.rows[0]?.name]);
observer.capture(() => importedInput.enabled && importedInput.rows[0]?.name);
observer.capture(() => importedCallable(importedInput.enabled));
// eslint-disable-next-line microdelta/tracked-captures -- An alpha-looking declaration is not Tracking's canonical brand.
observer.capture(() => forged.value);
observer.capture(() => tracked.enabled && 'enabled' in tracked);
observer.capture(() => observer.keys(tracked).includes('enabled'));
observer.capture(() => observer.hasOwn(tracked, 'enabled'));
observer.capture(() => Math.max(tracked.nested.count, Number.isFinite(0) ? 1 : 0));
observer.capture(() => Object.is(tracked.enabled, true));
observer.capture(() => [undefined, NaN, Infinity]);

{
  const Math: Pick<typeof globalThis.Math, 'max'> = { max: value => value };
  // eslint-disable-next-line microdelta/tracked-captures -- A local Math shadow does not inherit standard-library capability authority.
  observer.capture(() => Math.max(1, 2));
}
{
  const undefined = 'local';
  // eslint-disable-next-line microdelta/tracked-captures -- A local undefined shadow is an external captured binding.
  observer.capture(() => undefined);
}

// A tracked record returned by a recognized local cell carries semantic field reads.
const recordCell = observer.local.cell(observer.tracked({ enabled: true }, { path: ['cell'] }));
observer.capture(() => recordCell.get().enabled);

// Semantic derivation replays its validated reads for scalar success and failure results.
const successful = observer.derived(() => tracked.nested.count > 0);
observer.capture(() => successful.get());
const caughtFailure = observer.derived(() => {
  try {
    return tracked.nested.count > 0;
  } catch {
    return false;
  }
});
observer.capture(() => caughtFailure.get());

// Same-spelled non-framework entrypoints outside a real boundary are not capture boundaries.
function trackedEntry(callback: () => number): number { return callback(); }
trackedEntry(() => scalar);

const extracted = tracked.nested.count;
// eslint-disable-next-line microdelta/tracked-captures -- This fixture asserts detection of a scalar extracted before capture.
observer.capture(() => extracted);

const maybe = tracked.optional;
// eslint-disable-next-line microdelta/tracked-captures -- Optional values extracted before capture do not carry a selected read.
observer.capture(() => maybe?.value);

// eslint-disable-next-line microdelta/tracked-captures -- The configuration holder is not itself a branded tracked value.
observer.capture(() => configuration.input.enabled);

// eslint-disable-next-line microdelta/tracked-captures -- This fixture asserts detection of an external branch selector.
observer.capture(() => externalFlag ? tracked.enabled : false);

const scalarCell = observer.local.cell(1);
// eslint-disable-next-line microdelta/tracked-captures -- Scalar cell values do not carry semantic data observations.
observer.capture(() => scalarCell.get());

const invalidDerived = observer.derived(() => {
  // eslint-disable-next-line microdelta/tracked-captures -- The derived callback itself is the negative boundary assertion.
  return scalarCell.get() > 0;
});
observer.capture(() => invalidDerived.get());

declare const externalHelper: (value: number) => number;
// eslint-disable-next-line microdelta/tracked-captures -- Unbranded external helpers are outside the observation boundary.
observer.capture(() => externalHelper(scalar));

// eslint-disable-next-line microdelta/tracked-captures -- Same-spelled helpers are not trusted inside a real capture boundary.
observer.capture(() => trackedEntry(() => scalar));

// eslint-disable-next-line microdelta/tracked-captures -- A same-named string property is not the canonical unique-symbol brand.
observer.capture(() => fake.value);

// eslint-disable-next-line microdelta/tracked-captures -- Native reflection is not a supported tracked observation.
observer.capture(() => Object.keys(tracked));

// eslint-disable-next-line microdelta/tracked-captures -- Nondeterministic builtins are outside the deterministic allowlist.
observer.capture(() => Math.random());

declare function callbackFactory(): () => number;
// eslint-disable-next-line microdelta/tracked-captures -- Unsupported callback factories require an explicit direct callback form.
observer.capture(callbackFactory());

void source;
void producerInput;
void producerCallable;
