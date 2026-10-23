from pathlib import Path
import subprocess
r=Path('packages/core/test/resolution/controls')
original=(r/'resolution-mutation-controls.mjs').read_text()
s=original.replace("  'gap-hunt-contracts-resolution-144.test.js',\n",'').replace('/** Emitted artifacts are hashed as whole files',"controls.splice(0, controls.length - 5);\n\n/** Emitted artifacts are hashed as whole files")
p=r/'.review197-original-three.mjs'
assert not p.exists()
p.write_text(s)
try:
 result=subprocess.run(['node',str(p)])
 assert result.returncode==1
finally:p.unlink()
