"""Owned clean generated-declaration replay of one finite ACC-002 outcome; no remote work."""
from pathlib import Path
import subprocess,tempfile,json,hashlib,os,re,platform,time
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2];OUT=Path(tempfile.mkdtemp(prefix='microdelta-acc002-replay-'));print('Evidence output: '+str(OUT),flush=True)
PIN='52e3786516a404e3433bef03807a027c8103786c';receipt={'source':PIN,'recipe_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'node':subprocess.check_output(['node','--version'],text=True).strip(),'platform':platform.platform(),'commands':[]}
assert not subprocess.check_output(['git','-c','core.fsmonitor=false','diff',PIN,'--','.',':(exclude)scratch/gap-hunt/accounting-validation'],cwd=ROOT).strip()
def run(name,args):
 env=dict(os.environ)
 for k in ['GAP_HUNT_REUSE_BUILD','NODE_OPTIONS','NODE_PATH','GH_TOKEN','GITHUB_TOKEN']:env.pop(k,None)
 start=time.monotonic();p=subprocess.run(args,cwd=ROOT,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=600);raw=p.stdout
 text=raw.replace(str(ROOT),'<checkout>').replace(str(OUT),'<evidence-output>');text=re.sub(r'/var/folders/[^"\s]+/microdelta-acc002-[A-Za-z0-9]+','<synthetic-store>',text)
 (OUT/(name+'.log')).write_text(text);receipt['commands'].append({'name':name,'argv':args,'exit':p.returncode,'seconds':time.monotonic()-start,'log_sha256':hashlib.sha256(text.encode()).hexdigest()});(OUT/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(name,p.returncode,flush=True);assert p.returncode==0,name
 if name=='runtime':
  assert re.findall(r'^Test Suites:\s*(.+)$',raw,re.M)==['1 passed, 1 total'];assert re.findall(r'^Tests:\s*(.+)$',raw,re.M)==['1 passed, 1 total']
  assert not re.search(r'Test suite failed to run|Cannot find module|SyntaxError:|TypeError:|ReferenceError:|ERR_MODULE',raw)
  line=next(line.strip() for line in raw.splitlines() if line.strip().startswith('{"directory"'));data=json.loads(line);store=Path(data['directory']);receipt['synthetic_store_private']=str(store);data['directory']='<synthetic-store>';receipt['observation']=data;receipt['durable_records_sha256']=hashlib.sha256((store/'durable-records.json').read_bytes()).hexdigest()
run('install',['npm','ci','--no-audit','--no-fund']);run('build',['npm','run','build:packages']);run('types',['node','node_modules/typescript/bin/tsc','-p','scratch/gap-hunt/accounting-validation/tsconfig.json']);run('lint',['node','node_modules/eslint/bin/eslint.js','--config','scratch/gap-hunt/accounting-validation/eslint.config.mjs','scratch/gap-hunt/accounting-validation/worker.ts']);run('runtime',['node','--experimental-vm-modules','node_modules/jest/bin/jest.js','--config','scratch/gap-hunt/accounting-validation/jest.config.mjs','--runInBand'])
receipt['complete']=True;(OUT/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print('COMPLETE',flush=True)
