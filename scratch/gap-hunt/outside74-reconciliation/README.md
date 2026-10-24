# Frozen outside74 evidence

Read [REPORT.md](REPORT.md) for the58 DX and16 operational-row decisions.

Run from a fresh Node24 checkout:

```sh
python3 scratch/gap-hunt/outside74-reconciliation/replay.py
```

The final recipe includes the fixture build missing from the initial stage.
[receipt.json](captures/receipt.json) and [completion-receipt.json](captures/completion-receipt.json) preserve the exact actual two-stage execution and source hashes; this revised full sequence was not rerun.

[reconciliation.json](reconciliation.json) preserves each paragraph/requirement row and bounds its evidence. [runtime-assertion-index.json](captures/runtime-assertion-index.json) binds all270 successful runtime cases to229 parser-derived assertion declarations and source links. The75 carried lexical anchors are separate prior execution qualifications, not extra current cases. Historical74 and lexical294 inventories remain unchanged.

`complete-selected.py` is the captured local recovery-stage script, retained for transparency with its original output-directory literal normalized; the clean-checkout recipe is `replay.py`. Captures normalize checkout, Node executable, and temporary paths. See manifest.json for SHA256 of all other artifact files.
