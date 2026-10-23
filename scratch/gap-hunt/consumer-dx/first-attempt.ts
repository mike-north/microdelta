import { authoring, openWorkspace } from 'microdelta';

interface IPullRequest { readonly key: string; readonly title: string }
interface IListing { readonly members: readonly IPullRequest[]; readonly status: 'complete' | 'open' }
const api = authoring<{ readonly observation: string }, Record<string, never>>();
const listing = api.source<IListing>({ subject: 'github:search', collection: { identity: 'key' }, run: () => ({ members: [{ key: 'pr:1', title: 'Retry' }], status: 'complete' }) });
const workspace = openWorkspace({ location: './scratch/gap-hunt/consumer-dx/store', logicalStore: 'dx' });
void listing;
void workspace;
