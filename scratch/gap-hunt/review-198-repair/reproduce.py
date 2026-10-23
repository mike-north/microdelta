#!/usr/bin/env python3
"""Qualify four callback boundaries while retaining the separate memo residual."""
from pathlib import Path
import hashlib,json,os,platform,re,subprocess,sys,tempfile
ROOT=Path(__file__).resolve().parents[3];os.chdir(ROOT)
PREFIX=Path('scratch/gap-hunt/review-198-repair')
SOURCE='094378f66dd4955a533f4878b2a820f68e233610';OLD='a13a3fd88ffe5ed24334f60af84316b31d98971e';CALLBACK='350805fbfa423b8bfdfaeba4fe7ea3b8f7a51b3c';MEMO='95679b0484bcda7d6e6a00d2cddc165041fe2baf'
OUT=Path(os.environ.get('MICRODELTA_EVIDENCE_OUTPUT',tempfile.mkdtemp(prefix='microdelta-review198-')));OUT.mkdir(parents=True,exist_ok=True)
print(f'Evidence output: {OUT}',flush=True)
rows=[];NODE=subprocess.check_output(['node','-p','process.execPath'],text=True).strip()
EXPECTED={'callbacks-current':(0,8,8,0,1,1),'official-current':(0,32,32,0,1,1),'memo':(0,12,12,0,1,1),'privacy':(0,6,6,0,1,1),'mutation-current':(2,1,3,1,0,1),'callbacks-old':(4,4,8,1,0,1),'official-old':(12,20,32,1,0,1),'callbacks-restored':(0,8,8,0,1,1),'official-restored':(0,32,32,0,1,1),'mutation-restored':(2,1,3,1,0,1)}
def summary(log,label):
 matches=re.findall(r'^'+re.escape(label)+r':\s+(?:(\d+) failed,\s+)?(?:(\d+) passed,\s+)?(\d+) total\s*$',log,re.M)
 assert len(matches)==1,label
 return tuple(int(x or '0') for x in matches[0])
def obs(log,label):return [json.loads(m.group(1)) for m in re.finditer(r'^\s*'+re.escape(label)+r' (\{[^\n]+\})\s*$',log,re.M)]
def guard(name,log,data):
 assert not re.search(r'Test suite failed to run|Cannot find module|Jest encountered an unexpected token',log)
 assert summary(log,'Tests')+summary(log,'Test Suites')==EXPECTED[name],name
 assert data['numRuntimeErrorTestSuites']==0
 tests=[t for suite in data['testResults'] for t in suite['assertionResults']];failed=sorted(t['fullName'] for t in tests if t['status']=='failed')
 assert len(tests)==EXPECTED[name][2] and len(failed)==EXPECTED[name][0]
 if name.startswith('callbacks'):
  expected=sorted(f'{route}/author-resolution-error: outer framework failure keeps authored text in exact cause' for route in ['source','supplied','strict-fold','outcome-fold']) if name=='callbacks-old' else []
  assert failed==expected
  seen=obs(log,'callback-observation');assert len(seen)==8
  for item in seen:
   assert item['calls']==1 and not item['completedResult'] and item['failedStepResults']=={'count':0}
   if name=='callbacks-old' and item['mode']=='author-resolution-error':assert item['outerCode']=='unsupported-result' and item['outerIsThrown'] and not item['boundaryCauseIsThrown'] and item['outerMessage']=='SYNTHETIC-CALLBACK-DETAIL-4c81'
   else:assert item['outerCode']=='execution-failure' and not item['outerIsThrown'] and item['boundaryCauseIsThrown'] and 'SYNTHETIC-CALLBACK-DETAIL-4c81' not in item['outerMessage']
 elif name=='official-old':
  assert failed==sorted(f'{route}/{mode}: outer framework failure keeps authored text in exact cause' for route in ['source','supplied','strict-fold','outcome-fold'] for mode in ['unsupported-result','policy-failure','execution-failure'])
 elif name.startswith('mutation'):
  assert failed==sorted(f'{mode}: real child failure preserves safe outer text and refuses parent publication' for mode in ['mutate-rethrow','mutate-swallow'])
  seen=obs(log,'child-mutation-observation');assert len(seen)==3
  for item in seen:
   assert item['outerCode']=='unsupported-result' and item['rows']=={'count':0} and not item['completed']
   if item['mode']=='unmodified':assert item['mutations']==0 and not item['outerIsMutated'] and 'SYNTHETIC-RELABELED-CHILD-8b42' not in item['outerMessage']
   else:assert item['mutations']==1 and item['outerIsMutated'] and item['outerMessage']=='SYNTHETIC-RELABELED-CHILD-8b42'
 if EXPECTED[name][0]==0:assert failed==[]
if len(sys.argv)>1 and sys.argv[1]=='--check-logs':
 directory=Path(sys.argv[2])
 assert summary((directory/'preservation.log').read_text(),'Tests')+summary((directory/'preservation.log').read_text(),'Test Suites')==(0,98,98,0,4,4)
 for name in EXPECTED:guard(name,(directory/f'{name}.log').read_text(),json.loads((directory/f'{name}.json').read_text()))
 rejected=[]
 for name,log in [('missing',''),('load','Test suite failed to run\n'),('forgedload','Test suite failed to run\nTests: 2 failed, 1 passed, 3 total\nTest Suites: 1 failed, 1 total\n'),('wrongcount','Tests: 3 failed, 3 total\nTest Suites: 1 failed, 1 total\n')]:
  try:guard('mutation-current',log,{})
  except (AssertionError,KeyError):rejected.append(name)
  else:raise AssertionError('Unsafe log accepted')
 print(json.dumps(dict(status='PASS',exactJestLogs=len(EXPECTED),syntheticRejected=rejected),indent=2));sys.exit(0)
def normalize(text):return text.replace(os.path.relpath(OUT,ROOT),'<captures>').replace(str(OUT),'<captures>').replace(str(ROOT),'<checkout>').replace(NODE,'<node>')
def gitbytes(pin,path):return subprocess.check_output(['git','show',f'{pin}:{path}'])
def command(name,args,expected=0):
 env=dict(os.environ);env.pop('GAP_HUNT_REUSE_BUILD',None)
 result=subprocess.run(args,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
 log=normalize(result.stdout);(OUT/f'{name}.log').write_text(log)
 rows.append(dict(name=name,argv=[normalize(arg) for arg in args],exit=result.returncode,expected=expected));print(f'{name}: {result.returncode} (expected {expected})',flush=True)
 assert result.returncode==expected,name
 if name=='preservation':assert summary(log,'Tests')+summary(log,'Test Suites')==(0,98,98,0,4,4)
 if name in EXPECTED:
  p=OUT/f'{name}.json';p.write_text(normalize(p.read_text()));guard(name,log,json.loads(p.read_text()))
def jest(name,config,paths=None,expected=0):
 args=['node','--experimental-vm-modules','node_modules/jest/bin/jest.js','--config',config,'--runInBand','--json','--outputFile',str(OUT/f'{name}.json')]
 if paths:args+=['--runTestsByPath',*paths]
 command(name,args,expected)
source=Path('packages/resolution/src/resolution.ts');saved=source.read_bytes();assert saved==gitbytes(SOURCE,source)
assert (PREFIX/'frozen/callbacks.test.ts').read_bytes()==gitbytes(CALLBACK,'scratch/gap-hunt/error-privacy-callbacks/callbacks.test.ts')
assert (PREFIX/'mutation.test.ts').read_bytes()==gitbytes(MEMO,'scratch/gap-hunt/review-195-repair/mutation.test.ts')
official=['packages/core/.test-build/test/gap-hunt-error-privacy-callbacks.test.js']
try:
 command('install',['npm','ci','--no-audit','--no-fund'])
 command('build',['npm','run','build:packages'])
 command('fixtures',['npm','run','build:fixtures'])
 command('core-test-build',['node','node_modules/typescript/bin/tsc','-p','packages/core/tsconfig.test.json'])
 command('consumer-compile',['node','node_modules/typescript/bin/tsc','-p',str(PREFIX/'tsconfig.json')])
 command('consumer-lint',['node','node_modules/eslint/bin/eslint.js','-c',str(PREFIX/'eslint.config.mjs'),str(PREFIX/'mutation.test.ts'),str(PREFIX/'frozen/callbacks.test.ts')])
 command('resolution-check',['npm','run','check','--workspace','@microdelta/resolution'])
 command('core-check',['npm','run','check','--workspace','microdelta'])
 command('declarations',['npm','run','check:declarations'])
 jest('callbacks-current',str(PREFIX/'callbacks.jest.config.mjs'))
 jest('official-current','packages/core/jest.config.mjs',official)
 jest('memo','packages/core/jest.config.mjs',['packages/core/.test-build/test/gap-hunt-error-privacy.test.js'])
 jest('privacy','packages/core/jest.config.mjs',['packages/core/.test-build/test/resolution/author-error-privacy.test.js'])
 jest('mutation-current',str(PREFIX/'mutation.jest.config.mjs'),expected=1)
 command('preservation',['node','--experimental-vm-modules','node_modules/jest/bin/jest.js','--config','packages/core/jest.config.mjs','--runInBand','--runTestsByPath',*[f'packages/core/.test-build/test/{path}.test.js' for path in ['resolution/source-policy','fold/fold','nested/validation','outcome-fold/outcome-fold']]])
 try:
  source.write_bytes(gitbytes(OLD,source));command('old-build',['npm','run','build:packages'])
  jest('callbacks-old',str(PREFIX/'callbacks.jest.config.mjs'),expected=1)
  jest('official-old','packages/core/jest.config.mjs',official,1)
 finally:
  source.write_bytes(saved);command('restored-build',['npm','run','build:packages']);assert source.read_bytes()==saved
 jest('callbacks-restored',str(PREFIX/'callbacks.jest.config.mjs'))
 jest('official-restored','packages/core/jest.config.mjs',official)
 jest('mutation-restored',str(PREFIX/'mutation.jest.config.mjs'),expected=1)
finally:
 (OUT/'receipt.json').write_text(json.dumps(dict(source=SOURCE,oldResolution=OLD,frozenCallbacks=CALLBACK,frozenMemoMutation=MEMO,platform=platform.platform(),node=subprocess.check_output(['node','-v'],text=True).strip(),commands=rows),indent=2)+'\n')
