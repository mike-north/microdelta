import * as publicMaterialization from '@microdelta/materialization';

// A normal NodeNext consumer resolves the package name to its generated public rollup.
const publicPackage: object = publicMaterialization;
void publicPackage;

// @ts-expect-error: The selected materialization constructor is alpha and must stay hidden here.
publicMaterialization.createMaterialization;
