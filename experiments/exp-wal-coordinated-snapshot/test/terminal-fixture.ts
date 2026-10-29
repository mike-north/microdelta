/** Inert process with a deliberately live handle proves terminal emission is not confused with actual process exit. */
import { terminalBoundary } from '../node/terminal.js';
const finish = terminalBoundary(Date.now(), 150, process.argv[2] === 'blocked' ? { write: () => undefined, exit: code => process.exit(code) } : undefined);
setInterval(() => undefined, 1000);
finish({ proposedVerdict: 'PASS', unresolved: { preparation: process.argv[2] === 'blocked' } }, 0);
