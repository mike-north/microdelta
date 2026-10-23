#!/usr/bin/env python3
"""Fail closed on load errors, inventory changes, or wrong semantic failures."""
import json,pathlib,sys
HERE=pathlib.Path(__file__).resolve().parent
expected=json.loads((HERE/'frozen/fault-expectations.json').read_text())
def judge(directory):
 directory=pathlib.Path(directory)
 for label,wanted in expected.items():
  data=json.loads((directory/(label+'.json')).read_text())
  assert data['numTotalTestSuites']==1 and len(data['testResults'])==1
  assert data.get('numRuntimeErrorTestSuites',0)==0
  suite=data['testResults'][0]; assert not suite.get('testExecError')
  assertions=suite['assertionResults']; assert assertions
  titles=[a['fullName'] for a in assertions]; assert len(titles)==len(set(titles))
  for key,value in wanted['counts'].items(): assert data[key]==value,(label,key,data[key],value)
  actual={a['fullName']:a for a in assertions if a['status']=='failed'}
  assert list(actual)==list(wanted['failures']),(label,list(actual))
  for title,fragment in wanted['failures'].items():
   assert any(fragment in message for message in actual[title]['failureMessages']),(title,fragment)
  assert not data['success']
 return {'labels':list(expected),'preciseFailures':[8,4],'runtimeErrorSuites':0}
if __name__=='__main__': print(json.dumps(judge(sys.argv[1]),indent=2))
