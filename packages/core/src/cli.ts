#!/usr/bin/env node
/** Finite microdelta command dispatch; Node process mechanics stay behind the selected Machine capability. @packageDocumentation */
import { createNodeCommandProcess } from '@microdelta/machine-node';

import { openExecutionObservationReader } from './workspace.js';
import type { IExecutionObservationLocator, IExecutionObservationReadResult } from './workspace.js';

/** The selected host supplies only arguments, stream writes and natural exit status. */
type ICommandHost = ReturnType<typeof createNodeCommandProcess>;
/** Invalid invocations expose grammar, never raw arguments or application values. */
const usage = 'Usage: microdelta observe --location PATH --execution-id ID\n';

/** Accept only an exact observation locator; no application or execution input is available. */
function observeLocator(args: readonly string[]): IExecutionObservationLocator | undefined {
  if (args.length !== 5 || args[0] !== 'observe') { return undefined; }
  let location: string | undefined;
  let executionId: string | undefined;
  for (let index = 1; index < args.length; index += 2) {
    const option = args[index]; const value = args[index + 1];
    if (option === '--location' && location === undefined) { location = value; }
    else if (option === '--execution-id' && executionId === undefined) { executionId = value; }
    else { return undefined; }
  }
  if (location === undefined || location.length === 0 || location.length > 4096 || executionId === undefined || !/^[0-9a-f]{32}$/u.test(executionId)) { return undefined; }
  return { location, executionId };
}

/** One read releases its reader before output; read refusal differs from execution failure inside an observed record. */
function command(host: ICommandHost): void {
  const locator = observeLocator(host.arguments);
  if (locator === undefined) { host.writeStderr(usage); host.setExitCode(2); return; }
  try {
    const reader = openExecutionObservationReader(locator);
    let document: IExecutionObservationReadResult;
    try { document = reader.read(); } finally { reader.close(); }
    host.writeStdout(`${JSON.stringify(document)}\n`);
    host.setExitCode(document.result.kind === 'observed' ? 0 : 1);
  } catch {
    host.writeStderr('microdelta: observation command failed\n');
    host.setExitCode(1);
  }
}

// This leaf is the package's executable entry, never imported by its library entry.
command(createNodeCommandProcess());
