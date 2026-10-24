The manual sibling-consumer recipe references `alpha-import-only.ts` in its
`files` array but never creates or copies that file. The checked-in fixture
commands are complete; a new empty `parent/consumer` following the manual
JSON/package-link/runtime-probe steps gets `TS6053: File .../alpha-import-only.ts
not found` before checking any alpha declaration closure.

At exact `f4211e3`, a literal sibling probe without synthesized TS input exits2
with TS6053. Adding this explicit step from `consumer/` makes the same compiler
and runtime commands exit0:

```sh
cp ../microdelta/fixtures/declarations/consumer-alpha/alpha-import-only.ts .
```

Please document creation/copying of that input (or show its complete contents)
before the manual compiler command. This closes the remaining #154 AC1/AC5
setup-completeness gap. All bounded import-closure, generated/public boundary,
checked-in fixture and runtime controls otherwise passed. No runtime product
change or public-alpha exposure is requested.
