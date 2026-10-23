#!/usr/bin/env python3
"""Verify pinned production identity and execute the published bounded proofs."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

PIN = 'f43c5872987573d9b98a19f41c324b4d9336894c'
ROOT = Path(__file__).resolve().parents[3]
PACKAGE = ROOT / 'scratch/gap-hunt/criterion-proof'
RESULTS = Path(tempfile.mkdtemp(prefix='microdelta-criterion-proof-'))
OVERLAYS = frozenset([
    'packages/core/test/operations/criterion-boundaries.test.ts',
    'packages/core/test/observation-followup/source-policies.test.ts',
    'scratch/gap-hunt/observation-followup/tsconfig.json',
    'scratch/gap-hunt/observation-followup/jest.config.mjs',
])


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()


def clean():
    return not git('status', '--porcelain', '--untracked-files=no')


def run(label, argv):
    print(label, flush=True)
    with (RESULTS / f'{label}.log').open('w') as output:
        output.write(json.dumps(argv) + '\n')
        output.flush()
        result = subprocess.run(argv, cwd=ROOT, stdout=output, stderr=subprocess.STDOUT)
    if result.returncode:
        raise SystemExit(f'{label} failed ({result.returncode}); see {RESULTS}')


print(f'Fresh results: {RESULTS}', flush=True)
if not clean():
    raise SystemExit('Tracked tree must be clean before running')
subprocess.run(['git', 'merge-base', '--is-ancestor', PIN, 'HEAD'], cwd=ROOT, check=True)
changed = git('diff', '--name-only', PIN, 'HEAD').splitlines()
for relative in changed:
    if relative not in OVERLAYS and not relative.startswith('scratch/gap-hunt/criterion-proof/'):
        raise SystemExit('Production or unapproved path differs from baseline: ' + relative)
manifest = json.loads((PACKAGE / 'overlay-sha256.json').read_text())
if frozenset(manifest) != OVERLAYS:
    raise SystemExit('Unexpected test overlay manifest paths')
for relative, expected in manifest.items():
    actual = hashlib.sha256((ROOT / relative).read_bytes()).hexdigest()
    if actual != expected:
        raise SystemExit('Overlay byte mismatch: ' + relative)
commands = [
    ('install', ['npm', 'ci', '--no-audit', '--no-fund']),
    ('build', ['npm', 'run', 'build:packages']),
    ('core-types', ['npx', 'tsc', '-p', 'packages/core/tsconfig.test.json']),
    ('alpha-types', ['npx', 'tsc', '-p', 'scratch/gap-hunt/observation-followup/tsconfig.json']),
    ('criterion-tests', ['node', '--experimental-vm-modules', 'node_modules/jest/bin/jest.js', '--config', 'packages/core/jest.config.mjs', '--runInBand', '--runTestsByPath', 'packages/core/.test-build/test/operations/criterion-boundaries.test.js']),
    ('observation-tests', ['node', '--experimental-vm-modules', 'node_modules/jest/bin/jest.js', '--config', 'scratch/gap-hunt/observation-followup/jest.config.mjs', '--runInBand']),
    ('existing-provenance-tests', ['node', '--experimental-vm-modules', 'node_modules/jest/bin/jest.js', '--config', 'packages/core/jest.config.mjs', '--runInBand', '--runTestsByPath', 'packages/core/.test-build/test/acceptance/source-policy.test.js', 'packages/core/.test-build/test/resolution/summary-validation.test.js', '--testNamePattern', 'a false current answer enters the check|fresh equal data twice yields|a fresh source changing only unread fields']),
    ('lint', ['npx', 'eslint', 'packages/core/test/operations/criterion-boundaries.test.ts', 'packages/core/test/observation-followup']),
]
actual_counts = {}
expected_counts = {'criterion-tests': 2, 'observation-tests': 2, 'existing-provenance-tests': 3}
for label, argv in commands:
    if label in expected_counts:
        argv += ['--json', '--outputFile', str(RESULTS / f'{label}.json')]
    run(label, argv)
    if label in expected_counts:
        report = json.loads((RESULTS / f'{label}.json').read_text())
        actual_counts[label] = report['numPassedTests']
        if (not report['success'] or report['numFailedTests'] != 0
                or report['numPassedTests'] != expected_counts[label]):
            raise SystemExit(f'{label}: unexpected actual counts; see {RESULTS}')
if not clean():
    raise SystemExit('Tracked source changed while running')
summary = {'production_baseline': PIN, 'evidence_head': git('rev-parse', 'HEAD'),
           'baseline_diff_paths': changed, 'overlay_sha256': manifest, 'commands': commands,
           'actual_passed_tests': actual_counts, 'tracked_clean_before_and_after': True,
           'node': subprocess.check_output(['node', '--version'], text=True).strip()}
(RESULTS / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
print(f'PASS: actual test counts {actual_counts}; tracked tree clean; results {RESULTS}', flush=True)
