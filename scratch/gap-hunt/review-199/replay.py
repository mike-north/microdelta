#!/usr/bin/env python3
"""Exact-head docs verification; frozen checker, five missing-guidance negatives, restoration."""
import hashlib,json,os,pathlib,re,subprocess,sys,tempfile,time
HERE=pathlib.Path(__file__).resolve().parent
ROOT=HERE.parents[2]
OUT=pathlib.Path(tempfile.mkdtemp(prefix='microdelta-review199-'))
print('Evidence output: '+str(OUT),flush=True)
HEAD='e42e31b7e618222e8a57b67d94b88b51e0c4e14b'
BASE='52e3786516a404e3433bef03807a027c8103786c'
FILES=['README.md','docs/native-store-locations.md','examples/contribution-report/README.md','packages/core/README.md','packages/core/src/workspace.ts','packages/machine-node/src/index.ts']
def git(*args):return subprocess.check_output(['git','-c','core.fsmonitor=false',*args],cwd=ROOT)
def sha(data):return hashlib.sha256(data).hexdigest()
def require(ok,why):
 if not ok:raise RuntimeError(why)
def normalize(s):
 s=s.replace(str(ROOT),'<checkout>').replace(str(OUT),'<evidence-output>')
 return re.sub(r'/Users/[^/]+/\.nodenv/versions/[^/]+/bin/node','<node>',s)
receipt={'source':HEAD,'recipeCommit':git('rev-parse','HEAD').decode().strip(),'frozen':'275124b32fbd1b960cf8fa46b5e341b51dfdb38e','commands':[]}
def run(name,args,expected=0,reuse=False,docs=None):
 env=dict(os.environ);env.pop('GAP_HUNT_REUSE_BUILD',None)
 if reuse:env['GAP_HUNT_REUSE_BUILD']='1'
 start=time.monotonic();p=subprocess.run(args,cwd=ROOT,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=600);s=normalize(p.stdout)
 (OUT/(name+'.log')).write_text(s);receipt['commands'].append({'name':name,'argv':args,'exit':p.returncode,'seconds':round(time.monotonic()-start,3),'sha256':sha(s.encode())});(OUT/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(name,p.returncode,flush=True)
 require(p.returncode==expected,name+' unexpected exit')
 require(not re.search(r'Test suite failed to run|Cannot find module|SyntaxError:|TypeError:|ReferenceError:|ERR_MODULE|CONTROL RUN INVALID',s),name+' runtime/load failure')
 if docs is not None:
  require(re.findall(r'^Test Suites:\s*(.+)$',s,re.M)==['1 passed, 1 total'],name+' exact canonical suite')
  require(re.findall(r'^Tests:\s*(.+)$',s,re.M)==['3 passed, 3 total'],name+' exact canonical tests')
  # Node's reporter chooses TAP or spec according to terminal configuration.
  summary=lambda key:re.findall(r'^(?:ℹ|#) '+key+r' (\d+)\s*$',s,re.M)
  for key,value in [('tests',5),('pass',5 if docs else 0),('fail',0 if docs else 5),('cancelled',0),('skipped',0),('todo',0)]:require(summary(key)==[str(value)],name+' exact docs '+key)
  if not docs:
   for entry in ['README.md','packages/core/README.md','examples/contribution-report/README.md']:
    require(entry+' exposes supported path spellings and the hard-link/WAL restriction' in s,name+' missing intended entrypoint failure')
   for entry in ['packages/machine-node/src/index.ts','packages/core/src/workspace.ts']:
    require(entry+' narrows its owning canonical-location comment' in s,name+' missing intended owning-comment failure')
   require(s.count('ERR_ASSERTION')==10 or s.count('ERR_ASSERTION')==5,name+' expected assertion failures')
 return s
require(not git('diff',HEAD,'--','.',':(exclude)scratch/gap-hunt/review-199').strip(),'Product source must match exact reviewed head')
originals={ROOT/name:(ROOT/name).read_bytes() for name in FILES}
helpers={ROOT/'scratch/gap-hunt/contract-operations'/name:None for name in ['verify-store-location-docs.sh','check-store-location-docs.mjs']}
for p in helpers:helpers[p]=p.read_bytes() if p.exists() else None
receipt['sourceSha256']={str(p.relative_to(ROOT)):sha(data) for p,data in originals.items()}
try:
 for p in helpers:
  p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes((HERE/'frozen'/p.name).read_bytes())
 run('current',['bash','scratch/gap-hunt/contract-operations/verify-store-location-docs.sh'],docs=True)
 run('static',['node','scratch/gap-hunt/review-199/static-review.mjs'])
 run('machine-check',['npm','run','check','--workspace','@microdelta/machine-node'])
 run('core-check',['npm','run','check','--workspace','microdelta'])
 for name in FILES:
  p=ROOT/name
  if name=='docs/native-store-locations.md':p.unlink()
  else:p.write_bytes(git('show',BASE+':'+name))
 run('original-docs-negative',['bash','scratch/gap-hunt/contract-operations/verify-store-location-docs.sh'],1,reuse=True,docs=False)
finally:
 for p,data in originals.items():p.write_bytes(data)
 receipt['sourceRestored']={str(p.relative_to(ROOT)):p.read_bytes()==data for p,data in originals.items()}
 for p,data in helpers.items():
  if data is None:p.unlink(missing_ok=True)
  else:p.write_bytes(data)
 (OUT/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
# Restore the original helpers temporarily only to run the same positive command.
try:
 for p in helpers:p.write_bytes((HERE/'frozen'/p.name).read_bytes())
 run('restored',['bash','scratch/gap-hunt/contract-operations/verify-store-location-docs.sh'],reuse=True,docs=True)
finally:
 for p,data in helpers.items():
  if data is None:p.unlink(missing_ok=True)
  else:p.write_bytes(data)
receipt['complete']=True
(OUT/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
print('complete',flush=True)
