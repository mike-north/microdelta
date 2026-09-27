# EXP-5 historical record: bounded CML/API correspondence

This experiment was run on 2026-09-26 and merged in [PR #21](https://github.com/mike-north/microdelta/pull/21),
at commit `b4e7b67b54990ef8b50e0603c7e83ba001613c9b`. The original runnable
fixture and its detailed evidence are retained in that Git history; this file is
the durable summary after the runnable source was retired by the 2026-09-27
formal-policy decision recorded in issue #36.

The experiment successfully exercised a bounded mapping of two explicit
contexts to package entrypoints, selected entities/services to exported classes,
and named operations to methods. The official parser, TypeScript compiler,
API Extractor model and mutation controls found missing mapped declarations,
wrong package identity and wrong reference ownership. The fixture reported
unsupported TypeScript/CML categories explicitly. Its scope did not establish
general architecture correspondence, semantic equivalence, or a need for a
parallel CML model. The experiment also exposed clean-checkout build ordering:
lint required generated fixture declarations, which were added to the normal
build at that time and are now removed along with the retired fixture.

The retirement preserves the result as historical evidence without making its
model, parser bridge, checker, or Java/Gradle setup an active implementation or
CI requirement. The current package contract is PKG-006 in
[`package-boundaries.md`](../../spec/package-boundaries.md).
