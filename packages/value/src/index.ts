/** Value Semantics public-to-sibling entry point; release tags keep it project-private. @packageDocumentation */
export {
  decodeSnapshot,
  decodeValue,
  encodeSelectedFact,
  encodeSnapshot,
  encodeValue,
  fingerprint,
  observe,
  recordFromEntries,
} from './value.js';
export type { IAddressSegment, ISelectedFact, IOperation } from './value.js';
/** @alpha Re-export the host-owned hashing contract used by {@link fingerprint}. */
export type { ISha256Capability } from '@microdelta/machine';
