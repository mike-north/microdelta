#!/usr/bin/env python3
"""A finite TEST-6 composition qualification; fault only local tag invalidation."""
from pathlib import Path
import subprocess,json,os,tempfile
ROOT=Path(__file__).resolve().parents[3];os.chdir(ROOT)
P=Path('scratch/gap-hunt/local-filter');OUT=Path(tempfile.mkdtemp(prefix='microdelta-local-filter-'));print(OUT,flush=True)
rows=[]
def command(name,args,expected=0):
 env=dict(os.environ);env.pop('GAP_HUNT_REUSE_BUILD',None)
 r=subprocess.run(args,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 (OUT/(name+'.log')).write_text(r.stdout.replace(str(ROOT),'<checkout>').replace(str(OUT),'<captures>'))
 rows.append(dict(name=name,argv=[x.replace(str(OUT),'<captures>') for x in args],exit=r.returncode,expected=expected));print(name,r.returncode,flush=True);assert r.returncode==expected
 if name in ['current','fault','restored']:
  p=OUT/(name+'.json');t=p.read_text().replace(str(ROOT),'<checkout>');p.write_text(t);d=json.loads(t)
  assert d['numRuntimeErrorTestSuites']==0 and d['numTotalTests']==1
  assert d['numFailedTests']==(1 if name=='fault' else 0)
  a=d['testResults'][0]['assertionResults'];assert len(a)==1 and a[0]['fullName']=='TEST-6: independent local filters update retained scalar views without rewriting their exact snapshot'
  if name=='fault':assert 'widened' in r.stdout and 'Ben' in r.stdout
  else:assert '"databaseBytesUnchanged":true' in r.stdout and '"unreadSelectedReads":0' in r.stdout

def jest(name,expected=0):command(name,['node','--experimental-vm-modules','node_modules/jest/bin/jest.js','--config',str(P/'jest.config.mjs'),'--runInBand','--json','--outputFile',str(OUT/(name+'.json'))],expected)
source=Path('packages/tracking/src/index.ts');saved=source.read_bytes();assert saved==subprocess.check_output(['git','show','52e3786516a404e3433bef03807a027c8103786c:'+str(source)])
old='      value = v;\n      dirty(tag);';new='      value = v;\n      // TEST-6 sensitivity fault: omit invalidation of the local derivation.'
assert saved.decode().count(old)==1
try:
 command('install',['npm','ci','--no-audit','--no-fund'])
 command('build',['npm','run','build:packages'])
 command('compile',['node','node_modules/typescript/bin/tsc','-p',str(P/'tsconfig.json')])
 command('lint',['node','node_modules/eslint/bin/eslint.js','-c',str(P/'eslint.config.mjs'),str(P/'worker.ts'),str(P/'filter.test.ts')])
 jest('current')
 try:
  source.write_text(saved.decode().replace(old,new));command('fault-build',['npm','run','build','--workspace','@microdelta/tracking']);jest('fault',1)
 finally:
  source.write_bytes(saved);command('restored-build',['npm','run','build','--workspace','@microdelta/tracking'])
 jest('restored');assert source.read_bytes()==saved
finally:
 (OUT/'receipt.json').write_text(json.dumps({'source':'52e3786516a404e3433bef03807a027c8103786c','commands':rows,'restoredSource':source.read_bytes()==saved},indent=2)+'\n')
