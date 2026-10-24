#!/usr/bin/env python3
"""Bounded TEST-6 supplement: pinned source, fresh captures, exact restoration."""
import hashlib, json, os, pathlib, re, subprocess, sys, tempfile
ROOT = pathlib.Path(__file__).resolve().parents[3]
HERE = pathlib.Path(__file__).resolve().parent
SOURCE = 'e59c64d0e1c607b5a4a8ae1fa124b1be5cdc2573'
EXPECTED = {'matrix': (1, 0), 'counterfactual-oracle': (0, 1), 'restored-oracle': (1, 0), 'restored-matrix': (1, 0)}
MATRIX = 'TEST-6: CPU memo and cheap leaves with CPU aggregate preserve selected-work boundaries across restart'
ORACLE = 'unchanged cost oracle rejects legitimate extra aggregate execution'
def git(*args):
    return subprocess.check_output(['git', '-c', 'core.fsmonitor=false', *args], cwd=ROOT, timeout=30)
def preflight():
    assert not git('diff', '--name-only', 'HEAD').strip(), 'tracked checkout must start clean'
    names = git('ls-tree', '-r', '--name-only', SOURCE).decode().splitlines()
    for name in names:
        assert (ROOT / name).read_bytes() == git('show', SOURCE + ':' + name), 'runtime source differs: ' + name
    extras = git('ls-files', '--others', '--exclude-standard', 'packages', 'tooling').decode().splitlines()
    assert not extras, 'untracked production inputs: ' + repr(extras)
    return len(names)
def guard(name, log, data):
    passed, failed = EXPECTED[name]
    assert not re.search(r'Test suite failed to run|Cannot find module|SyntaxError:|ReferenceError:', log), name
    assert (data['numPassedTests'], data['numFailedTests'], data['numPendingTests'], data['numTotalTests']) == (passed, failed, 1, 2), name
    assert (data['numRuntimeErrorTestSuites'], data['numTotalTestSuites'], data['numFailedTestSuites']) == (0, 1, failed), name
    assertions = [a for suite in data['testResults'] for a in suite['assertionResults']]
    statuses = {a['fullName']: a['status'] for a in assertions}
    assert len(assertions) == 2
    assert statuses == {MATRIX: 'pending' if 'oracle' in name else 'passed', ORACLE: ('failed' if failed else 'passed') if 'oracle' in name else 'pending'}, statuses
if len(sys.argv) > 1 and sys.argv[1] == '--check-logs':
    directory = pathlib.Path(sys.argv[2])
    for name in EXPECTED:
        guard(name, (directory / (name + '.log')).read_text(), json.loads((directory / (name + '.json')).read_text()))
    print(json.dumps({'status': 'PASS', 'exactInventories': len(EXPECTED)})); sys.exit(0)
source_files = preflight()
proof_head = git('rev-parse', 'HEAD').decode().strip()
# Output is always a new directory; committed historical captures are never overwritten.
OUT = pathlib.Path(tempfile.mkdtemp(prefix='microdelta-cost-replay-'))
print('Evidence output: ' + str(OUT), flush=True)
records = []
restoration = None
def receipt():
    (OUT / 'receipt.json').write_text(json.dumps({'runtimeSource': SOURCE, 'proofHead': proof_head, 'preflightSourceFiles': source_files, 'output': str(OUT), 'commandTimeoutSeconds': 900, 'workerTimeoutMs': 30000, 'inheritedOracleEnvironmentCleared': True, 'commands': records, 'restoration': restoration}, indent=2) + '\n')
def command(name, args, expected=0, oracle=None):
    environment = dict(os.environ)
    environment.pop('COST_ORACLE_STORE', None); environment.pop('COST_BASELINE', None)
    if oracle is not None: environment.update(oracle)
    result = subprocess.run(args, cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=environment, timeout=900)
    (OUT / (name + '.log')).write_text(result.stdout)
    records.append({'name': name, 'command': args, 'expected': expected, 'exit': result.returncode})
    receipt()
    if result.returncode != expected: raise RuntimeError(f'{name}: expected {expected}, saw {result.returncode}; see log')
    if name in EXPECTED: guard(name, result.stdout, json.loads((OUT / (name + '.json')).read_text()))
    print(name + ': ' + str(result.returncode), flush=True)
    return result.stdout
def jest(name, expected=0, oracle=None):
    return command(name, ['node', '--experimental-vm-modules', 'node_modules/jest/bin/jest.js', '--config', 'scratch/gap-hunt/cost-neutrality/jest.config.mjs', '--runInBand', '--json', '--outputFile', str(OUT / (name + '.json'))], expected, oracle)
TSC = ['node_modules/.bin/tsc', '-p', 'scratch/gap-hunt/cost-neutrality/tsconfig.json']
command('install', ['npm', 'ci'])
command('build', ['npm', 'run', 'build:packages'])
command('types', TSC)
command('lint', ['node_modules/.bin/eslint', '-c', 'scratch/gap-hunt/cost-neutrality/eslint.config.mjs', 'scratch/gap-hunt/cost-neutrality/worker.ts'])
jest('matrix')
store = tempfile.mkdtemp(prefix='microdelta-cost-negative-')
cold = command('negative-cold', ['node', 'scratch/gap-hunt/cost-neutrality/dist/worker.js', store, 'a'])
baseline = json.loads(next(line for line in cold.splitlines() if line.startswith('{')))
(OUT / 'baseline.json').write_text(json.dumps(baseline, indent=2) + '\n')
worker = HERE / 'worker.ts'
original = worker.read_bytes()
needle = b'total += a + b;'
assert original.count(needle) == 1
emitted = HERE / 'dist/worker.js'
original_emitted = emitted.read_bytes()
primary = None
restoration_errors = []
oracle = {'COST_ORACLE_STORE': store, 'COST_BASELINE': str(OUT / 'baseline.json')}
try:
    worker.write_bytes(original.replace(needle, b'total += b + a;'))
    command('counterfactual-types', TSC)
    negative = jest('counterfactual-oracle', 1, oracle)
    matched = re.search(r'(\{"counterfactual":.*\})', negative)
    assert matched is not None
    row = json.loads(matched.group(1))['counterfactual']
    assert row['counts'] == dict(a=0, b=0, aggregate=1, cpu=0, aggregateIterations=100000, cpuIterations=0)
    assert row['results']['aggregate']['data'] == baseline['results']['aggregate']['data']
    assert row['results']['aggregate']['reference'] != baseline['results']['aggregate']['reference']
    for slot in ['a', 'b', 'cpu']:
        assert row['results'][slot]['reference'] == baseline['results'][slot]['reference']
except BaseException as error:
    primary = error
finally:
    worker.write_bytes(original)
    try:
        command('restored-types', TSC)
        assert emitted.read_bytes() == original_emitted
        jest('restored-oracle', 0, oracle)
        jest('restored-matrix')
    except BaseException as error:
        restoration_errors.append(str(error))
    restoration = {'exactSourceRestored': worker.read_bytes() == original, 'exactEmittedWorkerRestored': emitted.read_bytes() == original_emitted, 'sourceSha256': hashlib.sha256(original).hexdigest(), 'negativeStore': store, 'primaryError': str(primary) if primary else None, 'restorationErrors': restoration_errors}
    (OUT / 'restoration.json').write_text(json.dumps(restoration, indent=2) + '\n')
    receipt()
if primary is not None: raise primary
if restoration_errors: raise RuntimeError('; '.join(restoration_errors))
