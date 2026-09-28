# @microdelta/definition

## 0.1.0
### Minor Changes

- 5420e30: Add project-private family-bound source and memo declarations, the frozen M3
  composition with exact structural correspondence and direct-child witness
  reconnection, and an invocation bridge that hands actual author callbacks to an
  injected invoker and dispatches argument-free declared child handles through an
  injected port.
- 438854d: Add the project-private Run Supervision owner and the facade's alpha workspace path. Supervision runs scoped work over a structurally injected async-scope capability: runtime context lookup fails outside a live run, after close and during composition; normal requests take the writer lease lazily and the run releases it once; the caller's policy decides admission; observers see frozen events at fixed lifecycle positions and cannot veto work; ordinary nonmemoized work is observed without result identity. The facade composes the owners into `authoring()`, `openWorkspace()` with normal and recovery entry operations, and `currentRun()`, all as facade-local alpha declarations, so the public Store API is unchanged. Definition's topology now names its declared input and callable slots, and `isComposing()` reports the composition phase.

### Patch Changes

- Updated dependencies [709fb57]
- Updated dependencies [2f70608]
- Updated dependencies [0b26e08]
  - @microdelta/value@0.1.0
