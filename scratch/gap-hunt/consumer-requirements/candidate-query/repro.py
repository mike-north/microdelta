"""Captured production SQL on invented data; instruction counts, never time thresholds."""
from pathlib import Path
import json
import sqlite3
import sys

CAPTURE = json.loads(Path(__file__).with_name('captured-sql.json').read_text())


def database(name):
    connection = sqlite3.connect(':memory:')
    for ddl in CAPTURE[name]['ddl']:
        connection.execute(ddl)
    return connection


def publish(connection, result_id, analysis, environment, subject, version=1):
    # Only query-required rows are seeded. This is SQL access-path evidence,
    # not normal History publication or a proof of its integrity validation.
    connection.execute('''INSERT INTO history_results
      (result_id,analysis,environment,subject,version,publication,published_fence,
       encoding,index_version,payload,provenance_format,provenance_version,provenance)
      VALUES (?,?,?,?,?,?,1,'MDS1',1,'synthetic','synthetic',1,'synthetic')''',
      (result_id, analysis, environment, subject, version, result_id))


def request(name, analysis='a', environment='prod', subject='target', version=1):
    if name == 'published':
        return (analysis, environment, subject, version)
    return (analysis, subject, version, environment, environment)


def measured(connection, name, parameters):
    instructions = 0
    def progress():
        nonlocal instructions
        instructions += 1
        return 0
    query = CAPTURE[name]['query']
    plan = [row[3] for row in connection.execute('EXPLAIN QUERY PLAN ' + query, parameters)]
    connection.set_progress_handler(progress, 1)
    try:
        ids = [row[0] for row in connection.execute(query, parameters)]
    finally:
        connection.set_progress_handler(None, 0)
    return {'ids': ids, 'vm_steps': instructions, 'plan': plan}


def run():
    rows = []
    for name in CAPTURE:
        for filler in ['same-analysis', 'other-analysis', 'other-environment']:
            for population in [100, 1000, 10000]:
                connection = database(name)
                publish(connection, 1, 'a', 'prod', 'target')
                for i in range(2, population + 1):
                    publish(connection, i, 'other' if filler == 'other-analysis' else 'a',
                            'trial' if filler == 'other-environment' else 'prod', f'unrelated-{i}')
                row = measured(connection, name, request(name))
                assert row['ids'] == [1], row
                rows.append({'implementation': name, 'filler': filler, 'population': population, **row})
                absent = measured(connection, name, request(name, subject='absent'))
                assert absent['ids'] == [], absent
                connection.close()
    semantics = {}
    for name in CAPTURE:
        connection = database(name)
        for args in [(1,'a','prod','target',1), (2,'a','prod','target',1),
                     (3,'a','trial','target',1), (4,'other','prod','target',1),
                     (5,'a','prod','target',2)]:
            publish(connection, *args)
        before = measured(connection, name, request(name))['ids']
        assert before == [2,1], before
        if name == 'main':
            connection.execute("INSERT INTO history_promotions VALUES (1,'a','prod',1,'synthetic',1,'synthetic')")
            connection.execute('INSERT INTO history_promotion_results VALUES (1,0,3)')
            after = measured(connection, name, request(name))['ids']
            assert after == [3,2,1], after
            assert measured(connection, name, request(name, environment='unpromoted'))['ids'] == []
        else:
            after = None
        semantics[name] = {'before_promotion': before, 'after_promotion': after}
        connection.close()
    return {'sqlite_version': sqlite3.sqlite_version, 'measurement': 'SQLite VM instructions via unchanged SQL, progress callback every instruction', 'rows': rows, 'semantics': semantics}


if __name__ == '__main__':
    result = run()
    print(json.dumps(result, indent=2))
    if '--diagnostic-only' not in sys.argv:
        same = {row['population']: row['vm_steps'] for row in result['rows']
                if row['implementation'] == 'main' and row['filler'] == 'same-analysis'}
        if same[1000] > 2 * same[100]:
            print(f"FAIL unrelated-subject work: {same[1000]} > allowance {2 * same[100]}", file=sys.stderr)
            sys.exit(1)
