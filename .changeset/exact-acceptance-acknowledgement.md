---
"@microdelta/history": patch
---

Read back only the exact acceptance inserted by `recordAcceptance`, including its result and environment, while keeping full immutable acceptance inspection. Acknowledgements reject mismatched identity, fence, or evidence and roll back instead of returning speculative completion.
