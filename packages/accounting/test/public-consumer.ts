import * as publicAccounting from '@microdelta/accounting';

// A normal NodeNext consumer resolves the package name to its generated public rollup.
const publicPackage: object = publicAccounting;
void publicPackage;

// @ts-expect-error: The accounting adapter is project-private alpha and must stay hidden here.
publicAccounting.openDurableAccounting;
