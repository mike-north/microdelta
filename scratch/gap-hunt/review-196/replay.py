#!/usr/bin/env python3
"""Finite exact-head #173 verification, including eager scheduling negative and restoration."""
import hashlib, json, os, pathlib, platform, re, subprocess, sys, time, tempfile
HERE=pathlib.Path(__file__).resolve().parent
ROOT=HERE.parents[2]
OUT=pathlib.Path(tempfile.mkdtemp(prefix='microdelta-review-196-'))
print('Evidence output: '+str(OUT),flush=True)
from guards import validate, guard_only
if '--guards-only' in sys.argv:
    result=guard_only(HERE,OUT)
    print(json.dumps({'acceptedJestSteps':result['jestStepsAccepted'],'syntheticRejects':len(result['syntheticRejects'])}),flush=True)
    sys.exit(0)
HEAD='f7307e1542d6170505f31a3926bdc13917f603df'
def git(*args):
    return subprocess.check_output(['git','-c','core.fsmonitor=false',*args],cwd=ROOT,text=True).strip()
def digest(data): return hashlib.sha256(data).hexdigest()
def normalized(s):
    s=re.sub(r'/Users/[^/]+/\.nodenv/versions/[^/]+/bin/node','<node>',s)
    return s.replace(str(OUT),'<evidence-output>').replace(str(ROOT),'<checkout>').replace(str(pathlib.Path(sys.executable)),'<python>').replace(str(pathlib.Path(subprocess.check_output(['which','node'],text=True).strip())),'<node>')
receipt={'source':HEAD,'node':subprocess.check_output(['node','--version'],text=True).strip(),'npm':subprocess.check_output(['npm','--version'],text=True).strip(),'host':{'system':platform.system(),'release':platform.release(),'machine':platform.machine()},'commands':[]}
def run(name,args,expected=0, oracle=None):
    start=time.monotonic()
    env=dict(os.environ)
    env.pop('GAP_HUNT_REUSE_BUILD',None)
    # Only fixture replays reuse this invocation's already-built owned checkout.
    if name in {'current','frozen-original','precise-original','negative','negative-precise-original','restored'}:
        env['GAP_HUNT_REUSE_BUILD']='1'
    p=subprocess.run(args,cwd=ROOT,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=600,env=env)
    output=normalized(p.stdout)
    (OUT/(name+'.log')).write_text(output)
    row={'name':name,'argv':args,'exit':p.returncode,'seconds':round(time.monotonic()-start,3),'logSha256':digest(output.encode())}
    receipt['commands'].append(row)
    (OUT/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(name,p.returncode,flush=True)
    if p.returncode!=expected or (oracle is not None and not oracle(output)):
        raise RuntimeError(name+' unexpected result; see '+str(OUT/(name+'.log')))
    validate(name,output)
    return output
if git('diff',HEAD,'--','.',':(exclude)scratch/gap-hunt/review-196'):
    raise RuntimeError('Product and original fixture must match exact reviewed source')
source=ROOT/'packages/resolution/src/resolution.ts'
fixture=ROOT/'scratch/gap-hunt/scale/fanout-admission.ts'
tests=ROOT/'scratch/gap-hunt/scale/fanout-admission.test.mjs'
originals={p:p.read_bytes() for p in (source,fixture,tests)}
receipt['inputs']={str(p.relative_to(ROOT)):digest(b) for p,b in originals.items()}
build_ready=False
emitted_baseline={}
emitted=[ROOT/'packages/resolution/dist/src/resolution.js',ROOT/'scratch/gap-hunt/scale/dist/fanout-admission.js']
try:
    run('install',['npm','ci'])
    run('check',['npm','run','check'])
    build_ready=True
    current=run('current',['npm','run','test:fanout-dispatch'])
    matrix=[json.loads(line) for line in current.splitlines() if line.startswith('{"size"')]
    assert len(matrix)==6
    assert [row['pendingLaneWaits'] for row in matrix]==[1,1,8,8,0,8]
    for row in matrix:
        assert row['sourceBodies']==1 and row['topologyUnchanged'] and row['reportOrdered']
        assert row['reportMembers']==row['size'] and row['publishedMembers']==0 and row['pendingLaneWaitsAfterStop']==0
        assert row['admissionCalls']==min(row['size'],row['window'])
        assert row['bodies']==(row['window'] if row['phase']=='body' else 0)
        assert row['bodiesAfterStop']==row['bodies']
    receipt['matrix']=matrix
    emitted_baseline={str(p.relative_to(ROOT)):digest(p.read_bytes()) for p in emitted}
    run('supervision',['npm','run','test:unit','--workspace','@microdelta/supervision'])
    run('core-compile',['node','node_modules/typescript/bin/tsc','-p','packages/core/tsconfig.test.json'])
    core=['node','--experimental-vm-modules','node_modules/jest/bin/jest.js','--config','packages/core/jest.config.mjs','--runInBand','--runTestsByPath']
    paths=['stop/stop','stop/drain','stop/lifecycle','stop/resolution-port','keyed/members','keyed/restart','resolution/keyed-refusal','workspace-operations/operations','workspace-operations/async-supplied','m5-acceptance/stop']
    run('facade',core+['packages/core/.test-build/test/'+p+'.test.js' for p in paths])
    # Preserve the original #173 semantic oracle and probe byte-for-byte.
    fixture.write_bytes((HERE/'frozen/fanout-admission.ts').read_bytes())
    tests.write_bytes((HERE/'frozen/fanout-admission.test.mjs').read_bytes())
    run('frozen-original',['npm','run','test:fanout-dispatch'],1,lambda s:'1 failed, 1 passed, 2 total' in s and 'Expected: 16' in s and 'Received: 8' in s)
    precise=(HERE/'frozen/fanout-admission.ts').read_text().replace("import { createHook } from 'node:async_hooks';", "import { createHook } from 'node:async_hooks';\nimport { readFileSync } from 'node:fs';")
    marker="const hook = createHook({ init(id, type) {"
    site="const lines = readFileSync('packages/supervision/dist/src/permits.js', 'utf8').split('\\n');\nconst queueLine = lines.findIndex(line => line.includes('return new Promise(')) + 1;\nif (queueLine === 0) throw new Error('Lane wait allocation site moved');\nconst queueSite = `/supervision/dist/src/permits.js:${String(queueLine)}:`;\n"
    precise=precise.replace(marker,site+marker).replace("stack.includes('at new Promise') && stack.includes('/supervision/dist/src/permits.js')","stack.includes('at new Promise') && stack.includes(queueSite)")
    fixture.write_text(precise)
    run('precise-original',['npm','run','test:fanout-dispatch'])
    fixture.write_bytes(originals[fixture]); tests.write_bytes(originals[tests])
    # The deliberate negative restores the original eager enqueue expression;
    # no observer, permit mechanism, body, roster or assertion is weakened.
    text=originals[source].decode()
    start=text.index('    const started = await supervision.dispatchMembers(keys.length,')
    end=text.index('    if (runFailure.first !== undefined) {\n      throw runFailure.first.error;',start)
    eager='    await Promise.all(keys.map((key, position) => supervision.member(() => member(key, position))));\n'
    source.write_text(text[:start]+eager+text[end:])
    run('negative-build',['npm','run','build','--workspace','@microdelta/resolution'])
    negative=run('negative',['npm','run','test:fanout-dispatch'],1,lambda s:'Tests:       2 failed, 2 total' in s)
    negative_matrix=[json.loads(line) for line in negative.splitlines() if line.startswith('{"size"')]
    assert [row['pendingLaneWaits'] for row in negative_matrix]==[99,999,92,992,0,92]
    receipt['negativeMatrix']=negative_matrix
    fixture.write_text(precise)
    tests.write_bytes((HERE/'frozen/fanout-admission.test.mjs').read_bytes())
    run('negative-precise-original',['npm','run','test:fanout-dispatch'],1,lambda s:'1 failed, 1 passed, 2 total' in s and 'Received:    900' in s)
finally:
    primary_error=sys.exc_info()[1]
    for p,b in originals.items(): p.write_bytes(b)
    receipt['restored']={str(p.relative_to(ROOT)):p.read_bytes()==b for p,b in originals.items()}
    try:
        if build_ready:
            run('restoration-build',['npm','run','build','--workspace','@microdelta/resolution'])
            run('restoration-fixture',['node','node_modules/typescript/bin/tsc','-p','scratch/gap-hunt/scale/tsconfig.fanout-admission.json'])
            restored_emitted={str(p.relative_to(ROOT)):digest(p.read_bytes()) for p in emitted}
            if emitted_baseline and restored_emitted!=emitted_baseline:
                raise RuntimeError('Emitted runtime or probe did not restore byte-for-byte')
            receipt['emittedRestoration']={'rebuilt':True,'baselineSha256':emitted_baseline,'restoredSha256':restored_emitted,'equal':restored_emitted==emitted_baseline}
    except BaseException as restoration_error:
        receipt['emittedRestoration']={'rebuilt':False,'error':normalized(str(restoration_error))}
        if primary_error is None:
            raise
        print('Restoration also failed; preserving original failure: '+normalized(str(restoration_error)),flush=True)
    finally:
        (OUT/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
run('restored',['npm','run','test:fanout-dispatch'])
# Live-head delta is an import-only ordering change; validate its exact file.
delta=ROOT/'packages/resolution/test-d/resolution.test-d.ts'
delta_before=delta.read_bytes()
try:
    delta.write_bytes(subprocess.check_output(['git','-c','core.fsmonitor=false','show','4408ab236562e1f4fd4d7f15d353d04fe7a86eb7:packages/resolution/test-d/resolution.test-d.ts'],cwd=ROOT))
    run('live-delta-check',['npm','run','check','--workspace','@microdelta/resolution'])
    run('live-delta-types',['npm','run','test:types','--workspace','@microdelta/resolution'])
finally:
    delta.write_bytes(delta_before)
receipt['liveDelta']={'head':'4408ab236562e1f4fd4d7f15d353d04fe7a86eb7','onlyChange':'resolution test-d import ordering','restored':delta.read_bytes()==delta_before}
receipt['complete']=True
(OUT/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
print('complete',flush=True)
