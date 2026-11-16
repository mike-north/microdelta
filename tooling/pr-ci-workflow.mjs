/**
 * Interpret the deliberately narrow trigger forms used by this repository's
 * full and PR CI workflows. Unsupported forms fail rather than imply coverage.
 */
export function workflowRoute(workflow, event, branch) {
  const inline = /^on: \[([^\]]*)\]$/mu.exec(workflow);
  if (inline) return inline[1].split(',').map(item => item.trim()).includes(event);
  const triggers = /^on:\n([\s\S]*?)(?=^[^ \n]|$(?![\s\S]))/mu.exec(workflow)?.[1];
  if (!triggers) throw new Error('Unsupported workflow trigger form');
  const entries = [...triggers.matchAll(/^  ([a-z_]+):[^\n]*\n?([\s\S]*?)(?=^  [a-z_]+:|$(?![\s\S]))/gmu)];
  const selected = entries.find(match => match[1] === event);
  if (!selected) return false;
  const branches = /^    branches: \[([^\]]*)\]$/mu.exec(selected[2]);
  return !branches || branches[1].split(',').map(item => item.trim()).includes(branch);
}
