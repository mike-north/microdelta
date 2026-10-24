"""One capped original-fixture run, with independent closed-store correctness audit."""
from pathlib import Path
import argparse,datetime,json,os,signal,sqlite3,subprocess,tempfile,time
from reproduce import FIX,HERE,git,sha,write,sources,prepare,state

def generated(repo):
 return {str(p.relative_to(repo)):sha(p.read_bytes()) for p in sorted((repo/'packages').rglob('dist/**/*.js')) if p.is_file()}

def audit(path):
 """Assert only the fixture's tagged-wire shapes, independently of runtime decoding."""
 db=sqlite3.connect(path.resolve().as_uri()+'?mode=ro',uri=True)
 counts={t:db.execute('SELECT count(*) FROM '+t).fetchone()[0] for t in ['history_attempts','history_results','history_nodes','history_edges','history_addresses']}
 assert counts['history_results']==100001,counts
 seen=set();listing=None;score_sum=0
 for analysis,env,subject,payload in db.execute('SELECT analysis,environment,subject,payload FROM history_results'):
  assert analysis=='collections' and env=='synthetic',(analysis,env)
  if isinstance(payload,bytes):payload=payload.decode()
  assert payload.startswith('MDS1|');wire=json.loads(payload[5:])
  if subject=='listing':assert listing is None;listing=wire;continue
  assert subject.startswith('score:member:');i=int(subject[len('score:member:'):]);assert 0<=i<100000 and subject==f'score:member:{i}' and i not in seen
  assert wire==['o',[['score',['d',str(i)]]],['p-object']],(subject,wire)
  seen.add(i);score_sum+=i
 assert len(seen)==100000 and score_sum==4999950000
 assert listing is not None and listing[0]=='o' and listing[2]==['p-object']
 fields=dict(listing[1]);assert set(fields)=={'members','status'} and fields['status']==['s','complete']
 members=fields['members'];assert members[0]=='a' and len(members[1])==100000
 import hashlib
 digest=hashlib.sha256()
 for i,member in enumerate(members[1]):
  assert member==['o',[['key',['s',f'member:{i}']],['score',['d',str(i)]]],['p-object']],i
  digest.update(f'member:{i}\t{i}\n'.encode())
 db.close()
 return {'passed':True,'counts':counts,'exact_unique_member_keys':100000,'exact_score_subjects':100000,'missing':0,'duplicates':0,'incorrect_scores':0,'score_sum':score_sum,'ordered_key_score_sha256':digest.hexdigest(),'method':'Independent read-only Python SQLite audit of every listing member and every score result; exact original-fixture tagged-wire shapes.'}

def run(repo,out):
 assert os.uname().sysname=='Darwin'
 before=sources(repo);assert git(repo,'rev-parse','HEAD').decode().strip()==FIX
 assert (HERE/'collections.ts').read_bytes()==git(repo,'show','88812f7aafcc18f4736f23dd7ae5c6d4e27de62f:scratch/gap-hunt/scale/collections.ts')
 built=generated(repo);assert built
 argv=['node','--max-old-space-size=1536','scratch/gap-hunt/100k-profile/dist/collections.js','100000'];start=time.monotonic();schedule=[15,30,60,120,240];states=[];sample=None
 with (out/'runtime.log').open('w') as f:
  child=subprocess.Popen(argv,cwd=repo,stdout=f,stderr=subprocess.STDOUT,start_new_session=True)
  store=repo/f'scratch/gap-hunt/scale/collection-100000-{child.pid}.sqlite';assert not store.exists(),'Fresh PID store required'
  while child.poll() is None and time.monotonic()-start<300:
   elapsed=time.monotonic()-start
   if schedule and elapsed>=schedule[0]:
    planned=schedule.pop(0);row=state(repo,child.pid,elapsed);row['planned_seconds']=planned;states.append(row);write(out/'state-samples.json',states)
    if planned==30 and row.get('committed_counts',{}).get('history_results',0)==0:
     file=out/'near-30s.sample.txt';log=(out/'near-30s.sampler.log').open('w');proc=subprocess.Popen(['/usr/bin/sample',str(child.pid),'5','10','-file',str(file)],stdout=log,stderr=subprocess.STDOUT);sample={'started_seconds':elapsed,'process':proc,'log':log,'file':file}
   time.sleep(.1)
  timeout=child.poll() is None
  if timeout:os.killpg(child.pid,signal.SIGKILL)
  code=child.wait(timeout=5)
 terminal=time.monotonic()-start
 if sample:
  sample['exit']=sample.pop('process').wait(timeout=10);sample.pop('log').close();file=sample.pop('file');sample['file']=file.name;sample['sha256']=sha(file.read_bytes()) if file.exists() else None
 rows=[]
 for line in (out/'runtime.log').read_text().splitlines():
  try:rows.append(json.loads(line))
  except json.JSONDecodeError:pass
 states.append(state(repo,child.pid,terminal));write(out/'state-samples.json',states)
 gone=subprocess.run(['kill','-0',str(child.pid)],capture_output=True).returncode!=0;assert gone
 settled=next((r for r in rows if r.get('phase')=='settled'),None);closed=any(r.get('phase')=='closed' for r in rows)
 result={'source':FIX,'argv':argv,'size':100000,'heap_limit_mib':1536,'lease_milliseconds':3600000,'bound_seconds':300,'seconds':terminal,'exit':code,'timed_out':timeout,'signal':'SIGKILL' if code==-9 else None,'child_gone':gone,'store':str(store),'observations':rows,'state_samples':states,'external_sample':sample,'closed':closed,'observational_overlay':False,'python_sqlite_version':sqlite3.sqlite_version,'correctness':{'passed':False,'reason':'Runtime did not complete normally and close with 100000 succeeded'}}
 if code==0 and settled and settled.get('counts')=={'succeeded':100000} and closed:
  try:result['correctness']=audit(store)
  except Exception as e:result['correctness']={'passed':False,'error':repr(e)}
 after=sources(repo);afterbuilt=generated(repo);assert before==after and built==afterbuilt
 write(out/'source-receipt.json',{'source':FIX,'source_before':before,'source_after_runtime':after,'source_unchanged':True,'generated_before':built,'generated_after':afterbuilt,'generated_unchanged':True,'fixture_sha256':sha((HERE/'collections.ts').read_bytes()),'fixture_byte_exact_original':True,'observational_overlay':False})
 write(out/'runtime-receipt.json',result);print(json.dumps({'seconds':terminal,'exit':code,'closed':closed,'correctness':result['correctness']},indent=2),flush=True)

def main():
 p=argparse.ArgumentParser();p.add_argument('--verified-worktree');p.add_argument('--output');a=p.parse_args();out=Path(a.output).resolve() if a.output else Path(tempfile.mkdtemp(prefix='microdelta-fix100k-evidence-'));out.mkdir(parents=True,exist_ok=False) if a.output else None
 if a.verified_worktree:
  repo=Path(a.verified_worktree).resolve();previous=json.loads((out.parent/'fix100/source-receipt.json').read_text());assert sources(repo)==previous['source_after_runtime'];write(out/'reuse-build.json',{'explicit_reuse':True,'source_verified_against':'../fix100/source-receipt.json','prior_locked_install_build_compile_lint':True,'source':FIX})
 else:
  root=Path(git(HERE,'rev-parse','--show-toplevel').decode().strip());repo=Path(tempfile.mkdtemp(prefix='microdelta-fix100k-worktree-'))/'fix';subprocess.run(['git','-c','core.fsmonitor=false','worktree','add','--detach',str(repo),FIX],cwd=root,check=True,capture_output=True);write(out/'bootstrap-receipt.json',prepare(repo,FIX,out))
 write(out/'environment.json',{'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'node':subprocess.check_output(['node','--version'],text=True).strip(),'platform':os.uname().sysname,'paid_or_live_provider':False,'retry':False});run(repo,out)
if __name__=='__main__':main()
