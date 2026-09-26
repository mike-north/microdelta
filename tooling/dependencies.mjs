import path from 'node:path';

/** DR-1: unchanged adjacency list from components §6, including schema-only edges. */
export const dependencies = Object.freeze({
  name: [],
  fingerprint: [],
  identity: ['name'],
  track: [],
  middleware: [],
  store: [],
  trace: ['fingerprint'],
  repository: ['store'],
  claim: ['store', 'repository'],
  materialize: ['repository', 'fingerprint', 'track'],
  wrapper: ['name', 'identity', 'track', 'middleware', 'trace', 'claim', 'repository', 'materialize'],
  explain: ['repository', 'trace'],
});

/** Resolve physical paths, preventing nested relative paths from bypassing the graph. */
export const dependencyBoundaries = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { forbidden: 'DR-1: {{owner}} cannot import {{target}} (or this import must be type-only).' },
  },
  create(context) {
    const file = context.filename;
    const marker = `${path.sep}packages${path.sep}core${path.sep}src${path.sep}`;
    const start = file.lastIndexOf(marker);
    if (start < 0) { return {}; }
    const root = file.slice(0, start + marker.length);
    const owner = file.slice(root.length).split(path.sep)[0];
    // The public barrel assembles exports. All other source files must belong
    // to a configured component, or the shared types module with no dependencies.
    if (owner === 'index.ts') { return {}; }
    if (!(owner in dependencies) && owner !== 'types.ts') {
      return {
        Program(node) {
          context.report({ node, messageId: 'forbidden', data: { owner, target: 'an unlisted component' } });
        },
      };
    }
    const allowed = dependencies[owner] ?? [];

    function check(node, source, typeOnly = false) {
      if (typeof source !== 'string') {
        context.report({ node, messageId: 'forbidden', data: { owner, target: 'a computed module path' } });
        return;
      }
      let target;
      if (source === 'microdelta' || source.startsWith('microdelta/')) {
        target = 'the public barrel';
      } else if (source.startsWith('.')) {
        const relative = path.relative(root, path.resolve(path.dirname(file), source));
        target = relative.split(path.sep)[0];
        if (target === owner || (target === 'types.js' && typeOnly)) { return; }
        if (allowed.includes(target)) {
          if (!(owner === 'claim' && target === 'repository') || typeOnly) { return; }
        }
      } else {
        // Node built-ins and adopted third-party packages are outside the component graph.
        if (!path.isAbsolute(source) && !source.startsWith('#')) { return; }
        target = source;
      }
      context.report({ node, messageId: 'forbidden', data: { owner, target } });
    }

    return {
      ImportDeclaration(node) {
        check(node, node.source.value, node.importKind === 'type' ||
          (node.specifiers.length > 0 && node.specifiers.every(item => item.importKind === 'type')));
      },
      ExportNamedDeclaration(node) { if (node.source) { check(node, node.source.value, node.exportKind === 'type'); } },
      ExportAllDeclaration(node) { check(node, node.source.value, node.exportKind === 'type'); },
      ImportExpression(node) { check(node, node.source.value); },
      TSImportEqualsDeclaration(node) {
        if (node.moduleReference.type === 'TSExternalModuleReference') {
          check(node, node.moduleReference.expression.value, node.importKind === 'type');
        }
      },
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
          check(node, node.arguments[0]?.value);
        }
      },
    };
  },
};
