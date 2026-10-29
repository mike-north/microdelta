/** Actual inert child close/code proves the shared launcher terminal path; no qualification entrypoint is invoked. */
import { expect, test } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('final emission explicitly exits despite a live asynchronous handle', () => { const result = spawnSync(process.execPath, [fileURLToPath(new URL('./terminal-fixture.js', import.meta.url))], { encoding: 'utf8', timeout: 700 }); expect(result.error).toBeUndefined(); expect(result.status).toBe(0); expect(result.signal).toBeNull(); expect(result.stdout).toContain('preparation'); });
test('a blocked final emission is forced non-success inside the absolute outer envelope', () => { const started = Date.now(); const result = spawnSync(process.execPath, [fileURLToPath(new URL('./terminal-fixture.js', import.meta.url)), 'blocked'], { encoding: 'utf8', timeout: 700 }); expect(result.error).toBeUndefined(); expect(result.status).toBe(124); expect(Date.now() - started).toBeLessThan(600); });
