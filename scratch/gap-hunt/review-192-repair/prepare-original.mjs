/** Preserve frozen bytes; transpile the historical provisional matrix solely to inspect its unchanged runtime outcome. */
import { readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';
const root = new URL('./', import.meta.url);
const source = readFileSync(new URL('frozen/gap-hunt-contracts-scalar-roots.test.ts', root), 'utf8');
if (source.split("'../src/index.js'").length !== 3) throw new Error('historical import anchors changed');
const adapted = source.replaceAll("'../src/index.js'", "'../../../packages/core/dist/src/index.js'");
writeFileSync(new URL('original-runtime.test.mjs', root), ts.transpileModule(adapted, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
const types = readFileSync(new URL('frozen/gap-hunt-contracts-scalar-roots.test-d.ts', root), 'utf8');
if (types.split("'../dist/api/microdelta.alpha.js'").length !== 2) throw new Error('historical generated import anchor changed');
writeFileSync(new URL('original-positive.test-d.ts', root), types.replace("'../dist/api/microdelta.alpha.js'", "'../../../packages/core/dist/api/microdelta.alpha.js'"));
