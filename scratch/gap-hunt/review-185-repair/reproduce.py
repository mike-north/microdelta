"""Qualify PR185's inherited-isolation gate repair against the exact old host."""
from pathlib import Path
import hashlib,json,os,platform,re,shutil,subprocess
ROOT=Path(__file__).resolve().parents[3];PREFIX='scratch/gap-hunt/review-185-repair/';OUT=ROOT/PREFIX/'local-results'
PIN='25b8f3f58f295ca3e985126546e79b223ce0ebd4';PRIOR='aad9b93f23fb38b1cf1387e2f865c5490fc2b434';OLD='471c1d47ef3dc0700e36d8da2adca7e02534570b';FIXTURE='scratch/gap-hunt/scale/repro-context-component.mjs';commands=[]
def git(*args):return subprocess.check_output(['git','-c','core.fsmonitor=false',*args],cwd=ROOT)
def sha(b):return hashlib.sha256(b).hexdigest()
def guard():
 for args in [('diff','--name-only','-z',PIN,'HEAD'),('diff','--name-only','-z','HEAD'),('ls-files','--others','--exclude-standard','-z')]:assert all(not p or p.startswith(PREFIX) for p in git(*args).decode().split('\0')),args
def run(name,argv,expected=0,extra=None):
 env=dict(os.environ)
 for key in ['CONTEXT_COMPONENT_ISOLATED','GAP_HUNT_REUSE_BUILD','CONTEXT_RUNS','CONTEXT_BATCH','CONTEXT_CONFIRM','CONTEXT_STORE']:env.pop(key,None)
 env.update(extra or {})
 with (OUT/(name+'.log')).open('w') as f:r=subprocess.run(argv,cwd=ROOT,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=900)
 commands.append({'name':name,'argv':argv,'environment':extra or {},'exit':r.returncode,'expected':expected});(OUT/'commands.json').write_text(json.dumps(commands,indent=2)+'\n');assert r.returncode==expected,(name,r.returncode)
 return (OUT/(name+'.log')).read_text()
def tap(name,node,expected=0,inherited=False):
 text=run(name,[node,'--test','--test-reporter=tap','tooling/context-lifecycle.test.mjs'],expected,{'CONTEXT_COMPONENT_ISOLATED':'1'} if inherited else {})
 for key,value in [('tests',1),('pass',int(expected==0)),('fail',int(expected!=0)),('skipped',0)]:assert re.search('^# '+key+' '+str(value)+'$',text,re.M),(name,key)
def component(name,node,expected=0,external=False):
 text=run(name,[node,FIXTURE],expected,{'GAP_HUNT_REUSE_BUILD':'1',**({'CONTEXT_COMPONENT_ISOLATED':'1'} if external else {})})
 assert re.search(r'Tests:\s+'+('2 passed, 2 total' if expected==0 else '1 failed, 1 passed, 2 total'),text),name
 if expected:assert re.search(r'Received:\s+200',text),name
def census(name,node):
 text=run(name,[node,'--expose-gc','scratch/gap-hunt/scale/dist/context-consumer.js','component'],extra={'CONTEXT_RUNS':'300','CONTEXT_BATCH':'100','CONTEXT_CONFIRM':'1'})
 rows=[json.loads(x) for x in text.splitlines() if x.startswith('{')];assert [x['observed'] for x in rows]==[100,200,300];assert all(x['liveALS']==x['liveALSConfirm'] for x in rows);assert rows[-1]['liveALS']-rows[0]['liveALS']<=4
 return {'node':rows[0]['node'],'observed':[x['observed'] for x in rows],'liveALS':[x['liveALS'] for x in rows],'confirmed':True}
def main():
 guard();OUT.mkdir(parents=True,exist_ok=True);manifest=json.loads((ROOT/PREFIX/'original-manifest.json').read_text());assert len(manifest['files'])==9
 for row in manifest['files']:
  b=(ROOT/row['file']).read_bytes();assert sha(b)==row['sha256'] and b==git('show',manifest['pin']+':'+row['file'])
 node=shutil.which('node');assert node and subprocess.check_output([node,'--version']).decode().startswith('v24.')
 nodes={'node24':node};node26=os.environ.get('NODE26_BIN')
 if node26:assert subprocess.check_output([node26,'--version']).decode().startswith('v26.');nodes['node26']=node26
 run('install',['npm','ci','--no-audit','--no-fund']);run('build',['npm','run','build:packages'])
 run('environment-helper',['node','--test','--test-reporter=tap','tooling/context-lifecycle-env.test.mjs'])
 current={}
 for name,binary in nodes.items():
  component('current-'+name,binary);current[name]=census('current-'+name+'-census',binary);tap('current-'+name+'-gate-inherited',binary,inherited=True)
 source=ROOT/'packages/machine-node/src/node/index.ts';gate=ROOT/'tooling/context-lifecycle.test.mjs';actual=source.read_bytes();gatebytes=gate.read_bytes();previous=(ROOT/PREFIX/'previous-node-machine.ts').read_bytes();oldgate=git('show',PRIOR+':tooling/context-lifecycle.test.mjs')
 assert actual==git('show',PIN+':packages/machine-node/src/node/index.ts') and previous==git('show',OLD+':packages/machine-node/src/node/index.ts')
 try:
  source.write_bytes(previous);run('old-host-build',['npm','run','build','--workspace','@microdelta/machine-node'])
  for name,binary in nodes.items():
   component('old-'+name+'-negative',binary,1);component('old-'+name+'-external-control',binary,external=True);tap('old-'+name+'-gate-default',binary,1);tap('old-'+name+'-gate-inherited',binary,1,True)
  gate.write_bytes(oldgate);tap('old-gate-old-host-inherited-control',node,inherited=True);gate.write_bytes(gatebytes)
 finally:
  source.write_bytes(actual);gate.write_bytes(gatebytes);run('restored-host-build',['npm','run','build','--workspace','@microdelta/machine-node'])
 assert source.read_bytes()==actual and gate.read_bytes()==gatebytes
 for name,binary in nodes.items():component('restored-'+name,binary);tap('restored-'+name+'-gate-inherited',binary,inherited=True)
 guard();summary={'head':git('rev-parse','HEAD').decode().strip(),'reviewed_pin':PIN,'prior_gate_pin':PRIOR,'old_host_pin':OLD,'original_fixture_pin':manifest['pin'],'original_fixture_count':9,'platform':platform.platform(),'machine':platform.machine(),'node_versions':{n:subprocess.check_output([b,'--version']).decode().strip() for n,b in nodes.items()},'current':current,'old_host':{'original_component':'1 semantic pass,1 retention failure;growth200','external_control':'2pass','repaired_gate_default_exit':1,'repaired_gate_inherited_exit':1,'prior_gate_inherited_exit':0},'restored':{'source_byte_exact':True,'gate_byte_exact':True,'component':'2pass per host','inherited_gate_exit':0},'source_sha256':sha(actual),'old_source_sha256':sha(previous),'gate_sha256':sha(gatebytes),'verdict':'PASS bounded inherited-isolation gate repair','scope':'Actual recorded OS and supplied Node24/optional26 only; no broad owner-suite rerun, Node22/Linux/universal heap or whole-CI claim'}
 (OUT/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))
if __name__=='__main__':main()
