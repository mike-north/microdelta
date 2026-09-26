/** Step identity belongs to the step; execution policy belongs to its envelope. */
import { expectError, expectType } from 'tsd';
import { unified } from './api-options-surface.js';
import { memo } from './surface.js';
import type { StepEnvelope, IInputs, IMemoStep, IRef } from './surface.js';

/** The step owns its name, revision, behavior, and arbitrary additional domain state. */
class AuthorStep implements IMemoStep<{ id: string }, string> {
  readonly name = 'managed-label';
  readonly revision = 1;
  readonly cache = { directory: 'author-owned domain cache' };
  readonly validation = { schema: 'author-owned domain rule' };
  async identity(input: IInputs<{ id: string }>): Promise<string> { return await input.id; }
  async run(input: IInputs<{ id: string }>): Promise<string> {
    return `${this.name}: ${await input.id}`;
  }
}
const step = new AuthorStep();
expectType<IRef<string>>(unified.memo({ cache: { reuse: 'explicit' }, step })({ id: 'one' }));
expectType<IRef<string>>(memo({ step })({ id: 'one' }));

// Library options neither come from nor overwrite the author's similarly named fields.
expectError(unified.memo(step));
expectError(unified.memo({ step, cache: step.cache }));
expectError(unified.memo({ step, name: 'wrong-lane' }));
expectError(unified.memo({ step, revision: 7 }));
expectError(unified.memo({ step, run: step.run }));

// The envelope retains the exact step type, including its unrelated custom fields.
const envelope: StepEnvelope<AuthorStep> = { step };
expectType<AuthorStep>(envelope.step);
expectType<{ directory: string }>(envelope.step.cache);
