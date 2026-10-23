#!/usr/bin/env python3
"""Reproduce the bounded privacy failure; exit zero only for its exact current oracle."""
import json
import pathlib
import subprocess
import tempfile

root = pathlib.Path(__file__).resolve().parents[3]
commands = [
    ['npm', 'ci', '--no-audit', '--no-fund'],
    ['npm', 'run', 'build:packages'],
    ['node_modules/.bin/tsc', '-p', 'packages/core/tsconfig.test.json'],
    ['node_modules/.bin/eslint', 'packages/core/test/gap-hunt-error-privacy.test.ts'],
]
receipt = {'source': '2a640aca75d5728484a2cb06af88c77690616ba9', 'commands': []}
for command in commands:
    result = subprocess.run(command, cwd=root, capture_output=True, text=True)
    receipt['commands'].append({'argv': command, 'exit': result.returncode})
    if result.returncode:
        print(result.stdout.replace(str(root), '<checkout>'))
        print(result.stderr.replace(str(root), '<checkout>'))
        raise SystemExit(result.returncode)
with tempfile.TemporaryDirectory(prefix='microdelta-privacy-results-') as temporary:
    output = pathlib.Path(temporary) / 'jest.json'
    command = ['node', '--experimental-vm-modules', 'node_modules/jest/bin/jest.js', '--config', 'packages/core/jest.config.mjs', '--runInBand', '--runTestsByPath', 'packages/core/.test-build/test/gap-hunt-error-privacy.test.js', '--json', '--outputFile', str(output)]
    result = subprocess.run(command, cwd=root, capture_output=True, text=True)
    data = json.loads(output.read_text())
    tests = [test for suite in data['testResults'] for test in suite['assertionResults']]
    failed = [test['fullName'] for test in tests if test['status'] == 'failed']
    receipt.update({'jestExit': result.returncode, 'passed': data['numPassedTests'], 'failed': failed, 'runtimeErrorSuites': data['numRuntimeErrorTestSuites']})
    receipt['observations'] = [json.loads(line.split('author-error-observation ', 1)[1]) for line in result.stdout.splitlines() if 'author-error-observation {' in line]
    assert result.returncode == 1 and data['numPassedTests'] == 8 and data['numFailedTests'] == 1
    assert failed == ['author-resolution-error: author text stays in cause rather than the framework failure message']
    assert data['numRuntimeErrorTestSuites'] == 0
    assert len(receipt['observations']) == 2
print(json.dumps(receipt, indent=2))
