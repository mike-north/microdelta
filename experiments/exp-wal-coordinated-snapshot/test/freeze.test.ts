/** File-only release regressions exercise the installed inventory without loading an addon or starting a campaign. */
import { afterEach, expect, test } from '@jest/globals';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as nodeModule from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { freeze, verifyManifest } from '../node/freeze.js';

/** Independent expected inventory includes each executable constructor dependency and resolution authority. */
const runtimeFiles = [
    'node_modules/better-sqlite3/package.json',
    ...['index', 'database', 'util', 'sqlite-error'].map(name => `node_modules/better-sqlite3/lib/${name}.js`),
    ...['wrappers', 'transaction', 'pragma', 'backup', 'serialize', 'function', 'aggregate', 'table', 'inspect'].map(name => `node_modules/better-sqlite3/lib/methods/${name}.js`),
    'node_modules/better-sqlite3/src/objects/database.cpp',
    'node_modules/better-sqlite3/src/objects/statement.cpp',
    'node_modules/better-sqlite3/deps/sqlite3/sqlite3.c',
    'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
    'node_modules/bindings/package.json', 'node_modules/bindings/bindings.js',
    'node_modules/file-uri-to-path/package.json', 'node_modules/file-uri-to-path/index.js',
    'packages/machine/package.json', 'packages/machine-node/package.json',
];
/** The fixture preserves real source inventories and dependency metadata; generated files remain inert bytes. */
const experiment = 'experiments/exp-wal-coordinated-snapshot';
/** Each test owns its trees and removes them even when an assertion rejects the release. */
const trees: string[] = [];
afterEach(async () => { await Promise.all(trees.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

/** Mirror every experiment source emission required by the freezer without evaluating any copied module. */
async function emissions(root: string, directory: string): Promise<void> {
    for (const item of await readdir(join(root, directory), { withFileTypes: true })) {
        const path = join(directory, item.name);
        if (item.isDirectory()) {
            await emissions(root, path);
        } else if (path.endsWith('.ts') && !path.includes('/test-d/')) {
            for (const extension of ['.js', '.d.ts']) {
                const target = join(root, '.test-build', path.replace(/\.ts$/u, extension));
                await mkdir(dirname(target), { recursive: true });
                await writeFile(target, '// Inert generated fixture member.\n');
            }
        }
    }
}

/** Copy the checked-in and installed file contract; no runtime dependency is imported by fixture construction. */
async function fixture(): Promise<string> {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'issue302-freeze-')));
    trees.push(root);
    const checkout = process.cwd();
    const files = [...runtimeFiles, 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.base.json', 'eslint.config.mjs', 'tooling/pr-ci-catalog.json', 'docs/plans/standalone-inspection.md', 'docs/spec/experiments.md', 'docs/spec/architecture.md', 'docs/spec/operations.md', 'docs/spec/acceptance.md'];
    for (const file of files) {
        await mkdir(dirname(join(root, file)), { recursive: true });
        await cp(join(checkout, file), join(root, file));
    }
    for (const directory of [experiment, 'packages/machine/dist', 'packages/machine-node/dist']) {
        await mkdir(dirname(join(root, directory)), { recursive: true });
        await cp(join(checkout, directory), join(root, directory), { recursive: true });
    }
    await writeFile(join(root, experiment, 'node/launcher.ts'), '// Inert launcher fixture member.\n');
    await emissions(root, experiment);
    await mkdir(join(root, 'node_modules/@microdelta'), { recursive: true });
    for (const name of ['machine', 'machine-node']) {
        await symlink(join(root, 'packages', name), join(root, 'node_modules/@microdelta', name));
    }
    return root;
}

test('unchanged complete installed inventory can be frozen and accepted', async () => {
    const root = await fixture();
    const manifest = await freeze(root, '/private/tmp/issue302-native-author');
    expect(manifest.pins.map(pin => pin.path)).toEqual(expect.arrayContaining(runtimeFiles.map(file => join(root, file))));
    await expect(verifyManifest(manifest, pathToFileURL(join(root, '.test-build', experiment, 'node/qualification.js')))).resolves.toEqual(manifest);
});

test('a missing required reachable helper prevents producing a freeze', async () => {
    const root = await fixture();
    await rm(join(root, 'node_modules/better-sqlite3/lib/util.js'));
    await expect(freeze(root, '/private/tmp/issue302-native-author')).rejects.toThrow(/util\.js/u);
});

for (const file of ['node_modules/better-sqlite3/lib/util.js', 'node_modules/better-sqlite3/lib/methods/transaction.js', 'node_modules/bindings/bindings.js', 'node_modules/file-uri-to-path/index.js', 'packages/machine-node/package.json', 'packages/machine/package.json']) {
    test(`changed reachable input ${file} invalidates an existing freeze`, async () => {
        const root = await fixture();
        const manifest = await freeze(root, '/private/tmp/issue302-native-author');
        const original = await readFile(join(root, file), 'utf8');
        await writeFile(join(root, file), `${original}\n `);
        await expect(verifyManifest(manifest, pathToFileURL(join(root, '.test-build', experiment, 'node/qualification.js')))).rejects.toThrow(/Frozen input changed/u);
    });
}

test('a valid manifest from another physical tree cannot authorize this executing tree', async () => {
    const root = await fixture();
    const manifest = await freeze(root, '/private/tmp/issue302-native-author');
    // Both trees contain valid launcher paths; only the physical root differs.
    const other = await fixture();
    expect(resolve(root)).not.toBe(resolve(other));
    await expect(verifyManifest(manifest, pathToFileURL(join(other, '.test-build', experiment, 'node/qualification.js')))).rejects.toThrow(/executing|physical|root/iu);
});

test('a changed workspace import export map invalidates the frozen runtime selection', async () => {
    const root = await fixture();
    const manifest = await freeze(root, '/private/tmp/issue302-native-author');
    const filename = join(root, 'packages/machine-node/package.json');
    const original = await readFile(filename, 'utf8');
    expect(original).toContain('"import": "./dist/src/index.js"');
    await writeFile(filename, original.replace('"import": "./dist/src/index.js"', '"import": "./dist/src/other.js"'));
    await expect(verifyManifest(manifest, pathToFileURL(join(root, '.test-build', experiment, 'node/qualification.js')))).rejects.toThrow(/Frozen input changed/u);
});

test('an import-only package redirect cannot escape the finite pinned constructor closure', async () => {
    const root = await fixture();
    const filename = join(root, 'node_modules/better-sqlite3/package.json');
    const original = await readFile(filename, 'utf8');
    await writeFile(filename, original.replace('"main": "lib/index.js",', '"main": "lib/index.js", "exports": {".": {"import": "./unreviewed.js", "require": "./lib/index.js"}},'));
    await expect(freeze(root, '/private/tmp/issue302-native-author')).rejects.toThrow(/resolution|metadata|closure/iu);
});


/** The supported Node24 builtin is newer than Node20 declarations; validate its file-only boundary without asserting unchecked types. */
interface IFileOnlyPackageLookup {
    readonly findPackageJSON: (specifier: string, parent: URL) => unknown;
}
/** Node's package metadata lookup never imports the selected JavaScript or loads an addon. */
function packageLookup(value: unknown): value is IFileOnlyPackageLookup {
    return typeof value === 'object' && value !== null && 'findPackageJSON' in value && typeof value.findPackageJSON === 'function';
}
/** Confirm the actual ESM package selection from the actual importer URL, independently of freezer expectations. */
async function selectedPackage(specifier: string, importer: string): Promise<string> {
    if (!packageLookup(nodeModule)) { throw new Error('Supported Node24 file-only package metadata lookup unavailable'); }
    const selected = nodeModule.findPackageJSON(specifier, pathToFileURL(importer));
    if (typeof selected !== 'string') { throw new Error('Selected ESM package metadata absent'); }
    return await realpath(selected);
}
/** These are the complete finite ancestor corridors between each executing importer and the reviewed root workspace link. */
const workspaceEdges = [
    {
        name: 'machine-node', importer: join('.test-build', experiment, 'node/worker.js'),
        nearer: [join('.test-build', experiment, 'node'), join('.test-build', experiment), '.test-build/experiments', '.test-build'],
    },
    {
        name: 'machine', importer: 'packages/machine-node/dist/src/node/sqlite.js',
        nearer: ['packages/machine-node/dist/src/node', 'packages/machine-node/dist/src', 'packages/machine-node/dist', 'packages/machine-node', 'packages'],
    },
] as const;
/** A valid import-only nearer package can win ESM lookup while all root workspace links and package maps remain unchanged. */
async function shadow(root: string, directory: string, name: string): Promise<string> {
    const packageRoot = join(root, directory, 'node_modules/@microdelta', name);
    await mkdir(packageRoot, { recursive: true });
    await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: `@microdelta/${name}`, type: 'module', exports: { '.': { import: './shadow.js' } } }));
    await writeFile(join(packageRoot, 'shadow.js'), '// Inert ESM shadow; metadata tests never import this file.\nexport const marker = "shadow";\n');
    return join(packageRoot, 'package.json');
}

test('unchanged import-only workspace packages resolve from both executing importer parents to the reviewed physical metadata', async () => {
    const root = await fixture();
    for (const edge of workspaceEdges) {
        await expect(selectedPackage(`@microdelta/${edge.name}`, join(root, edge.importer))).resolves.toBe(join(root, 'packages', edge.name, 'package.json'));
    }
    const manifest = await freeze(root, '/private/tmp/issue302-native-author');
    await expect(verifyManifest(manifest, pathToFileURL(join(root, '.test-build', experiment, 'node/qualification.js')))).resolves.toEqual(manifest);
});

for (const edge of workspaceEdges) {
    for (const directory of edge.nearer) {
        test(`a valid import-only ${edge.name} shadow at ${directory} refuses freeze before it can authorize a different ESM target`, async () => {
            const root = await fixture();
            const selected = await shadow(root, directory, edge.name);
            await expect(selectedPackage(`@microdelta/${edge.name}`, join(root, edge.importer))).resolves.toBe(selected);
            await expect(freeze(root, '/private/tmp/issue302-native-author')).rejects.toThrow(/workspace|shadow|resolution|scope/iu);
        });

        test(`an import-only ${edge.name} shadow added at ${directory} invalidates an unchanged manifest`, async () => {
            const root = await fixture();
            const manifest = await freeze(root, '/private/tmp/issue302-native-author');
            const selected = await shadow(root, directory, edge.name);
            await expect(selectedPackage(`@microdelta/${edge.name}`, join(root, edge.importer))).resolves.toBe(selected);
            await expect(verifyManifest(manifest, pathToFileURL(join(root, '.test-build', experiment, 'node/qualification.js')))).rejects.toThrow(/workspace|shadow|resolution|scope/iu);
        });
    }

    test(`an import-only nearer package self-scope cannot redirect ${edge.name} before freeze`, async () => {
        const root = await fixture();
        const directory = dirname(join(root, edge.importer));
        const metadata = join(directory, 'package.json');
        await writeFile(metadata, JSON.stringify({ name: `@microdelta/${edge.name}`, type: 'module', exports: { '.': { import: './self.js' } } }));
        await writeFile(join(directory, 'self.js'), '// Inert ESM self-scope; never imported.\nexport const marker = "self";\n');
        await expect(selectedPackage(`@microdelta/${edge.name}`, join(root, edge.importer))).resolves.toBe(metadata);
        await expect(freeze(root, '/private/tmp/issue302-native-author')).rejects.toThrow(/workspace|shadow|resolution|scope/iu);
    });
}
