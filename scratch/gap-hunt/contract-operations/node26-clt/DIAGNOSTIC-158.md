# Executed #158 native diagnosis entrypoint

`diagnose-158-native.mjs` was executed unchanged from a new clean detached evidence checkout at `6d3f3f3533d75ea42be226edbd7e3932b974f447` (full actual commit in `diagnostic-context.json`). No repository dependency installation/build was needed: inspection confirmed this entrypoint creates its own temporary package, pins better-sqlite3@12.9.0, installs it, runs native SQLite open/query/close, records actual child outcomes, then removes only its temporary package.

Actual result: Node26.12.0 / ABI147 / Darwinarm64, npm11.20.0, dependency install status0, native smoke status0 with `native-sqlite-open-query-ok`. No child errors or signals. The outer status is also0, but success classification comes from the actual child statuses and smoke marker, not that diagnostic-completion exit policy. `diagnostic-validated.json` records the checked success conditions. Engine-range warning remains visible and does not become a support guarantee.

The command was `/Users/mnorth/.nodenv/versions/26.12.0/bin/node scratch/gap-hunt/contract-operations/diagnose-158-native.mjs`, with the exact command-local CC/CXX/SDKROOT/CFLAGS/CXXFLAGS/LDFLAGS/DEVELOPER_DIR from `retry-environment.json`, and PATH prefixed by Node26bin then CLTbin. Complete command/environment and clean-before/after evidence are in `diagnostic-context.json`; complete output is `diagnostic158.json` plus stderr log. Global xcode-select remains `/Applications/Xcode.app/Contents/Developer`; no global toolchain/configuration change, new driver, production edit, provider or issue mutation occurred.

## Superseded coverage candidate

The original RUN-012/A-12 expiry candidate was superseded by supervisor-linked `gap-hunt-contracts@b2ad91b` evidence: finite-window fake provider controls show expired unsafe replay could apply again, while a conservative adapter keeps unknown visible and sends nothing after same-process session reopen. This worker did not rerun those cross-owner cases. The current matrix records that bounded result without implying automatic revocation of earlier safety declarations.

Later RUN-016 authored selection/cap/normal-mode evidence is `AUTHORED-TRIAL.md`; REUSE-003 source-window/alias evidence is `../SOURCE-BOUNDARIES.md`. No highest-priority unexecuted RUN-012 claim remains here.
