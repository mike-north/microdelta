import { readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';
const base = 'scratch/gap-hunt/review-193-repair/';
const source = readFileSync(base + 'frozen/array-validation.test.ts', 'utf8');
const anchor = "'../durable-history/support.js'";
if (source.split(anchor).length !== 2) throw new Error('Expected one historical import anchor');
const adapted = source.replace(anchor, "'../../../packages/core/.test-build/test/durable-history/support.js'");
writeFileSync(base + 'original.test.mjs', ts.transpileModule(adapted, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
