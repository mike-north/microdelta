"""Fail closed on exact Jest evidence counts; a suite-loading failure is never a semantic negative."""
import json,re,sys
from pathlib import Path
# failed tests, passed tests, total tests, failed suites, passed suites, total suites
EXPECTED={
 'original-default-bootstrap':(0,3,3,0,1,1),
 'definition-tests':(0,283,283,0,15,15),
 'restart':(0,19,19,0,1,1),
 'supplement':(0,7,7,0,1,1),
 'old-source-original':(1,2,3,1,0,1),
 'old-source-supplement':(7,0,7,1,0,1),
 'restored-original':(0,3,3,0,1,1),
 'restored-supplement':(0,7,7,0,1,1),
}
def summary(log,label):
 matches=re.findall(r'^'+re.escape(label)+r':\s+(?:(\d+) failed,\s+)?(?:(\d+) passed,\s+)?(\d+) total\s*$',log,re.M)
 if len(matches)!=1:raise AssertionError(f'{label}: expected exactly one complete summary')
 return tuple(int(value or '0') for value in matches[0])
def check(name,log):
 if name in EXPECTED:
  if re.search(r'Test suite failed to run|Cannot find module|Jest encountered an unexpected token',log):
   raise AssertionError(f'{name}: suite load/runtime setup error')
  observed=summary(log,'Tests')+summary(log,'Test Suites')
  if observed!=EXPECTED[name]:raise AssertionError(f'{name}: {observed} != {EXPECTED[name]}')
 if name=='anchors' and re.findall(r'^ANCHORS OK: 23 controls$',log,re.M)!=['ANCHORS OK: 23 controls']:
  raise AssertionError('anchor census mismatch')
def validate(directory):
 for name in [*EXPECTED,'anchors']:check(name,(directory/f'{name}.log').read_text())
 rejected=[]
 for name,log in [
  ('missing',''),
  ('load-error','Test suite failed to run\nCannot find module fixture\nTest Suites: 1 failed, 1 total\n'),
  ('forged-count-with-load-error','Test suite failed to run\nTests: 1 failed, 2 passed, 3 total\nTest Suites: 1 failed, 1 total\n'),
  ('wrong-count','Tests: 2 failed, 1 passed, 3 total\nTest Suites: 1 failed, 1 total\n'),
 ]:
  try:check('old-source-original',log)
  except AssertionError:rejected.append(name)
  else:raise AssertionError(f'unsafe synthetic accepted: {name}')
 return {'checkedCaptureLogs':9,'expectedJestSummaries':8,'syntheticRejected':rejected,'status':'PASS'}
if __name__=='__main__':print(json.dumps(validate(Path(sys.argv[1])),indent=2))
