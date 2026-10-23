"""Count SQLite VM work for production candidate SQL over synthetic History rows.

The rows omit normal History publication and integrity machinery. This is an
access-path discriminator only; real History/facade suites own those guarantees.
"""
import json
import sqlite3
import sys


def parameters(shape, analysis='a', environment='prod', subject='target', version=1):
    """Bind the two supported production-query layouts without altering SQL."""
    if shape == 'scoped':
        return (analysis, environment, subject, version)
    if shape == 'legacy':
        return (analysis, subject, version, environment, environment)
    raise ValueError(f'unknown query shape: {shape}')


def database(schema):
    """Create only production objects needed for candidate-query execution."""
    connection = sqlite3.connect(':memory:')
    for ddl in schema:
        connection.execute(ddl)
    return connection


def publish(connection, result_id, analysis, environment, subject, version=1):
    """Seed one query-visible completed row without invoking History publication."""
    connection.execute('''INSERT INTO history_results
      (result_id,analysis,environment,subject,version,publication,published_fence,
       encoding,index_version,payload,provenance_format,provenance_version,provenance)
      VALUES (?,?,?,?,?,?,1,'MDS1',1,'synthetic','synthetic',1,'synthetic')''',
      (result_id, analysis, environment, subject, version, result_id))


def measured(connection, query, args):
    """Count every VM instruction executed by one unchanged prepared query."""
    steps = 0

    def progress():
        nonlocal steps
        steps += 1
        return 0

    connection.set_progress_handler(progress, 1)
    try:
        result_ids = [row[0] for row in connection.execute(query, args)]
    finally:
        connection.set_progress_handler(None, 0)
    return {'ids': result_ids, 'steps': steps}


def run(request):
    """Measure three isolation populations and verify promotion/order controls."""
    query = request['query']
    schema = request['schema']
    shape = request['shape']
    counts = {}
    for filler in ['same-environment', 'other-environment', 'other-analysis']:
        counts[filler] = []
        for population in [100, 1000, 10000]:
            connection = database(schema)
            publish(connection, 1, 'a', 'prod', 'target')
            for result_id in range(2, population + 1):
                publish(connection, result_id,
                        'other' if filler == 'other-analysis' else 'a',
                        'trial' if filler == 'other-environment' else 'prod',
                        f'unrelated-{result_id}')
            found = measured(connection, query, parameters(shape))
            assert found['ids'] == [1], found
            absent = measured(connection, query, parameters(shape, subject='absent'))
            assert absent['ids'] == [], absent
            counts[filler].append({'population': population, 'steps': found['steps']})
            connection.close()

    connection = database(schema)
    for row in [(1, 'a', 'prod', 'target', 1),
                (2, 'a', 'prod', 'target', 1),
                (3, 'a', 'trial', 'target', 1),
                (4, 'other', 'prod', 'target', 1),
                (5, 'a', 'prod', 'target', 2),
                (6, 'a', 'trial', 'unrelated', 1)]:
        publish(connection, *row)
    before = measured(connection, query, parameters(shape))['ids']
    assert before == [2, 1], before
    connection.execute("INSERT INTO history_promotions VALUES (1,'a','prod',1,'synthetic',1,'synthetic')")
    connection.execute('INSERT INTO history_promotion_results VALUES (1,0,3)')
    promoted = measured(connection, query, parameters(shape))['ids']
    assert promoted == [3, 2, 1], promoted
    connection.execute("INSERT INTO history_promotions VALUES (2,'a','prod',1,'synthetic',1,'synthetic')")
    connection.execute('INSERT INTO history_promotion_results VALUES (2,0,3)')
    connection.execute("INSERT INTO history_promotions VALUES (3,'a','prod',1,'synthetic',1,'synthetic')")
    connection.execute('INSERT INTO history_promotion_results VALUES (3,0,6)')
    duplicated = measured(connection, query, parameters(shape))['ids']
    assert duplicated == [3, 2, 1], duplicated
    assert measured(connection, query, parameters(shape, environment='unpromoted'))['ids'] == []
    assert measured(connection, query, parameters(shape, subject='target', version=2))['ids'] == [5]
    assert measured(connection, query, parameters(shape, analysis='other'))['ids'] == [4]
    connection.close()
    return {'sqlite_version': sqlite3.sqlite_version, 'counts': counts,
            'semantic': {'before': before, 'promoted': promoted, 'duplicate_promotion': duplicated}}


if __name__ == '__main__':
    print(json.dumps(run(json.load(sys.stdin))))
