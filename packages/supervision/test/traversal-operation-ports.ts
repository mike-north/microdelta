/**
 * In-memory owner ports for coordinator pass-resumption controls. The real
 * operation engine records its own deferral, identities and retry allowance;
 * this helper stores only its journal/Accounting output, with no native store
 * or complete controlled traversal.
 */
import type { IJournalEntry, IRunOperationPorts } from '../src/index.js';

/** Ordinary optimistic journal revisions are enforced; test code never injects a request's private deferral array. */
export function operationPorts(): IRunOperationPorts {
  const records = new Map<string, { readonly environment: string; readonly collection: string; readonly entry: IJournalEntry }>();
  let random = 0;
  return {
    journal: {
      commit(lease, request) {
        return request.writes.map(write => {
          const key = JSON.stringify([request.environment, write.collection, write.key]);
          const revision = records.get(key)?.entry.revision ?? 0;
          if (revision !== write.expectedRevision) { throw new Error('Owner-port journal revision conflict'); }
          const entry = { key: write.key, revision: revision + 1, fence: lease.fence, record: write.record };
          records.set(key, { environment: request.environment, collection: write.collection, entry });
          return entry;
        });
      },
      read: location => records.get(JSON.stringify([location.environment, location.collection, location.key]))?.entry,
      list: query => [...records.values()].filter(value => value.environment === query.environment && value.collection === query.collection).map(value => value.entry),
    },
    accounting: {
      recordUsageIntent: () => 'recorded',
      acknowledgeUsage: () => ({ kind: 'acknowledged' }),
    },
    random: { randomIdentifier: () => { random += 1; return random.toString(16).padStart(32, '0'); } },
  };
}
