/** Fresh-process consumer oracle: declarations stay fixed while only declared input snapshots vary. */
import { authoring, openWorkspace } from '../src/index.js';

/** Deliberate supported-container transitions exercise ordinary JavaScript consumers. */
interface IConfig {
  readonly detail?: { readonly name: string } | readonly string[] | null;
  readonly nested?: { readonly child?: { readonly name: string } | null } | null;
  readonly author: { readonly id: string; readonly name: string; readonly unread: number };
}
interface IInputs { readonly config: IConfig }
type IHelpers = Record<never, never>;

/** CLI discriminants name explicit snapshots; no parsed object is trusted as a framework input. */
function configOf(variant: string): IConfig {
  const author = { id: 'a', name: 'Ada', unread: 1 };
  switch (variant) {
    case 'record': return { detail: { name: 'Ada' }, nested: { child: { name: 'Ada' } }, author };
    case 'array': return { detail: ['Ada'], nested: { child: { name: 'Ada' } }, author };
    case 'null': return { detail: null, nested: null, author };
    case 'missing': return { author };
    case 'nested-null': return { detail: { name: 'Ada' }, nested: { child: null }, author };
    case 'new-author-equal': return { detail: { name: 'Ada' }, author: { id: 'b', name: 'Ada', unread: 2 } };
    case 'new-author-change': return { detail: { name: 'Ada' }, author: { id: 'b', name: 'Grace', unread: 3 } };
    case 'third-author-equal': return { detail: { name: 'Ada' }, author: { id: 'c', name: 'Grace', unread: 4 } };
    case 'third-author-change': return { detail: { name: 'Ada' }, author: { id: 'c', name: 'Katherine', unread: 5 } };
    default: throw new Error('Unknown snapshot');
  }
}

/** Consumers each have an ordinary stable body; operation selection happens outside capture. */
async function main(): Promise<void> {
  const [location, variant, slot, requestKey] = process.argv.slice(2);
  if (location === undefined || variant === undefined || slot === undefined || requestKey === undefined) { throw new Error('Expected location, variant, slot and request'); }
  const builders = authoring<IInputs, IHelpers>();
  const type = builders.memo({ subject: 'type', run: ({ inputs }) => ({ value: typeof inputs.config.detail }) });
  // eslint-disable-next-line microdelta/tracked-captures -- Adversarial runtime probe intentionally tests Array.isArray, outside the documented deterministic builtin lint allowlist.
  const array = builders.memo({ subject: 'array', run: ({ inputs }) => ({ value: Array.isArray(inputs.config.detail) }) });
  const nullish = builders.memo({ subject: 'nullish', run: ({ inputs }) => ({ value: (inputs.config.detail ?? 'fallback') === 'fallback' }) });
  const optional = builders.memo({ subject: 'optional', run: ({ inputs }) => ({ value: inputs.config.nested?.child?.name ?? 'fallback' }) });
  const leaf = builders.memo({ subject: 'leaf', run: ({ inputs }) => ({ value: inputs.config.author.name }) });
  const composition = builders.compose({ scope: 'operation-analysis', inputs: [{ slot: 'config', value: configOf(variant) }], helpers: [], steps: [
    { slot: 'type', declaration: type }, { slot: 'array', declaration: array }, { slot: 'nullish', declaration: nullish }, { slot: 'optional', declaration: optional }, { slot: 'leaf', declaration: leaf },
  ] });
  const workspace = openWorkspace({ location, logicalStore: 'operation-store' });
  try {
    const result = await workspace.run({ authoring: builders, composition, environment: 'test' }, async (run) => {
      const outcome = await run.resolve({ scope: 'operation-analysis', role: 'step', slot }, { requestKey });
      if (outcome.kind !== 'published' && outcome.kind !== 'reused') { throw new Error(`Unexpected ${outcome.kind}`); }
      return { kind: outcome.kind, reference: outcome.reference, value: run.read<unknown>(outcome.reference) };
    });
    process.stdout.write(`${JSON.stringify(result.value)}\n`);
  } finally { workspace.close(); }
}
await main();
