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

    /** Relative paths are permitted only while their normalized target stays within the example. */
    function check(node, specifier) {
      if (typeof specifier !== 'string' || !specifier.startsWith('.')) {
        return;
      }
      // ESM resolves path-like specifiers as URLs, so URL normalization (for
      // example encoded dot segments) must precede the package-boundary test.
      const target = fileURLToPath(new URL(specifier, pathToFileURL(context.filename)));
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
          // A parameter named `require` is an ordinary caller-supplied
          // function. Only an unbound Node-style require name denotes a
          // module edge for this literal-path check.
          let scope = context.sourceCode.getScope(node);
          while (scope !== null) {
            const binding = scope.set.get('require');
            if (binding?.defs.some((definition) => definition.type === 'Parameter')) {
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
