#!/usr/bin/env python3
"""Reproduce bounded writer-stop evidence; exit 0 means the expected controls match."""
from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path

BASE = "f43c5872987573d9b98a19f41c324b4d9336894c"
EVIDENCE = "scratch/gap-hunt/writer-stop/"
TEST = "packages/core/test/operations/boundaries.test.ts"
TEST_SHA = "2942413cfe9bda4fe094199ad37ddf58c171afbb6bdfbc022f7635797c08eec1"
NAME = "writer reacquisition after durable deferral"
CASE = NAME + " respects hard stop true without changing the competing holder (RUN-014, RUN-015)"
ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / EVIDENCE / "local-results"


def git(*args: str) -> bytes:
    """Read repository state without contacting a remote."""
    return subprocess.check_output(["git", "-c", "core.fsmonitor=false", *args], cwd=ROOT)


def allowed(path: str) -> bool:
    """Only this exact test and its synthetic evidence may differ from the pin."""
    return path == TEST or path.startswith(EVIDENCE)


def guard() -> None:
    """Permit evidence-only HEAD commits while rejecting any production or tooling drift."""
    for args in [("diff", "--name-only", "-z", BASE, "HEAD"),
                 ("diff", "--name-only", "-z", "HEAD"),
                 ("ls-files", "--others", "--exclude-standard", "-z")]:
        paths = git(*args).decode().split("\0")
        rejected = [path for path in paths if path and not allowed(path)]
        if rejected:
            raise RuntimeError(f"Unqualified files outside test/evidence scope: {rejected}")
    if hashlib.sha256((ROOT / TEST).read_bytes()).hexdigest() != TEST_SHA:
        raise RuntimeError("The test bytes differ from the qualified overlay")


def run(label: str, command: list[str], cwd: Path = ROOT, expected: int = 0) -> None:
    """Preserve command output in ignored local results, never captured evidence."""
    with (OUT / f"{label}.log").open("w") as log:
        result = subprocess.run(command, cwd=cwd, stdout=log, stderr=subprocess.STDOUT)
    if result.returncode != expected:
        raise RuntimeError(f"{label}: exit {result.returncode}, expected {expected}; see {OUT}")


def check_jest(label: str, passed: int, failed: int, skipped: int) -> dict[str, object]:
    """Require exact counts and the intended negative identity, not merely a nonzero exit."""
    report = json.loads((OUT / f"{label}.json").read_text())
    counts = {key: report[key] for key in ("numPassedTests", "numFailedTests", "numPendingTests", "numRuntimeErrorTestSuites")}
    expected = dict(zip(counts, (passed, failed, skipped, 0)))
    if counts != expected or report["success"] != (failed == 0):
        raise RuntimeError(f"{label}: unexpected Jest result {counts}")
    if failed:
        failures = [test for suite in report["testResults"] for test in suite["assertionResults"] if test["status"] == "failed"]
        if len(failures) != 1 or failures[0]["title"] != CASE:
            raise RuntimeError("The negative control failed a different test")
        messages = "\n".join(failures[0]["failureMessages"])
        if "boundaries.test.ts:201:33" not in messages or "1767229201000" not in messages:
            raise RuntimeError("The negative control did not detect the retained writer-poll timer")
    return counts


def main() -> None:
    guard()
    OUT.mkdir(parents=True, exist_ok=True)
    run("install", ["npm", "ci", "--no-audit", "--no-fund"])
    run("build", ["npm", "run", "build:packages"])
    run("check", ["npm", "run", "check", "--workspace", "microdelta"])
    run("positive", ["npm", "run", "test:unit", "--workspace", "microdelta", "--", "--testPathPatterns", "operations/boundaries.test", "--testNamePattern", NAME, "--json", "--outputFile", str(OUT / "positive.json")])
    positive = check_jest("positive", 2, 0, 30)
    writer = ROOT / "packages/supervision/dist/src/writer.js"
    original = writer.read_bytes()
    needle = b"            cancel();\n            reject(stopped());"
    if original.count(needle) != 1:
        raise RuntimeError("The emitted writer no longer matches the qualified fault point")
    try:
        writer.write_bytes(original.replace(needle, b"            // Negative control: retain the writer-poll timer.\n            reject(stopped());"))
        run("negative", ["node", "--experimental-vm-modules", "../../node_modules/jest/bin/jest.js", "--config", "jest.config.mjs", "--runInBand", "--testPathPatterns", "operations/boundaries.test", "--testNamePattern", NAME, "--json", "--outputFile", str(OUT / "negative.json")], ROOT / "packages/core", expected=1)
        negative = check_jest("negative", 1, 1, 30)
    finally:
        # Restore the actual bytes read from this checkout, even if the control fails.
        writer.write_bytes(original)
    if writer.read_bytes() != original:
        raise RuntimeError("Emitted writer restoration failed")
    run("restored", ["npm", "run", "test:unit", "--workspace", "microdelta", "--", "--testPathPatterns", "operations/boundaries.test", "--testNamePattern", NAME, "--json", "--outputFile", str(OUT / "restored.json")])
    restored = check_jest("restored", 2, 0, 30)
    run("boundaries", ["npm", "run", "test:unit", "--workspace", "microdelta", "--", "--testPathPatterns", "operations/boundaries.test", "--json", "--outputFile", str(OUT / "boundaries.json")])
    boundaries = check_jest("boundaries", 32, 0, 0)
    guard()
    summary = {"baseline": BASE, "head": git("rev-parse", "HEAD").decode().strip(), "testSha256": TEST_SHA, "emittedWriterRestoredSha256": hashlib.sha256(original).hexdigest(), "positive": positive, "negative": negative, "restored": restored, "boundaries": boundaries}
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
