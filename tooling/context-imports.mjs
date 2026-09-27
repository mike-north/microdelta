/**
 * PKG-001/004 source rule: a declared package surface and an allowed role edge
 * are both necessary. Runtime imports retain their bare package spelling; TS
 * declaration paths never authorize reaching another package's source tree.
 */
import path from 'node:path';
import { builtinModules } from 'node:module';

import { roleByDirectory, roleByPackage, roles } from './package-architecture.mjs';

/** Node's module inventory also identifies built-in subpaths without hardcoding a partial list. */
const nodeBuiltins = new Set(builtinModules.map(name => name.startsWith('node:') ? name.slice(5) : name));
const nodeGlobals = new Set([
  'Buffer', '__dirname', '__filename', 'clearImmediate', 'clearInterval', 'clearTimeout',
  'console', 'exports', 'global', 'module', 'process', 'require', 'setImmediate', 'setInterval', 'setTimeout',
]);

/** Tests may exercise host behavior, while production Node access has one owner subtree. */
function hasNodeRuntimeException(filename, packageRoot, role) {
  const relative = path.relative(packageRoot, filename).split(path.sep);
  const testFile = relative.some(segment => segment === 'test' || segment === 'test-d' || segment === '__tests__')
    || /(?:^|\.)test\.[cm]?[jt]sx?$/u.test(path.basename(filename));
  const nodeAdapter = role === 'machine-node'
    && relative[0] === 'src'
    && relative[1] === 'node';
  return testFile || nodeAdapter;
}

/** Source files cannot reach test helpers because tests are allowed host imports. */
function isTestFile(filename, packageRoot) {
  const relative = path.relative(packageRoot, filename).split(path.sep);
  return relative.some(segment => segment === 'test' || segment === 'test-d' || segment === '__tests__')
    || /(?:^|\.)test\.[cm]?[jt]sx?$/u.test(path.basename(filename));
}

/** `fs` and `node:fs/promises` are the same built-in; scoped packages are not. */
function isNodeBuiltin(specifier) {
  const name = specifier.startsWith('node:') ? specifier.slice('node:'.length) : specifier;
  if (nodeBuiltins.has(name)) {
    return true;
  }
  const slash = name.indexOf('/');
  return slash > 0 && nodeBuiltins.has(name.slice(0, slash));
}

/** Identify implemented packages and fixture-only roles with one owner policy. */
function location(filename) {
  const segments = filename.split(path.sep);
  const packageIndex = segments.lastIndexOf('packages');
  if (packageIndex >= 0 && segments[packageIndex + 1]) {
    const directory = segments[packageIndex + 1];
    const root = segments.slice(0, packageIndex + 2).join(path.sep);
    const role = roleByDirectory[directory];
    return {
      role,
      root,
      label: directory,
      isTestFile: isTestFile(filename, root),
      nodeRuntimeException: hasNodeRuntimeException(filename, root, role),
    };
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

    function reportNodeAccess(node, target) {
      context.report({ node, messageId: 'forbidden', data: { owner: owner.role, target } });
    }

    function check(node, specifier) {
      if (typeof specifier !== 'string') {
        context.report({ node, messageId: 'forbidden', data: { owner: owner.role, target: 'a computed module path' } });
        return;
      }
      if (isNodeBuiltin(specifier) && !owner.nodeRuntimeException) {
        reportNodeAccess(node, `Node built-in ${specifier}`);
        return;
      }
      if (specifier.startsWith('.')) {
        const target = path.resolve(path.dirname(context.filename), specifier);
        if (target === owner.root || target.startsWith(`${owner.root}${path.sep}`)) {
          const targetSegments = path.relative(owner.root, target).split(path.sep);
          const targetIsTest = targetSegments.some(segment => segment === 'test' || segment === 'test-d' || segment === '__tests__')
            || /(?:^|\.)test\.[cm]?[jt]sx?$/u.test(path.basename(target));
          // History's declaration-only rollup joins the separately published
          // Store conformance entry; runtime source never imports this test API.
          const historyConformanceRollup = owner.role === 'history'
            && path.basename(context.filename) === 'api-surface.d.ts'
            && specifier === './dist/test/conformance/store/index.js';
          if (targetIsTest && !owner.isTestFile && !historyConformanceRollup) {
            reportNodeAccess(node, 'a package test module from production source');
          }
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

    function isLocallyDeclared(name, node) {
      let scope = context.sourceCode.getScope(node);
      while (scope) {
        const variable = scope.set.get(name);
        if (variable && variable.defs.length > 0) {
          return true;
        }
        scope = scope.upper;
      }
      return false;
    }

    function checkNodeGlobal(node, name) {
      if (nodeGlobals.has(name) && !owner.nodeRuntimeException && !isLocallyDeclared(name, node)) {
        reportNodeAccess(node, `Node global ${name}`);
      }
    }

    function checkQualifiedNodeGlobal(node) {
      const object = node.object;
      if (object.type !== 'Identifier' || !isGlobalRoot(object)) {
        return;
      }
      const property = node.computed && node.property.type === 'Literal'
        ? node.property.value
        : !node.computed && node.property.type === 'Identifier' ? node.property.name : undefined;
      if (typeof property === 'string' && nodeGlobals.has(property) && !owner.nodeRuntimeException) {
        reportNodeAccess(node, `Node global ${object.name}.${property}`);
      }
    }

    /** Resolve simple const aliases to the ambient global object without execution. */
    function variableFor(node, name) {
      let scope = context.sourceCode.getScope(node);
      while (scope) {
        const variable = scope.set.get(name);
        if (variable) {
          return variable;
        }
        scope = scope.upper;
      }
      return undefined;
    }
    function isGlobalRoot(node, resolving = new Set()) {
      if (node?.type !== 'Identifier') {
        return false;
      }
      if (['globalThis', 'global'].includes(node.name) && !isLocallyDeclared(node.name, node)) {
        return true;
      }
      const variable = variableFor(node, node.name);
      if (!variable || resolving.has(variable)) {
        return false;
      }
      resolving.add(variable);
      return variable.defs.some(definition => {
        const declarator = definition.node;
        return declarator.type === 'VariableDeclarator'
          && declarator.parent.kind === 'const'
          && declarator.id.type === 'Identifier'
          && isGlobalRoot(declarator.init, resolving);
      });
    }

    function checkGlobalRootBinding(node) {
      const { id, init } = node;
      if (node.parent.kind !== 'const' || id.type !== 'ObjectPattern' || !isGlobalRoot(init)) {
        return;
      }
      for (const property of id.properties) {
        if (property.type !== 'Property') {
          continue;
        }
        const name = property.key.type === 'Identifier' ? property.key.name : property.key.value;
        if (typeof name === 'string' && nodeGlobals.has(name) && !owner.nodeRuntimeException) {
          reportNodeAccess(property, `Node global ${name} through globalThis`);
        }
      }
    }

    function isPropertyName(node) {
      const parent = node.parent;
      if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) {
        return true;
      }
      if (parent.type === 'Property' && parent.key === node && !parent.computed && !parent.shorthand) {
        return true;
      }
      if ((parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition')
        && parent.key === node && !parent.computed) {
        return true;
      }
      if (parent.type === 'TSPropertySignature' && parent.key === node && !parent.computed) {
        return true;
      }
      return false;
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
      Identifier(node) {
        if (!isPropertyName(node)) {
          checkNodeGlobal(node, node.name);
        }
      },
      MemberExpression(node) { checkQualifiedNodeGlobal(node); },
      VariableDeclarator(node) { checkGlobalRootBinding(node); },
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require'
          && !isLocallyDeclared('require', node.callee)) {
          check(node, node.arguments[0]?.value);
        }
      },
    };
  },
};
