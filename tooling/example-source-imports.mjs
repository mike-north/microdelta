/**
 * PKG-004/008 rule for keeping the executable consumer inside its own source tree.
 * ESM specifiers use Node's URL-based filesystem resolution; CommonJS edges keep
 * filesystem path semantics so encoded text is never treated as a URL escape.
 */
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

    /** Resolve ESM filesystem literals using canonical URL parsing and decoding. */
    function esmTarget(specifier) {
      if (specifier.startsWith('.') || specifier.startsWith('/') || /^file:/iu.test(specifier)) {
        try {
          const importerUrl = pathToFileURL(context.filename);
          const targetUrl = /^file:/iu.test(specifier) ? new URL(specifier) : new URL(specifier, importerUrl);
          if (targetUrl.protocol === 'file:') {
            return fileURLToPath(targetUrl);
          }
        } catch {
          // Invalid or unsupported file URLs are not resolved filesystem edges.
        }
      }
      return undefined;
    }

    /** Resolve CommonJS literals as filesystem paths, where percent escapes are ordinary characters. */
    function requireTarget(specifier) {
      if (specifier.startsWith('.') || path.isAbsolute(specifier)) {
        return path.resolve(path.dirname(context.filename), specifier);
      }
      return undefined;
    }

    /** Check only filesystem-backed literals; bare package and non-file URLs belong to other rules. */
    function check(node, specifier, resolution = 'esm') {
      if (typeof specifier !== 'string') {
        return;
      }
      const target = resolution === 'require' ? requireTarget(specifier) : esmTarget(specifier);
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

    /*
     * TypeScript's import-equals declaration uses the compiler's CommonJS
     * resolution model; it does not inherit ESM URL parsing of percent escapes.
     */
    function checkRequire(node, specifier) {
      check(node, specifier, 'require');
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
          checkRequire(node, node.moduleReference.expression.value);
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
          checkRequire(node, node.arguments[0]?.value);
        }
      },
    };
  },
};
