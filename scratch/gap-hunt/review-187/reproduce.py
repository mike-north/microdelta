"""Reproduce the bounded explicit-output current-fact repair and exact-prior-source negative."""
from pathlib import Path
import hashlib,json,os,platform,re,subprocess,time
ROOT=Path(__file__).resolve().parents[3];PREFIX=Path('scratch/gap-hunt/review-187');OUT=ROOT/PREFIX/'local-results'
PIN='0af7f746aa82fc72e88d24c3945061b1a17c0511';OLD='a0b539f7dbba17ece2fd82ab9b0b692e65316adf'
sha=lambda value:hashlib.sha256(value).hexdigest()
def git(*args):return subprocess.check_output(['git','-c','core.fsmonitor=false',*args],cwd=ROOT)
commands=[]
def run(name,args,expected=0):
 env=os.environ.copy();env.pop('GAP_HUNT_REUSE_BUILD',None)
 start=time.monotonic();p=subprocess.run(args,cwd=ROOT,env=env,capture_output=True,text=True)
 text=p.stdout+p.stderr;text=text.replace(str(ROOT),'<checkout>');text=re.sub(r'/Users/[^\s]+','<local-path>',text)
 (OUT/(name+'.log')).write_text(text)
 commands.append({'name':name,'argv':args,'exit':p.returncode,'expected':expected});(OUT/'commands.json').write_text(json.dumps(commands,indent=2)+'\n')
 print(name,p.returncode,round(time.monotonic()-start,1),flush=True);assert p.returncode==expected,(name,p.returncode,text[-2500:]);return text
def summary(name):
 data=json.loads((OUT/(name+'.json')).read_text());return {k:data[k] for k in ['numPassedTests','numFailedTests','numPassedTestSuites','numFailedTestSuites','numRuntimeErrorTestSuites']}
def suite(name,workspace,paths,expected=0):
 return run(name,['npm','run','test:unit','--workspace',workspace,'--','--runTestsByPath',*[f'.test-build/test/{path}.test.js' for path in paths],'--json','--outputFile','../../'+str(PREFIX/'local-results'/(name+'.json'))],expected)
def guard():
 changed=git('diff','--name-only',PIN).decode().splitlines()
 assert all(path.startswith(str(PREFIX)+'/') for path in changed),'Only this evidence subtree may differ from reviewed source'
def main():
 OUT.mkdir(exist_ok=True)
 guard()
 assert run('node-version',['node','--version']).strip().startswith('v24.')
 manifest=json.loads((ROOT/PREFIX/'original-manifest.json').read_text())
 for row in manifest['files']:
  actual=(ROOT/row['path']).read_bytes();assert sha(actual)==row['sha256'] and actual==git('show',row['pin']+':'+row['path'])
 assert (ROOT/PREFIX/'original-reproduce.mjs').read_bytes()==git('show',manifest['runner_pin']+':scratch/gap-hunt/contracts/reproduce.mjs')
 support=ROOT/'scratch/gap-hunt/consumer-dx/tsconfig.all.json'
 assert not support.exists()
 assert subprocess.run(['git','cat-file','-e',PIN+':scratch/gap-hunt/consumer-dx/tsconfig.all.json'],cwd=ROOT,capture_output=True).returncode!=0
 # Preserve the pristine delivered-path failure before supplying any missing support.
 pristine=run('pristine-original-minimal',['node',str(PREFIX/'original-reproduce.mjs'),'durable-output-minimal'],2)
 assert 'TS5083' in pristine and 'tsconfig.all.json' in pristine
 prior_support=(ROOT/PREFIX/'controls/original-tsconfig.all.json').read_bytes()
 assert prior_support==git('show','a97c11f:scratch/gap-hunt/consumer-dx/tsconfig.all.json')
 support.write_bytes(prior_support)
 try:
  # Explicit support overlay qualifies these runtime results, never the pristine build.
  run('supported-original-minimal',['node',str(PREFIX/'original-reproduce.mjs'),'durable-output-minimal'])
  run('strict',['npm','run','check','--workspace','@microdelta/resolution','--workspace','@microdelta/tracking','--workspace','microdelta'])
  run('fixture-strict',['npm','run','check:output-fixture'])
  run('type-contracts',['npm','run','test:types','--workspace','@microdelta/resolution','--workspace','@microdelta/tracking','--workspace','microdelta'])
  core=['gap-hunt-contracts-output','gap-hunt-dx-output-bindings','output-revalidation-process']
  suite('current-core','microdelta',core)
  suite('current-owner','@microdelta/resolution',['current-output'])
  # Tracking itself is unchanged; only the output and observer scope/correspondence regressions are relevant.
  suite('tracking-regression','@microdelta/tracking',['output-observation','observer'])
  source=ROOT/'packages/resolution/src/current.ts';actual=source.read_bytes();previous=(ROOT/PREFIX/'controls/previous-current.ts').read_bytes()
  assert actual==git('show',PIN+':packages/resolution/src/current.ts') and previous==git('show',OLD+':packages/resolution/src/current.ts')
  try:
   source.write_bytes(previous)
   run('old-source-build',['npm','run','build','--workspace','@microdelta/resolution'])
   suite('old-source-core','microdelta',core,1)
   suite('old-source-owner','@microdelta/resolution',['current-output'],1)
  finally:
   source.write_bytes(actual)
   run('restored-build',['npm','run','build','--workspace','@microdelta/resolution'])
  assert source.read_bytes()==actual
  suite('restored-core','microdelta',core)
  suite('restored-owner','@microdelta/resolution',['current-output'])
  values={name:summary(name) for name in ['current-core','current-owner','tracking-regression','old-source-core','old-source-owner','restored-core','restored-owner']}
  assert values['current-core']['numPassedTests']==values['restored-core']['numPassedTests']==14
  assert values['current-owner']['numPassedTests']==values['restored-owner']['numPassedTests']==6
  assert values['old-source-core']['numFailedTests']==11 and values['old-source-core']['numPassedTests']==3
  assert values['old-source-owner']['numFailedTests']==6
  assert values['tracking-regression']['numPassedTests']==54
  for name,passed_suites,failed_suites in [('current-core',3,0),('current-owner',1,0),('tracking-regression',2,0),('old-source-core',0,3),('old-source-owner',0,1),('restored-core',3,0),('restored-owner',1,0)]:
   assert values[name]['numPassedTestSuites']==passed_suites and values[name]['numFailedTestSuites']==failed_suites
   assert values[name]['numRuntimeErrorTestSuites']==0
  for name in ['current-core','current-owner','tracking-regression','restored-core','restored-owner']:
   assert values[name]['numFailedTests']==values[name]['numRuntimeErrorTestSuites']==0
  guard()
  result={'reviewed_pin':PIN,'old_source_pin':OLD,'actual_os':platform.platform(),'node':subprocess.check_output(['node','--version'],text=True).strip(),'original_files':len(manifest['files']),'source_sha256':sha(actual),'old_source_sha256':sha(previous),'source_restored_byte_exact':True,'suites':values,'commands':len(commands),'verdict':'PASS for bounded #164 explicit subtree revalidation','pristine_original_exit':2,'runtime_support_overlay':'Exact a97c11f tsconfig.all.json supplied only for runtime checks, then removed','scope':'Runtime PASS under explicit missing-config overlay; pristine build FAIL; Node24 actualOS only; no Linux/fullrepo/provider/publication qualification'}
  (OUT/'summary.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
 finally:
  support.unlink(missing_ok=True)
 assert not support.exists()
if __name__=='__main__':main()
