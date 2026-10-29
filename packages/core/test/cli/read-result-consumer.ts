/** Self-contained external v1 decoding recipe; it imports no package, generated declaration or private codec. */
type IConsumerFact = { readonly kind: 'fact'; readonly value: unknown } | { readonly kind: 'failed'; readonly code: string };

/** All inputs came from JSON, so reflection here observes data rather than arbitrary application objects. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
/** Closed field sets preserve this command version's meaning without guessing future additions. */
function fields(value: unknown, expected: readonly string[]): Readonly<Record<string, unknown>> {
  if (!isRecord(value) || Object.keys(value).length !== expected.length || !expected.every(key => Object.hasOwn(value, key))) { throw new TypeError('Unsupported CLI object'); }
  return value;
}
/** Node and slot vectors must be dense ordinary JSON arrays, never shorthand object forms. */
function vector(value: unknown): readonly unknown[] { if (!Array.isArray(value)) { throw new TypeError('Unsupported CLI vector'); } return value; }
/** Exact selection comparison is independent of outer JSON object field order. */
function selectionKey(value: unknown): string {
  const selected = fields(value, ['location', 'logicalStore', 'reference', 'operation', 'address']);
  const reference = fields(selected.reference, ['kind', 'locator']);
  if (typeof selected.location !== 'string' || selected.location.length === 0 || typeof selected.logicalStore !== 'string' || selected.logicalStore.length === 0 || reference.kind !== 'completed-result' || typeof reference.locator !== 'string' || reference.locator.length === 0 || !['value', 'own', 'membership', 'length', 'keys', 'container-kind'].some(operation => operation === selected.operation)) { throw new TypeError('Unsupported CLI selection'); }
  const address = vector(selected.address).map(segment => {
    if (!isRecord(segment)) { throw new TypeError('Unsupported CLI address'); }
    if (segment.kind === 'property') { const property = fields(segment, ['kind', 'key']); if (typeof property.key !== 'string') { throw new TypeError('Unsupported property'); } return ['property', property.key]; }
    const indexed = fields(segment, ['kind', 'index']);
    if (indexed.kind !== 'index' || typeof indexed.index !== 'number' || !Number.isSafeInteger(indexed.index) || indexed.index < 0) { throw new TypeError('Unsupported index'); }
    return ['index', indexed.index];
  });
  return JSON.stringify([selected.location, selected.logicalStore, reference.locator, selected.operation, address]);
}
/** Numbers use exact ECMAScript roundtripping tokens, preserving all special Number facts. */
function number(token: unknown): number {
  if (typeof token !== 'string') { throw new TypeError('Unsupported Number token'); }
  switch (token) {
    case 'NaN': return Number.NaN;
    case '+Infinity': return Infinity;
    case '-Infinity': return -Infinity;
    case '-0': return -0;
    default: { const value = Number(token); if (!Number.isFinite(value) || String(value) !== token) { throw new TypeError('Unsupported Number spelling'); } return value; }
  }
}
/** Decode one exact node; custom depth follows the entire current path, including data descendants. */
function decode(raw: unknown, customDepth: number): unknown {
  const node = vector(raw); const tag = node[0];
  if (node.length === 1) {
    switch (tag) { case 'u': return undefined; case 'n': return null; case 't': return true; case 'f': return false; }
  }
  if (tag === 's' && node.length === 2 && typeof node[1] === 'string') { return node[1]; }
  if (tag === 'd' && node.length === 2) { return number(node[1]); }
  if (tag === 'a' && node.length === 2) {
    const slots = vector(node[1]); const value = new Array<unknown>(slots.length);
    slots.forEach((slot, index) => { const entry = vector(slot); if (entry.length === 1 && entry[0] === 'h') { return; } Object.defineProperty(value, String(index), { value: decode(entry, customDepth), enumerable: true, configurable: true, writable: true }); });
    return Object.freeze(value);
  }
  if (tag === 'o' && node.length === 3) {
    const entries = vector(node[1]); const proto = vector(node[2]); let prototype: object | null;
    if (proto.length === 1 && proto[0] === 'p-null') { prototype = null; }
    else if (proto.length === 1 && proto[0] === 'p-object') { prototype = Object.prototype; }
    else if (proto.length === 2 && proto[0] === 'p-custom' && customDepth < 2 && vector(proto[1])[0] === 'o') {
      const decoded = decode(proto[1], customDepth + 1); if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) { throw new TypeError('Unsupported custom prototype'); } prototype = decoded;
    } else { throw new TypeError('Unsupported prototype'); }
    const value: Record<string, unknown> = {}; Object.setPrototypeOf(value, prototype); const keys: string[] = []; const unique = new Set<string>();
    for (const entry of entries) {
      const pair = vector(entry); const key = pair[0];
      if (pair.length !== 2 || typeof key !== 'string' || unique.has(key)) { throw new TypeError('Unsupported record entry'); }
      unique.add(key); keys.push(key); Object.defineProperty(value, key, { value: decode(pair[1], customDepth), enumerable: true, configurable: true, writable: true });
    }
    if (JSON.stringify(Object.keys(value)) !== JSON.stringify(keys)) { throw new TypeError('Unsupported key enumeration order'); }
    return Object.freeze(value);
  }
  throw new TypeError('Unsupported tagged value');
}

/** The ordinary consumer validates exact framing, selection and the selected tagged-value domain. @internal */
export function readHistoryResultDocument(stdout: string, expectedSelection: unknown): IConsumerFact {
  if (!stdout.endsWith('\n') || stdout.endsWith('\n\n')) { throw new TypeError('Unsupported command framing'); }
  const parsed: unknown = JSON.parse(stdout.slice(0, -1)); const document = fields(parsed, ['format', 'formatVersion', 'selection', 'result']);
  if (document.format !== 'microdelta.history-result-read' || document.formatVersion !== 1 || selectionKey(document.selection) !== selectionKey(expectedSelection)) { throw new TypeError('Unsupported command version or selection'); }
  if (!isRecord(document.result)) { throw new TypeError('Unsupported result'); }
  if (document.result.kind === 'failed') {
    const result = fields(document.result, ['kind', 'code']); const code = result.code;
    if (typeof code !== 'string' || !['absent', 'unsupported', 'corrupt', 'recovery-required', 'busy', 'schema', 'integrity', 'multiple-failures', 'failed'].includes(code)) { throw new TypeError('Unsupported failure'); }
    return { kind: 'failed', code };
  }
  const result = fields(document.result, ['kind', 'encoding', 'snapshot']);
  if (result.kind !== 'fact' || result.encoding !== 'MDS1' || typeof result.snapshot !== 'string' || !result.snapshot.startsWith('MDS1|')) { throw new TypeError('Unsupported fact encoding'); }
  const suffix = result.snapshot.slice(5); const tree: unknown = JSON.parse(suffix);
  if (JSON.stringify(tree) !== suffix) { throw new TypeError('Noncanonical snapshot'); }
  return { kind: 'fact', value: decode(tree, 0) };
}
