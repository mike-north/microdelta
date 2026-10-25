---
"@microdelta/machine": minor
"@microdelta/machine-node": minor
---

Add the alpha `IElapsedClockCapability` contract and Node factory for measuring whole milliseconds from Node's process-local performance time origin. These readings have no UTC meaning and cannot be ordered across process restarts; epoch clock behavior remains separate.
