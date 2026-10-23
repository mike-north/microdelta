"""Qualify #172 from unchanged fixtures, then reject the exact old Node host."""
from pathlib import Path
import hashlib,json,os,re,shutil,subprocess

ROOT=Path(__file__).resolve().parents[3]
PREFIX='scratch/gap-hunt/review-185/'
OUT=ROOT/PREFIX/'local-results'
PIN='aad9b93f23fb38b1cf1387e2f865c5490fc2b434'
OLD='471c1d47ef3dc0700e36d8da2adca7e02534570b'
FIXTURE='scratch/gap-hunt/scale/repro-context-component.mjs'
WORKER='scratch/gap-hunt/scale/dist/context-consumer.js'
commands=[]
def git(*args):return subprocess.check_output(['git','-c','core.fsmonitor=false',*args],cwd=ROOT)
def sha(b):return hashlib.sha256(b).hexdigest()
def tap(text,passed,failed):
 for key,value in [('tests',1),('pass',passed),('fail',failed),('skipped',0)]:assert re.search('^# '+key+' '+str(value)+'$',text,re.M),(key,value)
def guard():
 for args in [('diff','--name-only','-z',PIN,'HEAD'),('diff','--name-only','-z','HEAD'),('ls-files','--others','--exclude-standard','-z')]:
  assert all(not p or p.startswith(PREFIX) for p in git(*args).decode().split('\0')),args
def run(name,argv,expected=0,extra=None):
 env=dict(os.environ)
 for key in ['CONTEXT_COMPONENT_ISOLATED','GAP_HUNT_REUSE_BUILD','CONTEXT_RUNS','CONTEXT_BATCH','CONTEXT_CONFIRM','CONTEXT_STORE']:env.pop(key,None)
 env.update(extra or {})
 with (OUT/(name+'.log')).open('w') as out:r=subprocess.run(argv,cwd=ROOT,env=env,stdout=out,stderr=subprocess.STDOUT,timeout=900)
 commands.append({'name':name,'argv':argv,'environment':extra or {},'exit':r.returncode,'expected':expected})
 (OUT/'commands.json').write_text(json.dumps(commands,indent=2)+'\n')
 assert r.returncode==expected,(name,r.returncode)
 return (OUT/(name+'.log')).read_text()
def component(name,node,expected=0,isolated=False,bootstrap=False):
 env={} if bootstrap else {'GAP_HUNT_REUSE_BUILD':'1'}
 if isolated:env['CONTEXT_COMPONENT_ISOLATED']='1'
 text=run(name,[node,FIXTURE],expected,env)
 if expected==0:assert re.search(r'Tests:\s+2 passed, 2 total',text),name
 else:
  assert re.search(r'Tests:\s+1 failed, 1 passed, 2 total',text),name
  assert re.search(r'Received:\s+200',text),name
def census(name,node,mode='component',isolated=False):
 env={'CONTEXT_RUNS':'3000' if mode=='fresh' else '300','CONTEXT_BATCH':'100','CONTEXT_CONFIRM':'1'}
 if mode=='fresh':env['CONTEXT_STORE']=str(OUT/'workspace.sqlite')
 text=run(name,[node,'--expose-gc',WORKER,mode,*(['--isolated'] if isolated else [])],extra=env)
 rows=[json.loads(line) for line in text.splitlines() if line.startswith('{')]
 assert len(rows)==(30 if mode=='fresh' else 3)
 assert [row['runs'] for row in rows]==list(range(100,(3000 if mode=='fresh' else 300)+1,100))
 assert all(row['liveALS']==row['liveALSConfirm'] for row in rows)
 assert rows[-1]['liveALS']-rows[0]['liveALS']<=4
 if mode=='fresh':assert rows[-1]['bodies']==3000
 else:assert [row['observed'] for row in rows]==[100,200,300]
 return {'node':rows[0]['node'],'samples':len(rows),'liveALS':[r['liveALS'] for r in rows],'completed':rows[-1]['runs'],'bodies':rows[-1]['bodies'],'observed':rows[-1]['observed']}
def runtime(name,workspace):
 run(name,['npm','run','test:unit','--workspace',workspace,'--','--json','--outputFile=../../'+PREFIX+'local-results/'+name+'.json'])
 result=json.loads((OUT/(name+'.json')).read_text())
 assert result['numFailedTests']==result['numRuntimeErrorTestSuites']==0 and result['numPassedTests']>0
 return {k:result[k] for k in ['numPassedTests','numFailedTests','numPassedTestSuites','numRuntimeErrorTestSuites']}
def main():
 guard();OUT.mkdir(parents=True,exist_ok=True)
 # A rerun owns only its synthetic workspace store, never a consumer store.
 for suffix in ['', '-wal', '-shm']:(OUT/('workspace.sqlite'+suffix)).unlink(missing_ok=True)
 manifest=json.loads((ROOT/PREFIX/'original-manifest.json').read_text());assert len(manifest['files'])==9
 for row in manifest['files']:
  b=(ROOT/row['file']).read_bytes();assert sha(b)==row['sha256'];assert b==git('show',manifest['pin']+':'+row['file'])
 node=shutil.which('node');assert node
 node26=os.environ.get('NODE26_BIN')
 if node26:assert Path(node26).is_file(),'NODE26_BIN must name an existing Node 26 binary'
 assert subprocess.check_output([node,'--version']).decode().startswith('v24.')
 if node26:assert subprocess.check_output([node26,'--version']).decode().startswith('v26.')
 component('original-node24-clean',node,bootstrap=True)
 if node26:component('original-node26',node26)
 current={'node24':census('current-node24-census',node),'workspace_node24':census('current-workspace-node24',node,'fresh')}
 if node26:current['node26']=census('current-node26-census',node26)
 component('external-node24-control',node,isolated=True)
 if node26:component('external-node26-control',node26,isolated=True)
 machine=runtime('machine-runtime','@microdelta/machine-node');tracking=runtime('tracking-runtime','@microdelta/tracking')
 run('strict',['npm','run','check','--workspace','@microdelta/machine','--workspace','@microdelta/machine-node','--workspace','@microdelta/tracking'])
 run('type-contracts',['npm','run','test:types','--workspace','@microdelta/machine','--workspace','@microdelta/machine-node','--workspace','@microdelta/tracking'])
 tap(run('official-gate',['node','--test','--test-reporter=tap','tooling/context-lifecycle.test.mjs']),1,0)
 source=ROOT/'packages/machine-node/src/node/index.ts';actual=source.read_bytes();previous=(ROOT/PREFIX/'controls/previous-node-machine.ts').read_bytes()
 assert actual==git('show',PIN+':packages/machine-node/src/node/index.ts')
 assert previous==git('show',OLD+':packages/machine-node/src/node/index.ts')
 try:
  source.write_bytes(previous)
  run('old-host-build',['npm','run','build','--workspace','@microdelta/machine-node'])
  component('old-node24-negative',node,1)
  if node26:component('old-node26-negative',node26,1)
  component('old-node24-external-control',node,isolated=True)
  if node26:component('old-node26-external-control',node26,isolated=True)
  tap(run('old-official-gate-negative',['node','--test','--test-reporter=tap','tooling/context-lifecycle.test.mjs'],1),0,1)
  tap(run('old-official-gate-inherited-isolation',['node','--test','--test-reporter=tap','tooling/context-lifecycle.test.mjs'],extra={'CONTEXT_COMPONENT_ISOLATED':'1'}),1,0)
 finally:
  source.write_bytes(actual)
  run('restored-host-build',['npm','run','build','--workspace','@microdelta/machine-node'])
 assert source.read_bytes()==actual
 component('restored-node24',node)
 if node26:component('restored-node26',node26)
 tap(run('restored-official-gate',['node','--test','--test-reporter=tap','tooling/context-lifecycle.test.mjs']),1,0)
 guard()
 summary={'head':git('rev-parse','HEAD').decode().strip(),'reviewed_pin':PIN,'original_fixture_pin':manifest['pin'],'original_fixture_count':9,'node26_requested':bool(node26),'current':current,'machine_runtime':machine,'tracking_runtime':tracking,'negative':{'old_host_pin':OLD,'node24':{'passed':1,'failed':1,'growth':200},'node26':{'passed':1,'failed':1,'growth':200} if node26 else None,'external_controls_passed':True},'official_gate_old_host':{'default_exit':1,'inherited_isolation_exit':0,'scope':'focused gate only; not a whole-CI bypass'},'source_restored_byte_exact':True,'source_sha256':sha(actual),'old_source_sha256':sha(previous),'verdict':'Runtime PASS; regression gate PARTIAL because inherited isolation enables the external workaround','scope':('Node24+26' if node26 else 'Node24 only')+' standalone context and Node24 workspace/owner suites on macOS; no Node22/Linux/published-package-update or universal-memory claim'}
 (OUT/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))
if __name__=='__main__':main()
