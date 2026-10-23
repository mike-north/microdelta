/** The proposed constructor is a capture boundary only by its actual experimental declaration symbol. */
import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

/** Lint as a real author module in the strict experiment project, not as an untyped string. */
const root = fileURLToPath(new URL('../', import.meta.url));
const authorModule = path.join(root, 'experiments/exp-authoring/authors/assessment.ts');

/** Get ordinary diagnostics; no suppression is applied to these negative author callbacks. */
async function findings(source) {
  const eslint = new ESLint({ cwd: root });
  const [result] = await eslint.lintText(source, { filePath: authorModule });
  assert.ok(result);
  return result.messages;
}

test('experimental memo flags a mutable external capture in an actual author module', async () => {
  const messages = await findings([
    "import { analysis, memo } from '../src/protocol.js';",
    'const mutable = { offset: 1 };',
    "export const entry = analysis<{readonly title:string}>((input) => memo({ name:'score', from:{title:input('title')}, run:({title}) => title.length + mutable.offset }));",
  ].join('\n'));
  assert.deepEqual(messages.map(message => message.ruleId), ['microdelta/tracked-captures']);
  assert.match(messages[0]?.message ?? '', /External influence 'mutable'/u);
});

test('an imported alias of the real constructor keeps the same capture boundary', async () => {
  const messages = await findings([
    "import { analysis, memo as retained } from '../src/protocol.js';",
    'const mutable = { offset: 1 };',
    "export const entry = analysis<{readonly title:string}>((input) => retained({ name:'score', from:{title:input('title')}, run:({title}) => title.length + mutable.offset }));",
  ].join('\n'));
  assert.deepEqual(messages.map(message => message.ruleId), ['microdelta/tracked-captures']);
  assert.match(messages[0]?.message ?? '', /External influence 'mutable'/u);
});

test('selected callback parameters pass, and a same-named local function has no constructor authority', async () => {
  assert.deepEqual(await findings([
    "import { analysis, memo } from '../src/protocol.js';",
    "export const entry = analysis<{readonly title:string}>((input) => memo({ name:'score', from:{title:input('title')}, run:({title}) => title.length }));",
  ].join('\n')), []);
  assert.deepEqual(await findings([
    'const mutable = { offset: 1 };',
    'function memo(options: {readonly run:()=>number}): unknown { return options; }',
    'export const unrelated = memo({run:()=>mutable.offset});',
  ].join('\n')), []);
});
