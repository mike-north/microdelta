#!/usr/bin/env python3
"""Finite outside74 owner/tooling execution at an exact source; no product changes."""
from pathlib import Path
import json,hashlib,os,platform,subprocess,tempfile,time
ROOT=Path(__file__).resolve().parents[3];HERE=Path(__file__).resolve().parent;os.chdir(ROOT)
SEL=json.loads((HERE/'selection.json').read_text());SOURCE=SEL['source'];PREFIX=str(HERE.relative_to(ROOT))
def git(*a):return subprocess.check_output(['git','-c','core.fsmonitor=false',*a],timeout=30)
def hashes():
 out={}
 for n in git('ls-tree','-r','--name-only',SOURCE).decode().splitlines():
  b=Path(n).read_bytes();assert b==git('show',SOURCE+':'+n),'source differs:'+n;out[n]=hashlib.sha256(b).hexdigest()
 return out
assert not git('diff','--name-only','HEAD').strip(),'tracked start must be clean'
assert not git('diff','--name-only',SOURCE,'--','.',':(exclude)'+PREFIX).strip(),'complete source must match pin'
assert not Path('node_modules').exists(),'fresh checkout must not reuse node_modules'
assert subprocess.check_output(['node','-p','process.versions.node'],text=True,timeout=30).split('.')[0]=='24','Node24 required'
before=hashes();OUT=Path(tempfile.mkdtemp(prefix='microdelta-outside74-'));print('Evidence output: '+str(OUT),flush=True)
records=[];node=subprocess.check_output(['node','-p','process.execPath'],text=True,timeout=30).strip();env=dict(os.environ)
for k in ['GAP_HUNT_REUSE_BUILD','MICRODELTA_CONTROL_REUSE_BUILD']:env.pop(k,None)
sdk=Path('/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk')
def norm(s):return s.replace(str(ROOT),'<checkout>').replace(str(OUT),'<captures>').replace(node,'<node>')
def command(n,args):
 e=dict(env)
 if n=='install' and platform.system()=='Darwin' and sdk.exists():e['SDKROOT']=str(sdk)
 start=time.monotonic();r=subprocess.run(args,env=e,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=900);(OUT/(n+'.log')).write_text(norm(r.stdout));records.append(dict(name=n,argv=[norm(x) for x in args],exit=r.returncode,seconds=round(time.monotonic()-start,3)));print(n,r.returncode,flush=True)
 if r.returncode:raise RuntimeError(n+' failed; inspect capture')
def jest(owner,files):
 n='jest-'+owner;command(n,['node','--experimental-vm-modules','node_modules/jest/bin/jest.js','--config','packages/'+owner+'/jest.config.mjs','--runInBand','--json','--outputFile',str(OUT/(n+'.json')),'--runTestsByPath',*[str(Path(f.replace('/test/','/.test-build/test/')).with_suffix('.js')) for f in files]])
 f=OUT/(n+'.json');f.write_text(norm(f.read_text()));d=json.loads(f.read_text());assert d['numRuntimeErrorTestSuites']==0 and d['numFailedTests']==0 and d['numTotalTestSuites']==len(files)
 actual={s['name'].replace('<checkout>/','').replace('/.test-build/test/','/test/').removesuffix('.js')+'.ts' for s in d['testResults']};assert actual==set(files),(actual,files)
 rows=[dict(path=s['name'],fullName=a['fullName'],status=a['status']) for s in d['testResults'] for a in s['assertionResults']];assert rows and all(a['status']=='passed' for a in rows);(OUT/(n+'-inventory.json')).write_text(json.dumps(rows,indent=2)+'\n')
primary=None;after={}
try:
 command('install',['npm','ci','--no-audit','--no-fund']);command('build',['npm','run','build:packages']);command('build-fixtures',['npm','run','build:fixtures']);command('declarations',['node',str(HERE/'declarations.mjs'),str(OUT/'declarations.json')])
 for owner in ['core','tracking','materialization']:command('compile-'+owner,['node','node_modules/typescript/bin/tsc','-p','packages/'+owner+'/tsconfig.test.json'])
 for owner in ['core','tracking','materialization']:jest(owner,[p for p in SEL['selectedFiles'] if p.startswith('packages/'+owner+'/')])
 for p in [p for p in SEL['selectedFiles'] if p.startswith('tooling/')]:command(Path(p).stem,['node','--test','--test-reporter=tap',p])
except BaseException as e:primary=str(e);raise
finally:
 try:after=hashes()
 finally:(OUT/'receipt.json').write_text(json.dumps(dict(source=SOURCE,platform=platform.platform(),node=subprocess.check_output(['node','-v'],text=True,timeout=30).strip(),sourceBefore=before,sourceAfter=after,sourceUnchanged=before==after,commands=records,primaryError=primary,linuxExecuted=False,paidProviderExecuted=False,historicalInventoriesModified=False),indent=2)+'\n')
