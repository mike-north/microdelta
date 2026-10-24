#!/usr/bin/env python3
"""Clean strict reproduction. A reproduced normative failure remains a nonzero exit."""
import hashlib,json,os,pathlib,subprocess,sys,time
ROOT=pathlib.Path(__file__).resolve().parents[3]
OUT=pathlib.Path(os.environ.get('MICRODELTA_DURABLE_READ_OUTPUT',str(ROOT/'.test-build/durable-read-matrix'))).resolve()
OUT.mkdir(parents=True,exist_ok=True)
ENV=dict(os.environ)
SDK=pathlib.Path('/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk')
if sys.platform=='darwin' and SDK.is_dir(): ENV['SDKROOT']=str(SDK)
ENV['MICRODELTA_DURABLE_READ_EVIDENCE']=str(OUT/'cases.json')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def run(name,argv,timeout):
 start=time.time()
 with (OUT/(name+'.log')).open('w') as f:r=subprocess.run(argv,cwd=ROOT,env=ENV,stdout=f,stderr=subprocess.STDOUT,timeout=timeout)
 receipt={'argv':argv,'exit':r.returncode,'seconds':time.time()-start,'timeout':timeout,'log_sha256':sha(OUT/(name+'.log'))}
 (OUT/(name+'.json')).write_text(json.dumps(receipt,indent=2)+'\n')
 print(name,r.returncode,flush=True)
 return r.returncode
files=['packages/core/test/gap-hunt-durable-read-matrix.test.ts','packages/core/test/gap-hunt-durable-read-worker.ts']
before={p:sha(ROOT/p) for p in files}
for name,argv,timeout in [('install',['npm','ci','--no-audit','--no-fund'],900),('build',['npm','run','build:packages'],900),('types',['node','node_modules/typescript/bin/tsc','-p','packages/core/tsconfig.test.json'],180),('lint',['node','node_modules/eslint/bin/eslint.js',*files],180)]:
 status=run(name,argv,timeout)
 if status:raise SystemExit(status)
status=run('jest',['node','--experimental-vm-modules','node_modules/jest/bin/jest.js','--config','packages/core/jest.config.mjs','--runInBand','--runTestsByPath','packages/core/.test-build/test/gap-hunt-durable-read-matrix.test.js','--verbose','--json','--outputFile',str(OUT/'jest-results.json')],300)
assert before=={p:sha(ROOT/p) for p in files}
cases=json.loads((OUT/'cases.json').read_text());result=json.loads((OUT/'jest-results.json').read_text())
assert len(cases['cases'])==5 and result['numTotalTests']==5
successful=result['numPassedTests'];failed=result['numFailedTests']
if (successful,failed)==(4,1):
 assert status!=0 and cases['freshProcesses']==18 and cases['successfulStages']==17
 failures=[p for p in cases['processes'] if p['status']!=0]
 assert len(failures)==1 and failures[0]['mode']=='own' and failures[0]['variant']=='base'
 assert 'Native reflection is unsupported; use observer.hasOwn for supported fields' in failures[0]['stderr']
 classification='own-presence-authoring-gap-reproduced'
elif (successful,failed)==(5,0):
 assert status==0 and cases['freshProcesses']==21 and cases['successfulStages']==21
 classification='all-finite-outcomes-pass'
else:raise AssertionError('Unexpected test failure; do not classify as known gap')
(OUT/'receipt.json').write_text(json.dumps({'runtime':'7a629f94d83366131e4aa25e541a24e41db744fa','source_hashes':before,'source_unchanged':True,'cases':5,'fresh_processes':cases['freshProcesses'],'successful_stages':cases['successfulStages'],'jest_exit':status,'tests_passed':successful,'tests_failed':failed,'classification':classification,'node':subprocess.check_output(['node','--version'],text=True).strip(),'platform':sys.platform,'cases_sha256':sha(OUT/'cases.json'),'product_fixes':False,'paid_provider':False},indent=2)+'\n')
raise SystemExit(status)
