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
const observerMethods = new Set(['tracked', 'capture', 'captureAsync', 'derived', 'snapshotOutput', 'keys', 'hasOwn']);
const captureMethods = new Set(['tracked', 'capture', 'captureAsync', 'derived']);
/** Only operations that express observations may use Materialization's receiver capability. */
const materializationMethods = new Set(['materializeOutput', 'project', 'projectFrom', 'observeMemberOrder']);
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
/** These exact declarations own the bounded cross-context observation receiver. */
const materializationOwnerFiles = new Set([
  path.resolve(fileURLToPath(new URL('../packages/materialization/src/index.ts', import.meta.url))),
  path.resolve(fileURLToPath(new URL('../packages/materialization/dist/api/materialization.alpha.d.ts', import.meta.url))),
]);

/**
 * Definition's generated alpha declaration is the authoring contract consumers
 * compile against; its builder signatures define the direct callback boundary
 * and its declared-call brand identifies canonical child handles.
 */
const definitionOwnerFiles = new Set([
  path.resolve(fileURLToPath(new URL('../packages/definition/dist/api/definition.alpha.d.ts', import.meta.url))),
]);
/** Only these author callback options of a Definition builder are capture boundaries. */
const definitionCallbackOptions = new Set(['run', 'finality']);

/** Collect Definition's builder signatures and declared-call brand from its generated declaration. */
function definitionTypes(sourceFile, checker) {
  const builderSignatures = new Set();
  const brandProperties = new Set();
  const visit = node => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === 'IDeclarations') {
      for (const member of node.members) {
        if (ts.isMethodSignature(member) && member.name && ts.isIdentifier(member.name) &&
            (member.name.text === 'source' || member.name.text === 'memo')) {
          builderSignatures.add(member);
        }
      }
    }
    if (ts.isInterfaceDeclaration(node) && node.name.text === 'IDeclaredCallBrand') {
      const symbol = checker.getSymbolAtLocation(node.name);
      const property = symbol && checker.getDeclaredTypeOfSymbol(symbol).getProperty('__microdeltaDeclaredCall');
      if (property) {
        brandProperties.add(property);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { builderSignatures, brandProperties };
}

/** Resolve canonical symbols only from each owning source or generated alpha view. */
function canonicalTypes(program, checker) {
  const declarations = new Map();
  const brandProperties = new Set();
  const definitionBuilders = new Set();
  let materializationSymbol;
  for (const sourceFile of program.getSourceFiles()) {
    const filename = path.resolve(sourceFile.fileName);
    if (definitionOwnerFiles.has(filename)) {
      const definition = definitionTypes(sourceFile, checker);
      definition.builderSignatures.forEach(signature => definitionBuilders.add(signature));
      definition.brandProperties.forEach(property => brandProperties.add(property));
      continue;
    }
    const isTrackingOwner = trackingOwnerFiles.has(filename);
    const isMaterializationOwner = materializationOwnerFiles.has(filename);
    if (!isTrackingOwner && !isMaterializationOwner) {
      continue;
    }
    const fileDeclarations = new Map();
    const visit = node => {
      if ((ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) &&
          ((isTrackingOwner && ['ITrackedBrand', 'ITrackingObserver', 'ITracking', 'ITracked'].includes(node.name.text)) ||
            (isMaterializationOwner && node.name.text === 'IMaterialization'))) {
        const symbol = checker.getSymbolAtLocation(node.name);
        if (symbol) {
          if (isTrackingOwner) {
            fileDeclarations.set(node.name.text, symbol);
            declarations.set(node.name.text, symbol);
          }
          if (isMaterializationOwner && node.name.text === 'IMaterialization') {
            materializationSymbol = symbol;
          }
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
    definitionBuilders,
    observerMembers: new Map([...observerMethods].map(name => [
      name, observerSymbol && checker.getDeclaredTypeOfSymbol(observerSymbol).getProperty(name),
    ])),
    localMember: observerSymbol && checker.getDeclaredTypeOfSymbol(observerSymbol).getProperty('local'),
    cellMember: trackingSymbol && checker.getDeclaredTypeOfSymbol(trackingSymbol).getProperty('cell'),
    materializationMembers: new Map([...materializationMethods].map(name => [
      name, materializationSymbol && checker.getDeclaredTypeOfSymbol(materializationSymbol).getProperty(name),
    ])),
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

/** Find every receiver occurrence in one callback subtree, including nested functions. */
function findThisExpressions(root, visitorKeys) {
  const pending = [root];
  const found = [];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node.type === 'ThisExpression') {
      found.push(node);
    }
    const children = [];
    for (const key of visitorKeys[node.type] ?? []) {
      const value = node[key];
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child.type === 'string') {
            children.push(child);
          }
        }
      } else if (value && typeof value.type === 'string') {
        children.push(value);
      }
    }
    for (let index = children.length - 1; index >= 0; index--) {
      pending.push(children[index]);
    }
  }
  return found;
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
    /** Materialization's receiver is trusted only for its four named observation operations. */
    const actualMaterializationMethod = (call, name) => {
      const member = call?.callee;
      const canonicalMember = canonical.materializationMembers.get(name);
      return Boolean(canonicalMember && materializationMethods.has(name) && member?.type === 'MemberExpression' &&
        !member.computed && member.property.name === name &&
        propertySymbol(member) === canonicalMember);
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
      if (member.parent?.type === 'CallExpression' && member.parent.callee === member &&
          materializationMethods.has(member.property.name)) {
        return actualMaterializationMethod(member.parent, member.property.name);
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

    /**
     * A Definition builder call is recognized by its resolved signature's
     * declaration in Definition's generated alpha rollup, so pre-applied or
     * destructured builders qualify while same-spelled APIs never do.
     */
    const isDefinitionBuilderCall = callTs => {
      const declaration = checker.getResolvedSignature(callTs)?.declaration;
      return Boolean(declaration && canonical.definitionBuilders.has(declaration));
    };

    /** Resolve one Definition callback option value to a supported direct callback. */
    const definitionCallback = value => {
      if (value.type === 'ArrowFunctionExpression' || value.type === 'FunctionExpression') {
        return tsNodeFor(value);
      }
      if (value.type === 'Identifier') {
        const valueTs = tsNodeFor(value);
        const symbol = valueTs && checker.getSymbolAtLocation(valueTs);
        return symbol?.declarations?.find(declaration =>
          ts.isFunctionDeclaration(declaration) && declaration.getSourceFile() === valueTs.getSourceFile());
      }
      return undefined;
    };

    /**
     * The options must be an object literal. Its `run` and `finality` values are
     * boundaries when they are inline functions, methods or same-file function
     * declarations; spreads, computed keys and constructed callbacks are unsupported.
     */
    const collectDefinitionCallbacks = (node, candidates, unsupported) => {
      const options = node.arguments[0];
      if (options?.type !== 'ObjectExpression') {
        unsupported.add(options ?? node);
        return;
      }
      for (const property of options.properties) {
        if (property.type !== 'Property') {
          unsupported.add(property);
          continue;
        }
        if (property.computed) {
          unsupported.add(property);
          continue;
        }
        const key = property.key.type === 'Identifier' ? property.key.name
          : property.key.type === 'Literal' ? String(property.key.value) : undefined;
        if (!key || !definitionCallbackOptions.has(key)) {
          continue;
        }
        const callback = definitionCallback(property.value);
        const callbackNode = callback && estreeByTs.get(callback);
        if (!callback || !callbackNode) {
          unsupported.add(property.value);
          continue;
        }
        candidates.push({ callback, callbackNode });
      }
    };

    return {
      Program(node) { root = node; visit(node); },
      'Program:exit'() {
        const observerBoundaries = canonical.brandProperties.size > 0 && Boolean(canonical.observerMembers.get('capture'));
        const definitionBoundaries = canonical.definitionBuilders.size > 0;
        if (!observerBoundaries && !definitionBoundaries) {
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
          if (definitionBoundaries && isDefinitionBuilderCall(callTs)) {
            collectDefinitionCallbacks(node, candidates, unsupported);
            continue;
          }
          if (!observerBoundaries) {
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
        for (const { callbackNode } of candidates) {
          const callbackScope = sourceCode.getScope(callbackNode);
          if (!callbackScope) {
            unsupported.add(callbackNode);
            continue;
          }
          for (const thisExpression of findThisExpressions(callbackNode, sourceCode.visitorKeys)) {
            unsupported.add(thisExpression);
          }
          const scopes = [];
          const collect = scope => {
            scopes.push(scope);
            for (const child of scope.childScopes) {
              collect(child);
            }
          };
          collect(callbackScope);
          for (const scope of scopes) {
            for (const reference of scope.references) {
              if (!reference.isRead()) {
                continue;
              }
              // Type-only references (annotations, generic arguments) have no runtime influence.
              if (reference.isTypeReference === true && reference.isValueReference !== true) {
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
              context.report({ node: identifier, messageId: 'capture', data: { name: identifier.name } });
            }
          }
        }
        for (const node of unsupported) {
          context.report({ node, messageId: 'unsupported' });
        }
      },
    };
  },
};
