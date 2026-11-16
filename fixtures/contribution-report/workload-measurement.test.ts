/** Measurement assertions require observed sample activity, not merely a configured timer interval. */
import { describe, expect, test } from '@jest/globals';
import { createWorkloadMemorySampler } from './workload-measurement.js';

describe('workload process memory sampler', () => {
  test('records bounded dispatch and final samples with actual elapsed timing', () => {
    let elapsed = 0;
    let rss = 10_000;
    const sampler = createWorkloadMemorySampler({ intervalMilliseconds: 100, now: () => elapsed,
      read: () => ({ rss, heapUsed: rss / 2 }) });
    sampler.sampleDispatchBoundary();
    elapsed = 100;
    rss = 20_000;
    sampler.sampleDispatchBoundary();
    const snapshot = sampler.snapshot();
    sampler.close();

    expect(snapshot.baselineRssBytes).toBe(10_000);
    expect(snapshot.peakSampledRssBytes).toBe(20_000);
    expect(snapshot.sampleCounts).toEqual({ timer: 0, dispatch: 1, final: 1, total: 2 });
    expect(snapshot.timing).toMatchObject({ configuredIntervalMilliseconds: 100, firstSampleElapsedMilliseconds: 100, lastSampleElapsedMilliseconds: 100, maxGapMilliseconds: 100 });
  });
});
