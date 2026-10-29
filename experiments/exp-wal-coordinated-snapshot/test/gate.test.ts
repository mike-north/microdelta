/** Release validation is pure: in-memory dummy values never become a token file, output directory or campaign start. */
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { validateRelease } from '../node/freeze.js';

/** A fixed test clock makes exact expiry refusal independent of wall-clock scheduling. */
const now = Date.UTC(2026, 9, 28, 22, 57);
/** These dummy digests cannot identify the actual frozen candidate and are never persisted as releases. */
const digest = 'a'.repeat(64);
beforeEach(() => { jest.spyOn(Date, 'now').mockReturnValue(now); });
afterEach(() => { jest.restoreAllMocks(); });
/** Purpose/path data remains unknown at the same boundary used by the actual launcher. */
function release(purpose: string, output = `/private/tmp/issue302-native-${purpose}`): Record<string, unknown> {
    return { issue: 302, purpose, manifestDigest: digest, token: 'b'.repeat(64), output, expiresAt: new Date(now + 60_000).toISOString() };
}

test('missing or malformed release shapes refuse synchronously', () => {
    for (const value of [undefined, {}, { issue: 302, purpose: 'author', manifestDigest: 'wrong' }, { issue: 302, purpose: 'replay', manifestDigest: digest, token: 'x', output: '/tmp/elsewhere' }]) {
        expect(() => validateRelease(value, digest, '/private/tmp/issue302-native-author')).toThrow();
    }
});
for (const purpose of ['author', 'replay', 'corrected']) {
    test(`${purpose} accepts only its literal selected fixed destination and exact release bindings`, () => {
        const value = release(purpose);
        expect(validateRelease(value, digest, `/private/tmp/issue302-native-${purpose}`)).toEqual(value);
    });
}
for (const purpose of ['retry', 'corrected-again', 'CORRECTED', '', 'arbitrary']) {
    test(`unknown purpose ${JSON.stringify(purpose)} cannot authorize the corrected destination`, () => {
        expect(() => validateRelease(release(purpose, '/private/tmp/issue302-native-corrected'), digest, '/private/tmp/issue302-native-corrected')).toThrow();
    });
}
for (const [name, patch] of [
    ['different issue', { issue: 303 }],
    ['different digest', { manifestDigest: 'c'.repeat(64) }],
    ['missing token', { token: undefined }],
    ['malformed token', { token: 'z'.repeat(64) }],
    ['short token', { token: 'b'.repeat(63) }],
    ['expired', { expiresAt: new Date(now - 1).toISOString() }],
    ['exact expiry', { expiresAt: new Date(now).toISOString() }],
    ['invalid expiry', { expiresAt: 'not a date' }],
    ['non-string expiry', { expiresAt: now + 60_000 }],
    ['different bound output', { output: '/private/tmp/issue302-native-author' }],
] as const) {
    test(`corrected refuses ${name} while all other supplied fields match`, () => {
        expect(() => validateRelease({ ...release('corrected'), ...patch }, digest, '/private/tmp/issue302-native-corrected')).toThrow();
    });
}
for (const output of ['/private/tmp/arbitrary', '/tmp/issue302-native-corrected', '/private/tmp/issue302-native-author', '/private/tmp/issue302-native-replay', '/private/tmp/issue302-native-corrected/../issue302-native-corrected']) {
    test(`corrected refuses alternate path ${output} even when configuration and requested path agree`, () => {
        expect(() => validateRelease(release('corrected', output), digest, output)).toThrow();
    });
}
test('matching malformed digest is not an escape from manifest binding', () => {
    expect(() => validateRelease({ ...release('corrected'), manifestDigest: 'not-a-hash' }, 'not-a-hash', '/private/tmp/issue302-native-corrected')).toThrow();
});
