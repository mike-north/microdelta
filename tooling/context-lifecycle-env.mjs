/**
 * Define the environment for the official standalone host-context census.
 * The scratch diagnostic permits an external AsyncResource wrapper as a
 * comparison control, but that switch must not change the regression gate.
 */

/** Preserve the caller's environment while forcing the unwrapped diagnostic. */
export function standaloneContextEnvironment(parentEnvironment) {
  const environment = { ...parentEnvironment, GAP_HUNT_REUSE_BUILD: '1' };
  delete environment.CONTEXT_COMPONENT_ISOLATED;
  return environment;
}
