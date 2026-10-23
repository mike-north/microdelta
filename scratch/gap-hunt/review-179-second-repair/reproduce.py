"""Replay frozen residual import checks and prove sensitivity to the old rule."""
from pathlib import Path
import hashlib,json,os,re,subprocess
ROOT=Path(__file__).resolve().parents[3]
PREFIX='scratch/gap-hunt/review-179-second-repair/'
PIN='88f9b35830bf3f35368e8685155e0d7284dad383'
OUT=ROOT/PREFIX/'local-results'
def git(*a):return subprocess.check_output(['git','-c','core.fsmonitor=false',*a],cwd=ROOT)
def sha(b):return hashlib.sha256(b).hexdigest()
def guard():
 for args in [('diff','--name-only','-z',PIN,'HEAD'),('diff','--name-only','-z','HEAD'),('ls-files','--others','--exclude-standard','-z')]:assert all(not p or p.startswith(PREFIX) for p in git(*args).decode().split('\0')),args
commands=[]
def run(name,args,expected=0):
 with (OUT/(name+'.log')).open('w') as stdout:
  r=subprocess.run(args,cwd=ROOT,env=dict(os.environ,REVIEW_SOURCE_PIN=PIN),stdout=stdout,stderr=subprocess.STDOUT,timeout=600)
 commands.append({'name':name,'args':args,'exit':r.returncode,'expected':expected});(OUT/'commands.json').write_text(json.dumps(commands,indent=2)+'\n');assert r.returncode==expected,(name,r.returncode)
 return (OUT/(name+'.log')).read_text()
def witnesses(prefix,expected):
 text=run(prefix+'-residual',['node','--experimental-import-meta-resolve',PREFIX+'residual-matrix.mjs'],expected)
 # The witness writes its structured result before the Node assertion stack.
 data=json.JSONDecoder().raw_decode(text)[0];assert (data['passed'],data['failed'])==((4,0) if expected==0 else (3,1));assert data['rows'][0]['node_resolved_target']==data['rows'][1]['node_resolved_target']=='packages/history/src/index.js'
 text=run(prefix+'-shadow',['node',PREFIX+'shadowed-require.mjs'],expected);data=json.JSONDecoder().raw_decode(text)[0];assert len(data['errors'])==(0 if expected==0 else 1)
def main():
 guard();OUT.mkdir(parents=True,exist_ok=True)
 manifest=json.loads((ROOT/PREFIX/'original-manifest.json').read_text())
 for r in manifest['files']:
  b=(ROOT/PREFIX/r['path']).read_bytes();assert sha(b)==r['sha256'];assert b==git('show',manifest['pin']+':'+r['originalPath'])
 run('install',['npm','ci','--no-audit','--no-fund'])
 witnesses('current',0)
 text=run('official-rule-tests',['node','--test','--test-reporter=tap','tooling/context-boundaries.test.mjs','tooling/example-source-imports.test.mjs']);assert re.search(r'^# pass 14$',text,re.M) and re.search(r'^# fail 0$',text,re.M)
 run('official-import-check',['npm','run','check:imports'])
 rule=ROOT/'tooling/example-source-imports.mjs';actual=rule.read_bytes();previous=(ROOT/PREFIX/'previous-rule.mjs').read_bytes();assert actual==git('show',PIN+':tooling/example-source-imports.mjs');assert previous==git('show','e00d5f999725800eb4f574b8e73d7300e71ad44d:tooling/example-source-imports.mjs')
 try:
  rule.write_bytes(previous);witnesses('previous-rule',1)
 finally:rule.write_bytes(actual)
 assert rule.read_bytes()==actual
 witnesses('restored',0);run('restored-import-check',['npm','run','check:imports']);guard()
 result={'head':git('rev-parse','HEAD').decode().strip(),'reviewed_pin':PIN,'original_witness_pin':manifest['pin'],'original_files_byte_exact':True,'residual':{'passed':4,'failed':0},'shadowed_require_errors':0,'official_rule_tests_passed':14,'official_import_check':'pass','old_rule_residual':{'passed':3,'failed':1},'old_rule_shadowed_require_errors':1,'rule_restored_byte_exact':True,'rule_sha256':sha(actual),'previous_rule_sha256':sha(previous),'verdict':'PASS for the two reported residuals at the reviewed source','scope':'Node24 macOS tooling/source-check and ESM resolution only; no fullCI, Linux, moduleexecution, release or universalcheckercoverage'}
 (OUT/'summary.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
if __name__=='__main__':main()
