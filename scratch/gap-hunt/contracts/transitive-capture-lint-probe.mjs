/** Exercise the real configured type-aware rule over generated declarations, including negative diagnostics. */
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';
const eslint = new ESLint({ cwd: process.cwd() });
const [result] = await eslint.lintFiles(['packages/core/test/gap-hunt-contracts-capture-fixture.ts']);
assert.ok(result);
assert.deepEqual(result.messages, []);
const diagnostics = result.suppressedMessages.filter(message => message.ruleId === 'microdelta/tracked-captures');
assert.equal(diagnostics.length, 4);
assert.equal(diagnostics.filter(message => /External influence 'importedHelper'/u.test(message.message)).length, 3);
assert.equal(diagnostics.filter(message => /outside the linted direct-callback syntax/u.test(message.message)).length, 1);
console.log(JSON.stringify({ status: 'pass', checked: 'direct wrapper, imported callback, same-file callback, nested local bridge', diagnostics: diagnostics.map(({ line, message }) => ({ line, message })) }, null, 2));
