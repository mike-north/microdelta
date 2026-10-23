---
"@microdelta/machine": patch
"@microdelta/machine-node": patch
---

Document the `IAsyncContext` completed-entry retention contract and update the Node adapter so repeated fresh entries do not accumulate distinct host contexts in a continuing caller on the validated Node 24 and 26 runtimes. Callback results, caller context, and inherited asynchronous work retain their existing semantics. The Node 22 host-retention diagnostic remains unresolved.
