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
