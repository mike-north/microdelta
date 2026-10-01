/**
 * Canonical store locations for the Node adapter. Assembly compares store
 * locations to find two handles over one local file (for example a run nested
 * inside a run over the same store), so two spellings of one existing file must
 * canonicalize to the same string, distinct files must not, and a location that
 * names no existing file is refused rather than guessed.
 *
 * @see https://nodejs.org/api/fs.html#fsrealpathsyncpath-options
 */
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from '@jest/globals';

import { canonicalNodeLocation } from '../src/index.js';

/** Temporary directories created by a test. */
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** A fresh directory holding one existing file; returns both. */
function existingFile(): { readonly directory: string; readonly file: string } {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-location-'));
  directories.push(directory);
  const file = join(directory, 'history.sqlite');
  writeFileSync(file, '');
  return { directory, file };
}

describe('canonical Node store locations', () => {
  test('two spellings of one file, through a symbolic link and a redundant segment, canonicalize to one location', () => {
    const { directory, file } = existingFile();
    const linkParent = mkdtempSync(join(tmpdir(), 'microdelta-location-link-'));
    directories.push(linkParent);
    const link = join(linkParent, 'linked');
    symlinkSync(directory, link);
    const canonical = canonicalNodeLocation(file);
    expect(canonicalNodeLocation(`${link}/./history.sqlite`)).toBe(canonical);
    expect(canonicalNodeLocation(`${directory}/../${directory.split('/').at(-1) ?? ''}/history.sqlite`)).toBe(canonical);
  });

  test('distinct files canonicalize to distinct locations', () => {
    expect(canonicalNodeLocation(existingFile().file)).not.toBe(canonicalNodeLocation(existingFile().file));
  });

  test('a location naming no existing file is refused, not guessed', () => {
    const { directory } = existingFile();
    expect(() => canonicalNodeLocation(join(directory, 'missing.sqlite'))).toThrow();
  });
});
