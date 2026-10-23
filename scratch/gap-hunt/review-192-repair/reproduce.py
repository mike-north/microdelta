#!/usr/bin/env python3
"""Finite result-root boundary replay; old-source controls are always restored in this disposable checkout."""
import json,os,platform,re,subprocess,tempfile,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];os.chdir(ROOT)
OUT=Path(os.environ.get('MICRODELTA_EVIDENCE_OUTPUT',tempfile.mkdtemp(prefix='microdelta-review192-')));OUT.mkdir(parents=True,exist_ok=True)
print(f'Evidence output: {OUT}',flush=True)
SOURCE='10a69df858944b5141c9ef1a9c80d72a6d3dea4c';OLD='7677ec4d61fd78efc63da28906175707e1391f12';FROZEN='9267a44e1a203966e6ccd73db188e5826506326b'
NODE=subprocess.check_output(['node','-p','process.execPath'],text=True).strip();rows=[]
EXPECTED={'definition-tests':(0,281,281,0,15,15),'original-runtime':(10,5,15,1,0,1),'selected-runtime':(0,49,49,0,3,3),'supplement':(0,8,8,0,1,1),'restored-supplement':(0,8,8,0,1,1)}
def summary(log,label):
 values=re.findall(r'^'+re.escape(label)+r':\s+(?:(\d+) failed,\s+)?(?:(\d+) passed,\s+)?(\d+) total\s*$',log,re.M)
 assert len(values)==1,f'{label}: missing/ambiguous summary'
 return tuple(int(v or '0') for v in values[0])
def guard(name,log):
 if name in EXPECTED:
  assert not re.search(r'Test suite failed to run|Cannot find module|Jest encountered an unexpected token',log)
  assert summary(log,'Tests')+summary(log,'Test Suites')==EXPECTED[name],name
 if name=='original-types-current':assert re.search(r'\b5 errors\b',log) and 'does not satisfy the constraint object' in log
 if name=='old-selected-types':
  errors=[line for line in log.splitlines() if '✖' in line]
  assert len(errors)==28 and all('Expected an error, but found none.' in line for line in errors)
  assert re.search(r'\b28 errors\b',log)
if len(sys.argv)>1 and sys.argv[1]=='--check-logs':
 directory=Path(sys.argv[2])
 for name in [*EXPECTED,'original-types-current','old-selected-types']:guard(name,(directory/f'{name}.log').read_text())
 rejected=[]
 for name,log in [('missing',''),('load','Test suite failed to run\n'),('forgedload','Test suite failed to run\nTests: 10 failed, 5 passed, 15 total\nTest Suites: 1 failed, 1 total\n'),('wrongcount','Tests: 15 failed, 15 total\nTest Suites: 1 failed, 1 total\n')]:
  try:guard('original-runtime',log)
  except AssertionError:rejected.append(name)
  else:raise AssertionError('unsafe log accepted')
 print(json.dumps({'status':'PASS','exactJestLogs':len(EXPECTED),'typedCounterfactualGuards':2,'syntheticRejected':rejected},indent=2));sys.exit(0)
def command(name,args,expected=0):
 env=dict(os.environ);env.pop('GAP_HUNT_REUSE_BUILD',None)
 p=subprocess.run(args,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
 (OUT/f'{name}.log').write_text(p.stdout.replace(str(ROOT),'<checkout>').replace(NODE,'<node>'))
 rows.append(dict(name=name,command=args,exit=p.returncode,expected=expected));print(f'{name}: {p.returncode} (expected {expected})',flush=True)
 assert p.returncode==expected,name
 guard(name,p.stdout)
def gitbytes(pin,path):return subprocess.check_output(['git','show',f'{pin}:{path}'])
frozen={'gap-hunt-contracts-scalar-roots.test.ts':'packages/core/test/gap-hunt-contracts-scalar-roots.test.ts','gap-hunt-contracts-scalar-roots.test-d.ts':'packages/core/test-d/gap-hunt-contracts-scalar-roots.test-d.ts','reproduce.mjs':'scratch/gap-hunt/contracts/reproduce.mjs','SCALAR-ROOTS.md':'scratch/gap-hunt/contracts/SCALAR-ROOTS.md'}
for file,path in frozen.items():assert (Path('scratch/gap-hunt/review-192-repair/frozen')/file).read_bytes()==gitbytes(FROZEN,path)
paths=[Path('packages/definition/src/declarations.ts'),Path('packages/definition/src/template.ts'),Path('packages/definition/etc/definition.api.md')]
for p in paths:assert p.read_bytes()==gitbytes(SOURCE,p)
node='node';jest=[node,'--experimental-vm-modules','node_modules/jest/bin/jest.js'];tsd=[node,'node_modules/tsd/dist/cli.js','--typings','packages/core/dist/api/microdelta.alpha.d.ts','--files']
selected=tsd+['packages/core/test-d/result-roots.test-d.ts'];original=tsd+['scratch/gap-hunt/review-192-repair/original-positive.test-d.ts'];supplement=jest+['--config','scratch/gap-hunt/review-192-repair/supplement.jest.config.mjs','--runInBand']
try:
 command('install',['npm','ci','--no-audit','--no-fund'])
 command('build',['npm','run','build:packages'])
 command('fixture-build',['npm','run','build:fixtures'])
 command('prepare-original',[node,'scratch/gap-hunt/review-192-repair/prepare-original.mjs'])
 command('original-runtime',jest+['--config','scratch/gap-hunt/review-192-repair/original.jest.config.mjs','--runInBand'],1)
 command('original-types-current',original,1)
 command('selected-types',selected)
 command('core-types',['npm','run','test:types','--workspace','microdelta'])
 command('definition-check',['npm','run','check','--workspace','@microdelta/definition'])
 command('definition-tests',['npm','run','test','--workspace','@microdelta/definition'])
 command('core-check',['npm','run','check','--workspace','microdelta'])
 command('core-test-build',[node,'node_modules/typescript/bin/tsc','-p','packages/core/tsconfig.test.json'])
 command('selected-runtime',jest+['--config','packages/core/jest.config.mjs','--runInBand','--runTestsByPath','packages/core/.test-build/test/workspace/result-root-types.test.js','packages/core/.test-build/test/workspace/async-source.test.js','packages/core/.test-build/test/keyed/members.test.js'])
 command('supplement',supplement)
 command('declaration-check',['npm','run','check:declarations'])
 command('fixture-check',['npm','run','check:fixtures'])
 saved={p:p.read_bytes() for p in paths}
 try:
  for p in paths:p.write_bytes(gitbytes(OLD,p))
  command('old-build',['npm','run','build:packages'])
  command('old-selected-types',selected,1)
  command('old-original-types',original)
 finally:
  for p,data in saved.items():p.write_bytes(data)
  command('restored-build',['npm','run','build:packages'])
  assert all(p.read_bytes()==data for p,data in saved.items())
 command('restored-selected-types',selected)
 command('restored-supplement',supplement)
finally:
 (OUT/'receipt.json').write_text(json.dumps(dict(source=SOURCE,oldDefinitionSource=OLD,frozen=FROZEN,platform=platform.platform(),node=subprocess.check_output(['node','-v'],text=True).strip(),npm=subprocess.check_output(['npm','-v'],text=True).strip(),commands=rows),indent=2)+'\n')
