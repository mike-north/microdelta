#!/usr/bin/env python3
"""Finite clean-checkout eight-case callback privacy reproduction; no provider execution."""
from pathlib import Path
import hashlib,json,os,platform,re,subprocess,tempfile
ROOT=Path(__file__).resolve().parents[3]
PREFIX='scratch/gap-hunt/error-privacy-callbacks/'
BASE='7677ec4d61fd78efc63da28906175707e1391f12'
OUT=Path(os.environ.get('MICRODELTA_EVIDENCE_OUTPUT',tempfile.mkdtemp(prefix='microdelta-callback-evidence-')))
def git(*args):return subprocess.check_output(['git','-c','core.fsmonitor=false',*args],cwd=ROOT)
def guard():
    assert not git('status','--porcelain','--untracked-files=all'),'Use clean checkout'
    paths=git('diff','--name-only',BASE,'HEAD').decode().splitlines()
    assert all(p.startswith(PREFIX) for p in paths),paths
    assert git('rev-parse',BASE+':packages/resolution/src/resolution.ts').decode().strip()=='f6017e0105d24fdcff33d9ad6b617886d0746bf8'
guard();OUT.mkdir(parents=True,exist_ok=True)
receipt={'source':BASE,'head':git('rev-parse','HEAD').decode().strip(),'platform':platform.platform(),'node':subprocess.check_output(['node','--version']).decode().strip(),'npm':subprocess.check_output(['npm','--version']).decode().strip(),'node_modules_absent_before':not(ROOT/'node_modules').exists(),'clean_before':True,'commands':[]}
print('Evidence output: '+str(OUT),flush=True)
def save(): (OUT/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
def run(name,args):
    p=subprocess.run(args,cwd=ROOT,capture_output=True,text=True,timeout=900)
    (OUT/(name+'.stdout.log')).write_text(p.stdout.replace(str(ROOT),'<checkout>'))
    (OUT/(name+'.stderr.log')).write_text(p.stderr.replace(str(ROOT),'<checkout>'))
    receipt['commands'].append({'name':name,'argv':args,'exit':p.returncode});save()
    print(name+': '+str(p.returncode),flush=True)
    return p
for name,args in [('install',['npm','ci','--no-audit','--no-fund']),('build',['npm','run','build:packages']),('compile',['node_modules/.bin/tsc','-p',PREFIX+'tsconfig.json']),('lint',['node_modules/.bin/eslint','-c',PREFIX+'eslint.config.mjs',PREFIX+'callbacks.test.ts','--max-warnings','0'])]:
    p=run(name,args);assert p.returncode==0,(name,p.returncode)
p=run('jest',['node','--experimental-vm-modules','node_modules/jest/bin/jest.js','--config',PREFIX+'jest.config.mjs','--runInBand','--json','--outputFile',str(OUT/'jest.json')])
data=json.loads((OUT/'jest.json').read_text());tests=[t for suite in data['testResults'] for t in suite['assertionResults']]
observations=[json.loads(m.group(1)) for m in re.finditer(r'^\s*callback-observation (\{[^\n]+\})\s*$',p.stdout+'\n'+p.stderr,re.MULTILINE)]
failed=[t['fullName'] for t in tests if t['status']=='failed']
receipt.update({'passed':data['numPassedTests'],'failed':failed,'total':data['numTotalTests'],'runtime_error_suites':data['numRuntimeErrorTestSuites'],'observations':observations});save()
assert p.returncode==1 and data['numPassedTests']==4 and data['numFailedTests']==4 and data['numTotalTests']==8
assert data['numRuntimeErrorTestSuites']==0 and data['numTotalTestSuites']==1
routes=['source','supplied','strict-fold','outcome-fold']
assert failed==[r+'/author-resolution-error: outer framework failure keeps authored text in exact cause' for r in routes]
assert len(observations)==8
for o in observations:
    assert o['calls']==1 and not o['completedResult'] and o['failedStepResults']=={'count':0},o
    if o['mode']=='plain-error':
        assert o['outerCode']=='execution-failure' and 'SYNTHETIC-CALLBACK-DETAIL-4c81' not in o['outerMessage'] and o['boundaryCauseIsThrown'] and not o['outerIsThrown'],o
    else:
        assert o['outerCode']=='unsupported-result' and o['outerMessage']=='SYNTHETIC-CALLBACK-DETAIL-4c81' and o['outerIsThrown'] and not o['causeIsThrown'],o
guard();receipt['clean_after']=True;save();print(json.dumps(receipt,indent=2))
