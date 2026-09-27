/** EXP-5's bounded correspondence obligations, independent of parser mechanics. */
import { describe, expect, test } from '@jest/globals';

import { compareCorrespondence } from './conformance.js';
import type { IApiSnapshot, ICmlSnapshot, ICorrespondenceMapping } from './conformance.js';

/** Parsed CML ownership and operation facts for the two-package fixture. */
const cml: ICmlSnapshot = {
  contexts: [
    { name: 'ProducerContext', aggregates: [{ name: 'Records', objects: [{
      name: 'RecordEntity', kind: 'Entity', operations: [
        { name: 'rename', visibility: 'public', parameters: [{ name: 'nextLabel', type: 'String' }], returnType: 'String' },
        { name: '_localCode', visibility: 'package', parameters: [{ name: 'prefix', type: 'String' }], returnType: 'String' },
      ],
    }] }] },
    { name: 'ConsumerContext', aggregates: [{ name: 'Reports', objects: [{
      name: 'ReportService', kind: 'Service', operations: [
        { name: 'formatRecord', visibility: 'public', parameters: [{ name: 'record', type: 'RecordEntity' }], returnType: 'String' },
      ],
    }] }] },
  ],
};

/** API-model facts include release tiers as a separate axis from TS visibility. */
const api: IApiSnapshot = {
  packages: [
    { name: '@microdelta/exp5-producer', exports: [{
      name: 'RecordEntity', kind: 'Class', releaseTag: 'public', members: [
        { name: 'rename', visibility: 'public', releaseTag: 'public', parameters: [{ name: 'nextLabel', type: 'string' }], returnType: 'string' },
        { name: '_localCode', visibility: 'public', releaseTag: 'internal', parameters: [{ name: 'prefix', type: 'string' }], returnType: 'string' },
      ],
    }] },
    { name: '@microdelta/exp5-consumer', exports: [{
      name: 'ReportService', kind: 'Class', releaseTag: 'public', members: [
        { name: 'formatRecord', visibility: 'public', releaseTag: 'public', parameters: [{ name: 'record', type: 'RecordEntity', reference: '@microdelta/exp5-producer!RecordEntity:class' }], returnType: 'string' },
      ],
    }] },
  ],
};

/** Explicit mappings avoid deriving package names from display names. */
const mapping: ICorrespondenceMapping = {
  contexts: { ProducerContext: '@microdelta/exp5-producer', ConsumerContext: '@microdelta/exp5-consumer' },
  objects: {
    'ProducerContext.Records.RecordEntity': 'RecordEntity',
    'ConsumerContext.Reports.ReportService': 'ReportService',
  },
  types: { String: 'string', RecordEntity: 'RecordEntity' },
  references: { RecordEntity: '@microdelta/exp5-producer!RecordEntity:class' },
  operations: {
    'ProducerContext.Records.RecordEntity': ['rename', '_localCode'],
    'ConsumerContext.Reports.ReportService': ['formatRecord'],
  },
  unsupported: ['entity attributes', 'standalone function', 'interface', 'type alias', 'protected/private/# class members', 'beta/alpha release tiers'],
};

/** Every mutation changes one represented fact and must yield a diagnostic. */
function changed(change: (sample: { cml: ICmlSnapshot; api: IApiSnapshot; mapping: ICorrespondenceMapping }) => void) {
  const copy = structuredClone({ cml, api, mapping });
  change(copy);
  return compareCorrespondence(copy.cml, copy.api, copy.mapping);
}

describe('EXP-5 CML/API correspondence', () => {
  test('accepts the represented subset and reports unsupported coverage', () => {
    const result = compareCorrespondence(cml, api, mapping);
    expect(result.diagnostics).toEqual([]);
    expect(result.unsupported).toEqual(mapping.unsupported);
  });

  test('detects changed ownership', () => {
    expect(changed(x => { x.mapping.contexts.ProducerContext = '@microdelta/exp5-consumer'; }).diagnostics.length).toBeGreaterThan(0);
  });
  test('rejects deleted mapped contexts, objects, and operations', () => {
    expect(changed(x => { x.cml.contexts.pop(); }).diagnostics.join('\n')).toMatch(/ConsumerContext/u);
    expect(changed(x => { x.cml.contexts[0]!.aggregates[0]!.objects.pop(); }).diagnostics.join('\n')).toMatch(/RecordEntity/u);
    expect(changed(x => { x.cml.contexts[0]!.aggregates[0]!.objects[0]!.operations.pop(); }).diagnostics.join('\n')).toMatch(/_localCode/u);
  });
  test('detects changed type name', () => {
    expect(changed(x => { x.api.packages[0]!.exports[0]!.name = 'RenamedRecord'; }).diagnostics.length).toBeGreaterThan(0);
  });
  test('detects changed operation name', () => {
    expect(changed(x => { x.api.packages[0]!.exports[0]!.members[0]!.name = 'renamed'; }).diagnostics.length).toBeGreaterThan(0);
  });
  test('detects changed parameter name and type', () => {
    expect(changed(x => { x.api.packages[0]!.exports[0]!.members[0]!.parameters[0]!.name = 'name'; }).diagnostics.length).toBeGreaterThan(0);
    expect(changed(x => { x.api.packages[0]!.exports[0]!.members[0]!.parameters[0]!.type = 'number'; }).diagnostics.length).toBeGreaterThan(0);
  });
  test('detects changed return type', () => {
    expect(changed(x => { x.api.packages[0]!.exports[0]!.members[0]!.returnType = 'number'; }).diagnostics.length).toBeGreaterThan(0);
  });
  test('detects changed package visibility', () => {
    expect(changed(x => { x.api.packages[0]!.exports[0]!.members[1]!.releaseTag = 'public'; }).diagnostics.length).toBeGreaterThan(0);
  });
  test('detects changed cross-context reference', () => {
    expect(changed(x => { x.api.packages[1]!.exports[0]!.members[0]!.parameters[0]!.type = 'string'; }).diagnostics.length).toBeGreaterThan(0);
    expect(changed(x => { x.api.packages[1]!.exports[0]!.members[0]!.parameters[0]!.reference = '@microdelta/exp5-consumer!RecordEntity:class'; }).diagnostics.join('\n')).toMatch(/reference/u);
  });
});
