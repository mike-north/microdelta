"""Keep SQL-work controls tied to a captured listing even when its result ID changes.

The production capture currently happens to use result ID 1. This test changes
only that persisted identity and its query bindings; every subtree row and the
predeclared work criterion must still qualify, including the negative controls.
"""
from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
import json
import subprocess
import sys


HERE = Path(__file__).resolve().parent


def remap_case(case):
    """Give the one captured listing a different result identity in rows and bindings."""
    result_ids = {row['result_id'] for table in ('history_nodes', 'history_edges') for row in case['tables'][table]}
    if len(result_ids) != 1:
        raise AssertionError(f'Expected exactly one captured listing result: {result_ids}')
    old_id = result_ids.pop()
    new_id = old_id + 1000
    for table in ('history_nodes', 'history_edges'):
        for row in case['tables'][table]:
            row['result_id'] = new_id
    by_role = {statement['role']: statement for statement in case['statements']}
    payload = by_role['subtree-payload']
    if len(payload['values']) != 4 or payload['values'][1:] != [old_id] * 3:
        raise AssertionError('Unexpected captured subtree payload result bindings')
    payload['values'][1:] = [new_id] * 3
    structure = by_role['subtree-structure']
    if len(structure['values']) != 2 or structure['values'][0] != old_id:
        raise AssertionError('Unexpected captured subtree structure result binding')
    structure['values'][0] = new_id
    return new_id


def main():
    """Run the real SQL-work gate on a remapped copy and require all controls."""
    source = json.loads(Path(sys.argv[1]).read_text())
    capture = deepcopy(source)
    remapped_ids = [remap_case(case) for case in capture['captures']]
    if not remapped_ids or any(result_id == 1 for result_id in remapped_ids):
        raise AssertionError('The test did not move every listing off result ID 1')
    with TemporaryDirectory(prefix='microdelta-subtree-remapped-') as directory:
        path = Path(directory) / 'production-captures.json'
        path.write_text(json.dumps(capture) + '\n')
        completed = subprocess.run([sys.executable, str(HERE / 'sql-work.py'), str(path)], capture_output=True, text=True, check=False)
        if completed.returncode != 0:
            raise AssertionError(f'Remapped SQL-work gate failed:\n{completed.stdout}\n{completed.stderr}')
        result = json.loads((path.parent / 'sql-work-results.json').read_text())
        roles = {row['role'] for row in result['rows']}
        if not {'subtree-payload', 'subtree-structure', 'linear-control', 'old-negative', 'broad-negative'} <= roles:
            raise AssertionError(f'Missing measured query role: {roles}')
        if not (result['production_within_bound'] and result['linear_control_passed'] and result['broad_negative_rejected']):
            raise AssertionError('Remapped capture lost a bounded query or negative control')
    print('Remapped listing result ID preserves production and negative SQL-work controls')


if __name__ == '__main__':
    main()
