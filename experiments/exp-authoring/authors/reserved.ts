/** Legal authored names and aliases retain their literal meaning even when they match prototype properties. */
import { analysis, memo } from '../src/protocol.js';
/** Application slots, graph occurrences and aliases deliberately exercise own-key bookkeeping. */
export interface IReservedInputs { readonly ['__proto__']: { readonly title: string } }
/** Two numeric nodes remain the full proof; only their explicit spellings differ. */
export const reserved = analysis<IReservedInputs>((input) => {
  const child = memo({ name: '__proto__', from: { ['__proto__']: input('__proto__') }, run: (values) => values['__proto__'].title.length });
  return memo({ name: 'constructor', from: { ['__proto__']: child }, run: (values) => values['__proto__'] + 1 });
});
