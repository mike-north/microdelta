"""Two finite diagnostics over the unchanged original collection fixture; no product edits."""
from pathlib import Path
import argparse,collections,datetime,hashlib,json,os,signal,sqlite3,subprocess,tempfile,time
FIX='f46223193696b67499322bdf70260b85a6277564';BASE='c5802daca4a0bb8ea91159854d84eddcfa5215b6';ORIGINAL='88812f7aafcc18f4736f23dd7ae5c6d4e27de62f'
HERE=Path(__file__).resolve().parent
sha=lambda b:hashlib.sha256(b).hexdigest()
def git(repo,*args):return subprocess.check_output(['git','-c','core.fsmonitor=false',*args],cwd=repo)
def write(path,value):path.write_text(json.dumps(value,indent=2)+'\n')
def sources(repo):return {p:sha((repo/p).read_bytes()) for p in git(repo,'ls-files','-z').decode().split('\0') if p and (repo/p).is_file()}
def command(argv,cwd,output,label,timeout):
 start=time.monotonic()
 with (output/(label+'.log')).open('w') as f:r=subprocess.run(argv,cwd=cwd,stdout=f,stderr=subprocess.STDOUT,timeout=timeout)
 row={'argv':argv,'exit':r.returncode,'seconds':time.monotonic()-start,'log_sha256':sha((output/(label+'.log')).read_bytes())};write(output/(label+'.json'),row);print(label,r.returncode,flush=True);assert r.returncode==0,label
 return row

def prepare(repo,pin,output):
 assert git(repo,'rev-parse','HEAD').decode().strip()==pin
 before=sources(repo);owned=repo/'scratch/gap-hunt/100k-profile';owned.mkdir(parents=True,exist_ok=True)
 original=git(repo,'show',ORIGINAL+':scratch/gap-hunt/scale/collections.ts');assert original==(HERE/'collections.ts').read_bytes()
 for name in ['collections.ts','tsconfig.json','eslint.config.mjs']:
  target=owned/name
  if target.resolve()!=(HERE/name).resolve():target.write_bytes((HERE/name).read_bytes())
 assert (owned/'collections.ts').read_bytes()==original
 rows=[]
 for label,argv in [('install',['npm','ci','--no-audit','--no-fund']),('build',['npm','run','build:packages']),('compile',['node','node_modules/typescript/bin/tsc','-p','scratch/gap-hunt/100k-profile/tsconfig.json']),('lint',['node','node_modules/eslint/bin/eslint.js','--config','scratch/gap-hunt/100k-profile/eslint.config.mjs','scratch/gap-hunt/100k-profile/collections.ts'])]:rows.append(command(argv,repo,output,label,1200))
 assert sources(repo)==before,'Tracked source changed during bootstrap'
 (repo/'scratch/gap-hunt/scale').mkdir(parents=True,exist_ok=True)
 return {'source':pin,'source_before':before,'source_after_bootstrap':sources(repo),'fixture_sha256':sha(original),'fixture_source':ORIGINAL,'fixture_byte_exact_original':True,'observational_overlay':False,'commands':rows}

def profile_control(repo,output):
 start=time.monotonic();argv=['node','--max-old-space-size=1536','--cpu-prof','--cpu-prof-dir='+str(output),'scratch/gap-hunt/100k-profile/dist/collections.js','100']
 with (output/'runtime.log').open('w') as f:
  p=subprocess.Popen(argv,cwd=repo,stdout=f,stderr=subprocess.STDOUT,start_new_session=True)
  try:code=p.wait(timeout=30)
  except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait();code=124
 rows=[]
 for line in (output/'runtime.log').read_text().splitlines():
  try:rows.append(json.loads(line))
  except json.JSONDecodeError:pass
 profiles=list(output.glob('*.cpuprofile'));receipt={'argv':argv,'bound_seconds':30,'exit':code,'seconds':time.monotonic()-start,'observations':rows,'normal_exit_profile_required':True,'profiles':[]}
 write(output/'runtime-receipt.json',receipt)
 assert code==0 and len(profiles)==1,'Control must finish normally with one flushed CPU profile'
 assert next(x for x in rows if x.get('phase')=='settled')['counts']=={'succeeded':100}
 assert any(x.get('phase')=='closed' for x in rows)
 data=json.loads(profiles[0].read_text());nodes={n['id']:n['callFrame'] for n in data['nodes']};counts=collections.Counter(data['samples']);assert counts and all(x in nodes for x in counts)
 runtime=[{'frame':nodes[n],'self_samples':count} for n,count in counts.items() if '/packages/' in nodes[n]['url'] and '/dist/src/' in nodes[n]['url']]
 assert runtime,'Flushed profile contains sampled library runtime work'
 receipt.update(profiles=[{'file':profiles[0].name,'sha256':sha(profiles[0].read_bytes()),'samples':len(data['samples']),'nodes':len(data['nodes']),'readable':True}],runtime_frames=sorted(runtime,key=lambda x:x['self_samples'],reverse=True),top_frames=[{'frame':nodes[n],'self_samples':count} for n,count in counts.most_common(20)])
 write(output/'runtime-receipt.json',receipt);print('control profile readable; 100 succeeded',flush=True);return receipt

def state(repo,pid,elapsed):
 row={'elapsed_seconds':elapsed,'pid':pid}
 rss=subprocess.run(['ps','-o','rss=','-p',str(pid)],capture_output=True,text=True);row['rss_kib']=int(rss.stdout.strip()) if rss.returncode==0 and rss.stdout.strip() else None
 path=repo/f'scratch/gap-hunt/scale/collection-100000-{pid}.sqlite';row['store_exists']=path.exists()
 if path.exists():
  row['files']={f.name:f.stat().st_size for f in [path,Path(str(path)+'-wal'),Path(str(path)+'-shm')] if f.exists()}
  try:
   db=sqlite3.connect(path.resolve().as_uri()+'?mode=ro',uri=True,timeout=0.1)
   row['committed_counts']={t:db.execute('SELECT count(*) FROM '+t).fetchone()[0] for t in ['history_attempts','history_results','history_nodes','history_edges','history_addresses']};db.close()
  except sqlite3.Error as e:row['state_read_error']=str(e)
 return row

def baseline(repo,output):
 argv=['node','--max-old-space-size=1536','scratch/gap-hunt/100k-profile/dist/collections.js','100000'];start=time.monotonic();samples=[];observations=[];schedule=[(10,'near-10s'),(30,'near-30s')];nextstate=0
 with (output/'runtime.log').open('w') as f:
  child=subprocess.Popen(argv,cwd=repo,stdout=f,stderr=subprocess.STDOUT,start_new_session=True)
  while child.poll() is None and time.monotonic()-start<45:
   elapsed=time.monotonic()-start
   if elapsed>=nextstate:observations.append(state(repo,child.pid,elapsed));nextstate+=5;write(output/'state-samples.json',observations)
   if schedule and elapsed>=schedule[0][0]:
    _,label=schedule.pop(0);file=output/(label+'.sample.txt');log=(output/(label+'.sampler.log')).open('w');p=subprocess.Popen(['/usr/bin/sample',str(child.pid),'5','10','-file',str(file)],stdout=log,stderr=subprocess.STDOUT);samples.append({'label':label,'started_seconds':elapsed,'process':p,'log':log,'file':file})
   time.sleep(0.1)
  timedout=child.poll() is None
  if timedout:os.killpg(child.pid,signal.SIGKILL)
  code=child.wait(timeout=5)
 for x in samples:
  x['exit']=x['process'].wait(timeout=10);x['log'].close();x.pop('process');x.pop('log');file=x.pop('file');x['file']=file.name;x['exists']=file.exists();x['sha256']=sha(file.read_bytes()) if file.exists() else None
  content=file.read_text(errors='replace') if file.exists() else '';x['readable_stack_report']=('Call graph:' in content or 'Call graph' in content) and ('Thread_' in content or 'Thread ' in content or 'thread' in content)
 observations.append(state(repo,child.pid,time.monotonic()-start));write(output/'state-samples.json',observations)
 childgone=subprocess.run(['kill','-0',str(child.pid)],capture_output=True).returncode!=0
 receipt={'argv':argv,'source':BASE,'size':100000,'heap_limit_mib':1536,'lease_milliseconds':3600000,'bound_seconds':45,'seconds':time.monotonic()-start,'exit':code,'timed_out':timedout,'signal':'SIGKILL' if code==-9 else None,'child_gone':childgone,'external_samples':samples,'state_samples':observations,'python_sqlite_version':sqlite3.sqlite_version,'profile_flush_on_kill_assumed':False,'observational_overlay':False}
 write(output/'runtime-receipt.json',receipt);assert childgone
 print('baseline terminal',code,'samples',len(samples),flush=True);return receipt

def main():
 assert os.uname().sysname=='Darwin', 'External sample evidence requires macOS; no Linux profile claimed'
 p=argparse.ArgumentParser();p.add_argument('--fix-worktree');p.add_argument('--baseline-worktree');p.add_argument('--output');a=p.parse_args();repo=Path(git(HERE,'rev-parse','--show-toplevel').decode().strip());output=Path(a.output).resolve() if a.output else Path(tempfile.mkdtemp(prefix='microdelta-100k-profile-evidence-'));output.mkdir(parents=True,exist_ok=False) if a.output else None
 assert bool(a.fix_worktree)==bool(a.baseline_worktree),'Supply both explicit fresh worktrees or neither'
 owned=[]
 if a.fix_worktree:fix=Path(a.fix_worktree).resolve();base=Path(a.baseline_worktree).resolve()
 else:
  temp=Path(tempfile.mkdtemp(prefix='microdelta-100k-profile-worktrees-'));fix=temp/'fix';base=temp/'baseline'
  for path,pin in [(fix,FIX),(base,BASE)]:subprocess.run(['git','-c','core.fsmonitor=false','worktree','add','--detach',str(path),pin],cwd=repo,check=True,capture_output=True);owned.append(str(path))
 envinfo={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'node':subprocess.check_output(['node','--version'],text=True).strip(),'platform':os.uname().sysname,'output':str(output),'owned_worktrees':owned,'workloads':['fix100-control','baseline100k-45s-only'],'paid_or_live_provider':False,'step3_fix100k_executed':False};write(output/'environment.json',envinfo)
 runs={}
 for label,tree,pin in [('fix100',fix,FIX),('baseline100k',base,BASE)]:
  out=output/label;out.mkdir();bootstrap=prepare(tree,pin,out);write(out/'source-receipt.json',bootstrap)
  result=profile_control(tree,out) if label=='fix100' else baseline(tree,out)
  bootstrap['source_after_runtime']=sources(tree);bootstrap['source_unchanged']=bootstrap['source_before']==bootstrap['source_after_runtime'];assert bootstrap['source_unchanged'];write(out/'source-receipt.json',bootstrap);runs[label]={'source':pin,'source_files':len(bootstrap['source_before']),'source_unchanged':True,'runtime':result};write(output/'receipt.json',dict(environment=envinfo,runs=runs))
 print('COMPLETE',output,flush=True)
if __name__=='__main__':main()
