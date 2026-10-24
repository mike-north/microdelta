import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const cold=JSON.parse(readFileSync(new URL('./cold.json',import.meta.url)));
const restart=JSON.parse(readFileSync(new URL('./restart.json',import.meta.url)));
assert.equal(cold.calls,1);assert.equal(cold.outcome.kind,'published');
assert.equal(restart.calls,0);assert.equal(restart.outcome.kind,'reused');
assert.deepEqual(restart.outcome.reference,cold.outcome.reference);
console.log(JSON.stringify({coldCalls:cold.calls,restartCalls:restart.calls,exactReference:restart.outcome.reference}));
