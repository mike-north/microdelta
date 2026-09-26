/**
 * PKG-001/004 source rule: a declared package surface and an allowed role edge
 * are both necessary. Runtime imports retain their bare package spelling; TS
 * declaration paths never authorize reaching another package's source tree.
 */
import path from 'node:path';

import { roleByDirectory, roleByPackage, roles } from './package-architecture.mjs';

/** Identify implemented packages and fixture-only roles with one owner policy. */
function location(filename) {
  const segments = filename.split(path.sep);
  const packageIndex = segments.lastIndexOf('packages');
  if (packageIndex >= 0 && segments[packageIndex + 1]) {
    const directory = segments[packageIndex + 1];
    return { role: roleByDirectory[directory], root: segments.slice(0, packageIndex + 2).join(path.sep), label: directory };
  }
  const fixtureIndex = segments.lastIndexOf('context-roles');
  if (fixtureIndex >= 0 && segments[fixtureIndex - 1] === 'fixtures') {
    const role = segments[fixtureIndex + 1];
    return { role: role in roles ? role : undefined, root: segments.slice(0, fixtureIndex + 2).join(path.sep), label: role };
  }
  return null;
}

/** Report a direct import, indirect re-export, or computed path at its source. */
export const contextImports = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { forbidden: 'PKG-004: {{owner}} cannot use {{target}}; use an approved declared package surface and edge.' },
  },
  create(context) {
    const owner = location(context.filename);
    if (!owner) {
      return {};
    }
    if (!owner.role) {
      return { Program(node) { context.report({ node, messageId: 'forbidden', data: { owner: owner.label, target: 'an unknown package or context' } }); } };
    }

    function check(node, specifier) {
      if (typeof specifier !== 'string') {
        context.report({ node, messageId: 'forbidden', data: { owner: owner.role, target: 'a computed module path' } });
        return;
      }
      if (specifier.startsWith('.')) {
        const target = path.resolve(path.dirname(context.filename), specifier);
        if (target === owner.root || target.startsWith(`${owner.root}${path.sep}`)) {
          return;
        }
        context.report({ node, messageId: 'forbidden', data: { owner: owner.role, target: 'sibling source via a relative path' } });
        return;
      }
      if (path.isAbsolute(specifier) || /^[a-z][a-z+.-]*:\/\//iu.test(specifier) || specifier.startsWith('@source/') || specifier.startsWith('#')) {
        context.report({ node, messageId: 'forbidden', data: { owner: owner.role, target: 'a source alias or absolute path' } });
        return;
      }
      // The existing facade publishes one explicit Jest suite from History's
      // declared package subpath; this is not a general deep-import grant.
      if (owner.role === 'facade' && specifier === '@microdelta/history/conformance/store') {
        return;
      }
      if (specifier === 'microdelta' || specifier.startsWith('microdelta/') || specifier.startsWith('@microdelta/')) {
        const targetRole = roleByPackage[specifier];
        if (targetRole && (targetRole === owner.role || roles[owner.role].uses.includes(targetRole))) {
          return;
        }
        context.report({ node, messageId: 'forbidden', data: { owner: owner.role, target: specifier } });
      }
    }

    return {
      ImportDeclaration(node) { check(node, node.source.value); },
      ExportNamedDeclaration(node) { if (node.source) { check(node, node.source.value); } },
      ExportAllDeclaration(node) { check(node, node.source.value); },
      ImportExpression(node) { check(node, node.source.value); },
      TSImportType(node) { check(node, node.argument.value); },
      TSImportEqualsDeclaration(node) {
        if (node.moduleReference.type === 'TSExternalModuleReference') {
          check(node, node.moduleReference.expression.value);
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
