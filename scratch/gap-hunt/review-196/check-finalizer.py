import ast,copy,hashlib,json,pathlib,sys,tempfile
p=pathlib.Path(__file__).resolve().with_name('replay.py')
tree=ast.parse(p.read_text());owner=next(n for n in tree.body if isinstance(n,ast.Try))
fn=ast.FunctionDef(name='exercise',args=ast.arguments(posonlyargs=[],args=[],kwonlyargs=[],kw_defaults=[],defaults=[]),decorator_list=[],body=[ast.Try(body=[ast.If(test=ast.Name(id='primary',ctx=ast.Load()),body=[ast.Raise(exc=ast.Name(id='primary',ctx=ast.Load()))],orelse=[ast.Pass()])],handlers=[],orelse=[],finalbody=copy.deepcopy(owner.finalbody))])
module=ast.fix_missing_locations(ast.Module(body=[fn],type_ignores=[]));code=compile(module,'<exact-finalizer-ast>','exec')
class Primary(Exception): pass
class Restoration(Exception): pass
rows=[]
for prior in [False,True]:
 for failrestore in [False,True]:
  base=pathlib.Path(tempfile.mkdtemp(prefix='microdelta-finalizer-guard-'));out=base/'out';out.mkdir()
  originals={base/name:b'original' for name in ['source','fixture','tests']}
  for path in originals: path.write_bytes(b'planted')
  emitted=[base/'runtime.js',base/'probe.js']
  def digest(data): return hashlib.sha256(data).hexdigest()
  baseline={str(path.relative_to(base)):digest(b'original-emitted') for path in emitted}
  for path in emitted:path.write_bytes(b'planted-emitted')
  calls=[]
  def run(name,args):
   calls.append(name)
   if failrestore and name=='restoration-build':raise Restoration('synthetic restoration failure')
   target=emitted[0] if name=='restoration-build' else emitted[1];target.write_bytes(b'original-emitted')
  primary=Primary('synthetic primary failure') if prior else None
  receipt={};context=dict(primary=primary,originals=originals,ROOT=base,OUT=out,sys=sys,json=json,receipt=receipt,build_ready=True,run=run,emitted=emitted,emitted_baseline=baseline,digest=digest,normalized=lambda s:s)
  exec(code,context)
  observed=None
  try:context['exercise']()
  except Exception as error:observed=error
  assert all(path.read_bytes()==data for path,data in originals.items())
  assert calls==(['restoration-build'] if failrestore else ['restoration-build','restoration-fixture'])
  if prior:assert observed is primary
  elif failrestore:assert isinstance(observed,Restoration)
  else:assert observed is None
  assert receipt['emittedRestoration']['rebuilt']==(not failrestore)
  if not failrestore:assert receipt['emittedRestoration']['equal']
  rows.append({'primaryFailure':prior,'restorationFailure':failrestore,'sourceRestored':True,'calls':calls,'observed':type(observed).__name__ if observed else None,'primaryIdentityPreserved':observed is primary if prior else None,'emittedRestored':not failrestore})
result={'scope':'exact finalizer AST with synthetic Python filesystem/build doubles; no product runtime','runnerSha256':hashlib.sha256(p.read_bytes()).hexdigest(),'cases':rows}
outpath=pathlib.Path(tempfile.mkdtemp(prefix='microdelta-finalizer-results-'))/'finalizer-validation.json'
outpath.write_text(json.dumps(result,indent=2)+'\n');print('four exact-finalizer AST cases passed; receipt: '+str(outpath))
