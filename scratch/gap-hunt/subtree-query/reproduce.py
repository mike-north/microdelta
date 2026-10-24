"""Clean finite reproduction; expected exit1 is the captured SQL-work counterexample."""
from pathlib import Path
import argparse,hashlib,json,subprocess,tempfile,time
PIN='f46223193696b67499322bdf70260b85a6277564';HERE=Path(__file__).resolve().parent

def sources(repo):
 files=subprocess.check_output(['git','-c','core.fsmonitor=false','ls-files','-z'],cwd=repo).decode().split('\0')
 return {f:hashlib.sha256((repo/f).read_bytes()).hexdigest() for f in files if f and (repo/f).is_file()}

def main():
 p=argparse.ArgumentParser();p.add_argument('--output');a=p.parse_args();root=Path(subprocess.check_output(['git','rev-parse','--show-toplevel'],cwd=HERE,text=True).strip());temp=Path(tempfile.mkdtemp(prefix='microdelta-subtree-query-'));repo=temp/'worktree';out=Path(a.output).resolve() if a.output else temp/'evidence';out.mkdir(parents=True,exist_ok=False)
 subprocess.run(['git','-c','core.fsmonitor=false','worktree','add','--detach',str(repo),PIN],cwd=root,check=True,capture_output=True)
 before=sources(repo);target=repo/'scratch/gap-hunt/subtree-query';target.mkdir(parents=True)
 for f in ['probe.test.ts','tsconfig.json','eslint.config.mjs','jest.config.mjs','PREDECLARED.md','sql-work.py']:(target/f).write_bytes((HERE/f).read_bytes())
 commands=[('install',['npm','ci','--no-audit','--no-fund'],1200),('build',['npm','run','build:packages'],1200),('compile',['node','node_modules/typescript/bin/tsc','-p','scratch/gap-hunt/subtree-query/tsconfig.json'],120),('lint',['node','node_modules/eslint/bin/eslint.js','--config','scratch/gap-hunt/subtree-query/eslint.config.mjs','scratch/gap-hunt/subtree-query/probe.test.ts'],120),('production',['node','--experimental-vm-modules','node_modules/jest/bin/jest.js','--config','scratch/gap-hunt/subtree-query/jest.config.mjs','--runInBand'],60),('sql-work',['python3','scratch/gap-hunt/subtree-query/sql-work.py'],30)]
 receipt=[];code=0
 for name,argv,bound in commands:
  start=time.monotonic()
  with (out/(name+'.log')).open('w') as f:r=subprocess.run(argv,cwd=repo,stdout=f,stderr=subprocess.STDOUT,timeout=bound)
  receipt.append({'name':name,'argv':argv,'exit':r.returncode,'seconds':time.monotonic()-start});code=r.returncode
  if code:break
 assert before==sources(repo),'Tracked product source changed'
 for name in ['production-captures.json','sql-work-results.json']:
  if (target/name).exists():(out/name).write_bytes((target/name).read_bytes())
 (out/'receipt.json').write_text(json.dumps({'pin':PIN,'source_files':len(before),'source_unchanged':True,'commands':receipt,'expected_counterexample_exit':1,'no_retry':True,'worktree':str(repo)},indent=2)+'\n')
 print(out);return code
if __name__=='__main__':raise SystemExit(main())
