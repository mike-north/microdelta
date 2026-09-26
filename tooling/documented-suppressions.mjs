/**
 * Suppressions are narrow exceptions to shared TypeScript rules. A named rule
 * and a concrete explanation preserve why a line differs from the default;
 * file-wide disables hide future, unrelated violations.
 */
export function suppressionProblem(comment) {
  const content = comment.trim();
  const directive = content.match(/^eslint-disable(?<scope>-next-line|-line)?\b(?<rest>[\s\S]*)$/u);
  if (!directive) {
    return /^eslint(?:\s|$)/u.test(content) ? 'config' : null;
  }
  if (!directive.groups?.scope) {
    return 'scope';
  }
  const [rules, reason] = (directive.groups.rest ?? '').split(/\s+--\s+/u, 2);
  if (!rules?.trim() || !reason || reason.trim().length < 10) {
    return 'reason';
  }
  return null;
}

/** ESLint supplies precise comment locations for immediate editor feedback. */
export const documentedSuppressions = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      reason: 'An ESLint suppression needs a named rule and a specific reason after --.',
      config: 'Inline ESLint rule configuration can override checked rules; use a narrow explained line directive.',
      scope: 'File-wide ESLint disables hide unrelated future violations; use a line-scoped directive.',
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const problem = suppressionProblem(comment.value);
          if (problem) {
            context.report({ loc: comment.loc, messageId: problem });
          }
        }
      },
    };
  },
};
