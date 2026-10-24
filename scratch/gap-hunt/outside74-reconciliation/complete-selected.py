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
OUT=Path('<original-capture-directory>');before=hashes()
records=[];node=subprocess.check_output(['node','-p','process.execPath'],text=True,timeout=30).strip();env=dict(os.environ)
for k in ['GAP_HUNT_REUSE_BUILD','MICRODELTA_CONTROL_REUSE_BUILD']:env.pop(k,None)
sdk=Path('/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk')
def norm(s):return s.replace(str(ROOT),'<checkout>').replace(str(OUT),'<captures>').replace(node,'<node>')
def command(n,args):
 e=dict(env)
 if n=='install' and platform.system()=='Darwin' and sdk.exists():e['SDKROOT']=str(sdk)
 start=time.monotonic();r=subprocess.run(args,env=e,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=900);(OUT/(n+'.log')).write_text(norm(r.stdout));records.append(dict(name=n,argv=[norm(x) for x in args],exit=r.returncode,seconds=round(time.monotonic()-start,3)));print(n,r.returncode,flush=True)
 if r.returncode:raise RuntimeError(n+' failed; inspect capture')
primary=None;after={}
try:
 command('build-fixtures',['npm','run','build:fixtures'])
 for n in ['declaration-boundaries','quality-gates','foundation-wiring']:command(n+'.complete',['node','--test','--test-reporter=tap','tooling/'+n+'.test.mjs'])
except BaseException as e:primary=str(e);raise
finally:
 after=hashes();(OUT/'completion-receipt.json').write_text(json.dumps(dict(source=SOURCE,sourceBefore=before,sourceAfter=after,sourceUnchanged=before==after,commands=records,primaryError=primary,setupCorrection='build:fixtures omitted in initial stage; only affected and remaining tooling executed'),indent=2)+'\n')
