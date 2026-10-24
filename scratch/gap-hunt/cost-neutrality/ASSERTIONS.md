# TEST-6 finite cost-placement assertions

Written before the worker. Owning clauses: TEST-6, DOM-1; preserved controls REUSE-005, COL-4.

Two cheap memo leaves return score and note; a CPU aggregate consumes scores only. A separate CPU memo consumes its own seed. Each CPU body performs exactly 100000 additions of its consumed seed, returning the total; the independent oracle uses multiplication. No elapsed-time threshold.

Fresh processes over one SQLite store:
- A: leaves A/B once; aggregate and CPU once (100000 iterations each); totals 500000 and 700000.
- B unchanged: zero bodies/iterations; all exact references retained.
- C note A changes: only leaf A executes; both expensive exact references retained.
- D score A changes 2 to 4: only leaf A and aggregate execute; aggregate total 700000; CPU exact reference retained.
- E CPU seed changes 7 to 11: only CPU executes; total 1100000; aggregate exact reference retained.

A separately compiled alternate aggregate helper changes tracked implementation with equal output. Its legitimate recomputation must fail the unchanged-work oracle. Restore exact source, rebuild, and the unchanged oracle passes again. This is an oracle counterfactual, not a product defect.

No provider, scale, timing, Linux, universal cached-local-derivation or whole-spec claims.
