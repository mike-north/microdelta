"""Qualify PR179's narrow fix and reproduce its residual literal-path boundary failure."""
from pathlib import Path
import hashlib,json,os,re,subprocess
ROOT=Path(__file__).resolve().parents[3]
PIN='04f9754843fb8eddbc7b8e15b34a3e35d91c1c9a'
PARENT='f43c5872987573d9b98a19f41c324b4d9336894c'
PREFIX='scratch/gap-hunt/review-179/'
OUT=ROOT/PREFIX/'local-results'
def git(*args):return subprocess.check_output(['git','-c','core.fsmonitor=false',*args],cwd=ROOT)
def guard():
 for args in [('diff','--name-only','-z',PIN,'HEAD'),('diff','--name-only','-z','HEAD'),('ls-files','--others','--exclude-standard','-z')]:
  assert all(not p or p.startswith(PREFIX) for p in git(*args).decode().split('\0')),args
 assert git('rev-parse',PIN+'^').decode().strip()==PARENT
checks=[]
def run(name,argv,expected=0,pin=PIN):
 with (OUT/(name+'.log')).open('w') as log:
  result=subprocess.run(argv,cwd=ROOT,env=dict(os.environ,REVIEW_SOURCE_PIN=pin),stdout=log,stderr=subprocess.STDOUT,timeout=600)
 checks.append({'name':name,'argv':argv,'exit':result.returncode,'expected':expected,'source_pin':pin})
 (OUT/'commands.json').write_text(json.dumps(checks,indent=2)+'\n')
 assert result.returncode==expected,(name,result.returncode,expected)
def suite(name,passed,failed):
 text=(OUT/(name+'.log')).read_text()
 for key,value in [('tests',11),('pass',passed),('fail',failed),('skipped',0)]:
  assert re.search('^# '+key+' '+str(value)+'$',text,re.MULTILINE),(name,key)
def matrix(name,expected):
 # Node stdout is JSON; the failing assertion is captured separately on stderr.
 target=OUT/(name+'.json')
 with target.open('w') as stdout,(OUT/(name+'-assertion.log')).open('w') as stderr:
  result=subprocess.run(['node',PREFIX+'path-matrix.mjs'],cwd=ROOT,env=dict(os.environ,REVIEW_SOURCE_PIN=PIN if name=='current' else PARENT),stdout=stdout,stderr=stderr)
 assert result.returncode==1
 data=json.loads(target.read_text());assert data['cases']==8
 assert [row['passes_boundary'] for row in data['rows']]==expected
 assert all(row['resolved_literal_target']=='packages/history/src/index.js' for row in data['rows'])
 assert all(not row['errors'] for row in data['rows'][2:4])
 for row in data['rows'][4:]:assert {e['ruleId'] for e in row['errors']}=={'microdelta/context-imports'}
 return data

def main():
 guard();OUT.mkdir(parents=True,exist_ok=True)
 run('install',['npm','ci','--no-audit','--no-fund'])
 run('boundaries',['node','--test','--test-reporter=tap','tooling/context-boundaries.test.mjs']);suite('boundaries',11,0)
 run('qualified-probes',['node',PREFIX+'probes.mjs'])
 run('check-imports',['npm','run','check:imports'])
 current=matrix('current',[True,True,False,False,True,True,True,True])
 assert current['rows'][0]['errors'][0]['ruleId']=='no-restricted-imports'
 assert current['rows'][1]['errors'][0]['ruleId']=='no-restricted-syntax'
 config=ROOT/'tooling/context-imports.config.mjs';actual=config.read_bytes()
 assert actual==git('show',PIN+':tooling/context-imports.config.mjs')
 try:
  config.write_bytes(git('show',PARENT+':tooling/context-imports.config.mjs'))
  run('parent-control',['node','--test','--test-reporter=tap','tooling/context-boundaries.test.mjs'],1,PARENT);suite('parent-control',10,1)
  assert "void import('@microdelta/history')" in (OUT/'parent-control.log').read_text()
  parent=matrix('parent',[True,False,False,False,True,True,True,True])
 finally:config.write_bytes(actual)
 assert config.read_bytes()==actual
 run('restored',['node','--test','--test-reporter=tap','tooling/context-boundaries.test.mjs']);suite('restored',11,0)
 run('restored-imports',['npm','run','check:imports'])
 guard()
 summary={'head':git('rev-parse','HEAD').decode().strip(),'runtime_pin':PIN,'parent_pin':PARENT,'boundary_suite':{'passed':11,'failed':0},'parent_config_negative':{'passed':10,'failed':1},'restored_suite':{'passed':11,'failed':0},'current_literal_path_regression':{'passed':current['passed'],'failed':current['failed'],'exit':1},'parent_literal_path_regression':{'passed':parent['passed'],'failed':parent['failed'],'exit':1},'config_restored_sha256':hashlib.sha256(actual).hexdigest(),'verdict':'PARTIAL: narrow dynamic-import fix passes; equivalent literal example source bypass persists','scope':'tooling only; no runtime/build/Linux/provider/full-repository qualification'}
 (OUT/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))
if __name__=='__main__':main()
