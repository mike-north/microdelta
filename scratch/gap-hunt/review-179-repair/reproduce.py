"""Qualify the original repair and preserve two remaining source-checker mismatches."""
from pathlib import Path
import subprocess,json,hashlib,os,re
ROOT=Path(__file__).resolve().parents[3]
PIN='e00d5f999725800eb4f574b8e73d7300e71ad44d';PREFIX='scratch/gap-hunt/review-179-repair/'
OUT=ROOT/PREFIX/'local-results';OLD='scratch/gap-hunt/review-179/'
ORIGINALS={OLD+n for n in ['probes.mjs','path-matrix.mjs','reproduce.py']}
def git(*args):return subprocess.check_output(['git','-c','core.fsmonitor=false',*args],cwd=ROOT)
def digest(data):return hashlib.sha256(data).hexdigest()
def guard():
 for args in [('diff','--name-only','-z',PIN,'HEAD'),('diff','--name-only','-z','HEAD'),('ls-files','--others','--exclude-standard','-z')]:
  assert all(not p or p.startswith(PREFIX) or p in ORIGINALS for p in git(*args).decode().split('\0')),args
checks=[]
def run(name,argv,expected=0):
 with (OUT/(name+'.log')).open('w') as stdout:
  result=subprocess.run(argv,cwd=ROOT,env=dict(os.environ,REVIEW_SOURCE_PIN=PIN),stdout=stdout,stderr=subprocess.STDOUT,timeout=600)
 checks.append({'name':name,'argv':argv,'exit':result.returncode,'expected':expected});(OUT/'commands.json').write_text(json.dumps(checks,indent=2)+'\n')
 assert result.returncode==expected,(name,result.returncode)
def suite(name,passed,failed):
 text=(OUT/(name+'.log')).read_text()
 for key,value in [('tests',12),('pass',passed),('fail',failed),('skipped',0)]:assert re.search('^# '+key+' '+str(value)+'$',text,re.MULTILINE),(name,key)
def matrix(name,script,passed,failed,expected,flags=()):
 with (OUT/(name+'.json')).open('w') as stdout,(OUT/(name+'-assertion.log')).open('w') as stderr:
  result=subprocess.run(['node',*flags,script],cwd=ROOT,env=dict(os.environ,REVIEW_SOURCE_PIN=PIN),stdout=stdout,stderr=stderr,timeout=60)
 checks.append({'name':name,'argv':['node',*flags,script],'exit':result.returncode,'expected':expected});(OUT/'commands.json').write_text(json.dumps(checks,indent=2)+'\n')
 assert result.returncode==expected,(name,result.returncode)
 data=json.loads((OUT/(name+'.json')).read_text());assert (data['passed'],data['failed'])==(passed,failed)
 return data

def shadow(name,expected,errors):
 with (OUT/(name+'.json')).open('w') as stdout,(OUT/(name+'-assertion.log')).open('w') as stderr:
  result=subprocess.run(['node',PREFIX+'shadowed-require.mjs'],cwd=ROOT,stdout=stdout,stderr=stderr,timeout=60)
 checks.append({'name':name,'argv':['node',PREFIX+'shadowed-require.mjs'],'exit':result.returncode,'expected':expected});(OUT/'commands.json').write_text(json.dumps(checks,indent=2)+'\n')
 assert result.returncode==expected
 data=json.loads((OUT/(name+'.json')).read_text());assert len(data['errors'])==errors
 if errors:assert data['errors'][0]['ruleId']=='microdelta/example-source-imports'
 return data

def main():
 guard();OUT.mkdir(parents=True,exist_ok=True)
 manifest=json.loads((ROOT/PREFIX/'original-fixtures.json').read_text());assert {row['path'] for row in manifest['files']}==ORIGINALS
 for row in manifest['files']:assert digest((ROOT/row['path']).read_bytes())==row['sha256']
 run('install',['npm','ci','--no-audit','--no-fund'])
 run('boundaries',['node','--test','--test-reporter=tap','tooling/context-boundaries.test.mjs']);suite('boundaries',12,0)
 run('original-probes',['node',OLD+'probes.mjs']);assert json.loads((OUT/'original-probes.log').read_text())['qualified_probes']==21
 current=matrix('original-matrix',OLD+'path-matrix.mjs',8,0,0)
 residual=matrix('residual-matrix',PREFIX+'residual-matrix.mjs',3,1,1,['--experimental-import-meta-resolve'])
 assert [row['passes_boundary'] for row in residual['rows']]==[True,False,True,True]
 assert residual['rows'][0]['node_resolved_target']==residual['rows'][1]['node_resolved_target']=='packages/history/src/index.js'
 run('supplemental-literals',['node',PREFIX+'extra-probes.mjs'])
 shadow('shadowed-require-current',1,1)
 config=ROOT/'tooling/context-imports.config.mjs';actual=config.read_bytes();previous=(ROOT/PREFIX/'controls/previous-config.mjs').read_bytes()
 assert actual==git('show',PIN+':tooling/context-imports.config.mjs')
 assert digest(previous)=='f3b2c41b875a072503ea136934cbc3d2a03bec2a0d0294a22789ccc5c0633455'
 try:
  config.write_bytes(previous)
  run('previous-config-boundaries',['node','--test','--test-reporter=tap','tooling/context-boundaries.test.mjs'],1);suite('previous-config-boundaries',11,1)
  matrix('previous-config-original-matrix',OLD+'path-matrix.mjs',6,2,1)
  shadow('shadowed-require-previous',0,0)
 finally:config.write_bytes(actual)
 assert config.read_bytes()==actual
 run('restored-boundaries',['node','--test','--test-reporter=tap','tooling/context-boundaries.test.mjs']);suite('restored-boundaries',12,0)
 matrix('restored-original-matrix',OLD+'path-matrix.mjs',8,0,0)
 matrix('restored-residual-matrix',PREFIX+'residual-matrix.mjs',3,1,1,['--experimental-import-meta-resolve'])
 shadow('shadowed-require-restored',1,1)
 run('restored-imports',['npm','run','check:imports'])
 guard()
 summary={'head':git('rev-parse','HEAD').decode().strip(),'reviewed_pin':PIN,'original_suite':{'passed':12,'failed':0},'original_probes':21,'original_matrix':{'passed':8,'failed':0,'exit':0},'residual_matrix':{'passed':3,'failed':1,'exit':1},'previous_config_suite':{'passed':11,'failed':1},'previous_config_original_matrix':{'passed':6,'failed':2,'exit':1},'shadowed_local_require':{'current_errors':1,'previous_errors':0,'restored_errors':1},'actual_config_sha256':digest(actual),'config_restored_byte_exact':True,'verdict':'PARTIAL check:imports boundary: original dot-prefix witness repaired; encoded literal ESM source bypass and lexical-require false positive remain','scope':'tooling source checks and Node ESM resolution only; no module execution/full CI/runtime/Linux/provider claims'}
 (OUT/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))
if __name__=='__main__':main()
