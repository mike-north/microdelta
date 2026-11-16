/** File-only freeze/gate logic pins reviewed source, emissions, binding and toolchain without loading native code. */
import { createHash } from 'node:crypto';
import { lstat, open, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { record } from './peer.js';
/** A file pin binds bytes, identity and exact pathname rather than trusting package version labels. @internal */
export interface IPin {
    readonly path: string;
    readonly bytes: number;
    readonly sha256: string;
}
/** A frozen build has separate source/emitted/declaration/config/native identities and a fixed output destination. @internal */
export interface IManifest {
    readonly issue: 302;
    readonly schema: 1;
    readonly root: string;
    readonly node: string;
    readonly execPath: string;
    readonly output: string;
    readonly entrypoints: IEntrypoints;
    readonly pins: readonly IPin[];
}
/** Canonical executable identities bind the outer launcher, child entry, coordinator and worker to one physical build. @internal */
export interface IEntrypoints {
    readonly launcher: string;
    readonly qualification: string;
    readonly coordinator: string;
    readonly worker: string;
}
/** One selected experimental build layout is shared by freezing and execution checks. */
const experimentDirectory = 'experiments/exp-wal-coordinated-snapshot';
/** Ordinary reviewed inputs retain the existing ceiling; toolchain bytes are hashed without retention. */
const inputFileCeiling = 64 * 1024 * 1024;
/** The supported Node executable is larger than source inputs; this ceiling does not expand retained proof allocation. */
const toolchainFileCeiling = 128 * 1024 * 1024;
/** Explicit installed constructor closure: no dependency discovery executes package or addon code. */
const bindingInputs = [
    ...['package.json', 'lib/index.js', 'lib/database.js', 'lib/util.js', 'lib/sqlite-error.js',
        ...['wrappers', 'transaction', 'pragma', 'backup', 'serialize', 'function', 'aggregate', 'table', 'inspect'].map(name => `lib/methods/${name}.js`),
        'src/objects/database.cpp', 'src/objects/statement.cpp', 'deps/sqlite3/sqlite3.c', 'build/Release/better_sqlite3.node'].map(file => join('node_modules/better-sqlite3', file)),
    'node_modules/bindings/package.json', 'node_modules/bindings/bindings.js',
    'node_modules/file-uri-to-path/package.json', 'node_modules/file-uri-to-path/index.js',
];
/** Root binds one selected author, replay or corrected start to exact frozen inputs; the literal purpose grants no retry authority. @internal */
export interface IRelease {
    readonly issue: 302;
    readonly purpose: 'author' | 'replay' | 'corrected';
    readonly manifestDigest: string;
    readonly token: string;
    readonly output: string;
    readonly expiresAt: string;
}
/** Canonical payload hashing is shared by file pins and the root-reviewed manifest digest. @internal */
export function sha(bytes: string | Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
/** Release validation is synchronous and refuses before any worker spawn/native import. @internal */
export function validateRelease(value: unknown, digest: string, output: string): IRelease { if (!record(value) || value.issue !== 302 || (value.purpose !== 'author' && value.purpose !== 'replay' && value.purpose !== 'corrected') || value.manifestDigest !== digest || !/^[a-f0-9]{64}$/u.test(digest) || typeof value.token !== 'string' || !/^[a-f0-9]{64}$/u.test(value.token) || value.output !== output || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now()) {
    throw new Error('Root invocation release missing, mismatched or expired');
} if (output !== `/private/tmp/issue302-native-${value.purpose}`) {
    throw new Error('Output is outside selected fixed root');
} return { issue: 302, purpose: value.purpose, manifestDigest: digest, token: value.token, output, expiresAt: value.expiresAt }; }
/** Recursive file inventory refuses symlinks and is bounded before hashing proof inputs. */
async function inventory(root: string, relativeDirectory: string): Promise<string[]> { const names = await readdir(join(root, relativeDirectory), { withFileTypes: true }); const files: string[] = []; for (const item of names) {
    if (item.name === 'node_modules' || item.name === '.test-build') {
        continue;
    }
    const filename = join(relativeDirectory, item.name);
    if (item.isSymbolicLink()) {
        throw new Error(`Freeze symlink ${filename}`);
    }
    if (item.isDirectory()) {
        files.push(...await inventory(root, filename));
    }
    else if (item.isFile()) {
        files.push(filename);
    }
    if (files.length > 512) {
        throw new Error('Freeze inventory quota exceeded');
    }
} return files; }
/** Hash one bounded regular file through its owned descriptor, rejecting changed identity/size and symlink redirection. */
async function pinFile(filename: string, maximumBytes: number): Promise<IPin> {
    const canonical = await realpath(filename);
    const before = await lstat(filename);
    if (canonical !== resolve(filename) || !before.isFile() || before.size > maximumBytes) {
        throw new Error(`Invalid pin file ${filename}`);
    }
    const handle = await open(filename, 'r');
    try {
        const opened = await handle.stat();
        if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size || !opened.isFile()) {
            throw new Error(`Frozen input identity changed: ${filename}`);
        }
        const hash = createHash('sha256');
        const chunk = Buffer.alloc(64 * 1024);
        let bytes = 0;
        while (true) {
            const read = await handle.read(chunk, 0, chunk.length, null);
            if (read.bytesRead === 0) {
                break;
            }
            bytes += read.bytesRead;
            if (bytes > maximumBytes || bytes > before.size) {
                throw new Error(`Frozen input grew: ${filename}`);
            }
            hash.update(chunk.subarray(0, read.bytesRead));
        }
        const after = await handle.stat();
        const pathname = await lstat(filename);
        if (bytes !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || pathname.dev !== before.dev || pathname.ino !== before.ino || pathname.size !== before.size || !pathname.isFile() || await realpath(filename) !== canonical) {
            throw new Error(`Frozen input changed while hashing: ${filename}`);
        }
        return { path: canonical, bytes, sha256: hash.digest('hex') };
    } finally {
        await handle.close();
    }
}
/** Pin reviewed source, emission or native binary bytes without executing their contents. @internal */
export async function pin(filename: string): Promise<IPin> { return pinFile(filename, inputFileCeiling); }

/** Only the fixed emitted executable locations can participate in this experiment's process tree. */
async function entrypoints(root: string): Promise<IEntrypoints> {
    const directory = join(root, '.test-build', experimentDirectory, 'node');
    const expected = { launcher: join(directory, 'launcher.js'), qualification: join(directory, 'qualification.js'), coordinator: join(directory, 'coordinator.js'), worker: join(directory, 'worker.js') };
    for (const path of Object.values(expected)) {
        if (await realpath(path) !== path) {
            throw new Error(`Executing entrypoint redirects outside physical build: ${path}`);
        }
    }
    return expected;
}

/** Presence is checked afresh: cached package resolution cannot hide a nearer package added after freezing. */
async function requireAbsent(filename: string, reason: string): Promise<void> {
    try { await lstat(filename); }
    catch (cause: unknown) {
        if (record(cause) && cause.code === 'ENOENT') { return; }
        throw cause;
    }
    throw new Error(`${reason}: ${filename}`);
}
/**
 * Bind one of the two fixed workspace ESM edges to its reviewed root link.
 * Node searches node_modules at every importer ancestor and may self-resolve from
 * the nearest package scope before that search. Reject every nearer package and
 * every intervening scope; the reviewed scope name/export map and root link then
 * determine the import-only target. This is a finite selection constraint, not
 * dependency discovery, and it runs again on completion verification.
 */
async function verifyWorkspaceEdge(root: string, importer: string, specifier: string, expectedScope: string): Promise<void> {
    const importingFile = join(root, importer), scope = resolve(root, expectedScope);
    if (await realpath(importingFile) !== importingFile) { throw new Error(`Workspace ESM importer physical identity mismatch: ${importer}`); }
    let directory = dirname(importingFile), foundScope = scope === root, ancestors = 0;
    while (directory !== root) {
        if (ancestors++ >= 5) { throw new Error('Workspace ESM importer exceeds fixed resolution corridor'); }
        await requireAbsent(join(directory, 'node_modules', specifier), 'Nearer workspace ESM package shadows reviewed root selection');
        if (directory === scope) { foundScope = true; }
        // The expected non-root scope dominates its own ancestors. Before it is reached, any scope can self-resolve the bare import.
        if (scope === root || !foundScope) { await requireAbsent(join(directory, 'package.json'), 'Unexpected workspace ESM package scope'); }
        directory = dirname(directory);
    }
    if (!foundScope) { throw new Error('Workspace ESM expected package scope was not reached'); }
}
/** Bind the selected CJS edges and both actual workspace ESM importer corridors without evaluating package code. */
async function verifyResolution(root: string): Promise<void> {
    // These selected CJS packages have one legacy entry each. Conditional ESM redirects would require another reviewed closure.
    for (const [name, main] of [['better-sqlite3', 'lib/index.js'], ['bindings', './bindings.js'], ['file-uri-to-path', 'index.js']] as const) {
        const metadata: unknown = JSON.parse(await readFile(join(root, 'node_modules', name, 'package.json'), 'utf8'));
        if (!record(metadata) || metadata.name !== name || metadata.main !== main || metadata.exports !== undefined || (metadata.type !== undefined && metadata.type !== 'commonjs')) {
            throw new Error(`Runtime package metadata escapes selected closure: ${name}`);
        }
    }
    const edges = [
        [join('.test-build', experimentDirectory, 'node/worker.js'), 'better-sqlite3', 'node_modules/better-sqlite3/lib/index.js'],
        ['packages/machine-node/dist/src/node/sqlite.js', 'better-sqlite3', 'node_modules/better-sqlite3/lib/index.js'],
        ['node_modules/better-sqlite3/lib/database.js', 'bindings', 'node_modules/bindings/bindings.js'],
        ['node_modules/bindings/bindings.js', 'file-uri-to-path', 'node_modules/file-uri-to-path/index.js'],
    ] as const;
    for (const [parent, specifier, target] of edges) {
        if (await realpath(createRequire(join(root, parent)).resolve(specifier)) !== join(root, target)) {
            throw new Error(`Runtime resolution mismatch: ${specifier} from ${parent}`);
        }
    }
    for (const name of ['machine', 'machine-node']) {
        const packageRoot = join(root, 'packages', name);
        const metadata: unknown = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
        if (!record(metadata) || metadata.name !== `@microdelta/${name}` || metadata.type !== 'module' || !record(metadata.exports) || !record(metadata.exports['.']) || JSON.stringify(Object.keys(metadata.exports['.'])) !== JSON.stringify(['types', 'import']) || metadata.exports['.'].import !== './dist/src/index.js' || await realpath(join(root, 'node_modules/@microdelta', name)) !== packageRoot) {
            throw new Error(`Workspace import resolution mismatch: ${name}`);
        }
    }
    const workspace: unknown = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    if (!record(workspace) || workspace.name !== '@microdelta/workspace' || workspace.type !== 'module') { throw new Error('Workspace ESM root package scope mismatch'); }
    await verifyWorkspaceEdge(root, join('.test-build', experimentDirectory, 'node/worker.js'), '@microdelta/machine-node', '.');
    await verifyWorkspaceEdge(root, 'packages/machine-node/dist/src/node/sqlite.js', '@microdelta/machine', 'packages/machine-node');
}

/** Freeze the finite selected JS/native-resolution closure; native loading remains exclusively a released worker operation. @internal */
export async function freeze(root: string, output: string): Promise<IManifest> {
    if (!process.version.startsWith('v24.')) {
        throw new Error('Qualification freeze requires supported Node24');
    }
    root = await realpath(root);
    const executing = await entrypoints(root);
    await verifyResolution(root);
    const files = await inventory(root, experimentDirectory);
    const inputs = [...files, ...files.filter(file => file.endsWith('.ts') && !file.includes('/test-d/')).flatMap(file => [join('.test-build', file.replace(/\.ts$/u, '.js')), join('.test-build', file.replace(/\.ts$/u, '.d.ts'))]),
        ...await inventory(root, join('.test-build', experimentDirectory)),
        'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.base.json', 'eslint.config.mjs', 'tooling/pr-ci-catalog.json', 'docs/plans/standalone-inspection.md', 'docs/spec/experiments.md', 'docs/spec/architecture.md', 'docs/spec/operations.md', 'docs/spec/acceptance.md',
        'packages/machine-node/package.json', 'packages/machine/package.json',
        ...await inventory(root, 'packages/machine-node/dist'), ...await inventory(root, 'packages/machine/dist'),
        ...bindingInputs, ...await inventory(root, 'node_modules/better-sqlite3/lib')];
    const unique = [...new Set(inputs)].sort();
    if (unique.length + 1 > 512) {
        throw new Error('Freeze inventory quota exceeded');
    }
    const execPath = await realpath(process.execPath);
    const pins: IPin[] = [];
    // Serial hashing bounds descriptors and transient buffers independently of the input inventory size.
    for (const file of unique) {
        pins.push(await pin(join(root, file)));
    }
    pins.push(await pinFile(execPath, toolchainFileCeiling));
    return { issue: 302, schema: 1, root, node: process.version, execPath, output, entrypoints: executing, pins };
}

/** Recheck every frozen byte and bind the caller's physical emitted tree before any relative coordinator import or spawn. @internal */
export async function verifyManifest(value: unknown, executingEntrypoint: string | URL = import.meta.url): Promise<IManifest> {
    if (!record(value) || value.issue !== 302 || value.schema !== 1 || typeof value.root !== 'string' || typeof value.execPath !== 'string' || value.node !== process.version || typeof value.output !== 'string' || !record(value.entrypoints) || !Array.isArray(value.pins) || value.pins.length === 0 || value.pins.length > 512) {
        throw new Error('Malformed frozen manifest');
    }
    const executingPath = await realpath(fileURLToPath(executingEntrypoint));
    const executingRoot = await realpath(resolve(dirname(executingPath), '../../../..'));
    const executingDirectory = join(executingRoot, '.test-build', experimentDirectory, 'node');
    if (value.root !== executingRoot || dirname(executingPath) !== executingDirectory || !['launcher.js', 'qualification.js', 'coordinator.js', 'freeze.js'].some(name => executingPath === join(executingDirectory, name))) {
        throw new Error('Manifest root does not match physical executing tree');
    }
    const expected = await entrypoints(executingRoot);
    if (JSON.stringify(value.entrypoints) !== JSON.stringify(expected)) {
        throw new Error('Manifest executing entrypoint identity mismatch');
    }
    if (value.execPath !== await realpath(process.execPath)) {
        throw new Error('Toolchain executable mismatch');
    }
    const pins: IPin[] = [];
    for (const item of value.pins) {
        if (!record(item) || typeof item.path !== 'string' || typeof item.bytes !== 'number' || !Number.isSafeInteger(item.bytes) || item.bytes < 0 || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(item.sha256)) {
            throw new Error('Malformed pin');
        }
        const actual = await pinFile(item.path, item.path === value.execPath ? toolchainFileCeiling : inputFileCeiling);
        if (actual.bytes !== item.bytes || actual.sha256 !== item.sha256) {
            throw new Error(`Frozen input changed: ${item.path}`);
        }
        pins.push(actual);
    }
    if (new Set(pins.map(p => p.path)).size !== pins.length) {
        throw new Error('Duplicate frozen pin');
    }
    const manifest: IManifest = { issue: 302, schema: 1, root: value.root, node: process.version, execPath: value.execPath, output: value.output, entrypoints: expected, pins };
    const required = await freeze(manifest.root, manifest.output);
    if (JSON.stringify(required) !== JSON.stringify(manifest)) {
        throw new Error('Manifest omits or reorders required frozen inputs');
    }
    return manifest;
}
/** Direct freeze invocation emits review material only; importing this module has no execution side effect. */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const destination = process.argv[2];
    const root = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
    if (!destination) {
        throw new Error('Expected manifest output pathname');
    }
    const manifest = await freeze(root, '/private/tmp/issue302-native-author');
    await writeFile(destination, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ manifest: destination, sha256: sha(JSON.stringify(manifest)), pins: manifest.pins.length, root: relative(process.cwd(), root) }));
}
