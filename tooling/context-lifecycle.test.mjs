/**
 * Keep the pinned standalone Tracking host-context diagnostic in the normal
 * tooling gate. It tests completed captures without an external caller wrapper;
 * the worker owns its GC census and semantic controls across fresh observers.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import * as v8 from 'node:v8';
import { standaloneContextEnvironment } from './context-lifecycle-env.mjs';

/** Heap object census is only available on hosts that expose Node's diagnostic. */
const hasObjectCensus = typeof Reflect.get(v8, 'queryObjects') === 'function';
/**
 * The bounded instance-count oracle is established on Node 24 and 26. Node
 * 22.22.1 showed growth even with the external AsyncResource control; that
 * host result remains unresolved outside this diagnostic's proven scope.
 */
const censusVersion = Number(process.versions.node.split('.')[0]);
const validatedCensusVersion = censusVersion === 24 || censusVersion === 26;

test('completed standalone captures do not retain one host context per entry', {
  skip: !hasObjectCensus
    ? 'Node does not expose v8.queryObjects for the bounded GC census'
    : validatedCensusVersion ? false : 'bounded ALS census is validated only on Node 24 and 26',
}, () => {
  const result = spawnSync(process.execPath, ['scratch/gap-hunt/scale/repro-context-component.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: standaloneContextEnvironment(process.env),
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
