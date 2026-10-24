#!/usr/bin/env python3
"""Replay only the literal documentation input probe using qualified prior builds."""
import hashlib,json,os
from pathlib import Path
import re,shutil,subprocess,tempfile
ROOT=Path(__file__).resolve().parents[3]
PIN='4c4934ea61ba6294894c80089423e21adecabdda'
OLD='f4211e3d925ed8aaedc313ac468d49a13149826c'
DOC='docs/private-alpha-workspace-consumers.md'
OUT=ROOT/'scratch/gap-hunt/review-201-repair/captures'

def git(*args):return subprocess.check_output(['git','-c','core.fsmonitor=false',*args],cwd=ROOT)
def main():
 build=Path(os.environ['BUILD_CHECKOUT']).resolve();OUT.mkdir(exist_ok=True)
 changed=git('diff','--name-only',OLD,PIN).decode().splitlines();assert changed==[DOC]
 # This is a source-qualified prior build, not a clean install at the new head.
 names=git('ls-tree','-r','--name-only',OLD).decode().splitlines()
 for name in names:assert (build/name).read_bytes()==git('show',OLD+':'+name),name
 with tempfile.TemporaryDirectory(prefix='microdelta-review201repair-') as parent:
  checkout=Path(parent)/'microdelta';checkout.mkdir();subprocess.run(['tar','-xf','-','-C',str(checkout)],input=git('archive','--format=tar',PIN),check=True)
  (checkout/'node_modules').symlink_to(build/'node_modules',target_is_directory=True)
  emitted=[]
  for package in (build/'packages').iterdir():
   if (package/'dist').is_dir():
    (checkout/'packages'/package.name/'dist').symlink_to(package/'dist',target_is_directory=True)
    emitted.extend({'path':str(p.relative_to(build)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted((package/'dist').rglob('*')) if p.is_file())
  consumer=Path(parent)/'consumer';consumer.mkdir();doc=(checkout/DOC).read_text();configs=re.findall(r'```json\n(.*?)\n```',doc,re.S);js=re.findall(r'```js\n(.*?)\n```',doc,re.S);assert len(configs)==2 and len(js)==1
  (consumer/'tsconfig.json').write_text(configs[1]);(consumer/'runtime-import.mjs').write_text(js[0]);assert 'cp ' not in doc and 'copy' not in doc
  # Execute the repaired guide's exact setup commands from the new sibling.
  shell=re.findall(r'```sh\n(.*?)\n```',doc,re.S)[2].splitlines();assert shell[:2]==['mkdir -p node_modules','ln -s ../../microdelta/packages/core node_modules/microdelta']
  for command in shell[:2]:subprocess.run(['bash','-c',command],cwd=consumer,check=True,timeout=30)
  records=[]
  def run(label,argv,status,fragment=None):
   result=subprocess.run(argv,cwd=consumer,text=True,capture_output=True,timeout=60);text=result.stdout+result.stderr;assert result.returncode==status,(label,text)
   if fragment:assert fragment in text
   text=text.replace(str(parent),'<probe-root>');(OUT/(label+'.log')).write_text(text);records.append({'label':label,'argv':argv,'exit':result.returncode})
  compiler=['node','../microdelta/node_modules/typescript/bin/tsc','-p','tsconfig.json'];run('literal-new-head-no-input',compiler,2,'error TS6053:');assert not (consumer/'alpha-import-only.ts').exists()
  shutil.copyfile(checkout/'fixtures/declarations/consumer-alpha/alpha-import-only.ts',consumer/'alpha-import-only.ts');run('explicit-copy-compiler',compiler,0);run('explicit-copy-runtime',['node','runtime-import.mjs'],0)
  (OUT/'receipt.json').write_text(json.dumps({'source':PIN,'priorSource':OLD,'priorProof':'62edd3fce225a664470aca650c180e50486446f4','changedFiles':changed,'priorSourceFilesVerified':len(names),'buildQualification':'Existing executed prior compiler/generated closure reused after verifying all prior source files; new exact source archive. No fresh npm install/build.','missingInputPersists':True,'commands':records,'emittedFiles':emitted},indent=2)+'\n')
  print(json.dumps({'literalGuide':'TS6053','explicitCopy':'compiler/runtime0','missingInputPersists':True,'sourceFilesQualified':len(names),'emittedFiles':len(emitted)}))
if __name__=='__main__':main()
