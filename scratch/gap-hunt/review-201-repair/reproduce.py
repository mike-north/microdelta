#!/usr/bin/env python3
"""Check the exact changed guide from a clean archive and an empty sibling."""
import hashlib,json,os
from pathlib import Path
import re,shutil,subprocess,sys,tempfile
ROOT=Path(__file__).resolve().parents[3]
PIN='4c4934ea61ba6294894c80089423e21adecabdda'
OLD='f4211e3d925ed8aaedc313ac468d49a13149826c'
DOC='docs/private-alpha-workspace-consumers.md'

def git(*args):return subprocess.check_output(['git','-c','core.fsmonitor=false',*args],cwd=ROOT,timeout=60)
def main():
 out=Path(tempfile.mkdtemp(prefix='microdelta-review201repair-output-'))
 env=os.environ.copy();env.pop('GAP_HUNT_REUSE_BUILD',None)
 sdk=Path('/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk')
 if sys.platform=='darwin' and sdk.is_dir():env['SDKROOT']=str(sdk)
 changed=git('diff','--name-only',OLD,PIN).decode().splitlines();assert changed==[DOC]
 records=[]
 with tempfile.TemporaryDirectory(prefix='microdelta-review201repair-') as parent:
  checkout=Path(parent)/'microdelta';checkout.mkdir();subprocess.run(['tar','-xf','-','-C',str(checkout)],input=git('archive','--format=tar',PIN),check=True,timeout=60)
  files={str(p.relative_to(checkout)):hashlib.sha256(p.read_bytes()).hexdigest() for p in checkout.rglob('*') if p.is_file()}
  def run(label,argv,cwd,status=0,fragment=None,timeout=60):
   result=subprocess.run(argv,cwd=cwd,env=env,text=True,capture_output=True,timeout=timeout);text=result.stdout+result.stderr;(out/(label+'.log')).write_text(text.replace(str(parent),'<probe-root>'));assert result.returncode==status,(label,text[-4000:])
   if fragment:assert fragment in text,(label,text)
   records.append({'label':label,'argv':argv,'exit':result.returncode,'expected':status,'timeoutSeconds':timeout})
  run('install',['npm','ci'],checkout,timeout=900)
  run('build-packages',['npm','run','build:packages'],checkout,timeout=900)
  consumer=Path(parent)/'consumer';consumer.mkdir();doc=(checkout/DOC).read_text();configs=re.findall(r'```json\n(.*?)\n```',doc,re.S);js=re.findall(r'```js\n(.*?)\n```',doc,re.S);assert len(configs)==2 and len(js)==1
  (consumer/'tsconfig.json').write_text(configs[1]);(consumer/'runtime-import.mjs').write_text(js[0]);assert 'cp ' not in doc and 'copy' not in doc
  shell=re.findall(r'```sh\n(.*?)\n```',doc,re.S)[2].splitlines();assert shell[:2]==['mkdir -p node_modules','ln -s ../../microdelta/packages/core node_modules/microdelta']
  for index,command in enumerate(shell[:2]):run('guide-setup-'+str(index),['bash','-c',command],consumer,timeout=30)
  compiler=['node','../microdelta/node_modules/typescript/bin/tsc','-p','tsconfig.json'];run('literal-new-head-no-input',compiler,consumer,2,'error TS6053:');assert not (consumer/'alpha-import-only.ts').exists()
  shutil.copyfile(checkout/'fixtures/declarations/consumer-alpha/alpha-import-only.ts',consumer/'alpha-import-only.ts');run('explicit-copy-compiler',compiler,consumer);run('explicit-copy-runtime',['node','runtime-import.mjs'],consumer)
  assert all(hashlib.sha256((checkout/p).read_bytes()).hexdigest()==digest for p,digest in files.items())
  receipt={'source':PIN,'priorSource':OLD,'priorProof':'62edd3fce225a664470aca650c180e50486446f4','changedFiles':changed,'sourceFilesUnchanged':len(files),'freshInstallBuild':True,'missingInputPersists':True,'commands':records,'platform':sys.platform,'node':subprocess.check_output(['node','--version'],text=True,timeout=30).strip(),'sdkRootSelected':str(sdk) if env.get('SDKROOT')==str(sdk) else None}
  (out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps({'outputDirectory':str(out),'literalGuide':'TS6053','explicitCopy':'compiler/runtime0','sourceFilesUnchanged':len(files),'freshInstallBuild':True}))
if __name__=='__main__':main()
