/**
 * This fixture deliberately imitates Tracking's public brand shape so lint
 * tests can prove that a matching name and property do not convey authority.
 */

/** The same-named brand belongs only to this fixture, not to Tracking. @alpha */
export interface ITrackedBrand {
  readonly __microdeltaTracked: unique symbol;
}

/** A fake tracked view whose unique symbol is intentionally distinct. @alpha */
export type ITracked<T extends object> = T & ITrackedBrand;

/** A fixture value used only to verify that lookalike brands remain untrusted. @alpha */
export declare const forged: ITracked<{ readonly value: number }>;

/** The same-named declared-call brand belongs only to this fixture, not to Definition. @alpha */
export interface IDeclaredCallBrand {
  readonly __microdeltaDeclaredCall: unique symbol;
}

/** A fake declared child handle whose brand is intentionally distinct from Definition's. @alpha */
export type IDeclaredCallHandle<T> = (() => Promise<{ readonly data: T }>) & IDeclaredCallBrand;

/** A fixture handle used only to verify that lookalike handle brands remain untrusted. @alpha */
export declare const forgedHandle: IDeclaredCallHandle<number>;

/** Options with the same spelling as Definition's memo declaration. @alpha */
export interface IForgedMemoOptions {
  readonly subject: string;
  readonly run: () => unknown;
}

/** A same-spelled unrelated API; its callback is not a Definition capture boundary. @alpha */
export declare function memo(options: IForgedMemoOptions): IForgedMemoOptions;
