/**
 * This independent source check keeps ESLint directives from disabling the
 * rule that reviews them. It reads active TypeScript only; archived explorations
 * remain dated evidence rather than current code.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import tseslint from 'typescript-eslint';

import { suppressionProblem } from './documented-suppressions.mjs';

/** Ignore generated outputs while discovering every active TypeScript source. */
const omittedDirectories = new Set(['node_modules', 'dist', '.test-build']);

/** Recursively visit active code without following symlinks or archived drafts. */
async function* activeFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory() && !omittedDirectories.has(entry.name)) {
      yield* activeFiles(fullPath);
    } else if (entry.isFile() && /\.(?:[cm]?ts|tsx)$/u.test(entry.name)) {
      if (!entry.name.endsWith('.ts')) {
        throw new Error(`${fullPath}: unsupported TypeScript extension; add compiler and lint coverage first`);
      }
      yield fullPath;
    }
  }
}

/** Parsed comments exclude template text, regular expressions, and string content. */
function checkFile(source, filename) {
  const { ast } = tseslint.parser.parseForESLint(source, { comment: true, loc: true, filePath: filename });
  const findings = [];
  for (const comment of ast.comments ?? []) {
    const content = comment.value.trim();
    const problem = suppressionProblem(content);
    const tsDirective = content.match(/^@ts-(?<kind>ignore|nocheck|expect-error)\b(?<rest>[^\r\n]*)/u);
    const undocumentedTs = tsDirective && (tsDirective.groups?.kind !== 'expect-error' ||
      !/^:\s+.{10,}$/u.test(tsDirective.groups.rest ?? ''));
    if (problem || undocumentedTs) {
      const reason = problem === 'scope' ? 'File-wide ESLint disables are forbidden' :
        problem === 'reason' ? 'ESLint suppression needs a named rule and specific reason' :
          problem === 'config' ? 'Inline ESLint rule configuration is forbidden' :
            'TS suppression is undocumented or forbidden';
      findings.push(`${filename}:${comment.loc.start.line}: ${reason}`);
    }
  }
  return findings;
}

/** A nonzero exit prevents broad or undocumented exceptions from entering CI. */
const findings = [];
for (const root of ['packages', 'experiments']) {
  for await (const filename of activeFiles(root)) {
    findings.push(...checkFile(await readFile(filename, 'utf8'), filename));
  }
}
if (findings.length > 0) {
  process.stderr.write(`${findings.join('\n')}\n`);
  process.exitCode = 1;
}
