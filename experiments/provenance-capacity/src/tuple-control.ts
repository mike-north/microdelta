/** Fixed tiny children test resource/protocol stops without loading a workload. */
import { waitForParentRelease } from './tuple-lifecycle.js';

const mode = process.argv[2];
if (mode === 'normal') { setTimeout(() => { process.stdout.write('normal', () => { waitForParentRelease(); }); }, 100); }
else if (mode === 'uncoordinated-normal') { setTimeout(() => { process.stdout.write('normal'); process.disconnect(); }, 100); }
else if (mode === 'wait') { setInterval(() => undefined, 1000); }
else if (mode === 'early-close') { setTimeout(() => { process.exit(0); }, 25); }
else if (mode === 'malformed-ready' || mode === 'duplicate-ready' || mode === 'released-hang' || mode === 'released-output') {
  // Deliberately noncompliant controls isolate protocol refusal. Successful
  // production fixtures use only the direct synchronous release-exit handler.
  setInterval(() => undefined, 1000);
  process.on('message', () => { if (mode === 'released-output') { process.stdout.write('x'.repeat(70000)); } });
  process.send?.(mode === 'malformed-ready' ? { ready: true } : 'tuple-ready');
  if (mode === 'duplicate-ready') { process.send?.('tuple-ready'); }
} else { throw new Error('unknown diagnostic control'); }
