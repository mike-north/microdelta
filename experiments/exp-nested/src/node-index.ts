/**
 * Candidate durable layout for nested selected reads over immutable completed
 * results. It is a bounded experiment for the History owner to adopt or
 * reject, not a second persistence authority: it owns no attempt, lease,
 * current pointer, acceptance or publication protocol. It stores each result's
 * canonical MDS1 payload together with a node index that this module alone
 * generates from that payload, so navigation, selected leaves and fingerprint
 * metadata can be answered without decoding the root payload.
 *
 * Only two columns hold author payload: `candidate_results.payload` (the whole
 * canonical snapshot) and `candidate_nodes.scalar` (one scalar leaf). Every
 * other column is shape metadata or a SHA-256 digest. Statements are tagged
 * with a leading role comment so instrumented evidence can classify them.
 */
import type { ISha256Capability, ISqliteConnection, ISqliteRow, ISqliteStatement, ISqliteValue } from '@microdelta/machine';
import type {
  ICompletedNavigationReader,
  ICompletedResultReader,
  ICompletedResultReference,
  ISelectedFingerprintRequest,
  ISelectedFingerprintResolution,
  ISelectedReadRequest,
} from '@microdelta/history';
import {
  decodeSnapshot,
  decodeValue,
  encodeSelectedFact,
  encodeSnapshot,
  encodeValue,
  fingerprint,
  navigate,
  observe,
  recordFromEntries,
} from '@microdelta/value';
import type { IAddressSegment, IOperation, ISelectedFact, ISelectedNode } from '@microdelta/value';

/** Identity tag for SQL text; enables tooling without changing statement meaning. */
const sql = String.raw;

/** Schema identity kept distinct from the legacy Store, EXP-3 and future production History. */
const schemaName = 'microdelta.exp-nested.node-index';
/** The only schema version this candidate reads; any other version rejects before work. */
const schemaVersion = 1;
/** Exact-locator grammar version; unknown versions are unsupported, never guessed. */
const locatorVersion = 'mdnx1|';
/** The only payload encoding this layout indexes. */
const payloadEncoding = 'MDS1';
/** Tables that make up one complete candidate schema. */
const candidateTables = ['candidate_identity', 'candidate_results', 'candidate_nodes', 'candidate_edges', 'candidate_addresses'] as const;

/** Result of regenerating a result's index from its canonical payload and comparing it with storage. */
export type IIndexVerification =
  | { readonly kind: 'consistent' }
  | { readonly kind: 'inconsistent'; readonly detail: string };

/** Construction inputs: an owned connection, host hashing, and the logical store this file must hold. */
export interface ICandidateNodeIndexOptions {
  readonly connection: ISqliteConnection;
  readonly sha256: ISha256Capability;
  /** Logical store identity, independent of the file's location. */
  readonly logicalStore: string;
}

/** The candidate's exact-reference reader plus its write and verification operations. */
export interface ICandidateNodeIndex {
  /** Exact, synchronous, scoped reader implementing the scalar and navigation capabilities. */
  readonly reader: ICompletedResultReader & ICompletedNavigationReader;
  /** Store one immutable result and its generated index atomically; an existing key is never replaced. */
  publish(resultKey: string, value: unknown): ICompletedResultReference;
  /** Regenerate the index from the stored canonical payload and compare it row by row. */
  verify(reference: ICompletedResultReference): IIndexVerification;
}

/** One indexed node; only `scalar` holds author payload. */
interface INodeRow {
  readonly nodeId: number;
  readonly kind: 'scalar' | 'record' | 'array';
  /** MDV1 encoding of a scalar leaf. */
  readonly scalar: string | null;
  readonly arrayLength: number | null;
  /** A record's own enumerable keys in snapshot order, as JSON. */
  readonly ownKeys: string | null;
  readonly prototype: 'null' | 'object' | 'custom' | null;
  readonly prototypeNode: number | null;
  /** Where a record's lookup chain ends; decides intrinsic-member semantics for absent keys. */
  readonly terminal: 'null' | 'object' | null;
  /** SHA-256 of the node's MDS1 snapshot, answering explicit-output metadata. */
  readonly snapshotFingerprint: string;
}

/** One structural slot: an own record member or a present array element. */
interface IEdgeRow {
  readonly parentNode: number;
  readonly edgeKind: 'property' | 'index';
  readonly edgeKey: string;
  /** Own enumeration position for records; the index for arrays. */
  readonly position: number;
  readonly childNode: number;
}

/** One reachable structured address, including members inherited through supported prototypes. */
interface IAddressRow {
  readonly address: string;
  readonly nodeId: number;
  /** Whether the final Property segment names an own member rather than an inherited one. */
  readonly own: 0 | 1;
  /** SHA-256 of the MDO1 `value` fact at this address; absent for the root, which has no member address. */
  readonly valueFingerprint: string | null;
}

/** Complete generated index for one result. */
interface IIndexRows {
  readonly nodes: readonly INodeRow[];
  readonly edges: readonly IEdgeRow[];
  readonly addresses: readonly IAddressRow[];
}

/** Metadata-only view of the node at an indexed address. */
interface IAddressMetadata {
  readonly nodeId: number;
  readonly own: boolean;
  readonly kind: INodeRow['kind'];
  readonly arrayLength: number | null;
  readonly ownKeys: string | null;
  readonly terminal: INodeRow['terminal'];
}

/** Canonical, unambiguous text for a structured address: Property "0" and Index 0 differ. */
function encodeAddress(address: readonly IAddressSegment[]): string {
  return JSON.stringify(address.map((segment) => segment.kind === 'property' ? ['p', segment.key] : ['i', segment.index]));
}

/** Read one own data member of a decoded, validated snapshot node. */
function ownValue(record: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor === undefined ? undefined : descriptor.value as unknown;
}

/**
 * Generate the index for one decoded canonical snapshot. Container identity is
 * unique because the Value domain rejects shared references, so every node has
 * exactly one structural parent. Reachable addresses follow Value's lookup
 * order: own members first, then members inherited through each custom
 * prototype that an earlier level does not shadow.
 */
function buildIndex(root: object, host: ISha256Capability): IIndexRows {
  const nodes: INodeRow[] = [];
  const edges: IEdgeRow[] = [];
  const addresses: IAddressRow[] = [];
  const slots = new Map<string, number>();
  const childrenOf = new Map<number, IEdgeRow[]>();
  const addEdge = (edge: IEdgeRow): void => {
    edges.push(edge);
    childrenOf.set(edge.parentNode, [...(childrenOf.get(edge.parentNode) ?? []), edge]);
    slots.set(slotKey(edge.parentNode, edge.edgeKind, edge.edgeKey), edge.childNode);
  };
  const slotKey = (parent: number, kind: IEdgeRow['edgeKind'], key: string): string => JSON.stringify([parent, kind, key]);

  function addNode(value: unknown): number {
    const nodeId = nodes.length;
    const snapshotFingerprint = fingerprint(encodeSnapshot(value), host);
    if (value === null || typeof value !== 'object') {
      nodes.push({ nodeId, kind: 'scalar', scalar: encodeValue(value), arrayLength: null, ownKeys: null, prototype: null, prototypeNode: null, terminal: null, snapshotFingerprint });
      return nodeId;
    }
    if (Array.isArray(value)) {
      nodes.push({ nodeId, kind: 'array', scalar: null, arrayLength: value.length, ownKeys: null, prototype: null, prototypeNode: null, terminal: null, snapshotFingerprint });
      for (let position = 0; position < value.length; position += 1) {
        if (Object.prototype.hasOwnProperty.call(value, position)) {
          const childNode = addNode(ownValue(value, String(position)));
          addEdge({ parentNode: nodeId, edgeKind: 'index', edgeKey: String(position), position, childNode });
        }
      }
      return nodeId;
    }
    const keys = Object.keys(value);
    const prototype: unknown = Object.getPrototypeOf(value);
    let terminal: object | null = value;
    while (terminal !== null && terminal !== Object.prototype) {
      terminal = Object.getPrototypeOf(terminal) as object | null;
    }
    const position = nodes.length;
    nodes.push({
      nodeId, kind: 'record', scalar: null, arrayLength: null, ownKeys: JSON.stringify(keys),
      prototype: prototype === null ? 'null' : prototype === Object.prototype ? 'object' : 'custom',
      prototypeNode: null, terminal: terminal === null ? 'null' : 'object', snapshotFingerprint,
    });
    keys.forEach((key, keyPosition) => {
      const childNode = addNode(ownValue(value, key));
      addEdge({ parentNode: nodeId, edgeKind: 'property', edgeKey: key, position: keyPosition, childNode });
    });
    if (prototype !== null && prototype !== Object.prototype && typeof prototype === 'object') {
      const prototypeNode = addNode(prototype);
      const row = nodes[position];
      if (row !== undefined) {
        nodes[position] = { ...row, prototypeNode };
      }
    }
    return nodeId;
  }

  /** Index one reachable address and, for containers, every member reachable below it. */
  function addAddress(nodeId: number, address: readonly IAddressSegment[], own: boolean): void {
    addresses.push({
      address: encodeAddress(address),
      nodeId,
      own: own ? 1 : 0,
      valueFingerprint: address.length === 0 ? null : fingerprint(encodeSelectedFact(observe(root, address, 'value')), host),
    });
    const node = nodes[nodeId];
    if (node?.kind === 'array') {
      for (const edge of childrenOf.get(nodeId) ?? []) {
        addAddress(edge.childNode, [...address, { kind: 'index', index: edge.position }], true);
      }
    } else if (node?.kind === 'record') {
      const seen = new Set<string>();
      let level: INodeRow | undefined = node;
      let isOwnLevel = true;
      while (level !== undefined) {
        const levelKeys = JSON.parse(level.ownKeys ?? '[]') as string[];
        for (const key of levelKeys) {
          if (!seen.has(key)) {
            seen.add(key);
            const child = slots.get(slotKey(level.nodeId, 'property', key));
            if (child !== undefined) {
              addAddress(child, [...address, { kind: 'property', key }], isOwnLevel);
            }
          }
        }
        level = level.prototypeNode === null ? undefined : nodes[level.prototypeNode];
        isOwnLevel = false;
      }
    }
  }

  const rootNode = addNode(root);
  addAddress(rootNode, [], true);
  return { nodes, edges, addresses };
}

/** Narrow a returned SQLite cell to text. */
function text(row: ISqliteRow, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new TypeError(`Candidate column ${column} is not text`);
  }
  return value;
}

/** Narrow a returned SQLite cell to nullable text. */
function nullableText(row: ISqliteRow, column: string): string | null {
  const value = row[column];
  if (value !== null && typeof value !== 'string') {
    throw new TypeError(`Candidate column ${column} is not nullable text`);
  }
  return value;
}

/** Narrow a returned SQLite cell to a safe integer. */
function integer(row: ISqliteRow, column: string): number {
  const value = row[column];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError(`Candidate column ${column} is not an integer`);
  }
  return value;
}

/** Narrow a returned SQLite cell to a nullable safe integer. */
function nullableInteger(row: ISqliteRow, column: string): number | null {
  return row[column] === null ? null : integer(row, column);
}

/** Narrow the stored node kind. */
function nodeKind(row: ISqliteRow): INodeRow['kind'] {
  const kind = text(row, 'kind');
  if (kind !== 'scalar' && kind !== 'record' && kind !== 'array') {
    throw new TypeError(`Unsupported candidate node kind ${kind}`);
  }
  return kind;
}

/** Narrow a stored prototype-chain terminal. */
function terminalKind(row: ISqliteRow): INodeRow['terminal'] {
  const terminal = nullableText(row, 'terminal');
  if (terminal !== null && terminal !== 'null' && terminal !== 'object') {
    throw new TypeError(`Unsupported candidate prototype terminal ${terminal}`);
  }
  return terminal;
}

/**
 * A payload-free stand-in for an indexed container whose remaining address
 * segments are absent from the index. Because every present own or inherited
 * member has an indexed address, the remainder is absent along the whole
 * lookup chain, so Value evaluating the remainder against an empty container
 * with the same kind and chain terminal yields exactly Value's own answer:
 * undefined or false for absent members, or its rejection of intrinsic
 * inherited members and mismatched container kinds.
 */
function standIn(metadata: IAddressMetadata): unknown {
  switch (metadata.kind) {
    case 'record':
      return Object.freeze(Object.create(metadata.terminal === 'object' ? Object.prototype : null) as object);
    case 'array':
      return Object.freeze(new Array<unknown>(metadata.arrayLength ?? 0));
    case 'scalar':
      // Every scalar rejects member navigation identically, so no payload is needed.
      return null;
    default: {
      const exhaustive: never = metadata.kind;
      return exhaustive;
    }
  }
}

/** Rebase a Value fact computed for an address remainder onto its absolute address. */
function absoluteFact(operation: IOperation, address: readonly IAddressSegment[], fact: unknown): ISelectedFact {
  return Object.freeze({ operation, address, fact });
}

/** Copy a caller address into frozen canonical segments before it is encoded or bound. */
function copyAddress(address: readonly IAddressSegment[]): readonly IAddressSegment[] {
  return Object.freeze(address.map((segment) => Object.freeze(segment.kind === 'property'
    ? { kind: 'property' as const, key: segment.key }
    : { kind: 'index' as const, index: segment.index })));
}

/**
 * Open (creating when empty) one candidate index over an owned connection.
 * A database with an unknown schema identity, another version, another
 * logical store or an incomplete table set is rejected before any work.
 */
export function openCandidateNodeIndex(options: ICandidateNodeIndexOptions): ICandidateNodeIndex {
  const { connection, sha256: host, logicalStore } = options;
  initialize(connection, logicalStore);

  const statements = {
    insertResult: connection.prepare(sql`/* publish */ INSERT INTO candidate_results (result_key, encoding, payload) VALUES (?, ?, ?)`),
    insertNode: connection.prepare(sql`/* publish */ INSERT INTO candidate_nodes
      (result_key, node_id, kind, scalar, array_length, own_keys, prototype, prototype_node, terminal, snapshot_fingerprint)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    insertEdge: connection.prepare(sql`/* publish */ INSERT INTO candidate_edges
      (result_key, parent_node, edge_kind, edge_key, position, child_node) VALUES (?, ?, ?, ?, ?, ?)`),
    insertAddress: connection.prepare(sql`/* publish */ INSERT INTO candidate_addresses
      (result_key, address, node_id, own, value_fingerprint) VALUES (?, ?, ?, ?, ?)`),
    resultEncoding: connection.prepare(sql`/* reference */ SELECT encoding FROM candidate_results WHERE result_key = ?`),
    addressMetadata: connection.prepare(sql`/* node-metadata */ SELECT a.node_id, a.own, n.kind, n.array_length, n.own_keys, n.terminal
      FROM candidate_addresses a JOIN candidate_nodes n ON n.result_key = a.result_key AND n.node_id = a.node_id
      WHERE a.result_key = ? AND a.address = ?`),
    prefixMetadata: connection.prepare(sql`/* node-metadata */ SELECT a.address, a.node_id, a.own, n.kind, n.array_length, n.own_keys, n.terminal
      FROM candidate_addresses a JOIN candidate_nodes n ON n.result_key = a.result_key AND n.node_id = a.node_id
      WHERE a.result_key = ? AND a.address IN (SELECT value FROM json_each(?))`),
    scalarPayload: connection.prepare(sql`/* leaf-payload */ SELECT scalar FROM candidate_nodes WHERE result_key = ? AND node_id = ? AND kind = 'scalar'`),
    fingerprints: connection.prepare(sql`/* fingerprint */ SELECT a.value_fingerprint, n.snapshot_fingerprint
      FROM candidate_addresses a JOIN candidate_nodes n ON n.result_key = a.result_key AND n.node_id = a.node_id
      WHERE a.result_key = ? AND a.address = ?`),
    subtreeNodes: connection.prepare(sql`/* subtree-payload */ WITH RECURSIVE subtree(node_id) AS (
        SELECT ?
        UNION SELECT e.child_node FROM candidate_edges e JOIN subtree s ON e.parent_node = s.node_id WHERE e.result_key = ?
        UNION SELECT n.prototype_node FROM candidate_nodes n JOIN subtree s ON n.node_id = s.node_id
          WHERE n.result_key = ? AND n.prototype_node IS NOT NULL
      )
      SELECT n.node_id, n.kind, n.scalar, n.array_length, n.prototype, n.prototype_node, n.snapshot_fingerprint
      FROM candidate_nodes n JOIN subtree s ON n.node_id = s.node_id WHERE n.result_key = ?`),
    subtreeEdges: connection.prepare(sql`/* subtree-structure */ SELECT parent_node, edge_kind, edge_key, position, child_node
      FROM candidate_edges WHERE result_key = ? AND parent_node IN (SELECT value FROM json_each(?)) ORDER BY parent_node, position`),
    payload: connection.prepare(sql`/* root-payload */ SELECT payload FROM candidate_results WHERE result_key = ?`),
    allNodes: connection.prepare(sql`/* verify */ SELECT node_id, kind, scalar, array_length, own_keys, prototype, prototype_node, terminal, snapshot_fingerprint
      FROM candidate_nodes WHERE result_key = ? ORDER BY node_id`),
    allEdges: connection.prepare(sql`/* verify */ SELECT parent_node, edge_kind, edge_key, position, child_node
      FROM candidate_edges WHERE result_key = ?`),
    allAddresses: connection.prepare(sql`/* verify */ SELECT address, node_id, own, value_fingerprint
      FROM candidate_addresses WHERE result_key = ?`),
  } satisfies Record<string, ISqliteStatement>;

  /** Build this store's exact locator for one immutable result key. */
  function locatorFor(resultKey: string): ICompletedResultReference {
    return Object.freeze({ kind: 'completed-result', locator: `${locatorVersion}${JSON.stringify([logicalStore, resultKey])}` });
  }

  /**
   * Resolve an exact reference to its result key. Unknown locator grammar,
   * another logical store, a missing result or an unsupported stored encoding
   * are integrity failures; none is repaired by consulting any other result.
   */
  function resultKeyOf(reference: ICompletedResultReference): string {
    if (reference === null || typeof reference !== 'object' || reference.kind !== 'completed-result' || typeof reference.locator !== 'string') {
      throw new TypeError('Completed-result reference needs a supported kind and locator');
    }
    if (!reference.locator.startsWith(locatorVersion)) {
      throw new TypeError('Unsupported completed-result locator version');
    }
    const parsed: unknown = JSON.parse(reference.locator.slice(locatorVersion.length));
    if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string') {
      throw new TypeError('Malformed completed-result locator');
    }
    const [store, resultKey] = parsed as [string, string];
    if (store !== logicalStore) {
      throw new TypeError('Completed-result reference belongs to a different logical store');
    }
    const row = statements.resultEncoding.get(resultKey);
    if (row === undefined) {
      throw new Error(`Missing exact completed result ${reference.locator}`);
    }
    if (text(row, 'encoding') !== payloadEncoding) {
      throw new TypeError(`Unsupported stored result encoding ${text(row, 'encoding')}`);
    }
    return resultKey;
  }

  /** Map one metadata row. */
  function metadataOf(row: ISqliteRow): IAddressMetadata {
    return {
      nodeId: integer(row, 'node_id'),
      own: integer(row, 'own') === 1,
      kind: nodeKind(row),
      arrayLength: nullableInteger(row, 'array_length'),
      ownKeys: nullableText(row, 'own_keys'),
      terminal: terminalKind(row),
    };
  }

  /** Metadata for an exactly indexed address, or undefined when the address is not indexed. */
  function metadataAt(resultKey: string, address: readonly IAddressSegment[]): IAddressMetadata | undefined {
    const row = statements.addressMetadata.get(resultKey, encodeAddress(address));
    return row === undefined ? undefined : metadataOf(row);
  }

  /**
   * For an unindexed address, find its longest indexed prefix in one query and
   * return the Value stand-in plus the relative remainder to evaluate there.
   */
  function absentRemainder(resultKey: string, address: readonly IAddressSegment[]): { readonly standIn: unknown; readonly remainder: readonly IAddressSegment[] } {
    const prefixes = address.map((_segment, length) => encodeAddress(address.slice(0, length)));
    const rows = statements.prefixMetadata.all(resultKey, JSON.stringify(prefixes));
    let best: { readonly length: number; readonly metadata: IAddressMetadata } | undefined;
    for (const row of rows) {
      const length = prefixes.indexOf(text(row, 'address'));
      if (length >= 0 && (best === undefined || length > best.length)) {
        best = { length, metadata: metadataOf(row) };
      }
    }
    if (best === undefined) {
      throw new Error('Completed result has no indexed root');
    }
    return { standIn: standIn(best.metadata), remainder: address.slice(best.length) };
  }

  /** Decode one scalar leaf; this is the only per-node payload read. */
  function scalarAt(resultKey: string, nodeId: number): unknown {
    const row = statements.scalarPayload.get(resultKey, nodeId);
    if (row === undefined) {
      throw new Error('Indexed scalar node is missing its leaf payload');
    }
    return decodeValue(text(row, 'scalar'));
  }

  /**
   * Answer a presence, length or key-order fact from metadata alone. Value's
   * own `value` operation needs the leaf payload and is handled separately.
   */
  function metadataFact(resultKey: string, operation: Exclude<IOperation, 'value'>, address: readonly IAddressSegment[]): ISelectedFact {
    const metadata = metadataAt(resultKey, address);
    if (metadata === undefined) {
      const { standIn: stand, remainder } = absentRemainder(resultKey, address);
      return absoluteFact(operation, address, observe(stand, remainder, operation).fact);
    }
    switch (operation) {
      case 'own':
      case 'membership':
        if (address.length === 0) {
          // Value rejects member operations without a member address.
          return absoluteFact(operation, address, observe(standIn(metadata), [], operation).fact);
        }
        return absoluteFact(operation, address, operation === 'own' ? metadata.own : true);
      case 'length':
        if (metadata.kind !== 'array') {
          return absoluteFact(operation, address, observe(standIn(metadata), [], operation).fact);
        }
        return absoluteFact(operation, address, metadata.arrayLength);
      case 'keys': {
        if (metadata.kind !== 'record') {
          return absoluteFact(operation, address, observe(standIn(metadata), [], operation).fact);
        }
        const keys = JSON.parse(metadata.ownKeys ?? '[]') as unknown;
        if (!Array.isArray(keys) || !keys.every((key) => typeof key === 'string')) {
          throw new TypeError('Stored key order is malformed');
        }
        return absoluteFact(operation, address, Object.freeze([...keys]));
      }
      default: {
        const exhaustive: never = operation;
        return exhaustive;
      }
    }
  }

  /**
   * Load one container subtree from its own node and edge rows, then check
   * the rebuilt MDS1 snapshot against the node's indexed digest so tampered or
   * incomplete rows fail rather than return silently different data.
   */
  function subtreeAt(resultKey: string, nodeId: number): unknown {
    const nodeRows = statements.subtreeNodes.all(nodeId, resultKey, resultKey, resultKey);
    const byId = new Map(nodeRows.map((row) => [integer(row, 'node_id'), row]));
    const edgeRows = statements.subtreeEdges.all(resultKey, JSON.stringify([...byId.keys()]));
    const children = new Map<number, ISqliteRow[]>();
    for (const edge of edgeRows) {
      const parent = integer(edge, 'parent_node');
      children.set(parent, [...(children.get(parent) ?? []), edge]);
    }
    const rebuild = (id: number): unknown => {
      const row = byId.get(id);
      if (row === undefined) {
        throw new Error('Indexed subtree is missing a node');
      }
      const kind = nodeKind(row);
      if (kind === 'scalar') {
        return decodeValue(text(row, 'scalar'));
      }
      const members = children.get(id) ?? [];
      if (kind === 'array') {
        const array = new Array<unknown>(integer(row, 'array_length'));
        for (const edge of members) {
          array[integer(edge, 'position')] = rebuild(integer(edge, 'child_node'));
        }
        return array;
      }
      const prototypeKind = text(row, 'prototype');
      const prototypeNode = nullableInteger(row, 'prototype_node');
      let prototype: object | null = prototypeKind === 'null' ? null : Object.prototype;
      if (prototypeKind === 'custom' && prototypeNode !== null) {
        const rebuilt = rebuild(prototypeNode);
        if (rebuilt === null || typeof rebuilt !== 'object') {
          throw new Error('Indexed prototype is not a record');
        }
        prototype = rebuilt;
      }
      return recordFromEntries(members.map((edge) => [text(edge, 'edge_key'), rebuild(integer(edge, 'child_node'))] as const), prototype);
    };
    const encoded = encodeSnapshot(rebuild(nodeId));
    const expected = byId.get(nodeId);
    if (expected === undefined || fingerprint(encoded, host) !== text(expected, 'snapshot_fingerprint')) {
      throw new Error('Indexed subtree does not match its recorded snapshot fingerprint');
    }
    return decodeSnapshot(encoded);
  }

  const reader: ICompletedResultReader & ICompletedNavigationReader = Object.freeze({
    readNode(reference: ICompletedResultReference, requested: readonly IAddressSegment[]): ISelectedNode {
      const resultKey = resultKeyOf(reference);
      const address = copyAddress(requested);
      const metadata = metadataAt(resultKey, address);
      if (metadata === undefined) {
        const { standIn: stand, remainder } = absentRemainder(resultKey, address);
        const relative = navigate(stand, remainder);
        if (relative.kind !== 'scalar') {
          throw new Error('An unindexed address cannot select a container');
        }
        return Object.freeze({ kind: 'scalar', selected: absoluteFact('value', address, relative.selected.fact) });
      }
      switch (metadata.kind) {
        case 'record':
          return Object.freeze({ kind: 'record', address });
        case 'array':
          return Object.freeze({ kind: 'array', address, length: metadata.arrayLength ?? 0 });
        case 'scalar':
          return Object.freeze({ kind: 'scalar', selected: absoluteFact('value', address, scalarAt(resultKey, metadata.nodeId)) });
        default: {
          const exhaustive: never = metadata.kind;
          return exhaustive;
        }
      }
    },
    readSubtree(reference: ICompletedResultReference, requested: readonly IAddressSegment[]): unknown {
      const resultKey = resultKeyOf(reference);
      const metadata = metadataAt(resultKey, copyAddress(requested));
      if (metadata === undefined || metadata.kind === 'scalar') {
        throw new TypeError('Subtree reads need an indexed record or array');
      }
      return subtreeAt(resultKey, metadata.nodeId);
    },
    readSelected(reference: ICompletedResultReference, request: ISelectedReadRequest): ISelectedFact {
      const resultKey = resultKeyOf(reference);
      const address = copyAddress(request.address);
      if (request.operation !== 'value') {
        return metadataFact(resultKey, request.operation, address);
      }
      const metadata = address.length === 0 ? undefined : metadataAt(resultKey, address);
      if (metadata === undefined) {
        if (address.length === 0) {
          return absoluteFact('value', address, observe(null, [], 'value').fact);
        }
        const { standIn: stand, remainder } = absentRemainder(resultKey, address);
        return absoluteFact('value', address, observe(stand, remainder, 'value').fact);
      }
      return absoluteFact('value', address, metadata.kind === 'scalar' ? scalarAt(resultKey, metadata.nodeId) : subtreeAt(resultKey, metadata.nodeId));
    },
    resolveFingerprint(reference: ICompletedResultReference, request: ISelectedFingerprintRequest): ISelectedFingerprintResolution {
      const resultKey = resultKeyOf(reference);
      if (request.kind === 'projection') {
        // Keyed projections are outside this candidate's index; absence never implies equality.
        return { kind: 'unavailable' };
      }
      const address = copyAddress(request.address);
      try {
        if (request.kind === 'selected') {
          if (request.encoding !== 'MDO1') {
            return { kind: 'incompatible' };
          }
          if (request.operation === 'value') {
            if (address.length === 0) {
              // Value has no member address at which a root value could be observed.
              return { kind: 'incompatible' };
            }
            const row = statements.fingerprints.get(resultKey, encodeAddress(address));
            const stored = row === undefined ? null : nullableText(row, 'value_fingerprint');
            if (stored !== null) {
              return { kind: 'compatible', fingerprint: stored };
            }
            const { standIn: stand, remainder } = absentRemainder(resultKey, address);
            const fact = absoluteFact('value', address, observe(stand, remainder, 'value').fact);
            return { kind: 'compatible', fingerprint: fingerprint(encodeSelectedFact(fact), host) };
          }
          const fact = metadataFact(resultKey, request.operation, address);
          return { kind: 'compatible', fingerprint: fingerprint(encodeSelectedFact(fact), host) };
        }
        if (request.encoding !== 'MDS1') {
          return { kind: 'incompatible' };
        }
        const row = statements.fingerprints.get(resultKey, encodeAddress(address));
        if (row !== undefined) {
          return { kind: 'compatible', fingerprint: text(row, 'snapshot_fingerprint') };
        }
        const { standIn: stand, remainder } = absentRemainder(resultKey, address);
        const relative = navigate(stand, remainder);
        if (relative.kind !== 'scalar') {
          return { kind: 'incompatible' };
        }
        return { kind: 'compatible', fingerprint: fingerprint(encodeSnapshot(relative.selected.fact), host) };
      } catch (error: unknown) {
        // Value's rejection means the recorded selection cannot be asked of this result's shape.
        if (error instanceof TypeError) {
          return { kind: 'incompatible' };
        }
        throw error;
      }
    },
  });

  return Object.freeze({
    reader,
    publish(resultKey: string, value: unknown): ICompletedResultReference {
      const payload = encodeSnapshot(value);
      const canonical = decodeSnapshot(payload);
      if (canonical === null || typeof canonical !== 'object') {
        throw new TypeError('A navigable completed result needs a record or array root');
      }
      const rows = buildIndex(canonical, host);
      connection.transaction(() => {
        statements.insertResult.run(resultKey, payloadEncoding, payload);
        for (const node of rows.nodes) {
          statements.insertNode.run(resultKey, node.nodeId, node.kind, node.scalar, node.arrayLength, node.ownKeys, node.prototype, node.prototypeNode, node.terminal, node.snapshotFingerprint);
        }
        for (const edge of rows.edges) {
          statements.insertEdge.run(resultKey, edge.parentNode, edge.edgeKind, edge.edgeKey, edge.position, edge.childNode);
        }
        for (const address of rows.addresses) {
          statements.insertAddress.run(resultKey, address.address, address.nodeId, address.own, address.valueFingerprint);
        }
        return undefined;
      });
      return locatorFor(resultKey);
    },
    verify(reference: ICompletedResultReference): IIndexVerification {
      const resultKey = resultKeyOf(reference);
      const payloadRow = statements.payload.get(resultKey);
      if (payloadRow === undefined) {
        return { kind: 'inconsistent', detail: 'missing payload' };
      }
      const canonical = decodeSnapshot(text(payloadRow, 'payload'));
      if (canonical === null || typeof canonical !== 'object') {
        return { kind: 'inconsistent', detail: 'payload root is not a container' };
      }
      const expected = buildIndex(canonical, host);
      const expectedNodes = expected.nodes.map((node): readonly ISqliteValue[] => [node.nodeId, node.kind, node.scalar, node.arrayLength, node.ownKeys, node.prototype, node.prototypeNode, node.terminal, node.snapshotFingerprint]);
      const storedNodes = statements.allNodes.all(resultKey).map((row): readonly ISqliteValue[] => [
        row.node_id ?? null, row.kind ?? null, row.scalar ?? null, row.array_length ?? null, row.own_keys ?? null,
        row.prototype ?? null, row.prototype_node ?? null, row.terminal ?? null, row.snapshot_fingerprint ?? null,
      ]);
      const expectedEdges = expected.edges
        .map((edge): readonly ISqliteValue[] => [edge.parentNode, edge.edgeKind, edge.edgeKey, edge.position, edge.childNode]);
      const storedEdges = statements.allEdges.all(resultKey).map((row): readonly ISqliteValue[] => [
        row.parent_node ?? null, row.edge_kind ?? null, row.edge_key ?? null, row.position ?? null, row.child_node ?? null,
      ]);
      const expectedAddresses = expected.addresses
        .map((address): readonly ISqliteValue[] => [address.address, address.nodeId, address.own, address.valueFingerprint]);
      const storedAddresses = statements.allAddresses.all(resultKey).map((row): readonly ISqliteValue[] => [
        row.address ?? null, row.node_id ?? null, row.own ?? null, row.value_fingerprint ?? null,
      ]);
      for (const [label, left, right] of [
        ['nodes', expectedNodes, storedNodes],
        ['edges', expectedEdges, storedEdges],
        ['addresses', expectedAddresses, storedAddresses],
      ] as const) {
        // Compare as order-independent row sets; SQLite and JavaScript collations need not agree.
        const canonicalRows = (rows: readonly (readonly ISqliteValue[])[]): string => JSON.stringify(rows.map((row) => JSON.stringify(row)).sort());
        if (canonicalRows(left) !== canonicalRows(right)) {
          return { kind: 'inconsistent', detail: `${label} differ from the index generated from the canonical payload` };
        }
      }
      return { kind: 'consistent' };
    },
  });
}

/**
 * Create the candidate schema in one transaction on an empty database, or
 * validate an existing one. Partial, foreign or differently versioned schemas
 * fail before any read or write.
 */
function initialize(connection: ISqliteConnection, logicalStore: string): void {
  const present = connection.prepare(sql`/* schema */ SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'candidate\_%' ESCAPE '\'`)
    .all()
    .map((row) => text(row, 'name'));
  if (present.length === 0) {
    connection.transaction(() => {
      connection.exec(sql`
        CREATE TABLE candidate_identity (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          schema_name TEXT NOT NULL,
          schema_version INTEGER NOT NULL,
          logical_store TEXT NOT NULL
        ) STRICT;
        CREATE TABLE candidate_results (
          result_key TEXT PRIMARY KEY,
          encoding TEXT NOT NULL,
          payload TEXT NOT NULL
        ) STRICT;
        CREATE TABLE candidate_nodes (
          result_key TEXT NOT NULL REFERENCES candidate_results (result_key),
          node_id INTEGER NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('scalar', 'record', 'array')),
          scalar TEXT,
          array_length INTEGER,
          own_keys TEXT,
          prototype TEXT CHECK (prototype IS NULL OR prototype IN ('null', 'object', 'custom')),
          prototype_node INTEGER,
          terminal TEXT CHECK (terminal IS NULL OR terminal IN ('null', 'object')),
          snapshot_fingerprint TEXT NOT NULL,
          PRIMARY KEY (result_key, node_id)
        ) STRICT;
        CREATE TABLE candidate_edges (
          result_key TEXT NOT NULL REFERENCES candidate_results (result_key),
          parent_node INTEGER NOT NULL,
          edge_kind TEXT NOT NULL CHECK (edge_kind IN ('property', 'index')),
          edge_key TEXT NOT NULL,
          position INTEGER NOT NULL,
          child_node INTEGER NOT NULL,
          PRIMARY KEY (result_key, parent_node, edge_kind, edge_key)
        ) STRICT;
        CREATE TABLE candidate_addresses (
          result_key TEXT NOT NULL REFERENCES candidate_results (result_key),
          address TEXT NOT NULL,
          node_id INTEGER NOT NULL,
          own INTEGER NOT NULL CHECK (own IN (0, 1)),
          value_fingerprint TEXT,
          PRIMARY KEY (result_key, address)
        ) STRICT;
      `);
      connection.prepare(sql`/* schema */ INSERT INTO candidate_identity (singleton, schema_name, schema_version, logical_store) VALUES (1, ?, ?, ?)`)
        .run(schemaName, schemaVersion, logicalStore);
      return undefined;
    });
    return;
  }
  const missing = candidateTables.filter((table) => !present.includes(table));
  if (missing.length > 0) {
    throw new Error(`Incomplete candidate schema: missing ${missing.join(', ')}`);
  }
  const identity = connection.prepare(sql`/* schema */ SELECT schema_name, schema_version, logical_store FROM candidate_identity WHERE singleton = 1`).get();
  if (identity === undefined || text(identity, 'schema_name') !== schemaName) {
    throw new Error('Unknown candidate schema identity');
  }
  if (integer(identity, 'schema_version') !== schemaVersion) {
    throw new Error(`Unsupported candidate schema version ${String(integer(identity, 'schema_version'))}`);
  }
  if (text(identity, 'logical_store') !== logicalStore) {
    throw new Error('Database holds a different logical store');
  }
}
