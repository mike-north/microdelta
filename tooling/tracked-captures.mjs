/**
 * TRK-4's capture checker validates declared observer callback syntax using
 * lexical references and the same TypeScript declarations consumers compile.
 * It is a bounded aid: only the observer's runtime ownership table proves that
 * a branded value belongs to that observer, and arbitrary closure soundness is
 * outside this rule's contract. Callback receiver access and literal-computed
 * observer boundaries are diagnosed as unsupported rather than inferred.
 */
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

/** Observer capabilities and deterministic scalar functions have narrow authority. */
const observerMethods = new Set(['tracked', 'capture', 'captureAsync', 'derived', 'keys', 'hasOwn']);
const captureMethods = new Set(['tracked', 'capture', 'captureAsync', 'derived']);
const builtinMethods = new Set([
  'Math.abs', 'Math.ceil', 'Math.floor', 'Math.max', 'Math.min', 'Math.round',
  'Math.sign', 'Math.trunc', 'Math.sqrt', 'Math.pow',
  'Number.isFinite', 'Number.isInteger', 'Number.isNaN', 'Number.isSafeInteger', 'Object.is',
]);
const immutableGlobals = new Set(['undefined', 'NaN', 'Infinity']);
/** Brand authority follows the real Tracking producer artifacts, never similar names elsewhere. */
const trackingOwnerFiles = new Set([
  path.resolve(fileURLToPath(new URL('../packages/tracking/src/index.ts', import.meta.url))),
  path.resolve(fileURLToPath(new URL('../packages/tracking/src/observer.ts', import.meta.url))),
  path.resolve(fileURLToPath(new URL('../packages/tracking/dist/api/tracking.alpha.d.ts', import.meta.url))),
]);

/** Resolve canonical symbols only from Tracking's own source or generated alpha view. */
function canonicalTypes(program, checker) {
  const declarations = new Map();
  const brandProperties = new Set();
  for (const sourceFile of program.getSourceFiles()) {
    const filename = path.resolve(sourceFile.fileName);
    if (!trackingOwnerFiles.has(filename)) {
      continue;
    }
    const fileDeclarations = new Map();
    const visit = node => {
      if ((ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) &&
          ['ITrackedBrand', 'ITrackingObserver', 'ITracking', 'ITracked'].includes(node.name.text)) {
        const symbol = checker.getSymbolAtLocation(node.name);
        if (symbol) {
          fileDeclarations.set(node.name.text, symbol);
          declarations.set(node.name.text, symbol);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    const brand = fileDeclarations.get('ITrackedBrand');
    if (brand) {
      const property = checker.getDeclaredTypeOfSymbol(brand).getProperty('__microdeltaTracked');
      if (property) {
        brandProperties.add(property);
      }
    }
  }
  const observerSymbol = declarations.get('ITrackingObserver');
  const trackingSymbol = declarations.get('ITracking');
  return {
    brandProperties,
    observerMembers: new Map([...observerMethods].map(name => [
      name, observerSymbol && checker.getDeclaredTypeOfSymbol(observerSymbol).getProperty(name),
    ])),
    localMember: observerSymbol && checker.getDeclaredTypeOfSymbol(observerSymbol).getProperty('local'),
    cellMember: trackingSymbol && checker.getDeclaredTypeOfSymbol(trackingSymbol).getProperty('cell'),
  };
}

/** A returned brand is recognized by canonical symbol identity through intersections and unions. */
function hasTrackedBrand(type, checker, brandProperties) {
  if (!type || brandProperties.size === 0) {
    return false;
  }
  const value = type;
  if (value.isUnion()) {
    return value.types.every(part => hasTrackedBrand(part, checker, brandProperties));
  }
  if (checker.getPropertiesOfType(value).some(property => brandProperties.has(property))) {
    return true;
  }
  return value.isIntersection() && value.types.some(part => hasTrackedBrand(part, checker, brandProperties));
}

/** A declaration scope is local only when it descends from the callback scope. */
function isWithin(scope, ancestor) {
  for (let current = scope; current; current = current.upper) {
    if (current === ancestor) {
      return true;
    }
  }
  return false;
}

/** Unsupported receiver syntax remains within the callback's lexical boundary. */
function isAstDescendant(node, ancestor) {
  for (let current = node; current; current = current.parent) {
    if (current === ancestor) {
      return true;
    }
  }
  return false;
}

/** The type-aware rule keeps each exemption attached to declarations, not spellings. */
export const trackedCaptures = {
  meta: {
    type: 'problem',
    docs: { description: 'Detect untracked external captures in declared Tracking observer callbacks.' },
    schema: [],
    messages: {
      capture: "External influence '{{name}}' is not a tracked value or approved deterministic capability.",
      unsupported: 'This Tracking callback form is outside the linted direct-callback syntax; use a direct callback or same-file function declaration.',
      missingTypes: 'The tracked-captures rule requires TypeScript type information for resolved declarations.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    const services = sourceCode.parserServices ?? context.parserServices;
    const program = services?.program;
    const checker = program?.getTypeChecker();
    const nodeMap = services?.esTreeNodeToTSNodeMap;
    let root;
    if (!program || !checker || !nodeMap) {
      return {
        Program(node) { root = node; },
        'Program:exit'() { context.report({ node: root, messageId: 'missingTypes' }); },
      };
    }

    const canonical = canonicalTypes(program, checker);
    const estreeByTs = new Map();
    const allNodes = [];
    const tsNodeFor = node => nodeMap.get(node);
    const symbolAt = node => {
      const tsNode = node && tsNodeFor(node);
      return tsNode && checker.getSymbolAtLocation(tsNode);
    };
    const propertySymbol = member => member?.type === 'MemberExpression' && !member.computed
      ? symbolAt(member.property) : undefined;
    const canonicalObserverMethodName = call => {
      const member = call?.callee;
      if (member?.type !== 'MemberExpression') {
        return undefined;
      }
      const name = member.computed
        ? member.property.type === 'Literal' && typeof member.property.value === 'string' ? member.property.value : undefined
        : member.property.name;
      if (!name || !observerMethods.has(name)) {
        return undefined;
      }
      const tsMember = tsNodeFor(member);
      const memberSymbol = tsMember && ts.isElementAccessExpression(tsMember) && ts.isStringLiteral(tsMember.argumentExpression)
        ? checker.getTypeAtLocation(tsMember.expression).getProperty(tsMember.argumentExpression.text)
        : propertySymbol(member);
      return memberSymbol === canonical.observerMembers.get(name) ? name : undefined;
    };
    const hasBrand = (node, variable) => {
      const tsNode = tsNodeFor(node);
      if (!tsNode) {
        return false;
      }
      const symbol = checker.getSymbolAtLocation(tsNode);
      const declaration = variable?.defs?.map(definition => definition.name).find(name => name && tsNodeFor(name));
      const type = symbol && declaration
        ? checker.getTypeOfSymbolAtLocation(symbol, tsNodeFor(declaration))
        : checker.getTypeAtLocation(tsNode);
      return hasTrackedBrand(type, checker, canonical.brandProperties);
    };
    const actualObserverMethod = (call, name) => {
      const member = call?.callee;
      return member?.type === 'MemberExpression' && !member.computed && member.property.name === name &&
        propertySymbol(member) === canonical.observerMembers.get(name);
    };

    const visit = node => {
      allNodes.push(node);
      const tsNode = tsNodeFor(node);
      if (tsNode) {
        estreeByTs.set(tsNode, node);
      }
      for (const [key, value] of Object.entries(node)) {
        if (key === 'parent' || key === 'tokens' || key === 'comments') {
          continue;
        }
        if (Array.isArray(value)) {
          for (const child of value) {
            if (child && typeof child.type === 'string') {
              visit(child);
            }
          }
        } else if (value && typeof value.type === 'string') {
          visit(value);
        }
      }
    };

    const actualLocalCell = variable => {
      const definition = variable?.defs?.find(item => item.type === 'Variable' && item.node?.type === 'VariableDeclarator');
      const declarator = definition?.node;
      const initializer = declarator?.init;
      if (!declarator || declarator.parent?.type !== 'VariableDeclaration' ||
          declarator.parent.kind !== 'const' || initializer?.type !== 'CallExpression') {
        return undefined;
      }
      const cell = initializer.callee;
      const local = cell?.type === 'MemberExpression' && !cell.computed ? cell.object : undefined;
      const observer = local?.type === 'MemberExpression' && !local.computed ? local.object : undefined;
      if (cell?.type !== 'MemberExpression' || cell.computed || propertySymbol(cell) !== canonical.cellMember ||
          local?.type !== 'MemberExpression' || local.computed || local.property.name !== 'local' ||
          propertySymbol(local) !== canonical.localMember || observer?.type !== 'Identifier') {
        return undefined;
      }
      return initializer;
    };

    const actualDerived = (variable, validCallbacks) => {
      const definition = variable?.defs?.find(item => item.type === 'Variable' && item.node?.type === 'VariableDeclarator');
      const declarator = definition?.node;
      const initializer = declarator?.init;
      if (!declarator || declarator.parent?.type !== 'VariableDeclaration' ||
          declarator.parent.kind !== 'const' || initializer?.type !== 'CallExpression' ||
          !actualObserverMethod(initializer, 'derived')) {
        return false;
      }
      const callback = initializer.arguments[0];
      const callbackTs = callback && tsNodeFor(callback);
      return Boolean(callbackTs && validCallbacks.has(callbackTs));
    };

    const allowedBuiltin = call => {
      const member = call?.callee;
      if (call?.type !== 'CallExpression' || member?.type !== 'MemberExpression' || member.computed ||
          member.object?.type !== 'Identifier') {
        return false;
      }
      const name = member.object.name + '.' + member.property.name;
      const symbol = propertySymbol(member);
      const receiver = symbolAt(member.object);
      const fromDefaultLibrary = value => value?.declarations?.some(declaration =>
        program.isSourceFileDefaultLibrary(declaration.getSourceFile())) === true;
      return builtinMethods.has(name) && fromDefaultLibrary(receiver) && fromDefaultLibrary(symbol);
    };

    const immutableGlobal = (identifier, variable) => {
      if (!immutableGlobals.has(identifier.name)) {
        return false;
      }
      const symbol = symbolAt(identifier);
      if (identifier.name === 'undefined' && !variable?.defs?.length) {
        const type = checker.getTypeAtLocation(tsNodeFor(identifier));
        const declarations = symbol?.declarations ?? [];
        return symbol?.name === 'undefined' && (type.flags & ts.TypeFlags.Undefined) !== 0 &&
          declarations.every(declaration => program.isSourceFileDefaultLibrary(declaration.getSourceFile()));
      }
      return symbol?.name === identifier.name && symbol.declarations?.some(declaration =>
        program.isSourceFileDefaultLibrary(declaration.getSourceFile())) === true;
    };

    const capabilityUse = identifier => {
      const member = identifier.parent;
      if (member?.type !== 'MemberExpression' || member.object !== identifier || member.computed) {
        return false;
      }
      if (member.parent?.type === 'CallExpression' && member.parent.callee === member &&
          observerMethods.has(member.property.name)) {
        return actualObserverMethod(member.parent, member.property.name);
      }
      const cell = member.parent;
      const local = cell?.type === 'MemberExpression' && !cell.computed ? cell.object : undefined;
      const call = cell?.type === 'MemberExpression' && cell.parent?.type === 'CallExpression' ? cell.parent : undefined;
      return Boolean(call && call.callee === cell && local === member &&
        cell.property.name === 'cell' && propertySymbol(member) === canonical.localMember &&
        propertySymbol(cell) === canonical.cellMember);
    };

    const callbackForArgument = (callTs, index) => {
      const argument = callTs.arguments[index];
      if (argument && (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument))) {
        return argument;
      }
      if (argument && ts.isIdentifier(argument)) {
        const symbol = checker.getSymbolAtLocation(argument);
        return symbol?.declarations?.find(declaration =>
          ts.isFunctionDeclaration(declaration) && declaration.getSourceFile() === callTs.getSourceFile());
      }
      return undefined;
    };

    return {
      Program(node) { root = node; visit(node); },
      'Program:exit'() {
        if (!canonical.brandProperties.size || !canonical.observerMembers.get('capture')) {
          return;
        }
        const candidates = [];
        const unsupported = new Set();
        for (const node of allNodes) {
          if (node.type !== 'CallExpression') {
            continue;
          }
          const callTs = tsNodeFor(node);
          if (!callTs || !ts.isCallExpression(callTs)) {
            continue;
          }
          const name = canonicalObserverMethodName(node);
          if (!name || !captureMethods.has(name)) {
            continue;
          }
          if (node.callee.computed) {
            unsupported.add(node);
            continue;
          }
          if (name === 'tracked') {
            const input = callTs.arguments[0];
            const inputType = input && checker.getTypeAtLocation(input);
            if (!inputType || checker.getSignaturesOfType(inputType, ts.SignatureKind.Call).length === 0) {
              continue;
            }
          }
          const callback = callbackForArgument(callTs, 0);
          const callbackNode = callback && estreeByTs.get(callback);
          if (!callback || !callbackNode) {
            unsupported.add(node.arguments[0] ?? node);
            continue;
          }
          candidates.push({ callback, callbackNode });
        }

        const directCallbacks = new Set(candidates.map(candidate => candidate.callback));
        const validCallbacks = new Set();
        for (const { callback, callbackNode } of candidates) {
          const callbackScope = sourceCode.getScope(callbackNode);
          if (!callbackScope) {
            unsupported.add(callbackNode);
            continue;
          }
          for (const candidate of allNodes) {
            if (candidate.type === 'ThisExpression' && isAstDescendant(candidate, callbackNode)) {
              unsupported.add(candidate);
            }
          }
          const scopes = [];
          const collect = scope => {
            scopes.push(scope);
            for (const child of scope.childScopes) {
              collect(child);
            }
          };
          collect(callbackScope);
          let valid = true;
          for (const scope of scopes) {
            for (const reference of scope.references) {
              if (!reference.isRead()) {
                continue;
              }
              const identifier = reference.identifier;
              const variable = reference.resolved;
              if (variable && isWithin(variable.scope, callbackScope)) {
                continue;
              }
              if (hasBrand(identifier, variable)) {
                continue;
              }
              if (immutableGlobal(identifier, variable)) {
                continue;
              }
              const parent = identifier.parent;
              const invocation = parent?.type === 'MemberExpression' && parent.object === identifier &&
                parent.parent?.type === 'CallExpression' ? parent.parent : undefined;
              if (invocation && allowedBuiltin(invocation)) {
                continue;
              }
              if (capabilityUse(identifier)) {
                continue;
              }
              if (variable && parent?.type === 'MemberExpression' && parent.object === identifier &&
                  !parent.computed && parent.property.name === 'get' && parent.parent?.type === 'CallExpression' &&
                  parent.parent.callee === parent) {
                const initializer = actualLocalCell(variable);
                const result = initializer && checker.getTypeAtLocation(tsNodeFor(parent.parent));
                if (result && hasTrackedBrand(result, checker, canonical.brandProperties)) {
                  continue;
                }
                if (actualDerived(variable, directCallbacks)) {
                  continue;
                }
              }
              valid = false;
              context.report({ node: identifier, messageId: 'capture', data: { name: identifier.name } });
            }
          }
          if (valid) {
            validCallbacks.add(callback);
          }
        }
        for (const node of unsupported) {
          context.report({ node, messageId: 'unsupported' });
        }
      },
    };
  },
};
