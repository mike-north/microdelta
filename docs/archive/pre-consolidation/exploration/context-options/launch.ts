/** Same launch flow for either candidate; change only the create function import. @internal */
import { createContributionAnalysis } from './scoped.js';
import { configure, renderHistogram, saveReport, showPlan } from './domain.js';
import type { Input } from './domain.js';

/** Plan, execute, and observe one explicitly chosen environment. @internal */
export async function launch(environment: string, input: Input): Promise<void> {
  const configuration = configure(environment);
  const { definition, histogram } = createContributionAnalysis(configuration);

  // This proposed plan is structural. Unknown member counts stay unknown.
  showPlan(definition.plan(input).text);
  const execution = definition.run(input);
  const unsubscribe = execution.observe(histogram, renderHistogram, { throttleMs: 500 });
  try {
    // Verified consumption is distinct from the preview envelopes above.
    await saveReport(await execution.result, environment);
  } finally {
    unsubscribe();
  }
  // CLI controls can call execution.cancel(); soft/second-interrupt policy is still open.
}
