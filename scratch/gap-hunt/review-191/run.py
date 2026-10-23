#!/usr/bin/env python3
"""Install and verify exact PR191 code using isolated local synthetic SQLite stores."""
import json
import pathlib
import platform
import subprocess
import tempfile
root = pathlib.Path(__file__).resolve().parents[3]
def output(argv):
    return subprocess.check_output(argv, cwd=root, text=True).strip()
head = output(['git','-c','core.fsmonitor=false','rev-parse','HEAD'])
source = 'ee72391e330188dbd143d3889f4867da23a468d1'
assert subprocess.run(['git','merge-base','--is-ancestor',source,head],cwd=root).returncode == 0
assert output(['git','diff',source,'--','packages','package.json','package-lock.json','tooling']) == ''
receipt = {'source':source,'evidenceHead':head,'platform':platform.platform(),'node':output(['node','--version']),'npm':output(['npm','--version']),'nodeModulesBefore':(root/'node_modules').exists(),'statusBefore':output(['git','-c','core.fsmonitor=false','status','--porcelain']),'commands':[]}
commands = [['npm','ci','--no-audit','--no-fund'],['npm','run','build:packages'],['node_modules/.bin/tsc','-p','packages/core/tsconfig.test.json']]
for command in commands:
    result = subprocess.run(command,cwd=root,capture_output=True,text=True)
    receipt['commands'].append({'argv':command,'exit':result.returncode})
    if result.returncode:
        print((result.stdout+result.stderr).replace(str(root),'<checkout>'))
        raise SystemExit(result.returncode)
with tempfile.TemporaryDirectory(prefix='pr191-jest-') as temporary:
    path = pathlib.Path(temporary)/'jest.json'
    command = ['node','--experimental-vm-modules','node_modules/jest/bin/jest.js','--config','packages/core/jest.config.mjs','--runInBand','--runTestsByPath','packages/core/.test-build/test/durable-history/durable-history.test.js','packages/core/.test-build/test/container-guard.test.js','--json','--outputFile',str(path)]
    result = subprocess.run(command,cwd=root,capture_output=True,text=True)
    data = json.loads(path.read_text())
    receipt['jest'] = {'exit':result.returncode,'passed':data['numPassedTests'],'failed':data['numFailedTests'],'runtimeErrorSuites':data['numRuntimeErrorTestSuites'],'passedSuites':data['numPassedTestSuites']}
    assert result.returncode == 0 and data['numPassedTests'] == 98 and data['numFailedTests'] == 0 and data['numRuntimeErrorTestSuites'] == 0
receipt['census'] = json.loads(output(['node','scratch/gap-hunt/review-191/census.mjs']))
receipt['statusAfter'] = output(['git','-c','core.fsmonitor=false','status','--porcelain'])
assert receipt['statusBefore'] == receipt['statusAfter'] == ''
print(json.dumps(receipt,indent=2))
