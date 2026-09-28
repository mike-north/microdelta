import * as publicSupervision from '@microdelta/supervision';

// A normal NodeNext consumer resolves the package name to its generated public rollup.
const publicPackage: object = publicSupervision;
void publicPackage;

// @ts-expect-error: The Supervision constructor is project-private alpha and must stay hidden here.
publicSupervision.createSupervision;
