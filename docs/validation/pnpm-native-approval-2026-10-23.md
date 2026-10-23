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

**Linux pnpm 10/12 acceptance remains unexecuted.** Owner-supplied Linux
native installation/full-suite results used npm; they do not establish this
package-manager approval behavior. The same fixture must run on a fresh Linux
Node 24 environment before claiming Linux parity. Neither macOS control
proves a Node 26 or universal native-driver support policy.
