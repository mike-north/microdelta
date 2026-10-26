/** Independent acceptance expectations for the standalone report workload fixture. */
import { describe, expect, test } from '@jest/globals';
import { workloadCardinality, workloadPerson, workloadPull } from './workload-fixture.js';

describe('controlled report workload fixture', () => {
  test('represents 150,000 unique authored PRs with separate attached evidence counts', () => {
    const cardinality = workloadCardinality();
    expect(cardinality).toEqual({ people: 300, pullRequests: 150_000, reviews: 150_000, comments: 300_000, inlineComments: 150_000 });
  });

  test('uses varied per-person contributions and varied evidence payloads', () => {
    const sparse = workloadPerson(0);
    const prolific = workloadPerson(299);
    expect(sparse.pullRequests).toBe(250);
    expect(prolific.pullRequests).toBe(2_250);
    expect(workloadPull(sparse, 0)).not.toEqual(workloadPull(sparse, sparse.pullRequests - 1));
    expect(workloadPull(sparse, 0).reviewBody).not.toBe(workloadPull(sparse, 1).reviewBody);
  });
});
