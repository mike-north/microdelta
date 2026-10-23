#!/usr/bin/env python3
"""Reproduce the bounded failure with real commands and a precise negative oracle."""
from pathlib import Path
import hashlib,json,os,platform,re,subprocess,time
ROOT=Path(__file__).resolve().parents[3]
PREFIX='scratch/gap-hunt/error-privacy/'
BASE='2a640aca75d5728484a2cb06af88c77690616ba9'
TEST='packages/core/test/gap-hunt-error-privacy.test.ts'
OUT=ROOT/PREFIX/'local-results'
def git(*args):return subprocess.check_output(['git','-c','core.fsmonitor=false',*args],cwd=ROOT)
def normalized(text):return text.replace(str(ROOT),'<checkout>')
def guard():
    for args in [('diff','--name-only','-z',BASE,'HEAD'),('diff','--name-only','-z','HEAD'),('ls-files','--others','--exclude-standard','-z')]:
        assert all(not p or p==TEST or p.startswith(PREFIX) for p in git(*args).decode().split('\0')),args
    assert not git('status','--porcelain','--untracked-files=all'), 'Use a clean evidence checkout'
guard()
assert subprocess.check_output(['node','--version']).decode().startswith('v24.'),'Use Node24'
OUT.mkdir(parents=True,exist_ok=True)
receipt={'source':BASE,'head':git('rev-parse','HEAD').decode().strip(),'platform':platform.platform(),'architecture':platform.machine(),'node':subprocess.check_output(['node','--version']).decode().strip(),'npm':subprocess.check_output(['npm','--version']).decode().strip(),'clean_before':True,'node_modules_absent_before':not (ROOT/'node_modules').exists(),'test_sha256':hashlib.sha256((ROOT/TEST).read_bytes()).hexdigest(),'commands':[]}
def save(): (OUT/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
def run(name,command):
    start=time.monotonic();result=subprocess.run(command,cwd=ROOT,capture_output=True,text=True,timeout=900)
    (OUT/(name+'.stdout.log')).write_text(normalized(result.stdout));(OUT/(name+'.stderr.log')).write_text(normalized(result.stderr))
    receipt['commands'].append({'name':name,'argv':command,'exit':result.returncode,'seconds':time.monotonic()-start});save();return result
for name,command in [('install',['npm','ci','--no-audit','--no-fund']),('build',['npm','run','build:packages']),('compile',['node_modules/.bin/tsc','-p','packages/core/tsconfig.test.json']),('lint',['node_modules/.bin/eslint',TEST])]:
    result=run(name,command);assert result.returncode==0,(name,result.returncode)
output=PREFIX+'local-results/jest.json'
result=run('jest',['node','--experimental-vm-modules','node_modules/jest/bin/jest.js','--config','packages/core/jest.config.mjs','--runInBand','--runTestsByPath','packages/core/.test-build/test/gap-hunt-error-privacy.test.js','--json','--outputFile',output])
data=json.loads((ROOT/output).read_text());tests=[t for suite in data['testResults'] for t in suite['assertionResults']];failed=[t['fullName'] for t in tests if t['status']=='failed']
observations=[json.loads(m.group(1)) for m in re.finditer(r'^\s*author-error-observation (\{[^\n]+\})\s*$',result.stdout+'\n'+result.stderr,re.MULTILINE)]
receipt.update({'jestExit':result.returncode,'passed':data['numPassedTests'],'failed':failed,'runtimeErrorSuites':data['numRuntimeErrorTestSuites'],'observations':observations});save()
assert result.returncode==1 and data['numPassedTests']==8 and data['numFailedTests']==1
assert failed==['author-resolution-error: author text stays in cause rather than the framework failure message'] and data['numRuntimeErrorTestSuites']==0
assert len(observations)==2
by_mode={x['mode']:x for x in observations}
a=by_mode['author-resolution-error'];b=by_mode['plain-error']
assert a['outerCode']=='unsupported-result' and a['outerMessage']=='SYNTHETIC-OPAQUE-DETAIL-9d72' and a['outerIsThrown'] and not a['causeIsThrown'] and not a['completedResult']
assert b['outerCode']=='execution-failure' and 'SYNTHETIC-OPAQUE-DETAIL-9d72' not in b['outerMessage'] and b['causeIsThrown'] and not b['outerIsThrown'] and not b['completedResult']
guard();receipt['clean_after']=True;save();print(json.dumps(receipt,indent=2))
