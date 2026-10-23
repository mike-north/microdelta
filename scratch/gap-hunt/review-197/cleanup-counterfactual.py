#!/usr/bin/env python3
"""After canonical.py, isolate the immediate-pre-fix cleanup-handler negative."""
from pathlib import Path
import os,subprocess,tempfile
root=Path(__file__).resolve().parents[3];os.chdir(root)
p=Path('packages/core/test/resolution/controls/resolution-mutation-controls.mjs')
saved=p.read_bytes()
old=subprocess.check_output(['git','show','c2fc173a961f361b9a744c705609664477be1722:'+str(p)])
command=['node','--test','packages/core/test/resolution/controls/resolution-mutation-controls.test.mjs']
try:
 p.write_bytes(old)
 result=subprocess.run(command,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 print(result.stdout,end='')
 assert result.returncode==1 and 'the interrupted runner must remove its isolated checkout' in result.stdout and 'ERR_ASSERTION' in result.stdout
finally:p.write_bytes(saved)
subprocess.run(command,check=True)
assert p.read_bytes()==saved
