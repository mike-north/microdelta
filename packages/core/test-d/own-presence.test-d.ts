/** The generated alpha facade offers only the owning own-presence capability. */
import { expectError, expectType } from 'tsd';

import { authoring } from '../dist/api/microdelta.alpha.js';
import type { IHasOwn, ITrackedView } from '../dist/api/microdelta.alpha.js';

/** Optional data allows own presence to differ from its returned value. */
interface IInputs {
  readonly config: { readonly optional?: number | undefined };
  readonly rows: readonly number[];
}
/** A type-only consumer may name the narrow capability without obtaining an observer. */
declare const ownPresence: IHasOwn;
declare const config: ITrackedView<IInputs['config']>;
expectType<boolean>(ownPresence(config, 'optional'));
expectType<boolean>(ownPresence(config, 'absent'));
expectError(ownPresence({}, 'optional'));
expectError(ownPresence(3, 'optional'));
expectError(ownPresence(config, Symbol('optional')));
expectError(ownPresence(config, 0));
expectError(ownPresence.capture);

/** Contextual binding inference carries the capability through ordinary facade builders. */
const builders = authoring<IInputs, Record<never, never>>();
builders.memo({
  subject: 'own-presence',
  run: ({ inputs, hasOwn }) => {
    const capability: IHasOwn = hasOwn;
    return { own: capability(inputs.config, 'optional'), index: capability(inputs.rows, '0') };
  },
});
builders.source<{ readonly own: boolean }>({
  subject: 'own-source',
  run: ({ inputs, hasOwn, outcome }) => outcome.fresh({ own: hasOwn(inputs.config, 'optional') }),
});

// The capability is intentionally unavailable through the generated public facade.
// @ts-expect-error: The generated public tier must not export the alpha-only IHasOwn type.
export type { IHasOwn as IPublicOwnMustRemainHidden } from 'microdelta';
