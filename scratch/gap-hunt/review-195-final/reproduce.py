#!/usr/bin/env python3
"""Exact memo privacy repair qualification; preserve the original residual oracle."""
from pathlib import Path
import hashlib,json,os,platform,re,subprocess,sys,tempfile
ROOT=Path(__file__).resolve().parents[3];os.chdir(ROOT);P=Path('scratch/gap-hunt/review-195-final')
SOURCE='0b3cf4b01ef4e0d17211b98fc435385b2b4d2681';OLD='a13a3fd88ffe5ed24334f60af84316b31d98971e';FROZEN='95679b0484bcda7d6e6a00d2cddc165041fe2baf';ORIGINAL='49c47b79346e78ae9ef22f8985d254254200a14c'
EXPECTED={'original-current':(0,9,9),'official':(0,12,12),'privacy':(0,6,6),'mutation-current':(0,3,3),'official-mutation-current':(0,10,10),'original-old':(0,9,9),'mutation-old':(2,1,3),'original-restored':(0,9,9),'mutation-restored':(0,3,3),'official-mutation-restored':(0,10,10)}
def obs(log,label):return [json.loads(x) for x in re.findall(r'^\s*'+re.escape(label)+r' (\{[^\n]+\})\s*$',log,re.M)]
def guard(name,log,data):
 assert not re.search(r'Test suite failed to run|Cannot find module|SyntaxError:|ReferenceError:|TypeError:',log),name
 fail,passed,total=EXPECTED[name];assert (data['numFailedTests'],data['numPassedTests'],data['numTotalTests'])==(fail,passed,total),name
 assert data['numRuntimeErrorTestSuites']==0 and data['numTotalTestSuites']==1 and data['numFailedTestSuites']==(1 if fail else 0)
 assertions=[a for suite in data['testResults'] for a in suite['assertionResults']];assert len(assertions)==total
 failed=sorted(a['fullName'] for a in assertions if a['status']=='failed')
 assert len(failed)==fail
 if name=='mutation-old':assert failed==sorted(mode+': real child failure preserves safe outer text and refuses parent publication' for mode in ['mutate-rethrow','mutate-swallow'])
 if name.startswith('mutation-'):
  seen=obs(log,'child-mutation-observation');assert len(seen)==3
  for o in seen:
   assert o['outerCode']=='unsupported-result' and o['rows']=={'count':0} and not o['completed']
   assert o['mutations']==(0 if o['mode']=='unmodified' else 1)
   if name=='mutation-old' and o['mode']!='unmodified':assert o['outerIsMutated'] and o['outerMessage']=='SYNTHETIC-RELABELED-CHILD-8b42'
   else:assert not o['outerIsMutated'] and 'SYNTHETIC-RELABELED-CHILD-8b42' not in o['outerMessage']
 if name.startswith('original-'):
  seen=obs(log,'author-error-observation');assert len(seen)==2
  for o in seen:assert not o['completedResult'] and o['outerCode']=='execution-failure' and not o['outerIsThrown'] and o['causeIsThrown'] and 'SYNTHETIC-OPAQUE-DETAIL-9d72' not in o['outerMessage']
if len(sys.argv)>1 and sys.argv[1]=='--check-logs':
 d=Path(sys.argv[2])
 for name in EXPECTED:guard(name,(d/(name+'.log')).read_text(),json.loads((d/(name+'.json')).read_text()))
 rejected=[]
 baseline=json.loads((d/'mutation-old.json').read_text());valid=(d/'mutation-old.log').read_text()
 for label,log,data in [('missing','',{}),('load','Test suite failed to run\n'+valid,baseline),('wrong-count',valid,{**baseline,'numTotalTests':4}),('runtime-error',valid,{**baseline,'numRuntimeErrorTestSuites':1})]:
  try:guard('mutation-old',log,data)
  except (AssertionError,KeyError):rejected.append(label)
  else:raise AssertionError('Unsafe evidence accepted:'+label)
 print(json.dumps(dict(status='PASS',exactJestLogs=10,syntheticRejected=rejected),indent=2));sys.exit(0)
# Reject unrelated edits before creating output or entering any cleanup path.
def preflight():
 tracked=subprocess.check_output(['git','diff','--name-only','HEAD'],text=True).splitlines()
 staged=subprocess.check_output(['git','diff','--cached','--name-only'],text=True).splitlines()
 assert not tracked and not staged, 'tracked checkout must start clean'
 production=subprocess.check_output(['git','ls-tree','-r','--name-only',SOURCE],text=True).splitlines()
 for name in production:
  assert Path(name).read_bytes()==subprocess.check_output(['git','show',SOURCE+':'+name]), 'production differs: '+name
 assert not Path('packages/core/test/gap-hunt-review195-final-original.test.ts').exists(), 'transient fixture must start absent'
 return len(production)
if len(sys.argv)>1 and sys.argv[1]=='--preflight':
 print(json.dumps(dict(status='PASS',productionFiles=preflight())));sys.exit(0)
preflight()
OUT=Path(os.environ.get('MICRODELTA_EVIDENCE_OUTPUT',tempfile.mkdtemp(prefix='microdelta-review195-final-')));OUT.mkdir(parents=True,exist_ok=True);print('Evidence output: '+str(OUT),flush=True)
NODE=subprocess.check_output(['node','-p','process.execPath'],text=True).strip();rows=[];native={}
def norm(s):return s.replace(str(OUT),'<captures>').replace(str(ROOT),'<checkout>').replace(NODE,'<node>')
def gb(pin,path):return subprocess.check_output(['git','show',pin+':'+str(path)])
def command(name,args,expected=0):
 env=dict(os.environ);env.pop('GAP_HUNT_REUSE_BUILD',None)
 if name=='install':
  sdk=Path('/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk')
  if platform.system()=='Darwin' and sdk.exists():env['SDKROOT']=str(sdk)
  native.update(SDKROOT=env.get('SDKROOT'),node=subprocess.check_output(['node','-v'],text=True).strip())
 r=subprocess.run(args,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=900);log=norm(r.stdout);(OUT/(name+'.log')).write_text(log);rows.append(dict(name=name,argv=[norm(a) for a in args],exit=r.returncode,expected=expected));print(name,r.returncode,'expected',expected,flush=True);assert r.returncode==expected,name
 if name in EXPECTED:
  f=OUT/(name+'.json');f.write_text(norm(f.read_text()));guard(name,log,json.loads(f.read_text()))
def jest(name,path,expected=0,config='packages/core/jest.config.mjs'):
 args=['node','--experimental-vm-modules','node_modules/jest/bin/jest.js','--config',config,'--runInBand','--json','--outputFile',str(OUT/(name+'.json'))]
 if path:args+=['--runTestsByPath',path]
 command(name,args,expected)
def hashes():return {str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'packages/resolution/dist').rglob('*') if p.is_file()}
paths=[Path('packages/resolution/src/errors.ts'),Path('packages/resolution/src/resolution.ts')];saved={p:p.read_bytes() for p in paths}
for p,b in saved.items():assert b==gb(SOURCE,p)
assert (P/'mutation.test.ts').read_bytes()==gb(FROZEN,'scratch/gap-hunt/review-195-repair/mutation.test.ts')
assert (P/'frozen/original.test.ts').read_bytes()==gb(ORIGINAL,'packages/core/test/gap-hunt-error-privacy.test.ts')
tmp=Path('packages/core/test/gap-hunt-review195-final-original.test.ts');assert not tmp.exists();baseline={};restored={}
try:
 command('install',['npm','ci','--no-audit','--no-fund']);command('build',['npm','run','build:packages']);baseline=hashes();command('fixtures',['npm','run','build:fixtures'])
 tmp.write_bytes((P/'frozen/original.test.ts').read_bytes());command('core-test-build',['node','node_modules/typescript/bin/tsc','-p','packages/core/tsconfig.test.json'])
 command('original-lint',['node','node_modules/eslint/bin/eslint.js',str(tmp)])
 command('consumer-compile',['node','node_modules/typescript/bin/tsc','-p',str(P/'tsconfig.json')]);command('consumer-lint',['node','node_modules/eslint/bin/eslint.js','-c',str(P/'eslint.config.mjs'),str(P/'mutation.test.ts')])
 orig='packages/core/.test-build/test/gap-hunt-review195-final-original.test.js';official='packages/core/.test-build/test/gap-hunt-error-privacy.test.js';mutation='packages/core/.test-build/test/gap-hunt-review-195-mutation.test.js'
 jest('original-current',orig);jest('official',official);jest('privacy','packages/core/.test-build/test/resolution/author-error-privacy.test.js');jest('mutation-current',None,config=str(P/'mutation.jest.config.mjs'));jest('official-mutation-current',mutation)
 command('resolution-check',['npm','run','check','--workspace','@microdelta/resolution']);command('core-check',['npm','run','check','--workspace','microdelta']);command('declarations',['npm','run','check:declarations'])
 try:
  for p in paths:p.write_bytes(gb(OLD,p))
  command('old-build',['npm','run','build:packages']);jest('original-old',orig);jest('mutation-old',None,1,str(P/'mutation.jest.config.mjs'))
 finally:
  for p,b in saved.items():p.write_bytes(b)
  command('restored-build',['npm','run','build:packages']);restored=hashes();assert restored==baseline
 jest('original-restored',orig);jest('mutation-restored',None,config=str(P/'mutation.jest.config.mjs'));jest('official-mutation-restored',mutation)
finally:
 for p,b in saved.items():p.write_bytes(b)
 tmp.unlink(missing_ok=True)
 (OUT/'receipt.json').write_text(json.dumps(dict(source=SOURCE,old=OLD,frozenMutation=FROZEN,frozenOriginal=ORIGINAL,platform=platform.platform(),native=native,commands=rows,restoredSource=all(p.read_bytes()==b for p,b in saved.items()),emittedBaseline=baseline,emittedRestored=restored,emittedRestoredExact=bool(baseline) and baseline==restored),indent=2)+'\n')
