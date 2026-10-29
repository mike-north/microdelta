/** Finite exact-result command composition: grammar and transport belong here; History owns reading and release. */
import { HistoryBusyError, HistoryIntegrityError, HistorySchemaError } from '@microdelta/history';
import { SqliteReadError } from '@microdelta/machine';
import type { ICommandProcessCapability } from '@microdelta/machine';
import type { IAddressSegment, IOperation } from '@microdelta/value';

import type { readHistorySelection } from './history-selection.js';

/** The finite reader can name a path and report data, never load an author module or control a run. */
type IHistoryResultHost = Pick<ICommandProcessCapability, 'arguments' | 'resolvePath' | 'writeStdout' | 'writeStderr' | 'setExitCode'>;
/** Synchronous owner return means release finished before the transport encoder is called. */
interface IHistoryResultPorts {
  readonly read: typeof readHistorySelection;
  readonly encode: (fact: unknown) => string;
}

/** Parsed metadata is framework-owned data; it never identifies a latest/current result implicitly. */
interface IParsedSelection {
  readonly location: string;
  readonly logicalStore: string;
  readonly reference: { readonly kind: 'completed-result'; readonly locator: string };
  readonly operation: IOperation;
  readonly address: readonly IAddressSegment[];
}
/** Finite coded failures preserve owner meaning without exposing arbitrary diagnostic values. */
type IReadFailure = 'absent' | 'unsupported' | 'corrupt' | 'recovery-required' | 'busy' | 'schema' | 'integrity' | 'multiple-failures' | 'failed';
/** A fact's explicit branch keeps selected undefined distinct from a failed read. */
type ICommandResult = { readonly kind: 'fact'; readonly encoding: 'MDS1'; readonly snapshot: string } | { readonly kind: 'failed'; readonly code: IReadFailure };
/** The distinct command authority includes coordinated sidecar effects, unlike CLI-005 observation. */
const usage = 'Usage: microdelta read-result --location PATH --logical-store NAME --reference LOCATOR --operation OP --address ADDRESS_JSON\nReads existing History with native WAL/SHM coordination; never executes analysis.\n';
/** Diagnostics never contain caller input, author data or owner exception messages. */
const failedDiagnostic = 'microdelta: result read command failed\n';

/** JSON objects are inert supplied data; closed field sets prevent alternate address meanings. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
/** The operation vocabulary remains Value-owned, rather than a new result/JSON-pointer protocol. */
function operation(value: string): IOperation | undefined {
  switch (value) {
    case 'value': case 'own': case 'membership': case 'length': case 'keys': case 'container-kind': return value;
    default: return undefined;
  }
}
/** Copy only validated structured segments before any path or storage capability is exercised. */
function address(text: string): readonly IAddressSegment[] | undefined {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return undefined; }
  if (!Array.isArray(parsed)) { return undefined; }
  const values: readonly unknown[] = parsed; const segments: IAddressSegment[] = [];
  for (const value of values) {
    if (!isRecord(value) || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'kind')) { return undefined; }
    if (value.kind === 'property' && Object.hasOwn(value, 'key') && typeof value.key === 'string') { segments.push(Object.freeze({ kind: 'property', key: value.key })); }
    else if (value.kind === 'index' && Object.hasOwn(value, 'index') && typeof value.index === 'number' && Number.isSafeInteger(value.index) && value.index >= 0) { segments.push(Object.freeze({ kind: 'index', index: value.index })); }
    else { return undefined; }
  }
  return Object.freeze(segments);
}
/** Option/value pairs are literal; no module, input file, follow mode or implicit store lookup exists. */
function parse(arguments_: readonly string[]): IParsedSelection | undefined {
  if (arguments_.length !== 11 || arguments_[0] !== 'read-result') { return undefined; }
  let location: string | undefined; let logicalStore: string | undefined; let locator: string | undefined; let selectedOperation: string | undefined; let selectedAddress: string | undefined;
  for (let index = 1; index < arguments_.length; index += 2) {
    const option = arguments_[index]; const value = arguments_[index + 1];
    if (value === undefined || value.length === 0) { return undefined; }
    if (option === '--location' && location === undefined) { location = value; }
    else if (option === '--logical-store' && logicalStore === undefined) { logicalStore = value; }
    else if (option === '--reference' && locator === undefined) { locator = value; }
    else if (option === '--operation' && selectedOperation === undefined) { selectedOperation = value; }
    else if (option === '--address' && selectedAddress === undefined) { selectedAddress = value; }
    else { return undefined; }
  }
  if (location === undefined || logicalStore === undefined || locator === undefined || selectedOperation === undefined || selectedAddress === undefined) { return undefined; }
  const op = operation(selectedOperation); const path = address(selectedAddress);
  return op === undefined || path === undefined ? undefined : Object.freeze({ location, logicalStore, reference: Object.freeze({ kind: 'completed-result', locator }), operation: op, address: path });
}
/** Required diagnostic failure is command failure too, without another diagnostic attempt. */
function diagnostic(host: IHistoryResultHost, text: string, desiredExit: 1 | 2): void {
  let code: 1 | 2 = desiredExit;
  try { host.writeStderr(text); } catch { code = 1; }
  host.setExitCode(code);
}
/** Only existing owner constructors can establish a finite diagnosis. */
function failureCode(cause: unknown): IReadFailure {
  if (cause instanceof SqliteReadError) { return cause.code; }
  if (cause instanceof HistoryBusyError) { return 'busy'; }
  if (cause instanceof HistorySchemaError) { return 'schema'; }
  if (cause instanceof HistoryIntegrityError) { return 'integrity'; }
  if (cause instanceof AggregateError) { return 'multiple-failures'; }
  return 'failed';
}
/** Build the complete framework document before one full-write-or-throw transport call. */
function output(host: IHistoryResultHost, selection: IParsedSelection, result: ICommandResult): void {
  try {
    const document = JSON.stringify({ format: 'microdelta.history-result-read', formatVersion: 1, selection, result });
    host.writeStdout(`${document}\n`); host.setExitCode(result.kind === 'fact' ? 0 : 1);
  } catch { diagnostic(host, failedDiagnostic, 1); }
}

/** @internal Execute the separately permissionable exact-result command through its finite host ports. */
export function _runHistoryResultRead(host: IHistoryResultHost, ports: IHistoryResultPorts): void {
  const parsed = parse(host.arguments);
  if (parsed === undefined) { diagnostic(host, usage, 2); return; }
  let location: string;
  try { location = host.resolvePath(parsed.location); } catch { diagnostic(host, failedDiagnostic, 1); return; }
  const selection: IParsedSelection = Object.freeze({ ...parsed, location });
  let fact: unknown;
  try {
    const answer = ports.read({ location, logicalStore: selection.logicalStore }, { kind: 'fact', reference: selection.reference, request: { operation: selection.operation, address: selection.address } });
    if (answer.kind !== 'fact') { throw new TypeError('Exact fact command received another result kind'); }
    fact = answer.selected.fact;
  } catch (cause: unknown) { output(host, selection, { kind: 'failed', code: failureCode(cause) }); return; }
  let snapshot: string;
  try { snapshot = ports.encode(fact); } catch { diagnostic(host, failedDiagnostic, 1); return; }
  output(host, selection, { kind: 'fact', encoding: 'MDS1', snapshot });
}
