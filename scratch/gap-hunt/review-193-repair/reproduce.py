#!/usr/bin/env python3
"""Finite array publication replay, including exact old-index negative control."""
import json,os,platform,re,subprocess,tempfile,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];os.chdir(ROOT)
OUT=Path(os.environ.get('MICRODELTA_EVIDENCE_OUTPUT',tempfile.mkdtemp(prefix='microdelta-review193-')));OUT.mkdir(parents=True,exist_ok=True)
print(f'Evidence output: {OUT}',flush=True)
SOURCE='4f9bc2a54648e9802b47ab3d286cffb8ad2bc06f';OLD='7677ec4d61fd78efc63da28906175707e1391f12';FROZEN='abb9bab1987d18644093fb67dadb17c3ea9f94ce'
NODE=subprocess.check_output(['node','-p','process.execPath'],text=True).strip();rows=[]
def gitbytes(pin,path):return subprocess.check_output(['git','show',f'{pin}:{path}'])
EXPECTED={'original-current':(0,1,1,0,1,1),'official':(0,5,5,0,1,1),'value-tests':(0,60,60,0,3,3),'history-tests':(0,44,44,0,3,3),'durable':(0,41,41,0,2,2),'supplement':(0,3,3,0,1,1),'original-old':(1,0,1,1,0,1),'original-restored':(0,1,1,0,1,1)}
def summary(log,label):
 values=re.findall(r'^'+re.escape(label)+r':\s+(?:(\d+) failed,\s+)?(?:(\d+) passed,\s+)?(\d+) total\s*$',log,re.M)
 assert len(values)==1,f'{label}: missing/ambiguous summary'
 return tuple(int(v or '0') for v in values[0])
def guard(name,log):
 assert not re.search(r'Test suite failed to run|Cannot find module|Jest encountered an unexpected token',log)
 assert summary(log,'Tests')+summary(log,'Test Suites')==EXPECTED[name],name
 if name=='original-old':assert '1323,5043' in log and '2646' in log and '5043' in log
if len(sys.argv)>1 and sys.argv[1]=='--check-logs':
 directory=Path(sys.argv[2])
 for name in EXPECTED:guard(name,(directory/f'{name}.log').read_text())
 rejected=[]
 for name,log in [('missing',''),('load','Test suite failed to run\n'),('forgedload','Test suite failed to run\nTests: 1 failed, 1 total\nTest Suites: 1 failed, 1 total\n1323,5043 2646'),('wrongcount','Tests: 2 failed, 2 total\nTest Suites: 1 failed, 1 total\n1323,5043 2646')]:
  try:guard('original-old',log)
  except AssertionError:rejected.append(name)
  else:raise AssertionError('unsafe log accepted')
 print(json.dumps({'status':'PASS','exactJestLogs':len(EXPECTED),'syntheticRejected':rejected},indent=2));sys.exit(0)
def command(name,args,expected=0,total=None):
 env=dict(os.environ);env.pop('GAP_HUNT_REUSE_BUILD',None)
 p=subprocess.run(args,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
 log=p.stdout.replace(str(ROOT),'<checkout>').replace(NODE,'<node>');(OUT/f'{name}.log').write_text(log)
 rows.append(dict(name=name,command=args,exit=p.returncode,expected=expected));print(f'{name}: {p.returncode} (expected {expected})',flush=True)
 assert p.returncode==expected,name
 if name in EXPECTED:guard(name,log)
original='packages/core/test/gap-hunt-scale/array-validation.test.ts'
assert Path('scratch/gap-hunt/review-193-repair/frozen/array-validation.test.ts').read_bytes()==gitbytes(FROZEN,original)
path=Path('packages/history/src/durable/selected-index.ts');assert path.read_bytes()==gitbytes(SOURCE,path)
jest=['node','--experimental-vm-modules','node_modules/jest/bin/jest.js'];old=jest+['--config','scratch/gap-hunt/review-193-repair/original.jest.config.mjs','--runInBand'];saved=path.read_bytes()
try:
 command('install',['npm','ci','--no-audit','--no-fund'])
 command('build',['npm','run','build:packages'])
 command('fixture-build',['npm','run','build:fixtures'])
 command('core-test-build',['node','node_modules/typescript/bin/tsc','-p','packages/core/tsconfig.test.json'])
 command('prepare-original',['node','scratch/gap-hunt/review-193-repair/prepare-original.mjs'])
 command('original-current',old,total=1)
 command('official',jest+['--config','packages/core/jest.config.mjs','--runInBand','--runTestsByPath','packages/core/.test-build/test/gap-hunt-scale/array-validation.test.js'],total=5)
 command('value-check',['npm','run','check','--workspace','@microdelta/value'])
 command('value-tests',['npm','test','--workspace','@microdelta/value'])
 command('history-check',['npm','run','check','--workspace','@microdelta/history'])
 command('history-tests',['npm','test','--workspace','@microdelta/history'])
 command('durable',['node','--require','./scratch/gap-hunt/review-193-repair/file-fed-harness.cjs','--experimental-vm-modules','node_modules/jest/bin/jest.js']+['--config','packages/core/jest.config.mjs','--runInBand','--runTestsByPath','packages/core/.test-build/test/durable-history/durable-history.test.js','packages/core/.test-build/test/durable-history/crash-recovery.test.js'])
 command('supplement',jest+['--config','scratch/gap-hunt/review-193-repair/supplement.jest.config.mjs','--runInBand'],total=3)
 command('core-check',['npm','run','check','--workspace','microdelta'])
 command('declaration-check',['npm','run','check:declarations'])
 try:
  path.write_bytes(gitbytes(OLD,path))
  command('old-build',['npm','run','build:packages'])
  command('original-old',old,expected=1,total=1)
  log=(OUT/'original-old.log').read_text();assert '1323,5043' in log and '2646' in log and '5043' in log
 finally:
  path.write_bytes(saved);command('restored-build',['npm','run','build:packages']);assert path.read_bytes()==saved
 command('original-restored',old,total=1)
finally:
 (OUT/'receipt.json').write_text(json.dumps(dict(source=SOURCE,oldIndexSource=OLD,frozen=FROZEN,platform=platform.platform(),node=subprocess.check_output(['node','-v'],text=True).strip(),commands=rows),indent=2)+'\n')
