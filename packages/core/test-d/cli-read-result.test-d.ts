/** The internal finite handler accepts no module/control host capability and exports no new user decoder. */
import { expectError, expectType } from 'tsd';

import * as publicApi from '../dist/api/microdelta.public.js';
import { _runHistoryResultRead } from '../src/cli-read-result.js';

/** These are own-package test contracts, never sibling or external alpha imports. */
declare const host: Parameters<typeof _runHistoryResultRead>[0];
declare const ports: Parameters<typeof _runHistoryResultRead>[1];

expectType<void>(_runHistoryResultRead(host, ports));
expectType<readonly string[]>(host.arguments);
expectError(host.arguments = []);
expectError(host.loadModule);
expectError(host.onSignal);
expectError(host.keepAlive);
expectError(_runHistoryResultRead({ ...host, arguments: [0] }, ports));
expectError(_runHistoryResultRead(host, { ...ports, encode: () => undefined }));
expectError(publicApi.readHistoryResultDocument);
expectError(publicApi._runHistoryResultRead);
