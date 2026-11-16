/** Bounded process-memory observations supplement phase receipts without changing application scheduling. */
import { performance } from 'node:perf_hooks';

/** One process-memory reading uses the byte units returned by Node's memoryUsage API. */
export interface IWorkloadMemoryReading { readonly rss: number; readonly heapUsed: number }
/** Counts and timing show which samples actually occurred during an often microtask-bound phase. */
export interface IWorkloadMemorySnapshot {
  readonly baselineRssBytes: number;
  readonly peakSampledRssBytes: number;
  readonly peakSampledHeapUsedBytes: number;
  readonly sampleCounts: { readonly timer: number; readonly dispatch: number; readonly final: number; readonly total: number };
  readonly timing: { readonly configuredIntervalMilliseconds: number; readonly firstSampleElapsedMilliseconds: number | null; readonly lastSampleElapsedMilliseconds: number | null; readonly maxGapMilliseconds: number };
}
/** The driver can request rate-limited observations at actual transport boundaries and one final observation. */
export interface IWorkloadMemorySampler {
  sampleDispatchBoundary(): void;
  snapshot(): IWorkloadMemorySnapshot;
  close(): void;
}
/** Injected clock and reader make the sampling contract deterministic in tests. */
export interface IWorkloadMemorySamplerOptions {
  readonly intervalMilliseconds: number;
  readonly now?: () => number;
  readonly read?: () => IWorkloadMemoryReading;
}

/**
 * Capture an immediate baseline, periodic timer samples when the event loop permits them, and throttled
 * pre/post-dispatch samples when the phase is busy. Every timing field describes an observed sample.
 */
export function createWorkloadMemorySampler(options: IWorkloadMemorySamplerOptions): IWorkloadMemorySampler {
  if (!Number.isSafeInteger(options.intervalMilliseconds) || options.intervalMilliseconds < 1) { throw new RangeError('memory sample interval must be a positive integer'); }
  const now = options.now ?? (() => performance.now());
  const read = options.read ?? (() => process.memoryUsage());
  const startedAt = now();
  const baseline = read();
  let peakSampledRssBytes = baseline.rss;
  let peakSampledHeapUsedBytes = baseline.heapUsed;
  let timerSamples = 0;
  let dispatchSamples = 0;
  let finalSamples = 0;
  let firstSampleElapsedMilliseconds: number | null = null;
  let lastSampleElapsedMilliseconds: number | null = null;
  let maxGapMilliseconds = 0;
  let lastSampleAt: number | undefined = startedAt;

  const sample = (kind: 'timer' | 'dispatch' | 'final'): void => {
    const sampledAt = now();
    const elapsed = sampledAt - startedAt;
    const reading = read();
    peakSampledRssBytes = Math.max(peakSampledRssBytes, reading.rss);
    peakSampledHeapUsedBytes = Math.max(peakSampledHeapUsedBytes, reading.heapUsed);
    if (kind === 'timer') { timerSamples += 1; }
    else if (kind === 'dispatch') { dispatchSamples += 1; }
    else { finalSamples += 1; }
    if (firstSampleElapsedMilliseconds === null) { firstSampleElapsedMilliseconds = elapsed; }
    if (lastSampleAt !== undefined) { maxGapMilliseconds = Math.max(maxGapMilliseconds, sampledAt - lastSampleAt); }
    lastSampleAt = sampledAt;
    lastSampleElapsedMilliseconds = elapsed;
  };

  const timer = setInterval(() => sample('timer'), options.intervalMilliseconds);
  return {
    sampleDispatchBoundary() {
      const current = now();
      if (lastSampleAt === undefined || current - lastSampleAt >= options.intervalMilliseconds) { sample('dispatch'); }
    },
    snapshot() {
      sample('final');
      return {
        baselineRssBytes: baseline.rss,
        peakSampledRssBytes,
        peakSampledHeapUsedBytes,
        sampleCounts: { timer: timerSamples, dispatch: dispatchSamples, final: finalSamples, total: timerSamples + dispatchSamples + finalSamples },
        timing: { configuredIntervalMilliseconds: options.intervalMilliseconds, firstSampleElapsedMilliseconds, lastSampleElapsedMilliseconds, maxGapMilliseconds },
      };
    },
    close() { clearInterval(timer); },
  };
}
