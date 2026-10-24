#!/usr/bin/env python3
"""Read-only, fail-closed verification of the bounded compiler/runtime capture."""
import collections,json,pathlib,re,sys
EXPECTED=[('original154',0),('documented-root-compiler',0),('documented-root-tests',0),('documented-fixture-compiler',0),('documented-fixture-tests',0),('documented-sibling-compiler',0),('documented-sibling-runtime',0),('missing-definition',2),('missing-history',2),('missing-resolution',2),('missing-supervision',2),('missing-tracking',2),('public-consumer',2),('core-type-contracts',0),('fixture-lint',0)]
COUNTS={'original154':{'TS2305':114},'missing-definition':{'TS2305':39,'TS2536':3},'missing-history':{'TS2305':6},'missing-resolution':{'TS2305':42},'missing-supervision':{'TS2305':57},'missing-tracking':{'TS2305':8},'public-consumer':{'TS2305':1}}
def verify(directory):
 p=pathlib.Path(directory);commands=json.loads((p/'commands.json').read_text());assert [(c['label'],c['exit']) for c in commands]==EXPECTED
 for c in commands:assert c['exit']==c['expected']
 for name,wanted in COUNTS.items():
  text=(p/(name+'.log')).read_text();assert dict(collections.Counter(re.findall(r'error (TS\d+):',text)))==wanted,(name,wanted)
  assert 'TS5083' not in text and 'TS6053' not in text
 original=(p/'original154.log').read_text();assert '$ npm ci' in original and '$ npm run build:packages' in original and 'IAbortSignal' in original
 assert 'Facade-only alpha mapping fails; explicit six-owner import-only mapping passes.' in original
 for name in ['documented-root-tests','documented-fixture-tests']:
  text=(p/(name+'.log')).read_text()
  for key,value in [('tests',4),('pass',4),('fail',0),('cancelled',0),('skipped',0),('todo',0)]:assert re.search(rf'(?:#|ℹ) {key} {value}(?:\n|$)',text),(name,key)
 assert 'authoring' in (p/'public-consumer.log').read_text()
 d=json.loads((p/'boundary.json').read_text());assert d['archiveSource']=='f4211e3d925ed8aaedc313ac468d49a13149826c' and not d['siblingConfigContainsAbsolutePath']
 assert all('./alpha' not in v['exports'] for v in d['packageExports'].values())
 return {'commands':15,'uniqueOfficialCases':4,'officialInvocations':2,'missingOwnerNegatives':5,'publicFacadeNegative':1,'originalDiagnostics':114,'capturedRecipeExpectedExits':True,'documentationAcceptance':'separate literal-input finding; not established by this verifier'}
if __name__=='__main__':print(json.dumps(verify(sys.argv[1]),indent=2))
