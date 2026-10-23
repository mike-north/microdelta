/** PKG-004/008 rule for keeping the executable consumer inside its own source tree. */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Inspect literal relative module paths after resolving their actual target. */
export const exampleSourceImports = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      forbidden: 'PKG-004: the example cannot import workspace source outside its own package.',
    },
  },
  create(context) {
    const exampleRoot = path.resolve(context.cwd, 'examples/contribution-report');

    /** Resolve path-like literals with the same URL rules used by ESM imports. */
    function localTarget(specifier) {
      if (specifier.startsWith('.')) {
        return fileURLToPath(new URL(specifier, pathToFileURL(context.filename)));
      }
      if (specifier.startsWith('file:')) {
        return fileURLToPath(new URL(specifier));
      }
      if (path.isAbsolute(specifier)) {
        return path.resolve(specifier);
      }
      return undefined;
    }

    /** Relative paths are permitted only while their normalized target stays within the example. */
    function check(node, specifier) {
      if (typeof specifier !== 'string') {
        return;
      }
      const target = localTarget(specifier);
      if (target === undefined) {
        return;
      }
      const relativeTarget = path.relative(exampleRoot, target);
      if (relativeTarget === '..'
        || relativeTarget.startsWith(`..${path.sep}`)
        || path.isAbsolute(relativeTarget)) {
        context.report({ node, messageId: 'forbidden' });
      }
    }

    return {
      ImportDeclaration(node) { check(node, node.source.value); },
      ExportNamedDeclaration(node) { if (node.source) { check(node, node.source.value); } },
      ExportAllDeclaration(node) { check(node, node.source.value); },
      ImportExpression(node) { check(node, node.source.value); },
      TSImportType(node) {
        // TypeScript wraps a quoted import() type argument in TSLiteralType.
        // Read its literal value so compile-time module edges share the same
        // normalized source-tree boundary as runtime imports.
        if (node.argument.type === 'TSLiteralType') {
          check(node, node.argument.literal.value);
        }
      },
      TSImportEqualsDeclaration(node) {
        if (node.moduleReference.type === 'TSExternalModuleReference') {
          check(node, node.moduleReference.expression.value);
        }
      },
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
          // A local binding can be any caller-supplied callable, not a module
          // edge. Unbound Node-style `require` calls remain subject to checks.
          let scope = context.sourceCode.getScope(node);
          while (scope !== null) {
            const binding = scope.set.get('require');
            if (binding !== undefined && binding.defs.length > 0) {
              return;
            }
            scope = scope.upper;
          }
          check(node, node.arguments[0]?.value);
        }
      },
    };
  },
};
