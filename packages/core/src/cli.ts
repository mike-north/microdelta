#!/usr/bin/env node
/** Installed command dispatch separates finite observation/exact-result reads from caller-owned foreground execution. @packageDocumentation */
import { createNodeCommandProcess } from '@microdelta/machine-node';
import { encodeSnapshot } from '@microdelta/value';

import { _runHistoryResultRead } from './cli-read-result.js';
import { readHistorySelection } from './history-selection.js';

import { openExecutionObservationReader, createStopController } from './workspace.js';
import type { IExecutionObservationLocator, IExecutionObservationReadResult, IObservedRun, IObservationAcknowledgment } from './workspace.js';
import { isCliWorkload, isCliWorkloadPreparation } from './cli-workload.js';
import type { ICliWorkloadPreparation } from './cli-workload.js';

/** The selected host supplies process mechanics; command grammar and lifecycle remain here. */
type ICommandHost = ReturnType<typeof createNodeCommandProcess>;
/** Invalid invocations expose only a fixed grammar, never caller values. */
const observeUsage = 'Usage: microdelta observe --location PATH --execution-id ID\n';
const startUsage = 'Usage: microdelta start --module PATH --observation PATH [-- OPAQUE_ARGUMENT ...]\n';

/** Accept only the established exact-locator grammar; no author module is available to this reader. */
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

/** Parse tool-owned flags before import; only tokens after the final separator reach caller code. */
function startArguments(args: readonly string[]): { readonly module: string; readonly observation: string; readonly application: readonly string[] } | undefined {
  if (args[0] !== 'start') { return undefined; }
  let module: string | undefined;
  let observation: string | undefined;
  const applicationAt = args.indexOf('--', 1);
  const toolEnd = applicationAt < 0 ? args.length : applicationAt;
  for (let index = 1; index < toolEnd;) {
    const option = args[index]; const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) { return undefined; }
    if (option === '--module' && module === undefined) { module = value; }
    else if (option === '--observation' && observation === undefined) { observation = value; }
    else { return undefined; }
    index += 2;
  }
  if (module === undefined || module.length === 0 || module.length > 4096 || !/\.(?:js|mjs|cjs)$/u.test(module) || observation === undefined || observation.length === 0 || observation.length > 4096) { return undefined; }
  const application = applicationAt < 0 ? [] : args.slice(applicationAt + 1);
  if (application.length > 256 || application.some((argument) => argument.length > 4096)) { return undefined; }
  return { module, observation, application: Object.freeze(application) };
}

/** Emit one finite locator receipt; the caller retains lifecycle duties if the pipe has failed. */
function writeLocator(host: ICommandHost, locator: IExecutionObservationLocator): boolean {
  try { host.writeStdout(`${JSON.stringify({ version: 1, type: 'locator', locator })}\n`); return true; }
  catch { return false; }
}

/** Independent failure categories remain visible even when a handled signal selects the exit status. */
type IStartFailure = 'module' | 'preparation' | 'runtime' | 'observation' | 'cleanup' | 'transport';
/** Promise rejection is a command fact, distinct from the runtime's fulfilled observation receipts. */
type ICommandAcknowledgment = IObservationAcknowledgment | { readonly kind: 'rejected' };

/** Reduce runtime acknowledgment to its bounded protocol fields, excluding arbitrary diagnostics. */
function boundedAcknowledgment(acknowledgment: ICommandAcknowledgment): unknown {
  return {
    kind: acknowledgment.kind,
    ...(acknowledgment.kind === 'acknowledged' ? { revision: acknowledgment.revision } : {}),
    ...('observationFaults' in acknowledgment ? { observationFaults: acknowledgment.observationFaults } : {}),
  };
}

/** A failed write is contained; lifecycle ownership survives a lost stdout pipe. */
function writeTerminal(host: ICommandHost, receipt: Record<string, unknown>): boolean {
  try { host.writeStdout(`${JSON.stringify({ version: 1, type: 'terminal', ...receipt })}\n`); return true; }
  catch { return false; }
}

/** Attach both rejection handlers immediately and wait for both independent closure facts. */
async function settleRun<T>(observed: IObservedRun<T>): Promise<{ readonly runtime: 'returned' | 'failed'; readonly acknowledgment: ICommandAcknowledgment }> {
  const [result, acknowledgment] = await Promise.allSettled([observed.result, observed.acknowledgment]);
  return {
    runtime: result.status === 'fulfilled' ? 'returned' : 'failed',
    acknowledgment: acknowledgment.status === 'fulfilled' ? acknowledgment.value : { kind: 'rejected' },
  };
}

/** Own one handed-over preparation until actual runtime and observation closure, then dispose once. */
async function start(host: ICommandHost): Promise<void> {
  const parsed = startArguments(host.arguments);
  if (parsed === undefined) { host.writeStderr(startUsage); host.setExitCode(2); return; }

  const controller = createStopController();
  let interruptCount = 0;
  let termination: 'SIGINT' | 'SIGTERM' | undefined;
  const unsubscribeInt = host.onSignal('SIGINT', () => {
    termination ??= 'SIGINT';
    interruptCount += 1;
    controller.request({ level: interruptCount === 1 ? 'soft' : 'hard' });
  });
  const unsubscribeTerm = host.onSignal('SIGTERM', () => {
    termination = 'SIGTERM';
    controller.request({ level: 'hard' });
  });
  const releaseKeepAlive = host.keepAlive();
  let preparation: ICliWorkloadPreparation<object, object, unknown> | undefined;
  let locator: IExecutionObservationLocator | undefined;
  let runtime: 'returned' | 'failed' | 'not-started' = 'not-started';
  let acknowledgment: ICommandAcknowledgment | undefined;
  let cleanup: 'not-handed-over' | 'disposed' | 'failed' = 'not-handed-over';
  const failures = new Set<IStartFailure>();
  let locatorWritten = true;

  try {
    try {
      const modulePath = host.resolvePath(parsed.module);
      const observationLocation = host.resolvePath(parsed.observation);
      // Absolute identities stay bounded before allocation; locators are never rewritten afterward.
      if (modulePath.length > 4096 || observationLocation.length > 4096) { failures.add('module'); }
      else {
        const imported = await host.loadModule(modulePath);
        if (typeof imported !== 'object' || imported === null || !('default' in imported) || !isCliWorkload(imported.default)) {
          failures.add('module');
        } else {
          try {
            const prepared = await imported.default.prepare(parsed.application);
            if (!isCliWorkloadPreparation(prepared)) { failures.add('module'); }
            else { preparation = prepared; }
          } catch { failures.add('preparation'); }
          if (preparation !== undefined && termination === undefined) {
            try {
              const observed = preparation.workspace.startObserved({ ...preparation.options, stop: controller, observationLocation }, preparation.body);
              locator = observed.locator;
              locatorWritten = writeLocator(host, locator);
              const settled = await settleRun(observed);
              runtime = settled.runtime;
              acknowledgment = settled.acknowledgment;
              if (runtime === 'failed') { failures.add('runtime'); }
              if (acknowledgment.kind !== 'acknowledged') { failures.add('observation'); }
              if (!locatorWritten) { failures.add('transport'); }
            } catch { failures.add('runtime'); }
          }
        }
      }
    } catch { failures.add('module'); }
    finally {
      if (preparation !== undefined) {
        try { await preparation.dispose(); cleanup = 'disposed'; }
        catch { cleanup = 'failed'; failures.add('cleanup'); }
      }
    }

    let exitCode = termination === 'SIGINT' ? 130 : termination === 'SIGTERM' ? 143
      : failures.has('module') ? 2 : failures.size > 0 || runtime !== 'returned' || acknowledgment?.kind !== 'acknowledged' ? 1 : 0;
    const written = writeTerminal(host, {
      ...(locator === undefined ? {} : { locator }),
      runtime,
      failures: [...failures],
      stop: controller.state.level,
      ...(acknowledgment === undefined ? {} : { acknowledgment: boundedAcknowledgment(acknowledgment) }),
      cleanup,
      transport: locatorWritten ? 'available' : 'failed',
    });
    if (!written && termination === undefined) { exitCode = 1; }
    host.setExitCode(exitCode);
  } finally {
    unsubscribeInt(); unsubscribeTerm(); releaseKeepAlive();
  }
}

/** One read releases its reader before output; read refusal differs from execution failure inside an observed record. */
function observe(host: ICommandHost): void {
  const locator = observeLocator(host.arguments);
  if (locator === undefined) { host.writeStderr(observeUsage); host.setExitCode(2); return; }
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

/** Dispatch only explicit verbs; the executable module is never the library entry. */
const host = createNodeCommandProcess();
if (host.arguments[0] === 'start') { void start(host).catch(() => { host.setExitCode(1); }); }
else if (host.arguments[0] === 'read-result') { _runHistoryResultRead(host, { read: readHistorySelection, encode: encodeSnapshot }); }
else { observe(host); }
