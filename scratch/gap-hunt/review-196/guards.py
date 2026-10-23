"""Pure captured-log guards; no product execution or fixture mutation."""
import hashlib
import json
import pathlib
import re

CASES = (
    'prepublished roster, gate and stopped-report controls',
    'fixed active window does not allocate one pending lane wait per unadmitted member',
)
# passed, failed, total for suites and tests. No skipped/todo/obsolete rows accepted.
EXPECTED = {
    'current': ((1, 0, 1), (2, 0, 2)),
    'supervision': ((5, 0, 5), (197, 0, 197)),
    'facade': ((10, 0, 10), (103, 0, 103)),
    'frozen-original': ((0, 1, 1), (1, 1, 2)),
    'precise-original': ((1, 0, 1), (2, 0, 2)),
    'negative': ((0, 1, 1), (0, 2, 2)),
    'negative-precise-original': ((0, 1, 1), (1, 1, 2)),
    'restored': ((1, 0, 1), (2, 0, 2)),
}
RUNTIME = re.compile(
    r'Test suite failed to run|Jest encountered|(?:A jest|Jest) worker|'
    r'Cannot find (?:module|package)|(?:^|\n)\s*Error\s*:|(?:Syntax|Reference|Type|Range|URI|Eval)Error\s*:|'
    r'\bERR_[A-Z_]+\b|MODULE_NOT_FOUND|UnhandledPromiseRejection|'
    r'uncaughtException|Exceeded timeout|timed out|worker[^\n]*(?:killed|exited)|'
    r'test suite[^\n]*failed to run', re.IGNORECASE)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def counts(output, label):
    lines = re.findall(r'^' + re.escape(label) + r':\s*(.+)$', output, re.MULTILINE)
    require(len(lines) == 1, label + ' needs exactly one summary')
    terms = re.fullmatch(r'(?:(\d+) failed, )?(?:(\d+) passed, )?(\d+) total', lines[0])
    require(terms is not None, label + ' summary contains unsupported/missing counts')
    return int(terms[2] or 0), int(terms[1] or 0), int(terms[3])


def validate(name, output):
    """Reject missing/incomplete suites and accept only the named semantic reds."""
    require(RUNTIME.search(output) is None, name + ': runtime/load diagnostic')
    if name not in EXPECTED:
        return
    suites, tests = EXPECTED[name]
    require(counts(output, 'Test Suites') == suites, name + ': suite counts')
    require(counts(output, 'Tests') == tests, name + ': test counts')
    actual = tuple(re.findall(r'^\s+● (.+)$', output, re.MULTILINE))
    expected = {'frozen-original': (CASES[0],), 'negative': CASES,
                'negative-precise-original': (CASES[1],)}.get(name, ())
    require(actual == expected, name + ': unexpected failed case names')
    suite_paths = re.findall(r'^FAIL (.+)$', output, re.MULTILINE)
    require(suite_paths == (['scratch/gap-hunt/scale/fanout-admission.test.mjs'] if expected else []),
            name + ': unexpected failed suite path')
    if name == 'frozen-original':
        require('expect(received).toBe(expected) // Object.is equality' in output,
                'original raw failure must be equality, not load/runtime')
        require(re.search(r'Expected: 16\n\s+Received: 8\n', output), 'original raw numeric observation')
    if name == 'negative':
        blocks = re.split(r'^\s+● ', output, flags=re.MULTILINE)[1:]
        require(len(blocks) == 2, 'negative semantic failure blocks')
        require('expect(received).toBeLessThanOrEqual(expected)' in blocks[0] and
                re.search(r'Expected: <= 8\n\s+Received:\s+92\n', blocks[0]),
                'negative bounded wait failure must report 92 > 8')
        require('expect(received).toEqual(expected) // deep equality' in blocks[1] and
                re.search(r'\+\s+92,\n\s+\+\s+992,', blocks[1]),
                'negative population failure must report [92, 992]')
    if name == 'negative-precise-original':
        require('expect(received).toBeLessThanOrEqual(expected)' in output and
                re.search(r'Expected: <= 8\n\s+Received:\s+900\n', output),
                'unchanged original growth failure must report 900 > 8')


def guard_only(here, out):
    """Check published captures, then prove missing/load/wrong-count/name rejects."""
    before = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (here / 'results').iterdir() if p.is_file()}
    receipt = json.loads((here / 'results/receipt.json').read_text())
    expected_order = ['install', 'check', 'current', 'supervision', 'core-compile', 'facade',
                      'frozen-original', 'precise-original', 'negative-build', 'negative',
                      'negative-precise-original', 'restoration-build', 'restored',
                      'live-delta-check', 'live-delta-types']
    require([c['name'] for c in receipt['commands']] == expected_order, 'command catalog')
    require([c['exit'] for c in receipt['commands']] == [0,0,0,0,0,0,1,0,0,1,1,0,0,0,0], 'expected exits')
    logs = {}
    for row in receipt['commands']:
        path = here / 'results' / (row['name'] + '.log')
        data = path.read_bytes()
        require(hashlib.sha256(data).hexdigest() == row['logSha256'], row['name'] + ': capture hash')
        logs[row['name']] = data.decode()
        validate(row['name'], logs[row['name']])
    rejects = []
    def rejects_case(name, label, changed):
        try:
            validate(name, changed)
        except ValueError as error:
            rejects.append({'step': name, 'mutation': label, 'reason': str(error)})
        else:
            raise ValueError(name + ': guard accepted synthetic ' + label)
    for name in EXPECTED:
        text = logs[name]
        rejects_case(name, 'missing-log', '')
        rejects_case(name, 'load-error-with-valid-counts', text + '\nTest suite failed to run\nCannot find module fixture\n')
        rejects_case(name, 'wrong-test-count', re.sub(r'^(Tests:\s*).+$', r'\g<1>999 passed, 999 total', text, flags=re.MULTILINE))
        rejects_case(name, 'wrong-suite-count', re.sub(r'^(Test Suites:\s*).+$', r'\g<1>999 passed, 999 total', text, flags=re.MULTILINE))
    for name in ('frozen-original', 'negative', 'negative-precise-original'):
        text = logs[name]
        rejects_case(name, 'wrong-failed-case', re.sub(r'^(\s+● ).+$', r'\g<1>unrelated failure', text, count=1, flags=re.MULTILINE))
        rejects_case(name, 'wrong-semantic-matcher', text.replace('expect(received).', 'wrong(received).'))
    after = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (here / 'results').iterdir() if p.is_file()}
    require(before == after, 'guard-only changed committed captures')
    result = {'capturedRecipe': 'f348f72465a7b74189fd51d69cffaa43c745df25',
              'runtimeRepeated': False, 'capturedCommandsAccepted': len(receipt['commands']),
              'jestStepsAccepted': len(EXPECTED), 'syntheticRejects': rejects,
              'output': '<evidence-output>', 'committedCapturesModified': False}
    (out / 'guard-receipt.json').write_text(json.dumps(result, indent=2) + '\n')
    return result
