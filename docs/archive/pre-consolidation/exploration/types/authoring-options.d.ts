/**
 * Independent authoring-surface experiments, not approved microdelta APIs.
 * These ambient declarations have no runtime implementation or package exports.
 * @internal
 */

declare const keyBagValue: unique symbol;
declare const referenceBagValue: unique symbol;

/** Candidate A: awaiting a property handle resolves the represented value. @internal */
export namespace PropertyPromises {
  /**
   * Arrays expose indexed handles and a length handle, rather than masquerading
   * as native arrays whose length would have type number. Objects expose fields.
   * @internal
   */
  type Members<T> = T extends readonly (infer Item)[]
    ? { readonly [index: number]: Handle<Item>; readonly length: Handle<number> }
    : T extends object ? { readonly [Key in keyof T]: Handle<T[Key]> } : unknown;

  /** PromiseLike values compose with await and native Promise.all. @internal */
  export type Handle<T> = PromiseLike<T> & Members<T>;
}

/** Candidate B: select typed field keys from one source handle. @internal */
export namespace KeyBag {
  /** Nested objects and array metadata remain unresolved source handles. @internal */
  type Members<T> = T extends readonly (infer Item)[]
    ? { readonly [index: number]: Handle<Item>; readonly length: Handle<number> }
    : T extends object ? { readonly [Key in keyof T]: Handle<T[Key]> } : unknown;

  /** The private brand carries the source value type without being thenable. @internal */
  export type Handle<T> = { readonly [keyBagValue]: T } & Members<T>;

  /**
   * An inline ordinary key array infers its exact field union via a const generic.
   * A pre-widened key array can lose that precision; the experiment tests this.
   * @internal
   */
  export function readFields<T, const Keys extends readonly (keyof T)[]>(
    source: Handle<T>, keys: Keys,
  ): Promise<Pick<T, Keys[number]>>;
}

/** Candidate C: collect named references before issuing one resolution request. @internal */
export namespace ReferenceBag {
  /** Field access only constructs another typed reference. @internal */
  type Members<T> = T extends readonly (infer Item)[]
    ? { readonly [index: number]: Ref<Item>; readonly length: Ref<number> }
    : T extends object ? { readonly [Key in keyof T]: Ref<T[Key]> } : unknown;

  /** Nonthenable references carry their value type under a private brand. @internal */
  export type Ref<T> = { readonly [referenceBagValue]: T } & Members<T>;

  /** Infer the resolved value independently of nested reference members. @internal */
  type Value<Reference> = Reference extends { readonly [referenceBagValue]: infer T } ? T : never;

  /** A resolver creates a fresh bag or tuple of values; nested value types survive. @internal */
  type Resolved<Bag> = { -readonly [Key in keyof Bag]: Value<Bag[Key]> };

  /** Resolve a cross-source record of references while preserving caller keys. @internal */
  export function read<const Bag extends Record<string, Ref<unknown>>>(bag: Bag): Promise<Resolved<Bag>>;

  /** Optional positional variant: const inference preserves inline tuple members. @internal */
  export function read<const Items extends readonly Ref<unknown>[]>(items: Items): Promise<Resolved<Items>>;
}
