import { expectError, expectNotAssignable, expectType } from 'tsd';

import { KeyBag, ReferenceBag } from './authoring-options.js';
import type { PropertyPromises } from './authoring-options.js';

/** The same user-owned data schema exercises each independent proposal. */
interface PR {
  title: string;
  body: string;
  reviews: readonly { author: string; body: string }[];
  author: { login: string };
}

interface Rubric { prompt: string }

declare const promisedPR: PropertyPromises.Handle<PR>;
declare const promisedRubric: PropertyPromises.Handle<Rubric>;
declare const keyedPR: KeyBag.Handle<PR>;
declare const keyedRubric: KeyBag.Handle<Rubric>;
declare const referencedPR: ReferenceBag.Ref<PR>;
declare const referencedRubric: ReferenceBag.Ref<Rubric>;

// A: property handles are PromiseLike, including nested fields and array length.
expectType<PR>(await promisedPR);
expectType<string>(await promisedPR.title);
expectType<string>(await promisedPR.author.login);
expectType<number>(await promisedPR.reviews.length);
expectType<PR['reviews']>(await promisedPR.reviews);
expectNotAssignable<string>(promisedPR.title);
expectNotAssignable<number>(promisedPR.reviews.length);
expectError(promisedPR.titel);
expectError(promisedPR.author.logni);

/** A normal function can select handles, but its returned object is not thenable. */
function selectPromised(pr: PropertyPromises.Handle<PR>, rubric: PropertyPromises.Handle<Rubric>) {
  return { title: pr.title, body: pr.body, prompt: rubric.prompt };
}

const promisedBag = selectPromised(promisedPR, promisedRubric);
expectType<PropertyPromises.Handle<string>>(promisedBag.title);
expectType<typeof promisedBag>(await promisedBag);
expectType<[string, string, string]>(await Promise.all([promisedBag.title, promisedBag.body, promisedBag.prompt]));

// B: a normal literal key array infers its selected fields without a const cast.
expectType<Promise<Pick<PR, 'title' | 'body'>>>(KeyBag.readFields(keyedPR, ['title', 'body']));
expectType<Promise<Pick<PR, 'title'>>>(KeyBag.readFields(keyedPR, ['title', 'title']));
expectType<Promise<Pick<PR, never>>>(KeyBag.readFields(keyedPR, []));
expectType<Promise<{ login: string }>>(KeyBag.readFields(keyedPR.author, ['login']));
expectType<KeyBag.Handle<string>>(keyedPR.author.login);
expectType<KeyBag.Handle<number>>(keyedPR.reviews.length);
expectNotAssignable<number>(keyedPR.reviews.length);
expectType<Promise<Pick<PR['reviews'], 'length'>>>(KeyBag.readFields(keyedPR.reviews, ['length']));
expectError(KeyBag.readFields(keyedPR, ['titel']));
expectError(KeyBag.readFields(keyedPR.author, ['logni']));
expectError(keyedPR.author.logni);
expectError(keyedPR.title.then);

/** A helper returning an ordinary reference bag does not produce a source handle. */
function selectKeyed(pr: KeyBag.Handle<PR>, rubric: KeyBag.Handle<Rubric>) {
  return { title: pr.title, body: pr.body, prompt: rubric.prompt };
}

const keyedBag = selectKeyed(keyedPR, keyedRubric);
expectError(KeyBag.readFields(keyedBag, ['title', 'body', 'prompt']));
expectType<[Pick<PR, 'title' | 'body'>, Pick<Rubric, 'prompt'>]>(
  await Promise.all([KeyBag.readFields(keyedPR, ['title', 'body']), KeyBag.readFields(keyedRubric, ['prompt'])]),
);
const widenedKeys = ['title', 'body'];
expectError(KeyBag.readFields(keyedPR, widenedKeys));
const typedKeys: (keyof PR)[] = ['title', 'body'];
expectType<Promise<Pick<PR, keyof PR>>>(KeyBag.readFields(keyedPR, typedKeys));

// C: keys belong to the caller's result bag and refs may cross source boundaries.
expectType<Promise<{ title: string; body: string; prompt: string }>>(
  ReferenceBag.read({ title: referencedPR.title, body: referencedPR.body, prompt: referencedRubric.prompt }),
);
expectType<Promise<{ writer: string; reviewCount: number }>>(
  ReferenceBag.read({ writer: referencedPR.author.login, reviewCount: referencedPR.reviews.length }),
);
expectType<ReferenceBag.Ref<number>>(referencedPR.reviews.length);
expectNotAssignable<number>(referencedPR.reviews.length);
expectType<Promise<{ reviews: PR['reviews'] }>>(ReferenceBag.read({ reviews: referencedPR.reviews }));
expectType<Promise<Record<never, never>>>(ReferenceBag.read({}));
expectError(referencedPR.titel);
expectError(referencedPR.author.logni);
expectError(ReferenceBag.read({ title: 'already resolved' }));
expectError(ReferenceBag.read({ title: promisedPR.title }));
expectError(ReferenceBag.read({ title: keyedPR.title }));
expectError(referencedPR.title.then);
expectType<ReferenceBag.Ref<string>>(await referencedPR.title);

/** Ordinary synchronous helpers compose references without resolving any values. */
function selectReferences(pr: ReferenceBag.Ref<PR>, rubric: ReferenceBag.Ref<Rubric>) {
  return { title: pr.title, body: pr.body, prompt: rubric.prompt };
}

expectType<Promise<{ title: string; body: string; prompt: string }>>(
  ReferenceBag.read(selectReferences(referencedPR, referencedRubric)),
);
const immutableBag: { readonly title: ReferenceBag.Ref<string> } = { title: referencedPR.title };
expectType<Promise<{ title: string }>>(ReferenceBag.read(immutableBag));

// C's optional positional overload preserves heterogeneous tuples without casts.
expectType<Promise<[string, number, string]>>(
  ReferenceBag.read([referencedPR.title, referencedPR.reviews.length, referencedRubric.prompt]),
);
const [title, reviewCount, prompt] = await ReferenceBag.read([
  referencedPR.title, referencedPR.reviews.length, referencedRubric.prompt,
]);
expectType<string>(title);
expectType<number>(reviewCount);
expectType<string>(prompt);
expectError(ReferenceBag.read([referencedPR.title, 'not a reference']));
