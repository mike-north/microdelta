/** Qualification-only lifetime policy: a complete phase is one supervised fold request, not one HTTP send. */

/** The parent owns this finite wall-clock deadline for each independent cold/restart process. */
export const qualificationPhaseTimeoutMilliseconds = 12 * 60 * 60 * 1_000;
/** A bounded shutdown allowance keeps a live request lease valid while the parent closes a timed-out child. */
export const qualificationCleanupMarginMilliseconds = 60_000;
/** Long dead-holder recovery is an explicit cost of this isolated qualification store, not a production default or heartbeat. */
export const qualificationWriterLeaseMilliseconds = qualificationPhaseTimeoutMilliseconds + qualificationCleanupMarginMilliseconds;
