"""One SQL-layer finite discriminator over unchanged production captures; no product fix."""
from pathlib import Path
import json,sqlite3,hashlib,sys
HERE=Path(__file__).resolve().parent
CAPTURE=HERE/'production-captures.json'

def run():
 raw=CAPTURE.read_bytes();capture=json.loads(raw);rows=[]
 for case in capture['captures']:
  db=sqlite3.connect(':memory:')
  for table in ['history_nodes','history_edges']:
   ddl=next(s['sql'] for s in case['schema'] if s['name']==table);db.execute(ddl)
   values=case['tables'][table];columns=list(values[0]);quoted=','.join('"'+c+'"' for c in columns)
   db.executemany(f'INSERT INTO {table} ({quoted}) VALUES ({",".join("?" for _ in columns)})',[[r[c] for c in columns] for r in values])
  queries=[{'role':s['role'],'sql':s['sql'],'values':s['values'],'expected_rows':s['rows']} for s in case['statements']]
  # These controls were selected before measurement and are never used as replacements for production SQL.
  queries.extend([
   {'role':'linear-control','sql':'SELECT node_id FROM history_nodes WHERE result_id = ? ORDER BY node_id','values':[1],'expected_rows':3*case['size']+3},
   {'role':'broad-negative','sql':'SELECT count(*) AS n FROM history_nodes a CROSS JOIN history_nodes b WHERE a.result_id = ? AND b.result_id = ?','values':[1,1],'expected_rows':1},
  ])
  for query in queries:
   steps=0
   def progress():
    nonlocal steps
    steps+=1
    return 0
   plan=db.execute('EXPLAIN QUERY PLAN '+query['sql'],query['values']).fetchall()
   db.set_progress_handler(progress,1)
   result=db.execute(query['sql'],query['values']).fetchall()
   db.set_progress_handler(None,0)
   assert len(result)==query['expected_rows']
   if query['role']=='broad-negative':assert result==[((3*case['size']+3)**2,)]
   rows.append({'size':case['size'],'role':query['role'],'vm_instructions':steps,'returned_rows':len(result),'python_plan':plan,'sql_sha256':hashlib.sha256(query['sql'].encode()).hexdigest()})
  db.close()
 checks=[]
 for role in ['subtree-payload','subtree-structure','linear-control','broad-negative']:
  work={r['size']:r['vm_instructions'] for r in rows if r['role']==role}
  for n in [10,20]:checks.append({'role':role,'from':n,'to':2*n,'allowance':2*work[n]+500,'observed':work[2*n],'within_predeclared_bound':work[2*n]<=2*work[n]+500})
 linear=all(c['within_predeclared_bound'] for c in checks if c['role']=='linear-control');negative=any(not c['within_predeclared_bound'] for c in checks if c['role']=='broad-negative');assert linear and negative
 production=all(c['within_predeclared_bound'] for c in checks if c['role'].startswith('subtree-'))
 output={'capture_sha256':hashlib.sha256(raw).hexdigest(),'python_sqlite_version':sqlite3.sqlite_version,'node_sqlite_versions':[c['node_sqlite_version'] for c in capture['captures']],'bound':'W(2N) <= 2*W(N)+500, fixed before execution','rows':rows,'checks':checks,'linear_control_passed':linear,'broad_negative_rejected':negative,'production_within_bound':production,'qualification':'Python SQLite VM-work counter using captured actual production SQL/schema/listing data. This is not an actual Node-engine instruction count, full consumer timing attribution, or universal complexity proof. Node plans are separately preserved in production-captures.json. No SQL/product repair or retry.'}
 (HERE/'sql-work-results.json').write_text(json.dumps(output,indent=2)+'\n');print(json.dumps(output,indent=2));return 0 if production else 1
if __name__=='__main__':sys.exit(run())
