"""Clean-checkout exact-head repair proof; zero means positive and expected-negative controls match."""
from pathlib import Path
import hashlib,json,re,shutil,subprocess,time,platform
ROOT=Path(__file__).resolve().parents[3]
BASE='7a1c272c39b7d7e35e2cd9a0971d83312bde6ab3'
ORIGIN='e33ad02939a7b217a7ec754f097b6391ad581b13'
EVIDENCE='scratch/gap-hunt/review-178-repair/'
FIXTURE='scratch/gap-hunt/review-178/'
OUT=ROOT/EVIDENCE/'local-results'
sha=lambda b:hashlib.sha256(b).hexdigest()
def git(*args):return subprocess.check_output(['git','-c','core.fsmonitor=false',*args],cwd=ROOT)
def guard():
 for args in [('diff','--name-only','-z',BASE,'HEAD'),('diff','--name-only','-z','HEAD'),('ls-files','--others','--exclude-standard','-z')]:
  for path in git(*args).decode().split('\0'):
   assert not path or path.startswith((EVIDENCE,FIXTURE)),f'Unqualified tree change: {path}'
 manifest_bytes=(ROOT/FIXTURE/'overlay-hashes.json').read_bytes()
 assert sha(manifest_bytes)=='eb886b7373eff91add5cb55bc7925c2417d6ec83a49e80b58bcd5ed881f09441'
 manifest=json.loads(manifest_bytes)
 for item in manifest:
  assert sha((ROOT/FIXTURE/item['file']).read_bytes())==item['sha256'],item['file']
 return manifest
checks=[]
def run(name,argv,expected=0):
 start=time.monotonic()
 with (OUT/(name+'.log')).open('w') as log:r=subprocess.run(argv,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,timeout=600)
 log_path=OUT/(name+'.log');log_path.write_text(log_path.read_text().replace(str(ROOT),'<checkout>'))
 checks.append({'name':name,'argv':[str(a).replace(str(ROOT),'<checkout>') for a in argv],'exit':r.returncode,'seconds':time.monotonic()-start})
 (OUT/'commands.json').write_text(json.dumps(checks,indent=2)+'\n')
 assert r.returncode==expected,(name,r.returncode,expected)
def counts(name,passed,failed):
 data=json.loads((OUT/(name+'.json')).read_text())
 actual=[data[k] for k in ['numPassedTests','numFailedTests','numPendingTests','numRuntimeErrorTestSuites']]
 assert actual==[passed,failed,0,0],(name,actual)
 assert data['success']==(failed==0)
 if failed:
  failures=[t for s in data['testResults'] for t in s['assertionResults'] if t['status']=='failed']
  assert len(failures)==1 and failures[0]['title']=='current subject moved to another occurrence validates its current from edge'
  # Process receipts establish the actual stale value/reference/body behavior,
  # independently of Jest's optional rendered source frame or matcher message.
  cold=json.loads((ROOT/FIXTURE/'local-results/jest-receipt-7.json').read_text())
  stale=json.loads((ROOT/FIXTURE/'local-results/jest-receipt-8.json').read_text())
  assert stale['mode']=='swap' and stale['expected']==2
  assert stale['result']['data']==1 and stale['result']['kind']=='reused'
  assert stale['result']['reference']==cold['result']['reference']
  assert not [e for e in stale['events'] if e['kind']=='step' and e['event']['phase'] in ['execute','publish']]
 return actual
def receipts(name):
 target=OUT/(name+'-process-receipts')
 if target.exists():shutil.rmtree(target)
 shutil.copytree(ROOT/FIXTURE/'local-results',target)
def main():
 manifest=guard();OUT.mkdir(parents=True,exist_ok=True)
 run('install',['npm','ci','--no-audit','--no-fund'])
 run('packages',['npm','run','build:packages'])
 run('fixtures',['npm','run','build:fixtures'])
 run('occurrence-types',['node','node_modules/typescript/bin/tsc','-p',FIXTURE+'tsconfig.occurrence.json'])
 run('occurrence-lint',['node','node_modules/eslint/bin/eslint.js','--no-ignore','--config',FIXTURE+'occurrence.eslint.config.mjs',FIXTURE+'occurrence-worker.ts'])
 jest=['node','--experimental-vm-modules','node_modules/jest/bin/jest.js','--config',FIXTURE+'occurrence.jest.config.mjs','--runInBand','--json','--outputFile']
 run('positive',jest+[str(OUT/'positive.json')]);positive=counts('positive',5,0);receipts('positive')
 emitted=ROOT/FIXTURE/'occurrence-dist/experiments/exp-authoring/src/execute.js'
 original=emitted.read_bytes()
 needle=b"    if (typeof recipe.subject !== 'string' || recipe.subject.length === 0) {\n        throw new TypeError('Missing current recipe subject association');\n    }"
 assert original.count(needle)==1
 try:
  emitted.write_bytes(original.replace(needle,b'    // Negative control: omit current subject observation.'))
  run('negative',jest+[str(OUT/'negative.json')],1);negative=counts('negative',4,1);receipts('negative')
 finally:emitted.write_bytes(original)
 assert emitted.read_bytes()==original
 run('restored',jest+[str(OUT/'restored.json')]);restored=counts('restored',5,0);receipts('restored')
 run('experiment-types',['node','node_modules/typescript/bin/tsc','-p','experiments/exp-authoring/tsconfig.test.json'])
 run('official-tsd',['node','node_modules/tsd/dist/cli.js','--typings','experiments/exp-authoring/src/protocol.ts','--files','experiments/exp-authoring/test-d/protocol.test-d.ts'])
 run('origin-checks',['node','--test','tooling/authoring-origins.test.mjs'])
 guard()
 summary={'runtime_pin':BASE,'actual_os':platform.platform(),'architecture':platform.machine(),'head':git('rev-parse','HEAD').decode().strip(),'original_evidence':ORIGIN,'overlay_hashes':manifest,'positive':positive,'negative':negative,'restored':restored,'emitted_restored_sha256':sha(original),'node':subprocess.check_output(['node','--version'],text=True).strip(),'npm':subprocess.check_output(['npm','--version'],text=True).strip(),'scope':'bounded frozen occurrence witness with current dependencies, strict compile/lint, officialtsd and origin-tooling mutant; prior invariant-input covariance mutation not repeated; no fullsuite/Linux/capacity'}
 (OUT/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))
if __name__=='__main__':main()
