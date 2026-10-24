#!/usr/bin/env python3
"""Classify only the exact finite evidence; a Jest count alone is not proof."""
import copy,json,pathlib,sys
EXPECTED={'length':[(3,1),(3,0),(4,1),(4,0)],'position':[(20,1),(20,0),(20,0),(10,1),(10,0)],'value':[('undefined',1),('undefined',0),(7,1),(7,0)],'own':[],'closure':[(6,1),(6,0),(9,1),(9,0)]}
def verify(cases,result):
 assert result['numTotalTests']==5 and result['numPassedTests']==4 and result['numFailedTests']==1
 failed=[t for suite in result['testResults'] for t in suite['assertionResults'] if t['status']=='failed']
 assert len(failed)==1 and 'own presence distinguishes missing and own undefined' in failed[0]['fullName']
 assert len(cases['cases'])==5 and cases['freshProcesses']==18 and cases['successfulStages']==17 and len(cases['processes'])==18
 assert {c['mode'] for c in cases['cases']}==set(EXPECTED)
 for case in cases['cases']:
  reports=case['reports'];expected=EXPECTED[case['mode']]
  assert len(reports)==len(expected)
  for i,(report,(value,bodies)) in enumerate(zip(reports,expected)):
   assert type(report['selected']) is type(value) and report['selected']==value and report['bodies']==bodies
   assert report['kind']==('published' if bodies else 'reused')
   assert report['stderr'].splitlines().count('BODY:reader')==bodies
   if i:
    previous=reports[i-1]
    assert (report['reference']==previous['reference']) == (bodies==0)
    assert report['factory']==previous['factory'] and report['callable']==previous['callable']
 failures=[p for p in cases['processes'] if p['status']!=0]
 assert len(failures)==1 and failures[0]['mode']=='own' and failures[0]['variant']=='base' and failures[0]['bodies']==1
 assert 'Native reflection is unsupported; use observer.hasOwn for supported fields' in failures[0]['stderr']
 assert all(p['status']==0 for p in cases['processes'] if p['mode']!='own')
 return {'classification':'four-finite-families-pass-and-own-presence-negative-proved','jest_exit_expected':1,'wrapper_exit':0,'fresh_processes':18,'successful_stages':17,'failed_processes':1}
def selftest(cases,result):
 rejected=[]
 for name in ['missing-process','wrong-body','wrong-reference','wrong-error','wrong-test-count']:
  c=copy.deepcopy(cases);r=copy.deepcopy(result)
  if name=='missing-process':c['processes'].pop()
  elif name=='wrong-body':c['cases'][0]['reports'][1]['bodies']=1
  elif name=='wrong-reference':c['cases'][0]['reports'][1]['reference']='forged-new-ref'
  elif name=='wrong-error':next(p for p in c['processes'] if p['status']!=0)['stderr']='Different failure'
  else:r['numPassedTests']=5
  try:verify(c,r)
  except (AssertionError,KeyError):rejected.append(name)
  else:raise AssertionError('Accepted corrupt evidence '+name)
 return {'rejected':rejected,'positive':verify(cases,result)}
if __name__=='__main__':
 out=pathlib.Path(sys.argv[1]);cases=json.loads((out/'cases.json').read_text());result=json.loads((out/'jest-results.json').read_text())
 print(json.dumps(selftest(cases,result) if '--self-test' in sys.argv else verify(cases,result),indent=2))
