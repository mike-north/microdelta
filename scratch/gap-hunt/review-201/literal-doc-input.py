#!/usr/bin/env python3
"""Check the manual recipe without silently inventing its referenced input file."""
import json,pathlib,re,shutil,subprocess,sys,tempfile
checkout=pathlib.Path(sys.argv[1]).resolve();out=pathlib.Path(sys.argv[2]).resolve();out.mkdir(exist_ok=True)
# A fresh sibling uses only the guide's JSON and JavaScript plus its package link.
consumer=pathlib.Path(tempfile.mkdtemp(prefix='literal-consumer-',dir=checkout.parent))
try:
 doc=(checkout/'docs/private-alpha-workspace-consumers.md').read_text();configs=re.findall(r'```json\n(.*?)\n```',doc,re.S);probes=re.findall(r'```js\n(.*?)\n```',doc,re.S)
 assert len(configs)==2 and len(probes)==1
 (consumer/'tsconfig.json').write_text(configs[1]);(consumer/'runtime-import.mjs').write_text(probes[0]);(consumer/'node_modules').mkdir();(consumer/'node_modules/microdelta').symlink_to('../../microdelta/packages/core',target_is_directory=True)
 records=[]
 def run(label,argv,expected,fragment=None):
  result=subprocess.run(argv,cwd=consumer,capture_output=True,text=True,timeout=60);text=result.stdout+result.stderr;(out/(label+'.log')).write_text(text);assert result.returncode==expected,(label,text)
  if fragment:assert fragment in text,(label,text)
  records.append({'label':label,'argv':argv,'exit':result.returncode});return text
 argv=['node','../microdelta/node_modules/typescript/bin/tsc','-p','tsconfig.json']
 negative=run('literal-no-input',argv,2,'error TS6053:');assert 'alpha-import-only.ts' in negative and 'TS2305' not in negative
 # This is the missing explicit step, not an instruction already in the guide.
 source=checkout/'fixtures/declarations/consumer-alpha/alpha-import-only.ts';shutil.copyfile(source,consumer/'alpha-import-only.ts')
 records.append({'label':'explicit-input-copy','argv':['cp','../microdelta/fixtures/declarations/consumer-alpha/alpha-import-only.ts','.'],'exit':0,'performedBy':'shutil.copyfile with exact fixture bytes'})
 run('literal-with-copy',argv,0);run('literal-runtime-after-copy',['node','runtime-import.mjs'],0)
 (out/'literal-input-receipt.json').write_text(json.dumps({'source':'f4211e3d925ed8aaedc313ac468d49a13149826c','noInputFixtureSynthesizedBeforeNegative':True,'negativeIsMissingInputNotClosure':True,'manualRecipeRequiresUndocumentedInputStep':True,'commands':records},indent=2)+'\n')
 print(json.dumps({'withoutInput':'TS6053','afterExplicitCopy':'compiler and runtime pass','documentationGap':True}))
finally:shutil.rmtree(consumer)
