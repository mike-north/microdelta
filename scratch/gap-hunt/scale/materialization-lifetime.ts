/** Small lifecycle probe over public Materialization reader ports; no provider or durable-store claim. */
import { setImmediate } from 'node:timers/promises';
import { createMaterialization } from '@microdelta/materialization';
import { createTrackingObserver } from '@microdelta/tracking';
import { createNodeMachine } from '@microdelta/machine-node';
import { navigate, observe } from '@microdelta/value';
import type { IAddressSegment } from '@microdelta/value';
import type { ICompletedNavigationReader, ICompletedResultReader } from '@microdelta/history';
interface IChild { readonly value: number; readonly unread: string }
interface IRoot { readonly children: readonly IChild[] }
const size = Number(process.argv[2]);
if (!Number.isSafeInteger(size) || size <= 0) throw new Error('Expected finite size');
const snapshot: IRoot = { children: Array.from({ length: size }, (_, value) => ({ value, unread: 'unread' })) };
const machine = createNodeMachine();
const tracking = createTrackingObserver(machine);
let nodeCalls = 0;
let subtreeReads = 0;
let unreadReads = 0;
/** Count requests only; retaining reader source data is necessary source ownership, not a view cache. */
function inspect(address: readonly IAddressSegment[]): void {
  if (address.some(segment => segment.kind === 'property' && segment.key === 'unread')) unreadReads += 1;
}
const reader: ICompletedResultReader & ICompletedNavigationReader = {
  readNode(_reference, address) { nodeCalls += 1; inspect(address); return navigate(snapshot, address); },
  readSubtree(_reference, address) { subtreeReads += 1; inspect(address); return address.length === 0 ? snapshot : observe(snapshot, address, 'value').fact; },
  readSelected(_reference, request) { inspect(request.address); return observe(snapshot, request.address, request.operation); },
  resolveFingerprint() { return { kind: 'unavailable' }; },
};
const materialization = createMaterialization({ tracking, reader, navigationReader: reader });
const root = materialization.materializeView<IRoot>({ kind: 'completed-result', locator: 'synthetic-exact' }, { path: ['input'] });
let valuesChecked = 0;
let observations = 0;
let kindObservations = 0;
/** Each capture and child strong reference finish before the collection window. */
function consume(index: number): WeakRef<object> {
  let weak: WeakRef<object> | undefined;
  const capture = tracking.capture(() => {
    const child = root.children[index];
    if (child === undefined) throw new Error('Missing child');
    weak = new WeakRef(child);
    return child.value;
  });
  const leaf = capture.observations.filter(observation => String(observation.operation) === 'value');
  const kinds = capture.observations.filter(observation => String(observation.operation) === 'container-kind');
  if (capture.value !== index || leaf.length !== 1 || capture.observations.length !== leaf.length + kinds.length) throw new Error('Wrong selected read');
  const expectedAddress = JSON.stringify([{ kind: 'property', key: 'children' }, { kind: 'index', index }, { kind: 'property', key: 'value' }]);
  if (JSON.stringify(leaf[0]?.address) !== expectedAddress) throw new Error('Wrong selected address');
  kindObservations += kinds.length;
  valuesChecked += 1;
  observations += leaf.length;
  if (weak === undefined) throw new Error('Missing weak reference');
  return weak;
}
const dropped = Array.from({ length: size }, (_, index) => consume(index));
const retained = root.children[0];
if (retained === undefined) throw new Error('Missing retained control');
const retainedWeak = new WeakRef(retained);
/** GC happens only after synchronous consumers finish; the root remains live and usable. */
async function collect(): Promise<void> { await setImmediate(); global.gc?.(); await setImmediate(); global.gc?.(); await setImmediate(); }
await collect();
const liveDropped = dropped.filter(weak => weak.deref() !== undefined).length;
const liveRetained = retainedWeak.deref() === retained ? 1 : 0;
const ordinarySubtreeReads = subtreeReads;
const first = tracking.capture(() => root.children[0]?.value);
const beforeReread = nodeCalls;
const second = tracking.capture(() => root.children[0]?.value);
const rereadNodeCalls = nodeCalls - beforeReread;
const sameFingerprint = first.observations[0]?.fingerprint === second.observations[0]?.fingerprint;
let aliasRejected = false;
try { materialization.materializeOutput({ left: root.children[0], right: root.children[0] }); }
catch (error: unknown) { aliasRejected = error instanceof TypeError && /repeated/u.test(error.message); }
/** Detached outputs have consumer lifetime; dropping them must not pin them through the retained view. */
function outputWeak(): WeakRef<object> {
  const child = root.children[0];
  if (child === undefined) throw new Error('Missing output child');
  return new WeakRef(materialization.materializeOutput(child));
}
const output = outputWeak();
await collect();
const outputCollected = output.deref() === undefined;
const tag = tracking.local.createTag();
const revision = tracking.local.snapshot([tag]);
const tagValidBefore = tracking.local.isValid([tag], revision);
tracking.local.dirty(tag);
const tagInvalidAfter = !tracking.local.isValid([tag], revision);
// Keep both root and the intentional child control live through the entire census.
if (retained.value !== 0 || root.children[size - 1]?.value !== size - 1) throw new Error('Live root/control changed');
console.log(JSON.stringify({ size, valuesChecked, observations, kindObservations, ordinarySubtreeReads, unreadReads, liveDropped, liveRetained, rereadNodeCalls, sameFingerprint, aliasRejected, outputCollected, tagValidBefore, tagInvalidAfter }));
