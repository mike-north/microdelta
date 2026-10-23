#!/usr/bin/env python3
"""Bounded PR200 qualification. Run from this worktree root; restores all plants."""
import hashlib, json, os, pathlib, re, shutil, subprocess, tempfile, time
ROOT=pathlib.Path.cwd(); HERE=ROOT/'scratch/gap-hunt/review-200'; OUT=pathlib.Path(tempfile.mkdtemp(prefix='microdelta-review200-'))
ENV=dict(os.environ); ENV.pop('MICRODELTA_CONTROL_REUSE_BUILD',None)
records=[]
def run(label,args,expected=0):
 start=time.monotonic(); p=subprocess.run(args,cwd=ROOT,env=ENV,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=900)
 (OUT/(label+'.log')).write_text(p.stdout)
 records.append(dict(label=label,argv=args,exit=p.returncode,seconds=round(time.monotonic()-start,3)))
 print(label,p.returncode,flush=True)
 if p.returncode!=expected: raise AssertionError(f'{label}: expected {expected}, got {p.returncode}; {OUT}')
 return p.stdout
def jest(label,package,suite,pattern=None,expected=0):
 args=['node','--experimental-vm-modules','node_modules/jest/bin/jest.js','--config',f'packages/{package}/jest.config.mjs','--runInBand','--json','--outputFile='+str(OUT/(label+'.json')),'--runTestsByPath',f'packages/{package}/.test-build/test/{suite}.js']
 if pattern: args+=['--testNamePattern',pattern]
 run(label,args,expected)
 data=json.loads((OUT/(label+'.json')).read_text())
 assert data.get('numRuntimeErrorTestSuites',0)==0
 assert data['numTotalTestSuites']==1 and len(data['testResults'])==1
 suite_data=data['testResults'][0]; assert not suite_data.get('testExecError')
 titles=[(a['fullName'],a['status']) for a in suite_data['assertionResults']]
 assert titles and len(titles)==len(set(t for t,s in titles))
 summary={k:data[k] for k in ['numTotalTests','numPassedTests','numFailedTests','numPendingTests']}
 summary['failedTitles']=[t for t,s in titles if s=='failed']; summary['titles']=titles
 (OUT/(label+'-summary.json')).write_text(json.dumps(summary,indent=2)+'\n')
 if expected==0: assert not summary['failedTitles'] and data['success']
 else: assert summary['failedTitles'] and not data['success']
 return summary
source=ROOT/'packages/resolution/src/resolution.ts'; original=source.read_bytes()
transient=ROOT/'packages/resolution/test/gap-hunt-review200.test.ts'
extra=ROOT/'packages/core/test/gap-hunt-contracts-resolution-144.test.ts'
control=ROOT/'packages/core/test/resolution/controls/review200-144-controls.mjs'
static=ROOT/'scratch/gap-hunt/contracts/arc008-surface.json'
try:
 assert subprocess.run(['git','diff','--quiet','HEAD','--','.']).returncode==0, 'tracked working tree must start clean'
 assert subprocess.run(['git','diff','--quiet','1c0adc28df18b167bd4f7a7254108baad7457ea7','--','.',':(exclude)scratch/gap-hunt/review-200']).returncode==0, 'entire production tree must match source pin'
 assert all(not p.exists() for p in [transient,extra,control,static]), 'transient paths must start absent'
 assert hashlib.sha256(original).hexdigest()==hashlib.sha256(subprocess.check_output(['git','show','1c0adc28df18b167bd4f7a7254108baad7457ea7:packages/resolution/src/resolution.ts'])).hexdigest()
 transient.write_bytes((HERE/'supplemental.test.ts').read_bytes())
 extra.write_bytes((HERE/'frozen/resolution-144.test.ts').read_bytes())
 c=(HERE/'frozen/resolution-144-controls.mjs').read_text()
 c=re.sub(r"const suites = Object.freeze\(\[.*?\]\);", "const suites = Object.freeze(['gap-hunt-contracts-resolution-144.test.js']);",c,count=1,flags=re.S)
 c=c.replace('const sourceOriginals =', 'controls.splice(0, controls.length - 5);\nconst sourceOriginals =',1)
 control.write_text(c)
 run('install',['npm','ci','--ignore-scripts'])
 sdk=pathlib.Path('/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk')
 if sdk.exists(): ENV['SDKROOT']=str(sdk)
 (OUT/'native-environment.json').write_text(json.dumps({'SDKROOT':ENV.get('SDKROOT'),'node':subprocess.check_output(['node','--version'],text=True).strip()},indent=2)+'\n')
 run('native-addon',['npm','rebuild','better-sqlite3'])
 ENV.pop('SDKROOT',None)
 run('build',['npm','run','build:packages'])
 run('owner-types',['node','node_modules/typescript/bin/tsc','-p','packages/resolution/tsconfig.test.json'])
 run('owner-check',['npm','run','check','--workspace','@microdelta/resolution'])
 run('owner-tsd',['npm','run','test:types','--workspace','@microdelta/resolution'])
 run('owner-public',['npm','run','test:public','--workspace','@microdelta/resolution'])
 a=jest('original','resolution','child-validation.test'); assert a['numPassedTests']==15
 b=jest('supplemental','resolution','gap-hunt-review200.test','supplemental exact parent boundary'); assert b['numPassedTests']==5 and b['numPendingTests']==15
 run('core-types',['node','node_modules/typescript/bin/tsc','-p','packages/core/tsconfig.test.json'])
 jest('fresh-process','core','nested/restart.test')
 jest('144-witnesses','core','gap-hunt-contracts-resolution-144.test')
 run('existing-anchors',['node','packages/core/test/resolution/controls/resolution-mutation-controls.mjs','--check-anchors'])
 run('144-controls',['node',str(control.relative_to(ROOT))])
 names=['IChildResolutionInvocation','IChildResolutionService','_createResolutionWithChildService']
 paths=[ROOT/'packages/resolution/src/index.ts',*sorted((ROOT/'packages/resolution/dist/api').glob('*.d.ts')),*sorted((ROOT/'packages/resolution').glob('etc/*.api.md'))]
 proof={str(p.relative_to(ROOT)):{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'seamNamesPresent':[n for n in names if n in p.read_text()]} for p in paths}
 assert all(not v['seamNamesPresent'] for v in proof.values())
 proof['exports']=json.loads((ROOT/'packages/resolution/package.json').read_text())['exports']; assert list(proof['exports'])==['.']
 (OUT/'api-boundary.json').write_text(json.dumps(proof,indent=2)+'\n')
 static.parent.mkdir(parents=True,exist_ok=True)
 text=run('original-diagnostic-current',['node',str((HERE/'frozen/arc008-surface.mjs').relative_to(ROOT))],1)
 assert 'Expected the actual lexical child-resolution routes' in text
 source.write_bytes((HERE/'frozen/prior-resolution.ts').read_bytes())
 run('original-diagnostic-prior',['node',str((HERE/'frozen/arc008-surface.mjs').relative_to(ROOT))])
 shutil.copyfile(static,OUT/'original-diagnostic-prior.json'); source.write_bytes(original)
 anchor='  childService: IChildResolutionService,\n): IResolution {\n'
 assert original.decode().count(anchor)==1
 source.write_text(original.decode().replace(anchor,anchor+'  childService = { resolve: (_invocation, normal) => normal() };\n'))
 run('fault-owner-build',['npm','run','build','--workspace','@microdelta/resolution'])
 run('fault-owner-types',['node','node_modules/typescript/bin/tsc','-p','packages/resolution/tsconfig.test.json'])
 jest('fault-original','resolution','child-validation.test',expected=1)
 jest('fault-supplemental','resolution','gap-hunt-review200.test','supplemental exact parent boundary',expected=1)
 run('semantic-guard',['python3',str((HERE/'judge-captures.py').relative_to(ROOT)),str(OUT)])
 source.write_bytes(original)
 run('restored-owner-build',['npm','run','build','--workspace','@microdelta/resolution'])
 run('restored-owner-types',['node','node_modules/typescript/bin/tsc','-p','packages/resolution/tsconfig.test.json'])
 assert jest('restored-original','resolution','child-validation.test')==a
 assert jest('restored-supplemental','resolution','gap-hunt-review200.test','supplemental exact parent boundary')==b
finally:
 source.write_bytes(original)
 for p in [transient,extra,control,static]: p.unlink(missing_ok=True)
 (OUT/'commands.json').write_text(json.dumps(records,indent=2)+'\n')
 print('RAW_RECEIPT',OUT,flush=True)
 assert source.read_bytes()==original
