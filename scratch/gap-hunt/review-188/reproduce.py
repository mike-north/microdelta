"""Reproduce exact acceptance acknowledgement and its previous-source control."""
from pathlib import Path
import subprocess,os,json,platform,hashlib,time,re
ROOT=Path(__file__).resolve().parents[3];PREFIX='scratch/gap-hunt/review-188/';OUT=ROOT/PREFIX/'local-results';PIN='4853f0e5ba2f1f56898bdb79584d7e4850c0f2ba';OLD='2a640aca75d5728484a2cb06af88c77690616ba9';PREVIOUS='0194b33d4f8cb7ccbf6f58100f833e0248f76230';ORIGINAL='abb9bab1987d18644093fb67dadb17c3ea9f94ce';SOURCE='packages/history/src/durable/index.ts';TEST='packages/core/test/gap-hunt-scale/acceptance-readback.test.ts';commands=[]
def git(*a):return subprocess.check_output(['git','-c','core.fsmonitor=false',*a],cwd=ROOT)
def sha(b):return hashlib.sha256(b).hexdigest()
def run(name,args,expected=0):
 env=dict(os.environ);env.pop('GAP_HUNT_REUSE_BUILD',None)
 with (OUT/(name+'.log')).open('w') as f:r=subprocess.run(args,cwd=ROOT,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=900)
 commands.append({'name':name,'argv':args,'expected':expected,'exit':r.returncode});(OUT/'commands.json').write_text(json.dumps(commands,indent=2)+'\n');assert r.returncode==expected,(name,r.returncode,expected)
 return (OUT/(name+'.log')).read_text()
def compile_test(name):run(name,['node','node_modules/typescript/bin/tsc','-p','packages/core/tsconfig.test.json'])
def jest(name,passed,failed,extra=None):
 args=['node','--experimental-vm-modules','node_modules/jest/bin/jest.js','--config','packages/core/jest.config.mjs','--runInBand','--runTestsByPath','packages/core/.test-build/test/gap-hunt-scale/acceptance-readback.test.js','--json','--outputFile='+PREFIX+'local-results/'+name+'.json']
 run(name,args,1 if failed else 0);data=json.loads((OUT/(name+'.json')).read_text());assert data['numPassedTests']==passed and data['numFailedTests']==failed and data['numRuntimeErrorTestSuites']==0
 if failed==5:
  names={a['fullName'] for suite in data['testResults'] for a in suite['assertionResults'] if a['status']=='failed'}
  assert names=={'acknowledging each new acceptance returns only that acceptance from SQL','bounded acknowledgements preserve full histories across interleaved results and environments','acknowledgement names the inserted ID even if a later row exists for the same result and environment','wrong-result readback cannot acknowledge or commit a new acceptance','stale-evidence readback cannot acknowledge or commit a new acceptance'}
 return {'passed':passed,'failed':failed,'runtime_errors':0}
def guard():
 for args in [('diff','--name-only','-z',PIN,'HEAD'),('diff','--name-only','-z','HEAD'),('ls-files','--others','--exclude-standard','-z')]:assert all(not p or p.startswith(PREFIX) for p in git(*args).decode().split('\0')),args
 assert (ROOT/SOURCE).read_bytes()==git('show',PIN+':'+SOURCE) and (ROOT/TEST).read_bytes()==git('show',PIN+':'+TEST)
def main():
 guard();assert subprocess.check_output(['node','--version']).decode().startswith('v24.');OUT.mkdir(parents=True,exist_ok=True)
 original=git('show',ORIGINAL+':'+TEST);source=(ROOT/SOURCE).read_bytes();expanded=(ROOT/TEST).read_bytes();old=git('show',OLD+':'+SOURCE);assert old==git('show',PREVIOUS+':'+SOURCE)
 for filename,oldpath in [('original-test.ts',TEST),('repro-159.mjs','scratch/gap-hunt/contract-surface/repro-159.mjs'),('repro-support.mjs','scratch/gap-hunt/contract-surface/repro-support.mjs')]:assert (ROOT/PREFIX/filename).read_bytes()==git('show',ORIGINAL+':'+oldpath)
 try:
  (ROOT/TEST).write_bytes(original);text=run('original-default-runner',['node',PREFIX+'repro-159.mjs']);assert re.search(r'Tests:\s+1 passed, 1 total',text)
  run('default-build',['npm','run','build']);(ROOT/TEST).write_bytes(expanded);compile_test('expanded-compile');current=jest('expanded-current',9,0)
  run('strict-lint',['node','node_modules/eslint/bin/eslint.js',SOURCE,TEST]);run('history-types',['npm','run','check:types','--workspace','@microdelta/history'])
  # The prior complete owner file is used unchanged, rather than a synthetic approximation of its bug.
  (ROOT/SOURCE).write_bytes(old);run('previous-history-build',['npm','run','build','--workspace','@microdelta/history']);negative=jest('expanded-previous',4,5)
  (ROOT/TEST).write_bytes(original);compile_test('original-negative-compile');minimal=jest('original-previous',0,1)
 finally:
  (ROOT/SOURCE).write_bytes(source);(ROOT/TEST).write_bytes(expanded)
 run('restored-history-build',['npm','run','build','--workspace','@microdelta/history']);compile_test('restored-compile');restored=jest('expanded-restored',9,0)
 preservation=run('preserved-publication-acceptance',['node','--experimental-vm-modules','node_modules/jest/bin/jest.js','--config','packages/core/jest.config.mjs','--runInBand','--runTestsByPath','packages/core/.test-build/test/durable-history/durable-history.test.js','--testNamePattern','a staged attempt is not a completed result|dependencies must be exact completed results|rollback acceptance never rewinds current|stored results and acceptances are immutable'])
 assert re.search(r'Tests:\s+29 skipped, 4 passed, 33 total',preservation)
 environments=run('environment-acceptance',['node','--experimental-vm-modules','node_modules/jest/bin/jest.js','--config','packages/core/jest.config.mjs','--runInBand','--runTestsByPath','packages/core/.test-build/test/journal/environments.test.js'])
 assert re.search(r'Tests:\s+5 passed, 5 total',environments)
 guard();summary={'reviewed_pin':PIN,'previous_source_pin':OLD,'previous_commit':PREVIOUS,'original_fixture_pin':ORIGINAL,'actual_os':platform.platform(),'architecture':platform.machine(),'node':subprocess.check_output(['node','--version']).decode().strip(),'npm':subprocess.check_output(['npm','--version']).decode().strip(),'head':git('rev-parse','HEAD').decode().strip(),'original_current':{'passed':1,'failed':0},'expanded_current':current,'expanded_previous':negative,'original_previous':minimal,'expanded_restored':restored,'production_source_sha256':sha(source),'previous_source_sha256':sha(old),'original_fixture_sha256':sha(original),'expanded_fixture_sha256':sha(expanded),'source_and_test_restored_byte_exact':True,'preserved_publication_acceptance_passed':4,'environment_acceptance_passed':5,'commands':len(commands),'scope':'Actual recorded host/Node24; row materialization and exact acknowledgement correctness, no latency/M7/other-platform/full-suite claim'}
 (OUT/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))
if __name__=='__main__':main()
