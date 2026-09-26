> Historical artifact. Superseded by the [active specification](../../../spec/README.md). Do not implement from this document.

# Observed tokens do not necessarily determine monetary cost

**Source:** user-provided scenario, 2026-09-15. This is an accounting design case,
not a verified claim about a particular provider's current response schema or
pricing. Values below are illustrative.

An LLM response reports input and output token counts but omits how many input
tokens were served from the provider's prompt cache. The provider charges a
lower rate for cached input. Multiplying all reported input tokens by the normal
input rate can therefore substantially overstate actual cost, even though the
observed token counts are correct.

For example, a response reports 100,000 input tokens and 1,000 output tokens.
The observed quantities can be recorded and summed as reported. The cached-input
count remains unknown; it must not silently become zero. Without the billing
breakdown, a derived currency amount is an estimate, not observed spend.

## Expected behavior

- Preserve reported input/output quantities independently of any conversion to
  currency. A missing billing dimension does not invalidate those observations.
- If an adapter provides an estimate, label it as estimated and retain the
  relevant assumptions, such as treating all input tokens as uncached. Do not
  aggregate estimated dollars into an observed-dollar total without distinction.
- Leave the monetary value unavailable when no supported calculation is offered;
  the system need not infer a price or query a billing API to fill the gap.
- An uncached-price calculation is not universally a guaranteed upper bound.
  Such a bound requires additional assumptions about all applicable rates and
  charges; the example alone does not establish them.
- Distinguish provider prompt caching from microdelta memoized-result reuse. These
  affect different quantities and must not be conflated in reports.

## Future acceptance case

Supply a response with input/output counts and no cached-input count. Assert that
the observed token totals remain exact with respect to that response, cached
input is unknown, and any conversion using the normal input rate is visibly an
estimate. No provider accounting lookup is required. This is a future test
scenario, not an implemented adapter or passing-test claim.
