#!/usr/bin/env python3
"""Install/build the frozen runtime and verify one six-process TRK-7 matrix."""
import hashlib,json,os,pathlib,subprocess,sys,time
ROOT=pathlib.Path(__file__).resolve().parents[3]
OUT=pathlib.Path(os.environ.get('MICRODELTA_IDENTITY_OUTPUT',str(ROOT/'.test-build/identity-combination'))).resolve()
OUT.mkdir(parents=True,exist_ok=True)
ENV=dict(os.environ)
SDK=pathlib.Path('/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk')
if sys.platform=='darwin' and SDK.is_dir():ENV['SDKROOT']=str(SDK)
ENV['MICRODELTA_IDENTITY_EVIDENCE']=str(OUT/'cases.json')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def run(name,argv,timeout):
 start=time.time()
 with (OUT/(name+'.log')).open('w') as f:r=subprocess.run(argv,cwd=ROOT,env=ENV,stdout=f,stderr=subprocess.STDOUT,timeout=timeout)
 receipt={'argv':argv,'exit':r.returncode,'seconds':time.time()-start,'timeout':timeout,'log_sha256':sha(OUT/(name+'.log'))}
 (OUT/(name+'.json')).write_text(json.dumps(receipt,indent=2)+'\n');print(name,r.returncode,flush=True)
 if r.returncode:raise SystemExit(r.returncode)
files=['packages/core/test/gap-hunt-identity-combination.test.ts','packages/core/test/gap-hunt-identity-combination-worker.ts']
before={p:sha(ROOT/p) for p in files}
for name,argv,timeout in [('install',['npm','ci','--no-audit','--no-fund'],900),('build',['npm','run','build:packages'],900),('types',['node','node_modules/typescript/bin/tsc','-p','packages/core/tsconfig.test.json'],180),('lint',['node','node_modules/eslint/bin/eslint.js',*files],180),('jest',['node','--experimental-vm-modules','node_modules/jest/bin/jest.js','--config','packages/core/jest.config.mjs','--runInBand','--runTestsByPath','packages/core/.test-build/test/gap-hunt-identity-combination.test.js','--verbose','--json','--outputFile',str(OUT/'jest-results.json')],300)]:run(name,argv,timeout)
assert before=={p:sha(ROOT/p) for p in files}
cases=json.loads((OUT/'cases.json').read_text());result=json.loads((OUT/'jest-results.json').read_text());captures=cases['captures'];reports=[x['report'] for x in captures]
assert cases['freshProcesses']==6 and len(captures)==6
assert all(x['status']==0 for x in captures)
assert [x['bodies'] for x in reports]==[1,0,0,1,1,0]
assert [x['kind'] for x in reports]==['published','reused','reused','published','published','reused']
assert [(x['first'],x['second']) for x in reports]==[('first:a','second:a')]*3+[('first:b','second:a'),('first:b','second:b'),('first:b','second:b')]
assert all(x['key']=='output:fixed' for x in reports)
refs=[x['reference'] for x in reports]
assert refs[0]==refs[1]==refs[2] and refs[3]!=refs[2] and refs[4]!=refs[3] and refs[5]==refs[4] and len(set(refs))==3
assert result['numPassedTests']==1 and result['numFailedTests']==0
(OUT/'receipt.json').write_text(json.dumps({'runtime':'7a629f94d83366131e4aa25e541a24e41db744fa','source_hashes':before,'source_unchanged':True,'fresh_processes':6,'tests_passed':1,'tests_failed':0,'body_counts':[x['bodies'] for x in reports],'unique_references':len(set(refs)),'classification':'bounded combined input identity consumption, independent explicit output identity and subject','node':subprocess.check_output(['node','--version'],text=True).strip(),'platform':sys.platform,'cases_sha256':sha(OUT/'cases.json'),'product_fixes':False,'paid_provider':False},indent=2)+'\n')
print('verified six fresh processes, body counts 1/0/0/1/1/0, three exact references',flush=True)
