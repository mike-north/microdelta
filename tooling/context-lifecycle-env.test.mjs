/** The official standalone census must ignore the diagnostic's external wrapper switch. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { standaloneContextEnvironment } from './context-lifecycle-env.mjs';

test('standalone context census drops the external wrapper switch without losing other environment', () => {
  const parentEnvironment = {
    CONTEXT_COMPONENT_ISOLATED: '1',
    NODE_OPTIONS: '--no-warnings',
    CUSTOM_PARENT_VALUE: 'kept',
  };
  const environment = standaloneContextEnvironment(parentEnvironment);

  assert.equal(Object.hasOwn(environment, 'CONTEXT_COMPONENT_ISOLATED'), false);
  assert.equal(environment.GAP_HUNT_REUSE_BUILD, '1');
  assert.equal(environment.NODE_OPTIONS, '--no-warnings');
  assert.equal(environment.CUSTOM_PARENT_VALUE, 'kept');
  assert.equal(parentEnvironment.CONTEXT_COMPONENT_ISOLATED, '1');
  assert.equal(Object.hasOwn(standaloneContextEnvironment({ CONTEXT_COMPONENT_ISOLATED: '0' }), 'CONTEXT_COMPONENT_ISOLATED'), false);
});
