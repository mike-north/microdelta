/**
 * Canonical identity of a local store file. Assembly uses it to tell whether
 * two handles name one file, however each spelled the location: relative or
 * absolute, with redundant segments, or through symbolic links. It answers
 * only "which file is this"; what a shared file means (one writer lease, one
 * logical store) stays with the contexts that own those meanings.
 * @packageDocumentation
 */
import { realpathSync } from 'node:fs';

/**
 * The absolute real path of an existing file, with every symbolic link and
 * redundant segment resolved. A location naming no existing file throws.
 * @internal
 */
export function _canonicalNodeLocationImplementation(location: string): string {
  return realpathSync.native(location);
}
