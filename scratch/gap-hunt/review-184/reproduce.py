"""Clean source-bound PR184 repair qualification; historical SQL oracle stays unchanged."""
from pathlib import Path
import subprocess,json,hashlib,re,os
ROOT=Path(__file__).resolve().parents[3];PREFIX='scratch/gap-hunt/review-184/';OUT=ROOT/PREFIX/'local-results';PIN='8b5c7d82185fa17ac3a6cf96e5fe5c3b3cc11ea7';PARENT='471c1d47ef3dc0700e36d8da2adca7e02534570b'
def git(*args):return subprocess.check_output(['git','-c','core.fsmonitor=false',*args],cwd=ROOT)
def sha(data):return hashlib.sha256(data).hexdigest()
def guard():
 for args in [('diff','--name-only','-z',PIN,'HEAD'),('diff','--name-only','-z','HEAD'),('ls-files','--others','--exclude-standard','-z')]:assert all(not p or p.startswith(PREFIX) for p in git(*args).decode().split('\0')),args
commands=[]
def run(name,argv,expected=0):
 with (OUT/(name+'.log')).open('w') as output:r=subprocess.run(argv,cwd=ROOT,stdout=output,stderr=subprocess.STDOUT,timeout=600)
 commands.append({'name':name,'argv':argv,'exit':r.returncode,'expected':expected});(OUT/'commands.json').write_text(json.dumps(commands,indent=2)+'\n');assert r.returncode==expected,(name,r.returncode)
def tap(name,passes,failures):
 text=(OUT/(name+'.log')).read_text();assert re.search(r'^# pass '+str(passes)+'$',text,re.M) and re.search(r'^# fail '+str(failures)+'$',text,re.M)
def main():
 guard();OUT.mkdir(parents=True,exist_ok=True)
 originals=json.loads((ROOT/PREFIX/'original-manifest.json').read_text())
 for row in originals['files']:
  b=(ROOT/PREFIX/row['copied']).read_bytes();assert sha(b)==row['sha256'];assert b==git('show',originals['pin']+':'+row['source'])
 run('historical',['python3',PREFIX+'original/repro.py'],1)
 historical=(OUT/'historical.log').read_text();assert 'FAIL unrelated-subject work:' in historical and 'Traceback' not in historical
 parsed=json.loads(historical[historical.index('{'):historical.rindex('}')+1]);assert len(parsed['rows'])==18
 run('install',['npm','ci','--no-audit','--no-fund'])
 run('build',['npm','run','build:packages'])
 run('production-vm',['python3',PREFIX+'production-vm.py'])
 vm=json.loads((OUT/'production-vm.log').read_text());assert vm['repaired']['semantic']==vm['exact_parent_query_negative']['semantic']
 run('query-gate',['node','--test','--test-reporter=tap','tooling/candidate-query.test.mjs']);tap('query-gate',1,0)
 runtime=['npm','run','test:unit','--workspace','microdelta','--','--runTestsByPath',*[f'.test-build/test/{s}.test.js' for s in ['journal/environments','workspace-operations/operations','durable-history/durable-history','m5-acceptance/environments']],'--json','--outputFile=../../'+PREFIX+'local-results/runtime.json']
 run('runtime',runtime)
 results=json.loads((OUT/'runtime.json').read_text());assert results['numPassedTests']==56 and results['numFailedTests']==results['numRuntimeErrorTestSuites']==0 and results['numPassedTestSuites']==4
 run('strict',['npm','run','check','--workspace','@microdelta/history','--workspace','microdelta'])
 source=ROOT/'packages/history/src/durable/index.ts';actual=source.read_bytes();assert actual==git('show',PIN+':packages/history/src/durable/index.ts')
 old=git('show',PARENT+':packages/history/src/durable/index.ts').decode();pattern=r'(candidates: connection\.prepare\(sql`)([\s\S]*?)(`\))';match=re.search(pattern,old);assert match
 mutant=re.sub(pattern,lambda m:m[1]+match[2]+m[3],actual.decode(),count=1);assert mutant!=actual.decode()
 try:
  source.write_text(mutant)
  run('old-query-source-negative',['node','--test','--test-reporter=tap','tooling/candidate-query.test.mjs'],1);tap('old-query-source-negative',0,1)
  assert 'same-environment:' in (OUT/'old-query-source-negative.log').read_text()
 finally:source.write_bytes(actual)
 assert source.read_bytes()==actual
 run('restored-query-gate',['node','--test','--test-reporter=tap','tooling/candidate-query.test.mjs']);tap('restored-query-gate',1,0)
 guard()
 summary={'head':git('rev-parse','HEAD').decode().strip(),'reviewed_pin':PIN,'historical_frozen_oracle_exit':1,'production_query_gate':{'pass':1,'fail':0},'vm_counts':vm['repaired']['counts'],'exact_parent_vm_negative':vm['exact_parent_query_negative']['counts'],'sql_semantics':vm['repaired']['semantic'],'additional_controls':vm['controls'],'runtime':{k:results[k] for k in ['numPassedTests','numFailedTests','numPassedTestSuites','numFailedTestSuites','numRuntimeErrorTestSuites']},'old_query_source_negative':{'pass':0,'fail':1,'exit':1},'source_restored_byte_exact':True,'source_sha256':sha(actual),'schema_sha256':vm['schema_source_sha256'],'verdict':'PASS bounded #177 candidate lookup repair','scope':'synthetic production-SQL VM discriminator plus generated-declaration History/facade correctness; no consumer timing/capacity/Linux/provider claim'}
 (OUT/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))
if __name__=='__main__':main()
