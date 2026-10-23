#!/usr/bin/env python3
"""Finite PR189 replay. Source counterfactuals affect only this disposable evidence checkout."""
import json,os,platform,subprocess,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
os.chdir(ROOT)
OUT=Path(os.environ.get('MICRODELTA_EVIDENCE_OUTPUT',tempfile.mkdtemp(prefix='microdelta-review189-')));OUT.mkdir(parents=True,exist_ok=True)
print(f'Evidence output: {OUT}',flush=True)
SOURCE='fc1ccdae7284490066c45d3bcab322b554546a1f'
OLD='2a640aca75d5728484a2cb06af88c77690616ba9'
FROZEN='b1b42c304db15fe0c3c306a0fb4f71660970040f'
NODE_EXECUTABLE=subprocess.check_output(['node','-p','process.execPath'],text=True).strip()
rows=[]
def command(name,args,expected=0):
 env=dict(os.environ);env.pop('GAP_HUNT_REUSE_BUILD',None)
 p=subprocess.run(args,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
 (OUT/f'{name}.log').write_text(p.stdout.replace(str(ROOT),'<checkout>').replace(NODE_EXECUTABLE,'<node>'))
 rows.append(dict(name=name,command=args,exit=p.returncode,expected=expected))
 print(f'{name}: {p.returncode} (expected {expected})',flush=True)
 if p.returncode!=expected: raise RuntimeError(f'{name} unexpected exit; see captures')
def gitbytes(pin,path):return subprocess.check_output(['git','show',f'{pin}:{path}'])
files=['consumer-dx/custom-key.ts','consumer-dx/tsconfig.custom-key.json','consumer-dx/tsconfig.all.json','consumer-dx/custom-key.jest.config.mjs','consumer-dx/custom-key.test.mjs','consumer-dx/repro-custom-key.mjs','contract-surface/repro-support.mjs']
for f in files:
 p=Path('scratch/gap-hunt')/f
 assert p.read_bytes()==gitbytes(FROZEN,p),f
for path in ['packages/definition/src/collection.ts','packages/definition/src/template.ts']:
 assert Path(path).read_bytes()==gitbytes(SOURCE,path),path
node='node';jest=[node,'--experimental-vm-modules','node_modules/jest/bin/jest.js']
original=jest+['--config','scratch/gap-hunt/consumer-dx/custom-key.jest.config.mjs','--runInBand']
supplement=jest+['--config','scratch/gap-hunt/review-189-repair/jest.config.mjs','--runInBand']
try:
 command('original-default-bootstrap',[node,'scratch/gap-hunt/consumer-dx/repro-custom-key.mjs'])
 command('real-consumer-lint',[node,'node_modules/eslint/bin/eslint.js','-c','scratch/gap-hunt/review-189-repair/eslint.config.mjs','scratch/gap-hunt/consumer-dx/custom-key.ts','--max-warnings','0'])
 command('generated-alpha-types',[node,'node_modules/tsd/dist/cli.js','--typings','packages/core/dist/api/microdelta.alpha.d.ts','--files','scratch/gap-hunt/review-189-repair/generated.test-d.ts'])
 command('definition-check',['npm','run','check','--workspace','@microdelta/definition'])
 command('definition-tests',['npm','run','test','--workspace','@microdelta/definition'])
 command('core-test-build',[node,'node_modules/typescript/bin/tsc','-p','packages/core/tsconfig.test.json'])
 command('restart',jest+['--config','packages/core/jest.config.mjs','--runInBand','--runTestsByPath','packages/core/.test-build/test/keyed/restart.test.js'])
 command('supplement',supplement)
 command('anchors',[node,'packages/core/test/m4-acceptance/controls/m4-mutation-controls.mjs','--check-anchors'])
 paths=[Path('packages/definition/src/collection.ts'),Path('packages/definition/src/template.ts')]
 saved={p:p.read_bytes() for p in paths}
 try:
  for p in paths:p.write_bytes(gitbytes(OLD,p))
  command('old-source-build',['npm','run','build:packages'])
  command('old-source-original',original,1)
  command('old-source-supplement',supplement,1)
 finally:
  for p,data in saved.items():p.write_bytes(data)
  command('restored-build',['npm','run','build:packages'])
  assert all(p.read_bytes()==data for p,data in saved.items())
 command('restored-original',original)
 command('restored-supplement',supplement)
finally:
 (OUT/'receipt.json').write_text(json.dumps(dict(source=SOURCE,oldDefinitionSource=OLD,frozen=FROZEN,platform=platform.platform(),node=subprocess.check_output(['node','-v'],text=True).strip(),npm=subprocess.check_output(['npm','-v'],text=True).strip(),commands=rows),indent=2)+'\n')
