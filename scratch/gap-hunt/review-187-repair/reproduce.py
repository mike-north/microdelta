"""Qualify the pristine compiler-config repair without a support overlay."""
from pathlib import Path
import hashlib,json,os,platform,re,subprocess
ROOT=Path(__file__).resolve().parents[3];PREFIX='scratch/gap-hunt/review-187-repair/';OUT=ROOT/PREFIX/'local-results';PIN='accad3a07a24b7b544b22003a6f8a283c624efc9';OLD='0af7f746aa82fc72e88d24c3945061b1a17c0511';HIST='565f8384d8ca32681d45b8db262f2cf9571d04c7';commands=[]
sha=lambda b:hashlib.sha256(b).hexdigest()
def git(*a):return subprocess.check_output(['git','-c','core.fsmonitor=false',*a],cwd=ROOT)
def guard():
 for args in [('diff','--name-only','-z',PIN,'HEAD'),('diff','--name-only','-z','HEAD'),('ls-files','--others','--exclude-standard','-z')]:assert all(not p or p.startswith(PREFIX) for p in git(*args).decode().split('\0')),args
 assert not (ROOT/'scratch/gap-hunt/consumer-dx/tsconfig.all.json').exists()
def run(name,argv):
 env=dict(os.environ);env.pop('GAP_HUNT_REUSE_BUILD',None)
 with (OUT/(name+'.log')).open('w') as f:r=subprocess.run(argv,cwd=ROOT,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=900)
 commands.append({'name':name,'argv':argv,'exit':r.returncode});(OUT/'commands.json').write_text(json.dumps(commands,indent=2)+'\n');assert r.returncode==0,name
 return (OUT/(name+'.log')).read_text()
def main():
 guard();OUT.mkdir(parents=True,exist_ok=True);assert subprocess.check_output(['node','--version']).decode().startswith('v24.')
 manifest=json.loads((ROOT/PREFIX/'original-manifest.json').read_text())
 for row in manifest['files']:
  b=(ROOT/row['path']).read_bytes();assert sha(b)==row['sha256'] and b==git('show',row['pin']+':'+row['path'])
 assert (ROOT/PREFIX/'original-reproduce.mjs').read_bytes()==git('show',manifest['runner_pin']+':scratch/gap-hunt/contracts/reproduce.mjs')
 for target,original in [('historical-summary.json','summary.json'),('historical-pristine.log','pristine-original-minimal.log')]:assert (ROOT/PREFIX/target).read_bytes()==git('show',HIST+':scratch/gap-hunt/review-187/captures/'+original)
 prior=json.loads((ROOT/PREFIX/'historical-summary.json').read_text());assert prior['pristine_original_exit']==2
 changed=git('diff','--name-only',OLD,PIN).decode().splitlines();assert changed==['scratch/gap-hunt/consumer-dx/tsconfig.output-bindings.json','tooling/output-bindings-config.test.mjs']
 package_tree=git('rev-parse',PIN+':packages').decode().strip();assert package_tree==git('rev-parse',OLD+':packages').decode().strip()
 run('install',['npm','ci','--no-audit','--no-fund']);run('default-build',['npm','run','build']);run('output-fixture',['npm','run','check:output-fixture']);guard()
 text=run('original-minimal',['node',PREFIX+'original-reproduce.mjs','durable-output-minimal']);assert re.search(r'Tests:\s+7 skipped, 2 passed, 9 total',text)
 run('compiler-config-tooling',['node','--test','--test-reporter=tap','tooling/output-bindings-config.test.mjs'])
 run('generated-bindings',['npm','run','test:unit','--workspace','microdelta','--','--runTestsByPath','.test-build/test/gap-hunt-dx-output-bindings.test.js','--json','--outputFile=../../'+PREFIX+'local-results/generated-bindings.json'])
 result=json.loads((OUT/'generated-bindings.json').read_text());assert result['numPassedTests']==4 and result['numFailedTests']==result['numRuntimeErrorTestSuites']==0
 guard();summary={'reviewed_pin':PIN,'previous_reviewed_pin':OLD,'historical_proof':HIST,'actual_os':platform.platform(),'architecture':platform.machine(),'node':subprocess.check_output(['node','--version']).decode().strip(),'npm':subprocess.check_output(['npm','--version']).decode().strip(),'head':git('rev-parse','HEAD').decode().strip(),'four_original_files_byte_exact':True,'support_overlay_absent_before_after':True,'default_build_exit':0,'output_fixture_strict_lint_exit':0,'original_minimal':{'passed':2,'skipped':7,'total':9},'generated_bindings':{'passed':4,'failed':0,'runtime_errors':0},'package_tree_byte_exact_previous':package_tree,'prior_runtime_evidence':{'core_passed':14,'owner_passed':6,'tracking_passed':54,'qualification':'Prior565/64b runs at0af under explicit support overlay; package tree/runtime source byte-identical, broad suites not re-executed here'},'historical_pristine_exit_preserved':2,'commands':len(commands),'verdict':'PASS pristine compiler-config repair at exact head','scope':'Actual recorded host and Node24 only; no unexecuted-platform/full-suite claim beyond focused original2/generated4; historical pristineFAIL remains at originalpin'}
 (OUT/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))
if __name__=='__main__':main()
