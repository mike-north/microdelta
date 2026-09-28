# @microdelta/machine

## 0.1.0
### Minor Changes

- 39eef60: Add separate alpha SQLite and clock capabilities for durable local storage consumers. The Node adapter provides configured persistent connections, synchronous immediate transactions, portable value transport and explicit connection lifetime checks while preserving existing Machine consumers.
- 0b26e08: Add `@microdelta/value` for canonical value and snapshot encodings, structured selected-fact observations, and fingerprints. Add the Machine SHA-256 capability and its Node implementation.
