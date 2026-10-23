"""Clean exact-head qualification of #169; #156 remains a separate limitation."""
from pathlib import Path
import subprocess,json,hashlib,re
ROOT=Path(__file__).resolve().parents[3]
PIN='4661e7df2eb6c46018c0cb1febb83e20d5dcbab0';PREFIX='scratch/gap-hunt/review-181/'
OUT=ROOT/PREFIX/'local-results'
ORIGINALS={row['path'] for row in json.loads((ROOT/PREFIX/'original-overlay.json').read_text())['files']}
def git(*args):return subprocess.check_output(['git','-c','core.fsmonitor=false',*args],cwd=ROOT)
def guard():
 for args in [('diff','--name-only','-z',PIN,'HEAD'),('diff','--name-only','-z','HEAD'),('ls-files','--others','--exclude-standard','-z')]:assert all(not p or p.startswith(PREFIX) or p in ORIGINALS for p in git(*args).decode().split('\0')),args
checks=[]
def run(name,args):
 with (OUT/(name+'.log')).open('w') as log:r=subprocess.run(args,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,timeout=900)
 checks.append({'name':name,'args':args,'exit':r.returncode});(OUT/'commands.json').write_text(json.dumps(checks,indent=2)+'\n');assert r.returncode==0,(name,r.returncode)
def main():
 guard();OUT.mkdir(parents=True,exist_ok=True)
 manifest=json.loads((ROOT/PREFIX/'original-overlay.json').read_text())
 for row in manifest['files']:
  data=(ROOT/row['path']).read_bytes();assert hashlib.sha256(data).hexdigest()==row['sha256'],row['path']
 run('original-replay',['node','scratch/gap-hunt/consumer-dx/repro-async-source.mjs'])
 text=(OUT/'original-replay.log').read_text();assert 'Tests:       2 passed, 2 total' in text;assert 'Async source type acceptance passed.' in text
 run('parent-control',['python3',PREFIX+'parent-control.py'])
 run('core-tsd',['npm','run','test:types','--workspace','microdelta'])
 run('core-types',['node','node_modules/typescript/bin/tsc','-p','packages/core/tsconfig.test.json'])
 run('focused-lint',['node','node_modules/eslint/bin/eslint.js','packages/core/test-d/async-source.test-d.ts','packages/core/test/workspace/async-source.test.ts'])
 tests=['workspace/async-source','resolution/source-policy','workspace/scope','workspace/admission-observers','acceptance/source-policy','acceptance/admission-observers']
 run('focused-runtime',['node','--experimental-vm-modules','node_modules/jest/bin/jest.js','--config','packages/core/jest.config.mjs','--runInBand','--json','--outputFile',str(OUT/'focused-runtime.json'),'--runTestsByPath',*['packages/core/.test-build/test/'+n+'.test.js' for n in tests]])
 run('root-boundary',['node',PREFIX+'root-boundary.mjs'])
 guard()
 summary={'head':git('rev-parse','HEAD').decode().strip(),'reviewed_pin':PIN,'original_consumer_exit':0,'original_runtime_passed':2,'parent_ts2322_errors':4,'restored_compiler_exit':0,'focused_runtime_passed':63,'root_controls_passed':2,'verdict':'PASS for #169; #156 remains open','scope':'macOS Node24 bounded tests; no Linux/fullsuite/TrackG/provider execution'}
 jest=json.loads((OUT/'focused-runtime.json').read_text());assert jest['numPassedTests']==63 and jest['numFailedTests']==0 and jest['numRuntimeErrorTestSuites']==0
 summary['suite_breakdown']=[{'path':row['name'].split('/.test-build/test/')[-1],'passed':sum(t['status']=='passed' for t in row['assertionResults'])} for row in jest['testResults']]
 summary['numRuntimeErrorTestSuites']=jest['numRuntimeErrorTestSuites']
 (OUT/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))
if __name__=='__main__':main()
