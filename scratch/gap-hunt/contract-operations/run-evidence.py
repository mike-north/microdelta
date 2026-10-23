"""Replay the explicit bounded core suite set, preserving actual failures."""
import subprocess
from pathlib import Path
out=Path(__file__).parent
subprocess.run(['npx','tsc','-p','packages/core/tsconfig.test.json'],check=True)
roots=['acceptance','resolution','workspace','m4-acceptance','m5-acceptance','operations','outcome-fold','accounting','journal','stop']
paths=sorted(str(p) for r in roots for p in Path('packages/core/.test-build/test',r).glob('*.test.js'))
result=subprocess.run(['node','--experimental-vm-modules','node_modules/jest/bin/jest.js','--config','packages/core/jest.config.mjs','--runInBand','--json',f'--outputFile={out}/jest-results.json','--runTestsByPath',*paths],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
(out/'execution.log').write_text(result.stdout.replace(str(Path.cwd()),'<worktree>').replace('/Users/mnorth','<user-home>'))
subprocess.run(['python3',str(out/'build-coverage.py')],check=True)
raise SystemExit(result.returncode)
