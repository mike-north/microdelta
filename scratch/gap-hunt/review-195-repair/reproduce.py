#!/usr/bin/env python3
"""Verify the bounded memo repair and reproduce two remaining RUN-013 failures."""
import hashlib,json,os,platform,re,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];os.chdir(ROOT)
PREFIX=Path('scratch/gap-hunt/review-195-repair')
OUT=Path(os.environ.get('MICRODELTA_EVIDENCE_OUTPUT',tempfile.mkdtemp(prefix='microdelta-review195-')));OUT.mkdir(parents=True,exist_ok=True)
print(f'Evidence output: {OUT}',flush=True)
SOURCE='a13a3fd88ffe5ed24334f60af84316b31d98971e';OLD='5e3b2feba7191d6d643e571492730e5344b73b22';ORIGINAL='49c47b79346e78ae9ef22f8985d254254200a14c';CALLBACK='350805fbfa423b8bfdfaeba4fe7ea3b8f7a51b3c'
NODE=subprocess.check_output(['node','-p','process.execPath'],text=True).strip();rows=[]
EXPECTED={'original-current':(0,9,9,0,1,1),'official':(0,12,12,0,1,1),'privacy':(0,6,6,0,1,1),'callbacks':(4,4,8,1,0,1),'mutation':(2,1,3,1,0,1),'original-old':(1,8,9,1,0,1),'mutation-old':(2,1,3,1,0,1),'original-restored':(0,9,9,0,1,1),'mutation-restored':(2,1,3,1,0,1)}
def summary(log,label):
 values=re.findall(r'^'+re.escape(label)+r':\s+(?:(\d+) failed,\s+)?(?:(\d+) passed,\s+)?(\d+) total\s*$',log,re.M)
 assert len(values)==1,f'{label}: missing/ambiguous summary'
 return tuple(int(v or '0') for v in values[0])
def observations(log,label):return [json.loads(m.group(1)) for m in re.finditer(r'^\s*'+re.escape(label)+r' (\{[^\n]+\})\s*$',log,re.M)]
def guard(name,log,data):
 assert not re.search(r'Test suite failed to run|Cannot find module|Jest encountered an unexpected token',log)
 assert summary(log,'Tests')+summary(log,'Test Suites')==EXPECTED[name],name
 assert data['numRuntimeErrorTestSuites']==0
 tests=[t for suite in data['testResults'] for t in suite['assertionResults']];failed=sorted(t['fullName'] for t in tests if t['status']=='failed')
 assert len(tests)==EXPECTED[name][2] and len(failed)==EXPECTED[name][0]
 if name.startswith('mutation'):
  assert failed==sorted(f'{mode}: real child failure preserves safe outer text and refuses parent publication' for mode in ['mutate-rethrow','mutate-swallow'])
  seen=observations(log,'child-mutation-observation');assert len(seen)==3
  for item in seen:
   assert item['outerCode']=='unsupported-result' and item['rows']=={'count':0} and not item['completed']
   if item['mode']=='unmodified':assert item['mutations']==0 and not item['outerIsMutated'] and 'SYNTHETIC-RELABELED-CHILD-8b42' not in item['outerMessage']
   else:assert item['mutations']==1 and item['outerIsMutated'] and item['outerMessage']=='SYNTHETIC-RELABELED-CHILD-8b42'
 elif name=='callbacks':
  assert failed==sorted(f'{route}/author-resolution-error: outer framework failure keeps authored text in exact cause' for route in ['source','supplied','strict-fold','outcome-fold'])
  seen=observations(log,'callback-observation');assert len(seen)==8
  for item in seen:
   assert item['calls']==1 and not item['completedResult'] and item['failedStepResults']=={'count':0}
   if item['mode']=='plain-error':assert item['outerCode']=='execution-failure' and not item['outerIsThrown'] and item['boundaryCauseIsThrown'] and 'SYNTHETIC-CALLBACK-DETAIL-4c81' not in item['outerMessage']
   else:assert item['outerCode']=='unsupported-result' and item['outerIsThrown'] and not item['boundaryCauseIsThrown'] and item['outerMessage']=='SYNTHETIC-CALLBACK-DETAIL-4c81'
 elif name.startswith('original'):
  seen=observations(log,'author-error-observation');assert len(seen)==2
  for item in seen:
   assert not item['completedResult']
   if name=='original-old' and item['mode']=='author-resolution-error':assert item['outerCode']=='unsupported-result' and item['outerIsThrown'] and not item['causeIsThrown'] and item['outerMessage']=='SYNTHETIC-OPAQUE-DETAIL-9d72'
   else:assert item['outerCode']=='execution-failure' and not item['outerIsThrown'] and item['causeIsThrown'] and 'SYNTHETIC-OPAQUE-DETAIL-9d72' not in item['outerMessage']
  if name=='original-old':assert failed==['author-resolution-error: author text stays in cause rather than the framework failure message']
if len(sys.argv)>1 and sys.argv[1]=='--check-logs':
 directory=Path(sys.argv[2])
 for name in EXPECTED:guard(name,(directory/f'{name}.log').read_text(),json.loads((directory/f'{name}.json').read_text()))
 rejected=[]
 for name,log in [('missing',''),('load','Test suite failed to run\n'),('forgedload','Test suite failed to run\nTests: 2 failed, 1 passed, 3 total\nTest Suites: 1 failed, 1 total\n'),('wrongcount','Tests: 3 failed, 3 total\nTest Suites: 1 failed, 1 total\n')]:
  try:guard('mutation',log,{})
  except (AssertionError,KeyError):rejected.append(name)
  else:raise AssertionError('Unsafe log accepted')
 print(json.dumps({'status':'PASS','exactJestLogs':len(EXPECTED),'syntheticRejected':rejected},indent=2));sys.exit(0)
def gitbytes(pin,path):return subprocess.check_output(['git','show',f'{pin}:{path}'])
def command(name,args,expected=0):
 env=dict(os.environ);env.pop('GAP_HUNT_REUSE_BUILD',None)
 p=subprocess.run(args,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
 log=p.stdout.replace(str(ROOT),'<checkout>').replace(NODE,'<node>');(OUT/f'{name}.log').write_text(log)
 rows.append(dict(name=name,command=args,exit=p.returncode,expected=expected));print(f'{name}: {p.returncode} (expected {expected})',flush=True)
 assert p.returncode==expected,name
 if name in EXPECTED:
  result=OUT/f'{name}.json'
  result.write_text(result.read_text().replace(str(ROOT),'<checkout>').replace(NODE,'<node>'))
  guard(name,log,json.loads(result.read_text()))
def jest(name,config,path=None,expected=0):
 args=['node','--experimental-vm-modules','node_modules/jest/bin/jest.js','--config',config,'--runInBand','--json','--outputFile',str(OUT/f'{name}.json')]
 if path is not None:args+=['--runTestsByPath',path]
 command(name,args,expected)
frozen=[(ORIGINAL,'packages/core/test/gap-hunt-error-privacy.test.ts','original.test.ts'),(ORIGINAL,'scratch/gap-hunt/error-privacy/run.py','original-run.py'),(CALLBACK,'scratch/gap-hunt/error-privacy-callbacks/callbacks.test.ts','callbacks.test.ts'),(CALLBACK,'scratch/gap-hunt/error-privacy-callbacks/run.py','callbacks-run.py')]
for pin,path,file in frozen:assert (PREFIX/'frozen'/file).read_bytes()==gitbytes(pin,path)
source=Path('packages/resolution/src/resolution.ts');saved=source.read_bytes();assert saved==gitbytes(SOURCE,source)
temporary=Path('packages/core/test/gap-hunt-review195-original.test.ts');assert not temporary.exists()
try:
 command('install',['npm','ci','--no-audit','--no-fund'])
 command('build',['npm','run','build:packages'])
 command('fixture-build',['npm','run','build:fixtures'])
 temporary.write_bytes((PREFIX/'frozen/original.test.ts').read_bytes())
 command('core-test-build',['node','node_modules/typescript/bin/tsc','-p','packages/core/tsconfig.test.json'])
 command('original-lint',['node','node_modules/eslint/bin/eslint.js',str(temporary)])
 command('consumer-compile',['node','node_modules/typescript/bin/tsc','-p',str(PREFIX/'tsconfig.json')])
 command('consumer-lint',['node','node_modules/eslint/bin/eslint.js','-c',str(PREFIX/'eslint.config.mjs'),str(PREFIX/'mutation.test.ts'),str(PREFIX/'frozen/callbacks.test.ts')])
 jest('original-current','packages/core/jest.config.mjs','packages/core/.test-build/test/gap-hunt-review195-original.test.js')
 jest('official','packages/core/jest.config.mjs','packages/core/.test-build/test/gap-hunt-error-privacy.test.js')
 jest('privacy','packages/core/jest.config.mjs','packages/core/.test-build/test/resolution/author-error-privacy.test.js')
 jest('callbacks',str(PREFIX/'callbacks.jest.config.mjs'),expected=1)
 jest('mutation',str(PREFIX/'mutation.jest.config.mjs'),expected=1)
 command('resolution-check',['npm','run','check','--workspace','@microdelta/resolution'])
 command('core-check',['npm','run','check','--workspace','microdelta'])
 command('declaration-check',['npm','run','check:declarations'])
 try:
  source.write_bytes(gitbytes(OLD,source));command('old-build',['npm','run','build:packages'])
  jest('original-old','packages/core/jest.config.mjs','packages/core/.test-build/test/gap-hunt-review195-original.test.js',1)
  jest('mutation-old',str(PREFIX/'mutation.jest.config.mjs'),expected=1)
 finally:
  source.write_bytes(saved);command('restored-build',['npm','run','build:packages']);assert source.read_bytes()==saved
 jest('original-restored','packages/core/jest.config.mjs','packages/core/.test-build/test/gap-hunt-review195-original.test.js')
 jest('mutation-restored',str(PREFIX/'mutation.jest.config.mjs'),expected=1)
finally:
 temporary.unlink(missing_ok=True)
 (OUT/'receipt.json').write_text(json.dumps(dict(source=SOURCE,oldResolutionSource=OLD,original=ORIGINAL,callbacks=CALLBACK,platform=platform.platform(),node=subprocess.check_output(['node','-v'],text=True).strip(),commands=rows),indent=2)+'\n')
