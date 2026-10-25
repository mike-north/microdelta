/** RUN-007 availability is independent of author truthiness and is alpha-only. */
import { expectError, expectType } from 'tsd';
import type { IMaterialization, IMaterializedView } from '@microdelta/materialization';
import { createPreviewProjection } from '../dist/api/microdelta.alpha.js';
import type { IPreviewScope, IPreviewEvaluation } from '../dist/api/microdelta.alpha.js';
import * as publicFacade from 'microdelta';

/** Existing Materialization is sufficient; no writer/execution capability is accepted. */
declare const materialization: IMaterialization;
/** Scope and evaluation are supplied by the existing run/result owners. */
declare const scope: IPreviewScope;
declare const evaluation: IPreviewEvaluation;
/** A wrapped undefined remains available author data. */
interface IData { readonly count: number; readonly optional: undefined }
const projection = createPreviewProjection(materialization);
const preview = projection.project<IData>({ scope, evaluation });
expectError(preview.value);
if (preview.availability === 'available') {
  expectType<'current' | 'stale'>(preview.freshness);
  expectType<IMaterializedView<IData>>(preview.value);
  expectType<number>(preview.value.count);
  expectType<undefined>(preview.value.optional);
  expectError(preview.freshness = 'current');
} else {
  expectError(preview.value); expectError(preview.reference); expectError(preview.freshness);
}
if (preview.refresh.kind === 'failed') { expectType<unknown>(preview.refresh.error); }
else { expectError(preview.refresh.error); }
expectError(projection.project<number>({ scope }));
expectError(projection.project<undefined>({ scope }));
expectError(projection.project({ scope, isCurrent: true }));
expectError(publicFacade.createPreviewProjection);
