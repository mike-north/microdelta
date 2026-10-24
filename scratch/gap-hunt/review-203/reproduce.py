#!/usr/bin/env python3
"""Qualify docs and unchanged diagnostic control flow; never install native code."""
import hashlib,json,os
from pathlib import Path
import re,shutil,subprocess,sys,tempfile
ROOT=Path(__file__).resolve().parents[3]
PIN='3e8fe78df48222b3ccb2f56163a8e2ad159c8807'
FIXTURE='scratch/gap-hunt/contract-operations/diagnose-158-native.mjs'
OLD='faa7d2563945374b75cbd5b239a82df4e17a334d'
DIGEST='05062901824f478b0ca4a25b6c1f2ce101cd76e2f8c0b9169a3d4012b97953a4'
def git(*args):return subprocess.check_output(['git','-c','core.fsmonitor=false',*args],cwd=ROOT,timeout=60)
def main():
 out=Path(tempfile.mkdtemp(prefix='microdelta-review203-output-'));records=[]
 with tempfile.TemporaryDirectory(prefix='microdelta-review203-') as folder:
  checkout=Path(folder)/'source';checkout.mkdir();subprocess.run(['tar','-xf','-','-C',str(checkout)],input=git('archive','--format=tar',PIN),check=True,timeout=60)
  sourcefiles={str(p.relative_to(checkout)):hashlib.sha256(p.read_bytes()).hexdigest() for p in checkout.rglob('*') if p.is_file()}
  b=(checkout/FIXTURE).read_bytes();assert hashlib.sha256(b).hexdigest()==DIGEST and b==git('show',OLD+':'+FIXTURE)
  adapted=b.replace(b"startsWith('26.')",b"startsWith('24.')");assert hashlib.sha256(adapted).hexdigest()=='700f7cc4f4e76fc7d4edd9bdc2a9f19031e2637509cef852eaa1a5335517301c'
  captured=(checkout/'docs/validation/native-sqlite-node24-probe-2026-10-23.json').read_bytes();assert hashlib.sha256(captured).hexdigest()=='c9bd9bfa1e527269d9c6f256648ec6f6d715d5fbf1fb7f39141017e93b900ed7';probe=json.loads(captured);assert probe['node']=='v24.14.0' and probe['install']['status']==probe['smoke']['status']==0 and 'native-sqlite-open-query-ok' in probe['smoke']['stdout']
  historical=[]
  for pin,path,markers in [('6d3f3f3533d75ea42be226edbd7e3932b974f447','scratch/gap-hunt/contract-operations/node26-clt/REPORT.md',['stdio.h not found','SDKROOT=','24→26→24','26→24→26']), (OLD,'scratch/gap-hunt/contract-operations/node26-clt/DIAGNOSTIC-158.md',['Node26.12.0','install status0','smoke status0']),('e475049c3f858c270791581fb77f925e761363ce','scratch/gap-hunt/contract-operations/LINUX-PROVENANCE.md',['Node24.13.0','26.12.1','not rerun','npm success does not test pnpm'])]:
   content=git('show',pin+':'+path);text=content.decode();assert all(m in text for m in markers);historical.append(dict(pin=pin,path=path,sha256=hashlib.sha256(content).hexdigest(),markersVerified=markers))
  links=[]
  for name in ['README.md','packages/core/README.md','docs/native-sqlite-toolchain.md','docs/validation/native-sqlite-toolchain-2026-10-23.md']:
   for target in re.findall(r'\]\(([^)]+)\)',(checkout/name).read_text()):
    if target.startswith(('http:','https:','#')):continue
    assert ((checkout/name).parent/target.split('#')[0]).exists(),(name,target);links.append(dict(source=name,target=target))
  recipe=re.findall(r'```sh\n(.*?)\n```',(checkout/'docs/native-sqlite-toolchain.md').read_text(),re.S)[0]
  envprobe=Path(folder)/'env-probe.py';envprobe.write_text("import os,sys,json; names=['DEVELOPER_DIR','CC','CXX','SDKROOT','CFLAGS','CXXFLAGS','LDFLAGS','PATH']; print(json.dumps({'args':sys.argv[1:],'env':{k:os.environ.get(k) for k in names}}))")
  shell='npm() { command "$REVIEW_PYTHON" "$REVIEW_ENV_PROBE" "$@"; }; export -f npm\n'+recipe
  env=os.environ.copy();env['REVIEW_ENV_PROBE']=str(envprobe);env['REVIEW_PYTHON']=sys.executable
  selected=subprocess.check_output(['bash','-c',shell],cwd=checkout,env=env,text=True,timeout=30);selected=json.loads(selected);assert selected['args']==['ci','--no-audit','--no-fund']
  clt='/Library/Developer/CommandLineTools';sdk=clt+'/SDKs/MacOSX.sdk';expected={'DEVELOPER_DIR':clt,'CC':clt+'/usr/bin/clang','CXX':clt+'/usr/bin/clang++','SDKROOT':sdk,'CFLAGS':'-isysroot '+sdk,'CXXFLAGS':'-isysroot '+sdk,'LDFLAGS':'-isysroot '+sdk}
  assert all(selected['env'][k]==v for k,v in expected.items());assert selected['env']['PATH'].startswith('/absolute/path/to/node-26.12.0/bin:'+clt+'/usr/bin:')
  (out/'recipe-environment.json').write_text(json.dumps({'selectedVariables':expected,'pathPrefix':'NODE26_BIN:'+clt+'/usr/bin','npmArguments':selected['args'],'npmWasStubbed':True,'nativeInstallExecuted':False},indent=2)+'\n')
  tests=checkout/'scratch/gap-hunt/review-203';tests.mkdir();shutil.copyfile(ROOT/'scratch/gap-hunt/review-203/diagnostic-contract.test.mjs',tests/'diagnostic-contract.test.mjs')
  for label,argv,count in [('docs',['node','--test','tooling/native-toolchain-docs.test.mjs'],5),('diagnostic-contract',['node','--experimental-vm-modules','--test','scratch/gap-hunt/review-203/diagnostic-contract.test.mjs'],5)]:
   result=subprocess.run(argv,cwd=checkout,text=True,capture_output=True,timeout=120);text=result.stdout+result.stderr;(out/(label+'.log')).write_text(text.replace(str(folder),'<archive-root>'));assert result.returncode==0 and re.search(r'(?:ℹ|#) pass '+str(count)+r'\b',text);records.append(dict(label=label,argv=argv,exit=result.returncode,tests=count))
  assert all(hashlib.sha256((checkout/p).read_bytes()).hexdigest()==h for p,h in sourcefiles.items())
  receipt=dict(source=PIN,commands=records,sourceFilesUnchanged=len(sourcefiles),fixtureSha256=DIGEST,adaptationGuardOnlyHashVerified=True,capturedNode24HashVerified=True,historicalSources=historical,localLinks=links,nativeInstallExecuted=False,linuxRuntimeExecuted=False,scope='Synthetic diagnostic ports prove output classification/control flow only. Historical real-native and supplied Linux evidence retain their original provenance.')
  (out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(dict(outputDirectory=str(out),docsTests=5,syntheticDiagnosticTests=5,sourceFilesUnchanged=len(sourcefiles),nativeInstallExecuted=False)))
if __name__=='__main__':main()
