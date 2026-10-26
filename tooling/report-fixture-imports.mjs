/**
 * Independent report oracles inspect public History/Accounting contracts while
 * the concrete application remains a facade consumer. The fixture owns only
 * its scaffolding and the example's controlled source; owner implementations,
 * deep package paths and source aliases cannot become alternate dependencies.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** This test role permits explicit public entries, never an arbitrary module-resolution escape. */
export const reportFixtureImports = {
  meta: { type: 'problem', schema: [], messages: { forbidden: 'PKG-004: report fixtures use public package entries and their owned controlled application only.' } },
  create(context) {
    /** Compiled fixture declarations remain beneath the fixture's owned tree. */
    const owned = [path.resolve(context.cwd, 'fixtures/contribution-report'), path.resolve(context.cwd, 'examples/contribution-report/src/controlled')];
    /** An owned filesystem edge cannot escape through relative parents or URL-encoded parents. */
    function check(node, value, commonjs = false) {
      if (typeof value !== 'string') { context.report({ node, messageId: 'forbidden' }); return; }
      const filesystem = value.startsWith('.') || path.isAbsolute(value) || /^file:/iu.test(value);
      if (!filesystem) {
        if (value.startsWith('node:') || value === 'microdelta' || /^@microdelta\/[a-z][a-z0-9-]*$/u.test(value) || value === '@jest/globals' || value === 'tsd') { return; }
        context.report({ node, messageId: 'forbidden' }); return;
      }
      let target;
      try { target = commonjs ? path.resolve(path.dirname(context.filename), value) : fileURLToPath(new URL(value, pathToFileURL(context.filename))); }
      catch { context.report({ node, messageId: 'forbidden' }); return; }
      if (!owned.some(root => { const relative = path.relative(root, target); return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); })) {
        context.report({ node, messageId: 'forbidden' });
      }
    }
    return {
      ImportDeclaration(node) { check(node, node.source.value); },
      ExportNamedDeclaration(node) { if (node.source) { check(node, node.source.value); } },
      ExportAllDeclaration(node) { check(node, node.source.value); },
      ImportExpression(node) { check(node, node.source.value); },
      TSImportType(node) { if (node.argument.type === 'TSLiteralType') { check(node, node.argument.literal.value); } },
      TSImportEqualsDeclaration(node) { if (node.moduleReference.type === 'TSExternalModuleReference') { check(node, node.moduleReference.expression.value, true); } },
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'require') { return; }
        // A caller-supplied function named require is not a Node module edge.
        let scope = context.sourceCode.getScope(node);
        while (scope !== null) { const binding = scope.set.get('require'); if (binding !== undefined && binding.defs.length > 0) { return; } scope = scope.upper; }
        check(node, node.arguments[0]?.value, true);
      },
    };
  },
};
