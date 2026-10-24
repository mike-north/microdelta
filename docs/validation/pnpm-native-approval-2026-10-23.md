# pnpm native-build approval: bounded consumer evidence

This record covers the immutable published `microdelta@0.2.0` package, not
the current checkout's package version. The checked-in
[`verify-157.sh`](../../scratch/gap-hunt/contract-operations/verify-157.sh)
is byte-identical to `gap-hunt-durability@0683c2ed73934d10f9b5a1ad9e0dd9e3d1a88d4f`
(SHA-256 `b2becb9113b7ee62a2d984612000ce5c52299ec114eedece4de35eb370e7cfc7`).
Its consumer installations, SQLite stores, pnpm stores and build approvals
are disposable and local; it does not change global trust settings.

On macOS arm64, Node 24.14.0, npm 11.18.0, with `PNPM12_BIN` unset, two
independent commands from the repository root exited 0:

```sh
env -u PNPM12_BIN bash scratch/gap-hunt/contract-operations/verify-157.sh 10.34.7
env -u PNPM12_BIN bash scratch/gap-hunt/contract-operations/verify-157.sh 12.10.1
```

| Manager | Unapproved install | Unapproved durable open | Public memory smoke | After local approval and rebuild |
| --- | --- | --- | --- | --- |
| 10.34.7 | exit 0, ignored-build warning | exit 1, missing binding | `public-memory-ok` | cold 1/published; independent restart 0/reused, exact reference equal |
| 12.10.1 | exit 1, `ERR_PNPM_IGNORED_BUILDS` | exit 1, missing binding | `public-memory-ok` | cold 1/published; independent restart 0/reused, exact reference equal |

The runner's result lines were:

```text
pnpm=10.34.7 install=0 unapproved-durable=1
public-memory-ok
{"coldCalls":1,"restartCalls":0,"exactReference":{"kind":"completed-result","locator":"mdh1|[\"portability\",\"portability\",\"fixture\",1]"}}
pnpm=12.10.1 install=1 unapproved-durable=1
public-memory-ok
{"coldCalls":1,"restartCalls":0,"exactReference":{"kind":"completed-result","locator":"mdh1|[\"portability\",\"portability\",\"fixture\",1]"}}
```

Both commands printed the same retained locator,
`mdh1|["portability","portability","fixture",1]`, within their own isolated
consumers. The pnpm 12 command used the runner's default freshly downloaded
manager path; this run does not explain or invalidate the
[earlier host policy rejection](https://github.com/mike-north/microdelta/issues/157#issuecomment-6372556465)
at a different Node 24.22.1 setup. The previous clean macOS run using an
existing verified `PNPM12_BIN` is preserved in its
[report](https://github.com/mike-north/microdelta/blob/ee66046cf1ea8e6694ab0fe81ff272c15da0cbd2/scratch/gap-hunt/contract-operations/PNPM157-CLEAN-FALLBACK.md).

## Linux arm64 Node 24 control

The local Docker daemon reported Linux/aarch64, server 29.6.1. Its cached
official `node:24-bookworm` image had image ID and repository digest
`sha256:5a593d74b632d1c6f816457477b6819760e13624455d587eef0fa418c8d0777b`.
The disposable container reported Linux aarch64, Node 24.14.0 and npm 11.9.0;
Python 3, `make` and `g++` were present. No privileged flag, host mount,
remote shell or global trust edit was used; the unapproved negative controls
showed that no inherited approval for `better-sqlite3` affected this run.
The exact committed fixture at `c3c0409a4e10dac2765bda10015bf286a20624e0`
was streamed as a Git archive, verified inside the container against its
SHA-256 above, then run with no version argument:

```sh
set -o pipefail
git archive --format=tar c3c0409a4e10dac2765bda10015bf286a20624e0 scratch/gap-hunt/contract-operations/verify-157.sh | docker run --rm -i --platform linux/arm64 --workdir /work node:24-bookworm bash -lc 'set -euo pipefail; tar -xf -; printf "container node=%s npm=%s platform=%s arch=%s\n" "$(node --version)" "$(npm --version)" "$(uname -s)" "$(uname -m)"; printf "b2becb9113b7ee62a2d984612000ce5c52299ec114eedece4de35eb370e7cfc7  scratch/gap-hunt/contract-operations/verify-157.sh\n" | sha256sum -c -; bash -x scratch/gap-hunt/contract-operations/verify-157.sh'
```

The pipeline and both pnpm versions exited 0. pnpm 10.34.7 showed the
ignored-build warning after an exit-0 install; pnpm 12.10.1 rejected its
unapproved install with `ERR_PNPM_IGNORED_BUILDS`. In both isolated consumers,
durable open without approval failed for the missing binding, public memory
smoke passed, and local `allowBuilds` plus rebuild led to cold **1/published**
then independent restart **0/reused** with identical exact references. The
[full shell trace](pnpm-native-linux-node24-2026-10-23.log) has SHA-256
`7ea8e18d3c39ac08232adc523fffffb0bdba8bc8ecda16318bc144f0f6b621ca`.

This is Linux arm64 evidence for both pnpm versions on Node 24.14.0 only.
The earlier owner-supplied Linux Node 24/26 native/full-suite results used npm
and remain separate. This run does not establish pnpm approval on other Linux
architectures or Node 26, Linux cross-version same-store reuse, or a universal
native-driver support policy.
