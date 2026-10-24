/** Report readers cannot mutate, dispatch, or confuse nullable state with additive consumption. */
import { expectError, expectType } from 'tsd';
import type { IResourceReport, IResourceReportReader, IResourceReports, IRetainedResourceReport } from '../dist/src/index.js';

declare const report: IResourceReport;
declare const writer: IResourceReports;
declare const reader: IResourceReportReader;
expectType<'recorded' | 'duplicate'>(writer.record(report));
expectType<number>(writer.maintain());
expectType<readonly IRetainedResourceReport[]>(reader.query('production'));
expectType<number | null>(report.remaining);
expectError(reader.record);
expectError(reader.maintain);
expectError(reader.dispatch);
expectError(report.observedAt = 0);
expectError(writer.record({ ...report, remaining: '93' }));
