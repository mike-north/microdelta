/** Native parser and maintained API-model adapters for the bounded EXP-5 fixture. */
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { ApiClass, ApiMethod, ApiModel, ReleaseTag } from '@microsoft/api-extractor-model';
import ts from 'typescript';

import type { IApiMemberFact, IApiSnapshot, ICmlSnapshot, ICorrespondenceMapping } from './conformance.js';

/** An API-model input is explicitly associated with its workspace package. */
export interface IApiModelInput { name: string; apiJson: string; declaration: string }

/** The manifest chooses correspondence and artifact ports; it never supplies observed API or CML facts. */
export interface IManifest { mapping: ICorrespondenceMapping; artifacts: IApiModelInput[] }

/** Explicit package and entrypoint mapping is checked before reading either model. */
export async function loadManifest(file: string): Promise<IManifest> {
  const value: unknown = JSON.parse(await readFile(file, 'utf8'));
  if (!isObject(value) || !stringMap(value.contexts) || !stringMap(value.objects)
    || !stringMap(value.types) || !stringMap(value.references) || !stringArrayMap(value.operations)
    || !Array.isArray(value.unsupported)
    || !value.unsupported.every(item => typeof item === 'string')
    || !Array.isArray(value.artifacts) || !value.artifacts.every(artifact => isObject(artifact)
      && typeof artifact.name === 'string' && artifact.entrypoint === '.'
      && typeof artifact.apiJson === 'string' && typeof artifact.declaration === 'string')) {
    throw new Error(`Invalid EXP-5 correspondence manifest: ${file}`);
  }
  const artifacts: IApiModelInput[] = value.artifacts.map(artifact => {
    if (!isObject(artifact) || typeof artifact.name !== 'string'
      || typeof artifact.apiJson !== 'string' || typeof artifact.declaration !== 'string') {
      throw new Error(`Invalid EXP-5 artifact mapping: ${file}`);
    }
    return { name: artifact.name, apiJson: resolve(dirname(file), artifact.apiJson), declaration: resolve(dirname(file), artifact.declaration) };
  });
  if (new Set(artifacts.map(artifact => artifact.name)).size !== artifacts.length
    || Object.values(value.contexts).some(name => !artifacts.some(artifact => artifact.name === name))) {
    throw new Error(`Unresolved or duplicate EXP-5 package mapping: ${file}`);
  }
  return {
    mapping: { contexts: value.contexts, objects: value.objects, types: value.types,
      references: value.references, operations: value.operations, unsupported: value.unsupported },
    artifacts,
  };
}

/** Simple explicit maps are enough for this deliberately finite correspondence. */
function stringMap(value: unknown): value is Record<string, string> {
  return isObject(value) && Object.values(value).every(item => typeof item === 'string');
}

/** A finite named operation selection is the expected CML contract surface. */
function stringArrayMap(value: unknown): value is Record<string, string[]> {
  return isObject(value) && Object.values(value).every(item => Array.isArray(item)
    && item.every(name => typeof name === 'string'));
}

/** Compiler privacy evidence is separate from API Extractor release tags. */
export interface IClassPrivacyFacts {
  publicMembers: string[];
  protectedMembers: string[];
  privateMembers: string[];
  hardPrivateMembers: string[];
}

/** The native TypeScript AST preserves modifiers and # names absent from API-model release tiers. */
export function inspectClassPrivacy(file: string, className: string): IClassPrivacyFacts {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const result: IClassPrivacyFacts = { publicMembers: [], protectedMembers: [], privateMembers: [], hardPrivateMembers: [] };
  const declaration = source.statements.find(statement => ts.isClassDeclaration(statement) && statement.name?.text === className);
  if (!declaration || !ts.isClassDeclaration(declaration)) {
    throw new Error(`${file}: class ${className} missing`);
  }
  for (const member of declaration.members) {
    if (!ts.isMethodDeclaration(member)) {
      continue;
    }
    if (ts.isPrivateIdentifier(member.name)) {
      result.hardPrivateMembers.push(member.name.getText(source));
    } else if (ts.isIdentifier(member.name)) {
      if (member.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.PrivateKeyword)) {
        result.privateMembers.push(member.name.text);
      } else if (member.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ProtectedKeyword)) {
        result.protectedMembers.push(member.name.text);
      } else {
        result.publicMembers.push(member.name.text);
      }
    }
  }
  return result;
}

/** Reject malformed or incomplete extraction artifacts instead of assuming a match. */
export async function loadCmlSnapshot(file: string): Promise<ICmlSnapshot> {
  const value: unknown = JSON.parse(await readFile(file, 'utf8'));
  if (!isCmlSnapshot(value)) {
    throw new Error(`Invalid native CML extraction: ${file}`);
  }
  return value;
}

/** The finite extraction grammar is validated at the file boundary. */
function isCmlSnapshot(value: unknown): value is ICmlSnapshot {
  if (!isObject(value) || !Array.isArray(value.contexts)) {
    return false;
  }
  return value.contexts.every(context => isObject(context) && typeof context.name === 'string'
    && Array.isArray(context.aggregates) && context.aggregates.every(aggregate => isObject(aggregate)
      && typeof aggregate.name === 'string' && Array.isArray(aggregate.objects)
      && aggregate.objects.every(object => isObject(object) && typeof object.name === 'string'
        && (object.kind === 'Entity' || object.kind === 'Service') && Array.isArray(object.operations)
        && object.operations.every(operation => isObject(operation) && typeof operation.name === 'string'
          && typeof operation.returnType === 'string'
          && (operation.visibility === 'public' || operation.visibility === 'package'
            || operation.visibility === 'protected' || operation.visibility === 'private')
          && Array.isArray(operation.parameters) && operation.parameters.every(parameter => isObject(parameter)
            && typeof parameter.name === 'string' && typeof parameter.type === 'string')))));
}

/** Type narrowing protects all subsequent property reads from unchecked JSON. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** API Extractor can omit @internal items from .api.json; TS declarations fill only that deliberate gap. */
export function loadApiSnapshot(inputs: readonly IApiModelInput[]): IApiSnapshot {
  const model = new ApiModel();
  const packages: IApiSnapshot['packages'] = [];
  for (const input of inputs) {
    const loaded = model.loadPackage(input.apiJson);
    if (loaded.name !== input.name) {
      throw new Error(`${input.apiJson}: API package identity ${loaded.name} differs from mapping ${input.name}`);
    }
    const exports: IApiSnapshot['packages'][number]['exports'] = [];
    for (const entry of loaded.entryPoints) {
      for (const item of entry.members) {
        if (!(item instanceof ApiClass)) {
          continue;
        }
        const members: IApiMemberFact[] = [];
        for (const child of item.members) {
          if (child instanceof ApiMethod) {
            members.push({
              name: child.name,
              visibility: child.isProtected ? 'protected' : 'public',
              releaseTag: release(child.releaseTag),
              parameters: child.parameters.map(parameter => {
                const reference = parameter.parameterTypeExcerpt.spannedTokens.length === 1
                  ? parameter.parameterTypeExcerpt.spannedTokens[0]?.canonicalReference?.toString() : undefined;
                return reference
                  ? { name: parameter.name, type: parameter.parameterTypeExcerpt.text.trim(), reference }
                  : { name: parameter.name, type: parameter.parameterTypeExcerpt.text.trim() };
              }),
              returnType: child.returnTypeExcerpt.text.trim(),
            });
          }
        }
        const supplemental = internalMethods(input.declaration, item.name);
        for (const method of supplemental) {
          if (!members.some(candidate => candidate.name === method.name)) {
            members.push(method);
          }
        }
        exports.push({ name: item.name, kind: 'Class', releaseTag: release(item.releaseTag), members });
      }
    }
    packages.push({ name: input.name, exports });
  }
  return { packages };
}

/** Release tags are orthogonal to public/protected/private TypeScript accessibility. */
function release(value: ReleaseTag): IApiMemberFact['releaseTag'] {
  switch (value) {
    case ReleaseTag.Public: return 'public';
    case ReleaseTag.Beta: return 'beta';
    case ReleaseTag.Alpha: return 'alpha';
    case ReleaseTag.Internal: return 'internal';
    case ReleaseTag.None: return 'none';
  }
}

/** The compiler reads @internal members missing from API model, without parsing declaration text by regex. */
function internalMethods(file: string, className: string): IApiMemberFact[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const methods: IApiMemberFact[] = [];
  for (const statement of source.statements) {
    if (!ts.isClassDeclaration(statement) || statement.name?.text !== className) {
      continue;
    }
    for (const member of statement.members) {
      if (!ts.isMethodDeclaration(member) || !ts.isIdentifier(member.name)
        || !ts.getJSDocTags(member).some(tag => tag.tagName.text === 'internal')) {
        continue;
      }
      if (!member.type || member.parameters.some(parameter => !ts.isIdentifier(parameter.name) || !parameter.type)) {
        throw new Error(`${file}: unsupported @internal method signature`);
      }
      methods.push({
        name: member.name.text,
        visibility: member.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ProtectedKeyword) ? 'protected'
          : member.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.PrivateKeyword) ? 'private' : 'public',
        releaseTag: 'internal',
        parameters: member.parameters.map(parameter => ({ name: parameter.name.getText(source), type: parameter.type?.getText(source) ?? '' })),
        returnType: member.type.getText(source),
      });
    }
  }
  return methods;
}
