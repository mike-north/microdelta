"""Read actual production SQL/schema; compare unchanged old query without rewriting the historical oracle."""
from pathlib import Path
import re,json,importlib.util,subprocess,hashlib,sys
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[3]
def query(text):
 m=re.search(r'candidates: connection\.prepare\(sql`([\s\S]*?)`\)',text);assert m;return m[1]
def sha(b):return hashlib.sha256(b).hexdigest()
source=(ROOT/'packages/history/src/durable/index.ts').read_bytes();schema_source=(ROOT/'packages/history/src/durable/schema.ts').read_bytes();q=query(source.decode());assert 'WITH requested(' in q
names=['history_results','history_results_by_subject','history_promotions','history_promotions_by_target','history_promotion_results','history_promotion_results_by_result'];schema=[]
for name in names:
 matches=re.findall(r'sql`(CREATE (?:TABLE|INDEX) [\s\S]*?)`',schema_source.decode());found=[x for x in matches if re.match(r'^CREATE (?:TABLE|INDEX) '+name+r'\b',x)];assert len(found)==1;schema+=found
spec=importlib.util.spec_from_file_location('production_vm',ROOT/'tooling/candidate-query-vm.py');vm=importlib.util.module_from_spec(spec);spec.loader.exec_module(vm)
parent='471c1d47ef3dc0700e36d8da2adca7e02534570b';old_source=subprocess.check_output(['git','-c','core.fsmonitor=false','show',parent+':packages/history/src/durable/index.ts'],cwd=ROOT);old=query(old_source.decode());assert 'OR EXISTS' in old
new=vm.run({'query':q,'schema':schema,'shape':'scoped'});negative=vm.run({'query':old,'schema':schema,'shape':'legacy'})
for filler,rows in new['counts'].items():assert all(x['steps']<=rows[0]['steps']*2 for x in rows[1:]),(filler,rows)
assert negative['counts']['same-environment'][-1]['steps']>2*negative['counts']['same-environment'][0]['steps'];assert new['semantic']==negative['semantic']
# Direct target promotions are not transitive environment graph reachability.
c=vm.database(schema);vm.publish(c,1,'a','prod','target');vm.publish(c,2,'a','trial','target');vm.publish(c,3,'a','trial','target',2)
def promote(i,target,result):
 c.execute('INSERT INTO history_promotions VALUES (?,\'a\',?,1,\'synthetic\',1,\'synthetic\')',(i,target));c.execute('INSERT INTO history_promotion_results VALUES (?,0,?)',(i,result))
promote(1,'stage',2);promote(2,'prod',1) # locally present result also explicitly promoted
assert vm.measured(c,q,vm.parameters('scoped'))['ids']==[1]
promote(3,'prod',2);assert vm.measured(c,q,vm.parameters('scoped'))['ids']==[2,1]
assert vm.measured(c,q,vm.parameters('scoped',environment='stage'))['ids']==[2]
assert vm.measured(c,q,vm.parameters('scoped',version=2))['ids']==[]
report={'production_source_sha256':sha(source),'schema_source_sha256':sha(schema_source),'schema_names':names,'production_query_sha256':sha(q.encode()),'old_query_parent':parent,'old_query_sha256':sha(old.encode()),'repaired':new,'exact_parent_query_negative':negative,'controls':{'direct_not_transitive':True,'local_plus_promotion_deduplicated':True,'exact_promoted_version':True},'scope':'SQL VM count and semantics over invented rows, not History integrity or module execution'}
print(json.dumps(report,indent=2))
