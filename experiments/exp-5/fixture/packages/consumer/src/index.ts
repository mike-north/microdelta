/** The consumer fixture expresses one declared cross-context type reference. @packageDocumentation */
import type { RecordEntity } from '@microdelta/exp5-producer';

/** A report service is the sole CML-mapped consumer operation. @public */
export class ReportService {
  /** The producer type reference is checked as a named API contract. @public */
  public formatRecord(record: RecordEntity): string { return record.label; }
}
