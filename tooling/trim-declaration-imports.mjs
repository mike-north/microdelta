/** Re-emit trimmed API Extractor rollups after removing only now-unused imports. */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

/** Release declarations are checked without hiding unresolved or malformed public types. */
const compilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  noUnusedLocals: true,
  verbatimModuleSyntax: true,
};

/**
 * Re-emit a single trimmed declaration rollup so TypeScript drops imports whose
 * declarations did not survive release-tier trimming. The caller supplies the
 * existing package file path so NodeNext resolves its package mode consistently.
 */
export function trimDeclarationImports(source, filename) {
  const syntheticFilename = filename.replace(/\.d\.ts$/u, '.ts');
  const parsed = ts.createSourceFile(syntheticFilename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const statement of parsed.statements) {
    if (ts.isImportEqualsDeclaration(statement)) {
      throw new Error(`${filename}: unsupported import-equals declaration; rollup import cleanup refuses to guess its runtime meaning.`);
    }
    if (ts.isImportDeclaration(statement) && !statement.importClause) {
      throw new Error(`${filename}: unsupported side-effect import; rollup import cleanup cannot prove it is unused.`);
    }
  }
  const output = ts.transpileDeclaration(source, {
    fileName: syntheticFilename,
    compilerOptions,
    reportDiagnostics: true,
  });
  const errors = (output.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error);
  if (errors.length > 0) {
    const host = {
      getCurrentDirectory: () => process.cwd(),
      getCanonicalFileName: value => value,
      getNewLine: () => '\n',
    };
    throw new Error(ts.formatDiagnostics(errors, host));
  }
  return output.outputText;
}

/** The build gate transforms all requested files before writing any of them. */
async function main(filenames) {
  if (filenames.length === 0 || filenames.some(filename => !filename.endsWith('.d.ts'))) {
    throw new Error('Usage: trim-declaration-imports.mjs <rollup.d.ts> [rollup.d.ts ...]');
  }
  const results = await Promise.all(filenames.map(async filename => {
    const absolute = path.resolve(filename);
    const source = await readFile(absolute, 'utf8');
    return { absolute, contents: trimDeclarationImports(source, absolute) };
  }));
  for (const result of results) {
    await writeFile(result.absolute, result.contents);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
