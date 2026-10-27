import { expectError, expectType } from 'tsd';

import { createNodeCommandProcess } from '../dist/src/index.js';
import type { ICommandProcessCapability } from '@microdelta/machine';

const command = createNodeCommandProcess();
expectType<ICommandProcessCapability>(command);
expectType<readonly string[]>(command.arguments);
expectType<void>(command.writeStdout('one complete command document'));
expectType<void>(command.writeStderr('command diagnostic'));
expectType<void>(command.setExitCode(1));
expectError(command.arguments.push('new argument'));
expectError(command.setExitCode('failed'));
expectError(command.exit());
