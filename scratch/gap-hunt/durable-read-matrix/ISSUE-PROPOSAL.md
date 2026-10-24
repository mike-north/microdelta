# Provide an own-presence operation to default workspace authors

Status: local unfiled proposal for supervisor review; needs confirmation of the intended alpha capability boundary.

TRK-5 requires own-property observation, including missing versus own undefined and exclusion of inherited existence, values and siblings. The default workspace's authoring callbacks expose tracked inputs/helpers/untracked, but the inspected alpha surface provides no access to the owning observer's explicit `hasOwn` operation. Native `Object.hasOwn` intentionally rejects on these views. Tracking itself supports the operation, and lower-level assembly can inject its own observer; this is a default-authoring access seam.

A clean frozen7a reproduction passes length/position/optional-value/tracked-view closure controls with actual body counters and exact durable references. Its own-presence control fails on cold missing input with `Native reflection is unsupported; use observer.hasOwn for supported fields`. Exact API/source evidence and read-only issue search are attached in the evidence prefix. Closed #26/#29 describe owner/lint mechanisms and closed #162 repairs intrinsic property names; none of the searched open issues covered this default-facade capability route.

Required outcome, subject to selected alpha scope: expose an intentional owning capability to observe own presence without giving authors another observer or consuming value/sibling/whole output data. Demonstrate missing→own undefined causes one body and a new exact reference, a later own value-only edit causes zero bodies with the same reference, and own absent→inherited present stays own-absent. Preserve ordinary membership semantics separately. A conservative explicit scope decision is acceptable if the full target remains documented and tracked separately; do not silently count owner-only tests as default authoring coverage.

The implementation spelling is not selected by this report. No product fix is proposed or executed here.
