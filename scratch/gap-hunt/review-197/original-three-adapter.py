from pathlib import Path
import subprocess,re
r=Path('packages/core/test/resolution/controls')
original=(r/'resolution-mutation-controls.mjs').read_text()
s=original.replace("  'gap-hunt-contracts-resolution-144.test.js',\n",'').replace('/** Emitted artifacts are hashed as whole files',"controls.splice(0, controls.length - 5);\n\n/** Emitted artifacts are hashed as whole files")
p=r/'.review197-original-three.mjs'
assert not p.exists()
p.write_text(s)
try:
 result=subprocess.run(['node',str(p)],text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 print(result.stdout,end='')
 assert result.returncode==1
 assert 'baseline: 73 tests, 0 failing' in result.stdout and 'restored: 73 tests, 0 failing' in result.stdout and 'FAIL: 5 controls' in result.stdout
 plants=re.findall(r'^## (.*): (\d+) failing$',result.stdout,re.M)
 assert len(plants)==5 and all(count=='0' for _,count in plants)
 assert 'CONTROL RUN INVALID' not in result.stdout and 'ANCHOR ' not in result.stdout
finally:p.unlink()
