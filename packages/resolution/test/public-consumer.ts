import * as publicResolution from '@microdelta/resolution';

// A normal NodeNext consumer resolves the package name to its generated public rollup.
const publicPackage: object = publicResolution;
void publicPackage;

// @ts-expect-error: The Resolution constructor is project-private alpha and must stay hidden here.
publicResolution.createResolution;
