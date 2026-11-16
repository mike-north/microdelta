/** Final verification and structured verdict share one sticky deadline boundary. */
import type { ExecutionScope, IExpirationState } from './deadline.js';
import { classify } from '../src/evidence.js';
import type { ICell } from '../src/evidence.js';
/** Pins returning late are not sufficient evidence of a successful invocation. @internal */
export async function completeVerification(scope: ExecutionScope, verify: () => Promise<unknown>, failures: unknown[]): Promise<boolean> { try { await scope.stage('completion pin verification', verify); scope.assert(); return true; } catch (error: unknown) { failures.push(error); return false; } }
/** Established counterexamples survive harness errors; expiry can never yield PASS. @internal */
export function terminalVerdict(cells: readonly ICell[], state: IExpirationState, failures: readonly unknown[]): 'PASS' | 'REJECT' | 'INCONCLUSIVE' { const result = classify(cells); return result === 'PASS' && (state.expired || failures.length) ? 'INCONCLUSIVE' : result; }
