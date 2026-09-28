# microdelta

## 0.1.0
### Minor Changes

- 438854d: Add the project-private Run Supervision owner and the facade's alpha workspace path. Supervision runs scoped work over a structurally injected async-scope capability: runtime context lookup fails outside a live run, after close and during composition; normal requests take the writer lease lazily and the run releases it once; the caller's policy decides admission; observers see frozen events at fixed lifecycle positions and cannot veto work; ordinary nonmemoized work is observed without result identity. The facade composes the owners into `authoring()`, `openWorkspace()` with normal and recovery entry operations, and `currentRun()`, all as facade-local alpha declarations, so the public Store API is unchanged. Definition's topology now names its declared input and callable slots, and `isComposing()` reports the composition phase.

### Patch Changes

- Updated dependencies [5420e30]
- Updated dependencies [3420440]
- Updated dependencies [39eef60]
- Updated dependencies [709fb57]
- Updated dependencies [7004ca9]
- Updated dependencies [438854d]
- Updated dependencies [2f70608]
- Updated dependencies [7f0c96a]
- Updated dependencies [0b26e08]
  - @microdelta/definition@0.1.0
  - @microdelta/history@0.1.0
  - @microdelta/machine-node@0.1.0
  - @microdelta/value@0.1.0
  - @microdelta/tracking@0.1.0
  - @microdelta/materialization@0.1.0
  - @microdelta/resolution@0.1.0
  - @microdelta/supervision@0.1.0
