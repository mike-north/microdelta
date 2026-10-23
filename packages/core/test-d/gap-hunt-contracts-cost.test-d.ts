/** Owner-alpha composition preserves readonly retained data beside a mutable process-local filter. */
import { expectError, expectType } from 'tsd';
import { createTracking } from '@microdelta/tracking';
import type { ITrackingObserverHost } from '@microdelta/tracking';
import type { IMaterializedView } from '@microdelta/materialization';
declare const host: ITrackingObserverHost;
declare const view: IMaterializedView<{ readonly members: readonly { readonly score: number }[] }>;
const local = createTracking(host);
const filter = local.cell(5);
expectType<number>(filter.get());
filter.set(8);
expectType<number>(local.derived(() => filter.get()).get());
expectType<number | undefined>(view.members[0]?.score);
// eslint-disable-next-line @typescript-eslint/no-unsafe-call -- Deliberate tsd negative: tracked arrays intentionally have no native push method.
expectError(view.members.push({ score: 1 }));
expectError(view.members[0]!.score = 4);
expectError(filter.set('five'));
