/**
 * History's generated selected index over one immutable completed result,
 * adopted from the accepted nested selected-read gate (issue #54, index
 * requirements 1–7). History alone generates the index, inside the publish
 * transaction, from the canonical MDS1 payload it stores; callers never supply
 * index metadata. The index answers navigation, selected leaves and
 * fingerprint metadata without decoding the root payload:
 *
 * - one node row per payload node (kind, MDV1 scalar leaf, array length, own
 *   keys in snapshot order, prototype link and chain terminal, MDS1 digest);
 * - one edge row per own record member or present array element;
 * - one address row per reachable structured address (including members
 *   inherited through supported prototypes) with its MDO1 `value` digest.
 *
 * Absent members are answered by evaluating Value on a payload-free stand-in of
 * the longest indexed prefix. Reads verify what they return: a scalar leaf must
 * match its address's `value` digest and a subtree its node's MDS1 digest, so
 * corrupted storage fails as an integrity error instead of returning different
 * data. Storage-shape failures never surface as `TypeError`, which is reserved
 * for Value rejecting a selection's shape.
 * @packageDocumentation
 */
import type { ISha256Capability, ISqliteConnection, ISqliteRow, ISqliteValue } from '@microdelta/machine';
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

import type {
  ICompletedNavigationReader,
  ICompletedResultReader,
  ICompletedResultReference,
  ISelectedFingerprintRequest,
  ISelectedFingerprintResolution,
  ISelectedReadRequest,
} from '../completed-results.js';
import type { IResultVerification } from './contracts.js';
import { HistoryIntegrityError } from './errors.js';

/** Identity tag for embedded SQL; the text is passed through unchanged. */
const sql = String.raw;

/** The index layout version recorded with every result. */
export const indexVersion = 1;

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
  /** SHA-256 of the node's MDS1 snapshot. */
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

/** One reachable structured address. */
interface IAddressRow {
  readonly address: string;
  readonly nodeId: number;
  /** Whether the final Property segment names an own member rather than an inherited one. */
  readonly own: 0 | 1;
  /** SHA-256 of the MDO1 `value` fact here; null for the root, which has no member address. */
  readonly valueFingerprint: string | null;
}

/** The complete generated index for one result. */
export interface IIndexRows {
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
  readonly valueFingerprint: string | null;
}

/** Canonical, unambiguous text for a structured address: Property "0" and Index 0 differ (VAL-1). */
function encodeAddress(address: readonly IAddressSegment[]): string {
  return JSON.stringify(address.map((segment) => segment.kind === 'property' ? ['p', segment.key] : ['i', segment.index]));
}

/** Read one own data member of a decoded, validated snapshot node. */
function ownValue(record: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor === undefined ? undefined : descriptor.value as unknown;
}

/**
 * Generate the index for one decoded canonical snapshot with a record or
 * array root. Every container has exactly one structural parent because Value
 * rejects shared references. Reachable addresses follow Value's lookup order:
 * own members first, then members inherited through each custom prototype
 * that an earlier level does not shadow.
 */
export function buildIndex(root: object, host: ISha256Capability): IIndexRows {
  const nodes: INodeRow[] = [];
  const edges: IEdgeRow[] = [];
  const addresses: IAddressRow[] = [];
  const slots = new Map<string, number>();
  const childrenOf = new Map<number, IEdgeRow[]>();
  const slotKey = (parent: number, kind: IEdgeRow['edgeKind'], key: string): string => JSON.stringify([parent, kind, key]);
  const addEdge = (edge: IEdgeRow): void => {
    edges.push(edge);
    const siblings = childrenOf.get(edge.parentNode);
    if (siblings === undefined) {
      childrenOf.set(edge.parentNode, [edge]);
    } else {
      siblings.push(edge);
    }
    slots.set(slotKey(edge.parentNode, edge.edgeKind, edge.edgeKey), edge.childNode);
  };

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
      const row = nodes[nodeId];
      if (row !== undefined) {
        nodes[nodeId] = { ...row, prototypeNode };
      }
    }
    return nodeId;
  }

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

  addAddress(addNode(root), [], true);
  return { nodes, edges, addresses };
}

/** Narrow a stored cell to text, or fail as corrupted storage. */
function text(row: ISqliteRow, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new HistoryIntegrityError(`Stored History column ${column} is not text`);
  }
  return value;
}

/** Narrow a stored cell to nullable text. */
function nullableText(row: ISqliteRow, column: string): string | null {
  const value = row[column];
  if (value !== null && typeof value !== 'string') {
    throw new HistoryIntegrityError(`Stored History column ${column} is not nullable text`);
  }
  return value ?? null;
}

/** Narrow a stored cell to a safe integer. */
function integer(row: ISqliteRow, column: string): number {
  const value = row[column];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new HistoryIntegrityError(`Stored History column ${column} is not an integer`);
  }
  return value;
}

/** Narrow a stored cell to a nullable safe integer. */
function nullableInteger(row: ISqliteRow, column: string): number | null {
  return row[column] === null ? null : integer(row, column);
}

/** Narrow a stored node kind. */
function nodeKind(row: ISqliteRow): INodeRow['kind'] {
  const kind = text(row, 'kind');
  if (kind !== 'scalar' && kind !== 'record' && kind !== 'array') {
    throw new HistoryIntegrityError(`Unsupported stored node kind ${kind}`);
  }
  return kind;
}

/** Narrow a stored prototype-chain terminal. */
function terminalKind(row: ISqliteRow): INodeRow['terminal'] {
  const terminal = nullableText(row, 'terminal');
  if (terminal !== null && terminal !== 'null' && terminal !== 'object') {
    throw new HistoryIntegrityError(`Unsupported stored prototype terminal ${terminal}`);
  }
  return terminal;
}

/** Decode stored canonical text, converting Value's rejection into an integrity failure. */
function decodeStored<T>(decode: () => T, what: string): T {
  try {
    return decode();
  } catch (error: unknown) {
    throw new HistoryIntegrityError(`Stored ${what} is not valid canonical data: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * A payload-free stand-in for an indexed container. Every present own or
 * inherited member has an indexed address, so a remainder absent from the
 * index is absent along the whole lookup chain; Value evaluating it against an
 * empty container of the same kind and chain terminal yields Value's own
 * answer, including its rejection of intrinsic members and kind mismatches.
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

/** Rebase a fact computed for an address remainder onto its absolute address. */
function absoluteFact(operation: IOperation, address: readonly IAddressSegment[], fact: unknown): ISelectedFact {
  return Object.freeze({ operation, address, fact });
}

/** Copy a caller address into frozen canonical segments before encoding or binding it. */
function copyAddress(address: readonly IAddressSegment[]): readonly IAddressSegment[] {
  return Object.freeze(address.map((segment) => Object.freeze(segment.kind === 'property'
    ? { kind: 'property' as const, key: segment.key }
    : { kind: 'index' as const, index: segment.index })));
}

/** Resolves an exact reference to a verified result identity in this store and scope. */
export type IResultResolver = (reference: ICompletedResultReference) => number;

/** The generated index's write, read and verification operations for one connection. */
export interface ISelectedIndex {
  /** Insert a result's generated index rows inside the caller's publish transaction. */
  insert(resultId: number, rows: IIndexRows): void;
  /** Exact scalar and navigation reader over completed results. */
  readonly reader: ICompletedResultReader & ICompletedNavigationReader;
  /** Regenerate a result's index from its stored canonical payload and compare. */
  verify(resultId: number): IResultVerification;
}

/**
 * Create the index operations over an owned connection. Exact references
 * are resolved by the authority's `resolve`, which validates locator, store,
 * scope, completion and stored encoding before any index row is read.
 */
export function createSelectedIndex(connection: ISqliteConnection, host: ISha256Capability, resolve: IResultResolver): ISelectedIndex {
  const statements = {
    insertNode: connection.prepare(sql`/* publish */ INSERT INTO history_nodes
      (result_id, node_id, kind, scalar, array_length, own_keys, prototype, prototype_node, terminal, snapshot_fingerprint)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    insertEdge: connection.prepare(sql`/* publish */ INSERT INTO history_edges
      (result_id, parent_node, edge_kind, edge_key, position, child_node) VALUES (?, ?, ?, ?, ?, ?)`),
    insertAddress: connection.prepare(sql`/* publish */ INSERT INTO history_addresses
      (result_id, address, node_id, own, value_fingerprint) VALUES (?, ?, ?, ?, ?)`),
    addressMetadata: connection.prepare(sql`/* node-metadata */ SELECT a.node_id, a.own, a.value_fingerprint, n.kind, n.array_length, n.own_keys, n.terminal
      FROM history_addresses a JOIN history_nodes n ON n.result_id = a.result_id AND n.node_id = a.node_id
      WHERE a.result_id = ? AND a.address = ?`),
    prefixMetadata: connection.prepare(sql`/* node-metadata */ SELECT a.address, a.node_id, a.own, a.value_fingerprint, n.kind, n.array_length, n.own_keys, n.terminal
      FROM history_addresses a JOIN history_nodes n ON n.result_id = a.result_id AND n.node_id = a.node_id
      WHERE a.result_id = ? AND a.address IN (SELECT value FROM json_each(?))`),
    scalarPayload: connection.prepare(sql`/* leaf-payload */ SELECT scalar FROM history_nodes WHERE result_id = ? AND node_id = ? AND kind = 'scalar'`),
    fingerprints: connection.prepare(sql`/* fingerprint */ SELECT a.value_fingerprint, n.snapshot_fingerprint
      FROM history_addresses a JOIN history_nodes n ON n.result_id = a.result_id AND n.node_id = a.node_id
      WHERE a.result_id = ? AND a.address = ?`),
    subtreeNodes: connection.prepare(sql`/* subtree-payload */ WITH RECURSIVE subtree(node_id) AS (
        SELECT ?
        UNION SELECT e.child_node FROM history_edges e JOIN subtree s ON e.parent_node = s.node_id WHERE e.result_id = ?
        UNION SELECT n.prototype_node FROM history_nodes n JOIN subtree s ON n.node_id = s.node_id
          WHERE n.result_id = ? AND n.prototype_node IS NOT NULL
      )
      SELECT n.node_id, n.kind, n.scalar, n.array_length, n.prototype, n.prototype_node, n.snapshot_fingerprint
      FROM history_nodes n JOIN subtree s ON n.node_id = s.node_id WHERE n.result_id = ?`),
    subtreeEdges: connection.prepare(sql`/* subtree-structure */ SELECT parent_node, edge_kind, edge_key, position, child_node
      FROM history_edges WHERE result_id = ? AND parent_node IN (SELECT value FROM json_each(?)) ORDER BY parent_node, position`),
    payload: connection.prepare(sql`/* verify */ SELECT payload FROM history_results WHERE result_id = ?`),
    allNodes: connection.prepare(sql`/* verify */ SELECT node_id, kind, scalar, array_length, own_keys, prototype, prototype_node, terminal, snapshot_fingerprint
      FROM history_nodes WHERE result_id = ?`),
    allEdges: connection.prepare(sql`/* verify */ SELECT parent_node, edge_kind, edge_key, position, child_node FROM history_edges WHERE result_id = ?`),
    allAddresses: connection.prepare(sql`/* verify */ SELECT address, node_id, own, value_fingerprint FROM history_addresses WHERE result_id = ?`),
  };

  /**
   * Map one metadata row, rejecting cells whose presence contradicts the
   * node kind or address so corrupted metadata never becomes a Value answer.
   */
  function metadataOf(row: ISqliteRow, address: readonly IAddressSegment[]): IAddressMetadata {
    const metadata: IAddressMetadata = {
      nodeId: integer(row, 'node_id'),
      own: integer(row, 'own') === 1,
      kind: nodeKind(row),
      arrayLength: nullableInteger(row, 'array_length'),
      ownKeys: nullableText(row, 'own_keys'),
      terminal: terminalKind(row),
      valueFingerprint: nullableText(row, 'value_fingerprint'),
    };
    const shapeValid = metadata.kind === 'array'
      ? metadata.arrayLength !== null && metadata.arrayLength >= 0 && metadata.ownKeys === null && metadata.terminal === null
      : metadata.kind === 'record'
        ? metadata.arrayLength === null && metadata.ownKeys !== null && metadata.terminal !== null
        : metadata.arrayLength === null && metadata.ownKeys === null && metadata.terminal === null;
    if (!shapeValid || (address.length === 0) !== (metadata.valueFingerprint === null)) {
      throw new HistoryIntegrityError('Stored index metadata contradicts its node kind or address');
    }
    return metadata;
  }

  /** Metadata for an exactly indexed address, or undefined when it is not indexed. */
  function metadataAt(resultId: number, address: readonly IAddressSegment[]): IAddressMetadata | undefined {
    const row = statements.addressMetadata.get(resultId, encodeAddress(address));
    return row === undefined ? undefined : metadataOf(row, address);
  }

  /** For an unindexed address, the stand-in of its longest indexed prefix and the relative remainder. */
  function absentRemainder(resultId: number, address: readonly IAddressSegment[]): { readonly standIn: unknown; readonly remainder: readonly IAddressSegment[] } {
    const prefixes = address.map((_segment, length) => encodeAddress(address.slice(0, length)));
    const rows = statements.prefixMetadata.all(resultId, JSON.stringify(prefixes));
    let best: { readonly length: number; readonly metadata: IAddressMetadata } | undefined;
    for (const row of rows) {
      const length = prefixes.indexOf(text(row, 'address'));
      if (length >= 0 && (best === undefined || length > best.length)) {
        best = { length, metadata: metadataOf(row, address.slice(0, length)) };
      }
    }
    if (best === undefined) {
      throw new HistoryIntegrityError('Completed result has no indexed root');
    }
    return { standIn: standIn(best.metadata), remainder: address.slice(best.length) };
  }

  /**
   * Decode one scalar leaf and verify it against its address's recorded
   * `value` digest; this is the only per-node payload read.
   */
  function verifiedScalar(resultId: number, address: readonly IAddressSegment[], metadata: IAddressMetadata): unknown {
    const row = statements.scalarPayload.get(resultId, metadata.nodeId);
    if (row === undefined) {
      throw new HistoryIntegrityError('Indexed scalar node is missing its leaf payload');
    }
    const value = decodeStored(() => decodeValue(text(row, 'scalar')), 'scalar leaf');
    const actual = fingerprint(encodeSelectedFact(absoluteFact('value', address, value)), host);
    if (metadata.valueFingerprint === null || actual !== metadata.valueFingerprint) {
      throw new HistoryIntegrityError('Stored scalar leaf does not match its indexed value fingerprint');
    }
    return value;
  }

  /** Answer a presence, length or key-order fact from metadata alone. */
  function metadataFact(resultId: number, operation: Exclude<IOperation, 'value'>, address: readonly IAddressSegment[]): ISelectedFact {
    const metadata = metadataAt(resultId, address);
    if (metadata === undefined) {
      const { standIn: stand, remainder } = absentRemainder(resultId, address);
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
        const keys = decodeStored(() => JSON.parse(metadata.ownKeys ?? '') as unknown, 'key order');
        if (!Array.isArray(keys) || !keys.every((key) => typeof key === 'string') || new Set(keys).size !== keys.length) {
          throw new HistoryIntegrityError('Stored key order is malformed');
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
   * Load one container subtree from its node and edge rows and check the
   * rebuilt MDS1 snapshot against the node's indexed digest, so tampered or
   * incomplete rows fail rather than return different data.
   */
  function subtreeAt(resultId: number, nodeId: number): unknown {
    const nodeRows = statements.subtreeNodes.all(nodeId, resultId, resultId, resultId);
    const byId = new Map(nodeRows.map((row) => [integer(row, 'node_id'), row]));
    const edgeRows = statements.subtreeEdges.all(resultId, JSON.stringify([...byId.keys()]));
    const children = new Map<number, ISqliteRow[]>();
    for (const edge of edgeRows) {
      const parent = integer(edge, 'parent_node');
      const siblings = children.get(parent);
      if (siblings === undefined) {
        children.set(parent, [edge]);
      } else {
        siblings.push(edge);
      }
    }
    const rebuild = (id: number): unknown => {
      const row = byId.get(id);
      if (row === undefined) {
        throw new HistoryIntegrityError('Indexed subtree is missing a node');
      }
      const kind = nodeKind(row);
      if (kind === 'scalar') {
        return decodeStored(() => decodeValue(text(row, 'scalar')), 'scalar leaf');
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
          throw new HistoryIntegrityError('Indexed prototype is not a record');
        }
        prototype = rebuilt;
      }
      return recordFromEntries(members.map((edge) => [text(edge, 'edge_key'), rebuild(integer(edge, 'child_node'))] as const), prototype);
    };
    const encoded = decodeStored(() => encodeSnapshot(rebuild(nodeId)), 'subtree');
    const expected = byId.get(nodeId);
    if (expected === undefined || fingerprint(encoded, host) !== text(expected, 'snapshot_fingerprint')) {
      throw new HistoryIntegrityError('Indexed subtree does not match its recorded snapshot fingerprint');
    }
    return decodeSnapshot(encoded);
  }

  /** Evaluate a Value selection, mapping only Value's shape rejection to `incompatible`. */
  function compatible(evaluate: () => string | undefined): ISelectedFingerprintResolution {
    let digest: string | undefined;
    try {
      digest = evaluate();
    } catch (error: unknown) {
      if (error instanceof TypeError) {
        return { kind: 'incompatible' };
      }
      throw error;
    }
    return digest === undefined ? { kind: 'incompatible' } : { kind: 'compatible', fingerprint: digest };
  }

  const reader: ICompletedResultReader & ICompletedNavigationReader = Object.freeze({
    readNode(reference: ICompletedResultReference, requested: readonly IAddressSegment[]): ISelectedNode {
      const resultId = resolve(reference);
      const address = copyAddress(requested);
      const metadata = metadataAt(resultId, address);
      if (metadata === undefined) {
        const { standIn: stand, remainder } = absentRemainder(resultId, address);
        const relative = navigate(stand, remainder);
        if (relative.kind !== 'scalar') {
          throw new HistoryIntegrityError('An unindexed address cannot select a container');
        }
        return Object.freeze({ kind: 'scalar', selected: absoluteFact('value', address, relative.selected.fact) });
      }
      switch (metadata.kind) {
        case 'record':
          return Object.freeze({ kind: 'record', address });
        case 'array':
          return Object.freeze({ kind: 'array', address, length: metadata.arrayLength ?? 0 });
        case 'scalar':
          return Object.freeze({ kind: 'scalar', selected: absoluteFact('value', address, verifiedScalar(resultId, address, metadata)) });
        default: {
          const exhaustive: never = metadata.kind;
          return exhaustive;
        }
      }
    },
    readSubtree(reference: ICompletedResultReference, requested: readonly IAddressSegment[]): unknown {
      const resultId = resolve(reference);
      const metadata = metadataAt(resultId, copyAddress(requested));
      if (metadata === undefined || metadata.kind === 'scalar') {
        throw new TypeError('Subtree reads need an indexed record or array');
      }
      return subtreeAt(resultId, metadata.nodeId);
    },
    readSelected(reference: ICompletedResultReference, request: ISelectedReadRequest): ISelectedFact {
      const resultId = resolve(reference);
      const address = copyAddress(request.address);
      if (request.operation !== 'value') {
        return metadataFact(resultId, request.operation, address);
      }
      if (address.length === 0) {
        // Value has no member address at which a root value could be observed.
        return absoluteFact('value', address, observe(null, [], 'value').fact);
      }
      const metadata = metadataAt(resultId, address);
      if (metadata === undefined) {
        const { standIn: stand, remainder } = absentRemainder(resultId, address);
        return absoluteFact('value', address, observe(stand, remainder, 'value').fact);
      }
      return absoluteFact('value', address, metadata.kind === 'scalar' ? verifiedScalar(resultId, address, metadata) : subtreeAt(resultId, metadata.nodeId));
    },
    resolveFingerprint(reference: ICompletedResultReference, request: ISelectedFingerprintRequest): ISelectedFingerprintResolution {
      const resultId = resolve(reference);
      if (request.kind === 'projection') {
        // Keyed projections are outside this index; absence never implies equality.
        return { kind: 'unavailable' };
      }
      const address = copyAddress(request.address);
      if (request.kind === 'selected') {
        if (request.encoding !== 'MDO1') {
          return { kind: 'incompatible' };
        }
        if (request.operation === 'value') {
          if (address.length === 0) {
            return { kind: 'incompatible' };
          }
          const row = statements.fingerprints.get(resultId, encodeAddress(address));
          if (row !== undefined) {
            const stored = nullableText(row, 'value_fingerprint');
            if (stored === null) {
              throw new HistoryIntegrityError('Indexed member address has no value fingerprint');
            }
            return { kind: 'compatible', fingerprint: stored };
          }
          const { standIn: stand, remainder } = absentRemainder(resultId, address);
          return compatible(() => fingerprint(encodeSelectedFact(absoluteFact('value', address, observe(stand, remainder, 'value').fact)), host));
        }
        const operation = request.operation;
        // Storage failures inside metadataFact are integrity errors, not TypeErrors, so they propagate.
        return compatible(() => fingerprint(encodeSelectedFact(metadataFact(resultId, operation, address)), host));
      }
      if (request.encoding !== 'MDS1') {
        return { kind: 'incompatible' };
      }
      const row = statements.fingerprints.get(resultId, encodeAddress(address));
      if (row !== undefined) {
        return { kind: 'compatible', fingerprint: text(row, 'snapshot_fingerprint') };
      }
      const { standIn: stand, remainder } = absentRemainder(resultId, address);
      return compatible(() => {
        const relative = navigate(stand, remainder);
        return relative.kind === 'scalar' ? fingerprint(encodeSnapshot(relative.selected.fact), host) : undefined;
      });
    },
  });

  return Object.freeze({
    insert(resultId: number, rows: IIndexRows): void {
      for (const node of rows.nodes) {
        statements.insertNode.run(resultId, node.nodeId, node.kind, node.scalar, node.arrayLength, node.ownKeys, node.prototype, node.prototypeNode, node.terminal, node.snapshotFingerprint);
      }
      for (const edge of rows.edges) {
        statements.insertEdge.run(resultId, edge.parentNode, edge.edgeKind, edge.edgeKey, edge.position, edge.childNode);
      }
      for (const address of rows.addresses) {
        statements.insertAddress.run(resultId, address.address, address.nodeId, address.own, address.valueFingerprint);
      }
    },
    reader,
    verify(resultId: number): IResultVerification {
      const payloadRow = statements.payload.get(resultId);
      if (payloadRow === undefined) {
        return { kind: 'inconsistent', detail: 'missing payload' };
      }
      let canonical: unknown;
      try {
        canonical = decodeSnapshot(text(payloadRow, 'payload'));
      } catch {
        return { kind: 'inconsistent', detail: 'stored payload is not canonical MDS1' };
      }
      if (canonical === null || typeof canonical !== 'object') {
        return { kind: 'inconsistent', detail: 'payload root is not a container' };
      }
      const expected = buildIndex(canonical, host);
      const nodeCells = (row: ISqliteRow): readonly ISqliteValue[] => [
        row.node_id ?? null, row.kind ?? null, row.scalar ?? null, row.array_length ?? null, row.own_keys ?? null,
        row.prototype ?? null, row.prototype_node ?? null, row.terminal ?? null, row.snapshot_fingerprint ?? null,
      ];
      const edgeCells = (row: ISqliteRow): readonly ISqliteValue[] => [row.parent_node ?? null, row.edge_kind ?? null, row.edge_key ?? null, row.position ?? null, row.child_node ?? null];
      const addressCells = (row: ISqliteRow): readonly ISqliteValue[] => [row.address ?? null, row.node_id ?? null, row.own ?? null, row.value_fingerprint ?? null];
      const comparisons = [
        ['nodes', expected.nodes.map((node) => [node.nodeId, node.kind, node.scalar, node.arrayLength, node.ownKeys, node.prototype, node.prototypeNode, node.terminal, node.snapshotFingerprint]), statements.allNodes.all(resultId).map(nodeCells)],
        ['edges', expected.edges.map((edge) => [edge.parentNode, edge.edgeKind, edge.edgeKey, edge.position, edge.childNode]), statements.allEdges.all(resultId).map(edgeCells)],
        ['addresses', expected.addresses.map((row) => [row.address, row.nodeId, row.own, row.valueFingerprint]), statements.allAddresses.all(resultId).map(addressCells)],
      ] as const;
      for (const [label, left, right] of comparisons) {
        // Compare as row sets; SQLite and JavaScript collations need not agree.
        const canonicalRows = (rows: readonly (readonly ISqliteValue[])[]): string => JSON.stringify(rows.map((row) => JSON.stringify(row)).sort());
        if (canonicalRows(left) !== canonicalRows(right)) {
          return { kind: 'inconsistent', detail: `${label} differ from the index generated from the canonical payload` };
        }
      }
      return { kind: 'consistent' };
    },
  });
}
