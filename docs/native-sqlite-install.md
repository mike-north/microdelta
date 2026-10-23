# Native SQLite installation with pnpm

This guide describes an **external ESM consumer of the published
`microdelta@0.2.0`** on the tested Node 24 setup. It does not describe the
current checkout's package version or make the workspace authoring API public.
The default public TypeScript entry exposes the process-local memory `Store`;
the durable `openWorkspace` path remains **project-private alpha**. Its
declaration setup is a separate concern tracked in [#154](https://github.com/mike-north/microdelta/issues/154).

The durable Node adapter uses native `better-sqlite3@12.9.0`. A pnpm consumer
must allow that dependency's local build before opening a durable workspace.
This is pnpm's build-trust policy, not an ESM import or TypeScript resolution
failure. In isolated macOS arm64 tests on Node 24.22.1, the unapproved paths
behaved differently:

| Package manager | Unapproved installation | Subsequent durable open |
| --- | --- | --- |
| pnpm 10.34.7 | Exited 0 with `Ignored build scripts: better-sqlite3@12.9.0` | Failed with `Could not locate the bindings file` |
| pnpm 12.10.1 | Exited nonzero with `ERR_PNPM_IGNORED_BUILDS` naming `better-sqlite3` | Failed for the missing binding in the isolated fixture |

The same fixture's public ESM memory-store smoke succeeded without a native
binding. That result does not turn the failed pnpm 12 installation into a
supported way to install a consumer; it separates the public memory API from
the private-alpha durable prerequisite.

In the **consumer directory**, add a local `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  better-sqlite3: true
```

Then rebuild only the approved native dependency:

```sh
pnpm rebuild better-sqlite3
```

This targeted approval avoids changing global trust settings or approving
unrelated dependencies. pnpm also offers interactive `pnpm approve-builds`;
the YAML plus rebuild sequence above is the verified route for these two
versions. If a prebuilt binding is unavailable, native compilation requires a
working compiler, linker and SDK on the consumer host. The macOS Node 26 SDK
linker diagnosis and platform-qualified setup are tracked in
[#158](https://github.com/mike-north/microdelta/issues/158); a successful
pnpm approval alone does not prove native compatibility on another host.

## Reproduce the bounded controls

The unchanged [portable acceptance fixture](../scratch/gap-hunt/contract-operations/verify-157.sh)
pins the published package and both pnpm versions, creates disposable external
consumers, and leaves global trust settings untouched. From a clean checkout,
with Node 24.x, npm, Bash and npm-registry access:

```sh
bash scratch/gap-hunt/contract-operations/verify-157.sh
```

Pass `10.34.7` or `12.10.1` to run one manager. The fixture checks each
unapproved negative, the public memory smoke, and the locally approved cold
durable run (**one body, published**) followed in another Node process by
**zero bodies, reused with the identical exact reference**. A native source
build may also need Python 3, `make`, and a C++ compiler. Use a fresh user or
container without inherited pnpm build approvals when reproducing negatives.

The earlier [clean macOS fallback run](https://github.com/mike-north/microdelta/blob/ee66046cf1ea8e6694ab0fe81ff272c15da0cbd2/scratch/gap-hunt/contract-operations/PNPM157-CLEAN-FALLBACK.md)
passed both versions using an existing pnpm 12.10.1 executable selected with
`PNPM12_BIN`; the fixture verifies that executable's version. A later default
freshly downloaded pnpm 12 executable was
[blocked at launch by that host's code-signing policy](https://github.com/mike-north/microdelta/issues/157#issuecomment-6372556465)
before consumer installation. A new macOS arm64 Node 24.14.0 implementation
run downloaded pnpm 12.10.1 afresh and passed all controls, including the
approved cold/restart sequence. These are host-specific results, not a
promise that every downloaded manager will launch. The
[implementation evidence](validation/pnpm-native-approval-2026-10-23.md)
records the exact commands and outcomes.

**Linux pnpm 10/12 execution remains unverified.** The owner-supplied Linux
Node 24/26 native-install and full-suite successes used npm, so they do not
establish pnpm approval behavior. Run the fixture on a fresh Linux Node 24
environment before claiming Linux acceptance. This guide makes no Node 26,
Linux pnpm, driver-engine or package-publication support change.
