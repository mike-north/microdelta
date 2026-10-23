#!/usr/bin/env python3
"""PR201 exact-source clean archive plus literal documented sibling consumer."""
import io,json,os,pathlib,re,subprocess,tarfile,tempfile,time,hashlib
ROOT=pathlib.Path.cwd();HERE=ROOT/'scratch/gap-hunt/review-201';SOURCE='f4211e3d925ed8aaedc313ac468d49a13149826c'
OUT=pathlib.Path(tempfile.mkdtemp(prefix='microdelta-review201-'));CHECKOUT=OUT/'microdelta';CHECKOUT.mkdir();ENV=dict(os.environ);ENV.pop('GAP_HUNT_REUSE_BUILD',None)
SDK=pathlib.Path('/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk')
if SDK.exists():ENV['SDKROOT']=str(SDK)
records=[]
def run(label,argv,cwd=CHECKOUT,expected=0,contains=None):
 start=time.monotonic();p=subprocess.run(argv,cwd=cwd,env=ENV,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=900)
 (OUT/(label+'.log')).write_text(p.stdout);records.append({'label':label,'argv':argv,'cwd':str(cwd),'exit':p.returncode,'expected':expected,'seconds':round(time.monotonic()-start,3)})
 print(label,p.returncode,flush=True);assert p.returncode==expected,(label,OUT)
 if contains:assert contains in p.stdout,(label,contains)
 return p.stdout
assert subprocess.run(['git','diff','--quiet',SOURCE,'--','.',':(exclude)scratch/gap-hunt/review-201']).returncode==0
archive=subprocess.check_output(['git','archive',SOURCE])
with tarfile.open(fileobj=io.BytesIO(archive)) as tar:tar.extractall(CHECKOUT,filter='data')
assert not (CHECKOUT/'node_modules').exists()
try:
 # Freeze the original issue's script and import-only inputs. Bootstrap stays enabled.
 for name in ['repro-154.mjs','repro-support.mjs']:
  dest=CHECKOUT/'scratch/gap-hunt/contract-surface'/name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes((HERE/'frozen'/name).read_bytes())
 for name in ['alpha-import-only.ts','tsconfig.alpha-facade.json','tsconfig.alpha-six.json']:
  dest=CHECKOUT/'scratch/gap-hunt/consumer-dx'/name;dest.write_bytes((HERE/'frozen'/name).read_bytes())
 original=run('original154',['node','scratch/gap-hunt/contract-surface/repro-154.mjs'],contains='Facade-only alpha mapping fails; explicit six-owner import-only mapping passes.')
 assert '$ npm ci' in original and '$ npm run build:packages' in original and 'error TS2305:' in original and 'IAbortSignal' in original
 compiler=CHECKOUT/'node_modules/typescript/bin/tsc'
 run('documented-root-compiler',['node',str(compiler),'-p','fixtures/declarations/consumer-alpha/tsconfig.alpha-six.json'])
 rootTests=run('documented-root-tests',['node','--test','fixtures/declarations/consumer-alpha/alpha-consumer.test.mjs'],contains='pass 4');assert re.search(r'(?:#|ℹ) fail 0(?:\n|$)',rootTests)
 fixture=CHECKOUT/'fixtures/declarations/consumer-alpha'
 run('documented-fixture-compiler',['node','../../../node_modules/typescript/bin/tsc','-p','tsconfig.alpha-six.json'],cwd=fixture)
 fixtureTests=run('documented-fixture-tests',['node','--test','alpha-consumer.test.mjs'],cwd=fixture,contains='pass 4');assert re.search(r'(?:#|ℹ) fail 0(?:\n|$)',fixtureTests)
 # Use the exact second JSON fence and exact JavaScript probe in the guide.
 doc=(CHECKOUT/'docs/private-alpha-workspace-consumers.md').read_text();configs=re.findall(r'```json\n(.*?)\n```',doc,re.S);assert len(configs)==2
 manual=json.loads(configs[1]);assert manual['compilerOptions']['skipLibCheck'] is False and manual['compilerOptions']['strict'] is True
 consumer=OUT/'consumer';consumer.mkdir();(consumer/'tsconfig.json').write_text(configs[1]);(consumer/'alpha-import-only.ts').write_text("import { authoring } from 'microdelta';\nvoid authoring;\n")
 probe=re.findall(r'```js\n(.*?)\n```',doc,re.S);assert len(probe)==1;(consumer/'runtime-import.mjs').write_text(probe[0])
 (consumer/'node_modules').mkdir();(consumer/'node_modules/microdelta').symlink_to('../../microdelta/packages/core',target_is_directory=True)
 run('documented-sibling-compiler',['node','../microdelta/node_modules/typescript/bin/tsc','-p','tsconfig.json'],cwd=consumer)
 run('documented-sibling-runtime',['node','runtime-import.mjs'],cwd=consumer)
 negatives={}
 for owner in [name for name in manual['compilerOptions']['paths'] if name!='microdelta']:
  missing=json.loads(configs[1]);del missing['compilerOptions']['paths'][owner]
  name=owner.split('/')[-1];config=consumer/('missing-'+name+'.json');config.write_text(json.dumps(missing))
  output=run('missing-'+name,['node','../microdelta/node_modules/typescript/bin/tsc','-p',config.name],cwd=consumer,expected=2,contains='error TS2305:')
  assert 'error TS5083:' not in output and 'error TS6053:' not in output
  negatives[owner]=len(re.findall(r'error TS\d+:',output))
 public=json.loads(configs[1]);del public['compilerOptions']['paths'];del public['compilerOptions']['baseUrl'];(consumer/'public.json').write_text(json.dumps(public))
 publicText=run('public-consumer',['node','../microdelta/node_modules/typescript/bin/tsc','-p','public.json'],cwd=consumer,expected=2,contains='error TS2305:');assert 'authoring' in publicText
 run('core-type-contracts',['npm','run','test:types','--workspace','microdelta'])
 run('fixture-lint',['node','node_modules/eslint/bin/eslint.js','fixtures/declarations/consumer-alpha/alpha-consumer.test.mjs'])
 manifests={}
 for p in sorted((CHECKOUT/'packages').glob('*/package.json')):
  d=json.loads(p.read_text());assert './alpha' not in d.get('exports',{});manifests[d['name']]={'types':d.get('types'),'exports':d.get('exports')}
 (OUT/'boundary.json').write_text(json.dumps({'packageExports':manifests,'siblingConfigContainsAbsolutePath':str(CHECKOUT) in json.dumps(manual),'negativeMissingOwners':negatives,'archiveSource':SOURCE,'originalDiagnosticOnly':True},indent=2)+'\n')
finally:
 (OUT/'commands.json').write_text(json.dumps(records,indent=2)+'\n');print('RAW_RECEIPT',OUT,flush=True)

# Read-only final capture verification; no additional runtime workload.
verified=subprocess.run(["python3",str(HERE/"verify-captures.py"),str(OUT)],capture_output=True,text=True,timeout=30)
print(verified.stdout,flush=True);assert verified.returncode==0,verified.stderr
