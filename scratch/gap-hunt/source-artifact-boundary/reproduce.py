#!/usr/bin/env python3
"""One clean-checkout, strict compiler/Jest reproduction; no provider or product mutation."""
import hashlib,json,os,pathlib,subprocess,sys,time
ROOT=pathlib.Path(__file__).resolve().parents[3]
OUT=pathlib.Path(os.environ.get('MICRODELTA_BOUNDARY_OUTPUT',str(ROOT/'.test-build/source-artifact-boundary')))
OUT.mkdir(parents=True,exist_ok=True)
ENV=dict(os.environ)
# Use an installed CLT SDK command-locally on Darwin when available; no global tool changes.
SDK=pathlib.Path('/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk')
if sys.platform=='darwin' and SDK.is_dir(): ENV['SDKROOT']=str(SDK)
ENV['MICRODELTA_SOURCE_ARTIFACT_EVIDENCE']=str(OUT/'cases.json')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def run(name,argv,timeout):
 start=time.time()
 with (OUT/(name+'.log')).open('w') as f:r=subprocess.run(argv,cwd=ROOT,env=ENV,stdout=f,stderr=subprocess.STDOUT,timeout=timeout)
 receipt={'argv':argv,'exit':r.returncode,'seconds':time.time()-start,'timeout':timeout,'log_sha256':sha(OUT/(name+'.log'))}
 (OUT/(name+'.json')).write_text(json.dumps(receipt,indent=2)+'\n')
 print(name,r.returncode,flush=True)
 if r.returncode:raise SystemExit(r.returncode)
files=['packages/core/test/gap-hunt-source-artifact-'+x for x in ['boundary.test.ts','worker.ts','intermediary.ts','leaf.ts']]
before={p:sha(ROOT/p) for p in files}
run('install',['npm','ci','--no-audit','--no-fund'],900)
run('build',['npm','run','build:packages'],900)
run('types',['node','node_modules/typescript/bin/tsc','-p','packages/core/tsconfig.test.json'],180)
run('lint',['node','node_modules/eslint/bin/eslint.js',*files],180)
run('jest',['node','--experimental-vm-modules','node_modules/jest/bin/jest.js','--config','packages/core/jest.config.mjs','--runInBand','--runTestsByPath','packages/core/.test-build/test/gap-hunt-source-artifact-boundary.test.js','--verbose'],300)
assert before=={p:sha(ROOT/p) for p in files}
cases=json.loads((OUT/'cases.json').read_text());assert len(cases['cases'])==4 and cases['spawnedProcesses']==12
(OUT/'receipt.json').write_text(json.dumps({'runtime':'7a629f94d83366131e4aa25e541a24e41db744fa','source_hashes':before,'source_unchanged':True,'cases':4,'fresh_processes':12,'node':subprocess.check_output(['node','--version'],text=True).strip(),'platform':sys.platform,'cases_sha256':sha(OUT/'cases.json'),'product_fixes':False,'paid_provider':False},indent=2)+'\n')
