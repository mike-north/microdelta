/** Value Semantics public-to-sibling entry point; release tags keep it project-private. @packageDocumentation */
export {
  decodeSnapshot,
  decodeValue,
  encodeProjectionFact,
  encodeSelectedFact,
  encodeSnapshot,
  encodeValue,
  fingerprint,
  normalizeProjectionDescriptor,
  normalizeProjectionFact,
  observe,
  recordFromEntries,
} from './value.js';
export type {
  IAddressSegment,
  IOperation,
  ISelectedFact,
  IValueProjectionDescriptor,
  IValueProjectionFact,
  IValueProjectionMember,
  IValueProjectionTraversal,
} from './value.js';
/** @alpha Re-export the host-owned hashing contract used by {@link fingerprint}. */
export type { ISha256Capability } from '@microdelta/machine';
