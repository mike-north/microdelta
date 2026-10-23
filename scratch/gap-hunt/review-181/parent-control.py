"""Rebuild exact parent source contracts; restore all tracked build inputs/reports in finally."""
from pathlib import Path
import subprocess,re,json,hashlib
root=Path.cwd();out=root/'scratch/gap-hunt/review-181/local-results';parent='f43c5872987573d9b98a19f41c324b4d9336894c'
paths=subprocess.check_output(['git','ls-files','-z']).decode().split('\0'); saved={p:(root/p).read_bytes() for p in paths if p and (root/p).is_file()}
def run(name,args,expected=0):
 with (out/(name+'.log')).open('w') as log:r=subprocess.run(args,stdout=log,stderr=subprocess.STDOUT,timeout=600)
 assert r.returncode==expected,(name,r.returncode)
try:
 for p in ['packages/definition/src/declaration.ts','packages/definition/src/template.ts','packages/definition/etc/definition.api.md']:(root/p).write_bytes(subprocess.check_output(['git','show',parent+':'+p]))
 run('parent-build-definition',['npm','run','build','--workspace','@microdelta/definition'])
 run('parent-build-core',['npm','run','build','--workspace','microdelta'])
 run('parent-original-compiler',['node','node_modules/typescript/bin/tsc','--noEmit','-p','scratch/gap-hunt/consumer-dx/tsconfig.async-source.json'],2)
 text=(out/'parent-original-compiler.log').read_text();assert len(re.findall(r'error TS2322:',text))==4;assert len(re.findall(r'error TS\d+:',text))==4
finally:
 for p,data in saved.items():
  if not (root/p).exists() or (root/p).read_bytes()!=data:(root/p).write_bytes(data)
run('restored-build-definition',['npm','run','build','--workspace','@microdelta/definition'])
run('restored-build-core',['npm','run','build','--workspace','microdelta'])
run('restored-original-compiler',['node','node_modules/typescript/bin/tsc','--noEmit','-p','scratch/gap-hunt/consumer-dx/tsconfig.async-source.json'])
assert all((root/p).read_bytes()==data for p,data in saved.items()),'tracked bytes drifted after restore build'
(out/'parent-control.json').write_text(json.dumps({'parent':parent,'parent_errors':4,'parent_diagnostic':'TS2322','restored_compiler_exit':0,'all_tracked_bytes_restored':True},indent=2)+'\n')
print('Exact parent four TS2322; restored current compiler green; all tracked bytes unchanged.')
