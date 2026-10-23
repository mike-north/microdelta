"""Clean-checkout reproduction: build this pinned PR runtime, then require four controls and one semantic red."""
import hashlib,json,pathlib,subprocess,time
root=pathlib.Path(__file__).resolve().parents[3]
source=root/'scratch/gap-hunt/review-178'
out=source/'local-results'
out.mkdir(parents=True,exist_ok=True)
pin='577644f188a80bf7b081804fd63fe23ba263f88f'
# Evidence-only commits may advance HEAD, but must never change the runtime under review.
for path in ['packages','experiments/exp-authoring','tooling','package-lock.json','package.json','tsconfig.json','tsconfig.base.json']:
 assert not subprocess.check_output(['git','diff',pin,'--',path],cwd=root),f'Runtime drift: {path}'
for entry in json.loads((source/'overlay-hashes.json').read_text()):
 assert hashlib.sha256((source/entry['file']).read_bytes()).hexdigest()==entry['sha256'],f"Overlay drift: {entry['file']}"
checks=[]
def run(name,argv,expected=0):
 start=time.time()
 with (out/('repro-'+name+'.log')).open('w') as f:p=subprocess.run(argv,cwd=root,stdout=f,stderr=subprocess.STDOUT,timeout=600)
 check={'name':name,'argv':argv,'exit_code':p.returncode,'seconds':time.time()-start,'log_sha256':hashlib.sha256((out/('repro-'+name+'.log')).read_bytes()).hexdigest()};checks.append(check)
 (out/'repro-checks.json').write_text(json.dumps(checks,indent=2)+'\n');print(name,p.returncode,flush=True)
 assert p.returncode==expected,name
run('install',['npm','ci','--no-audit','--no-fund'])
run('packages',['npm','run','build:packages'])
run('types',['node','node_modules/typescript/bin/tsc','-p','scratch/gap-hunt/review-178/tsconfig.occurrence.json'])
run('lint',['node','node_modules/eslint/bin/eslint.js','--no-ignore','--config','scratch/gap-hunt/review-178/occurrence.eslint.config.mjs','scratch/gap-hunt/review-178/occurrence-worker.ts'])
run('jest',['node','--experimental-vm-modules','node_modules/jest/bin/jest.js','--config','scratch/gap-hunt/review-178/occurrence.jest.config.mjs','--runInBand','--json','--outputFile',str(out/'repro-jest-results.json')],1)
j=json.loads((out/'repro-jest-results.json').read_text())
assert [j['numFailedTests'],j['numPassedTests'],j['numPendingTests'],j['numRuntimeErrorTestSuites']]==[1,4,0,0]
failed=[a for r in j['testResults'] for a in r['assertionResults'] if a['status']=='failed']
assert len(failed)==1 and failed[0]['title']=='current subject moved to another occurrence validates its current from edge'
(out/'repro-metadata.json').write_text(json.dumps({'runtime_pin':pin,'checkout_head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'node':subprocess.check_output(['node','--version'],text=True).strip(),'npm':subprocess.check_output(['npm','--version'],text=True).strip(),'failed':1,'passed':4,'runtime_errors':0},indent=2)+'\n')
print('Expected counterexample reproduced: one semantic Jest failure, four controls pass, zero runtime errors. Wrapper exits0 only for that exact bounded result.')
