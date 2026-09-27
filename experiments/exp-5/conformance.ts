/** Bounded EXP-5 correspondence between parsed CML and extracted API facts. */

/** A name and simple type identify a represented operation argument. */
export interface IParameterFact { name: string; type: string; reference?: string }

/** CML operation facts retain native visibility rather than release metadata. */
export interface ICmlOperationFact {
  name: string;
  visibility: 'public' | 'package' | 'protected' | 'private';
  parameters: IParameterFact[];
  returnType: string;
}

/** An entity or service belongs to exactly one modeled aggregate. */
export interface ICmlObjectFact {
  name: string;
  kind: 'Entity' | 'Service';
  operations: ICmlOperationFact[];
}

/** The parsed tactical model supplies ownership rather than package guesses. */
export interface ICmlSnapshot {
  contexts: { name: string; aggregates: { name: string; objects: ICmlObjectFact[] }[] }[];
}

/** API members retain both TypeScript accessibility and release tier. */
export interface IApiMemberFact {
  name: string;
  visibility: 'public' | 'protected' | 'private';
  releaseTag: 'public' | 'beta' | 'alpha' | 'internal' | 'none';
  parameters: IParameterFact[];
  returnType: string;
}

/** Extracted declarations represent independently named package exports. */
export interface IApiSnapshot {
  packages: {
    name: string;
    exports: { name: string; kind: string; releaseTag: string; members: IApiMemberFact[] }[];
  }[];
}

/** Author-selected correspondence is explicit; unsupported items remain visible. */
export interface ICorrespondenceMapping {
  contexts: Record<string, string>;
  objects: Record<string, string>;
  types: Record<string, string>;
  references: Record<string, string>;
  operations: Record<string, string[]>;
  unsupported: string[];
}

/** Diagnostics are evidence that the bounded representation drifted. */
export interface ICorrespondenceResult { diagnostics: string[]; unsupported: string[] }

/** The mapping intentionally compares only facts with faithful counterparts. */
export function compareCorrespondence(
  cml: ICmlSnapshot,
  api: IApiSnapshot,
  mapping: ICorrespondenceMapping,
): ICorrespondenceResult {
  const diagnostics: string[] = [];
  /** A manifest obligation remains required when its current CML declaration disappears. */
  const contextNames = new Set(cml.contexts.map(context => context.name));
  const objects = new Map<string, ICmlObjectFact>();
  for (const context of cml.contexts) {
    for (const aggregate of context.aggregates) {
      for (const object of aggregate.objects) {
        objects.set(`${context.name}.${aggregate.name}.${object.name}`, object);
      }
    }
  }
  for (const name of Object.keys(mapping.contexts)) {
    if (!contextNames.has(name)) {
      diagnostics.push(`${name}: mapped CML context missing`);
    }
  }
  for (const address of Object.keys(mapping.objects)) {
    if (!objects.has(address)) {
      diagnostics.push(`${address}: mapped CML object missing`);
    }
  }
  for (const [address, names] of Object.entries(mapping.operations)) {
    const object = objects.get(address);
    for (const name of names) {
      if (!object?.operations.some(operation => operation.name === name)) {
        diagnostics.push(`${address}.${name}: mapped CML operation missing`);
      }
    }
  }
  for (const context of cml.contexts) {
    const packageName = mapping.contexts[context.name];
    const packageFact = api.packages.find(candidate => candidate.name === packageName);
    if (!packageName || !packageFact) {
      diagnostics.push(`${context.name}: mapped package unavailable`);
      continue;
    }
    for (const aggregate of context.aggregates) {
      for (const object of aggregate.objects) {
        const address = `${context.name}.${aggregate.name}.${object.name}`;
        const exportName = mapping.objects[address];
        const exportFact = packageFact.exports.find(candidate => candidate.name === exportName);
        if (!exportName || !exportFact) {
          diagnostics.push(`${address}: mapped export unavailable in ${packageName}`);
          continue;
        }
        if (exportFact.kind !== 'Class') {
          diagnostics.push(`${address}: expected a class counterpart`);
        }
        for (const operation of object.operations) {
          if (!mapping.operations[address]?.includes(operation.name)) {
            diagnostics.push(`${address}.${operation.name}: current CML operation has no mapping`);
            continue;
          }
          const member = exportFact.members.find(candidate => candidate.name === operation.name);
          const operationAddress = `${address}.${operation.name}`;
          if (!member) {
            diagnostics.push(`${operationAddress}: operation missing`);
            continue;
          }
          if (operation.visibility === 'package') {
            if (member.releaseTag !== 'internal') {
              diagnostics.push(`${operationAddress}: CML package visibility requires @internal`);
            }
          } else if (operation.visibility === 'public') {
            if (member.visibility !== 'public') {
              diagnostics.push(`${operationAddress}: TypeScript member is not public`);
            }
          } else {
            diagnostics.push(`${operationAddress}: CML ${operation.visibility} visibility has no adopted API mapping`);
          }
          if (member.parameters.length !== operation.parameters.length) {
            diagnostics.push(`${operationAddress}: parameter count changed`);
          }
          operation.parameters.forEach((parameter, index) => {
            const current = member.parameters[index];
            const mappedType = mapping.types[parameter.type];
            if (!current || current.name !== parameter.name || !mappedType || current.type !== mappedType) {
              diagnostics.push(`${operationAddress}: parameter ${index} differs`);
            }
            const expectedReference = mapping.references[parameter.type];
            if (expectedReference && current?.reference !== expectedReference) {
              diagnostics.push(`${operationAddress}: parameter ${index} reference owner differs`);
            }
          });
          const mappedReturn = mapping.types[operation.returnType];
          if (!mappedReturn || member.returnType !== mappedReturn) {
            diagnostics.push(`${operationAddress}: return type differs`);
          }
        }
      }
    }
  }
  return { diagnostics, unsupported: [...mapping.unsupported] };
}
