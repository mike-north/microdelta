/** Canonical Actions facts shared by integration-reader and publisher fixtures; no fixture reaches a service. */
export const integrationRepository = 'mike-north/microdelta';
/** Stable workflow identity distinguishes the intended file from a display-name impostor. */
export const checkWorkflowId = 100;
/** The native main-push run survives reruns; its attempt may advance independently of retained jobs. */
export const checkRunId = 200;

/** The repository endpoint anchors both run repository identities. */
export function repositoryFixture() { return { id: 50, full_name: integrationRepository }; }

/** Canonical workflow lookup is scoped to the configured API origin in local fixtures. */
export function workflowFixture(apiUrl = 'https://api.github.com', overrides = {}) {
  return { id: checkWorkflowId, name: 'Check', path: '.github/workflows/check.yml', state: 'active',
    url: `${apiUrl}/repos/${integrationRepository}/actions/workflows/${checkWorkflowId}`, ...overrides };
}

/** A main-push run binds a workflow number/attempt to one repository and exact commit. */
export function runFixture(sha, overrides = {}, apiUrl = 'https://api.github.com') {
  const id = overrides.id ?? checkRunId;
  return { id, run_number: 10, run_attempt: 1, workflow_id: checkWorkflowId, name: 'Check',
    path: '.github/workflows/check.yml', event: 'push', head_branch: 'main', head_sha: sha,
    repository: repositoryFixture(), head_repository: repositoryFixture(),
    url: `${apiUrl}/repos/${integrationRepository}/actions/runs/${id}`,
    html_url: `https://github.com/${integrationRepository}/actions/runs/${id}`,
    workflow_url: `${apiUrl}/repos/${integrationRepository}/actions/workflows/${checkWorkflowId}`,
    status: 'completed', conclusion: 'success', ...overrides };
}

/** The supported matrix member proves the actual required commands, with ordinal identities inside its job. */
export function jobsFixture(sha, apiUrl = 'https://api.github.com') {
  return [24].map((node, index) => ({
    id: 300 + index, run_id: checkRunId, run_attempt: 1, head_sha: sha, head_branch: 'main', workflow_name: 'Check',
    run_url: `${apiUrl}/repos/${integrationRepository}/actions/runs/${checkRunId}`,
    url: `${apiUrl}/repos/${integrationRepository}/actions/jobs/${300 + index}`,
    name: `core (${node})`, status: 'completed', conclusion: 'success',
    steps: ['npm ci', 'npm run check', 'npm test', 'npm run build'].map((command, step) => ({
      number: step + 1, name: `Run ${command}`, status: 'completed', conclusion: 'success',
    })),
  }));
}
