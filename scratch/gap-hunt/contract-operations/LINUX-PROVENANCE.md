# Owner-supplied Linux verification

owner-linux-parity.md is an exact copy of the owner-supplied report at /Users/mnorth/stripe/microdelta/.worktrees/linux-parity-results.md, read in full on2026-10-23. This worker did not rerun the Linux commands or inspect the remote raw logs. Remote /pay/home/... links in that report name original artifacts, not files claimed available in this checkout.

The report records independently installed native bindings, clean isolated checkouts, all8installs/builds passing and main c5802daca4a0bb8ea91159854d84eddcfa5215b6 full npm test passing on Linuxaarch64 Node24.13.0 and26.12.1 (26.12.1 substitutes for the requested26.12 line). Three durability suites pass under both Nodes; the unsupported hard-file-alias probe remains a SQLite I/O failure, not a successful fencing test. The contracts repro failures and DX known failed single-mapping compiler attempt are preserved as failures.

This is positive Node26 native/runtime evidence on that Linux host. The older macOS Node26.12.0 SDK linker failure is host-specific. Pinned native dependency engine metadata excluding26 is declared-range lag, not proof of Node26 runtime incompatibility. The report does not establish a same-store cross-version cold/restart reuse sequence, all host/toolchain support, or a built-in SQLite fallback.

Linux npm success does not test pnpm10/12 build approval (#157). The parity durability commit is bfb1cc3 and the contracts/DX commits are pinned in the report; newer #162/#164 reproductions, performance work, focused lazy/observer/expiry/waiter additions and the latest clean-checkout runners were not in those checkouts. Keep their platform verification separate.
