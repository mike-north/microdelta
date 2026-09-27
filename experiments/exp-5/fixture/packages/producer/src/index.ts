/** The producer fixture exposes a record contract from the modeled Records aggregate. @packageDocumentation */

/** A stable record shape represented as a CML entity for correspondence only. @public */
export class RecordEntity {
  /** The record identity is fixture data, not a CML/TS name locator. */
  public constructor(public readonly id: string, public readonly label: string) {}

  /** Rename is the public operation represented by CML. @public */
  public rename(nextLabel: string): string { return nextLabel; }

  /** Package visibility maps to this own-package-only release contract. @internal */
  public _localCode(prefix: string): string { return `${prefix}:${this.id}`; }

  /** Native TS subclass visibility has no selected CML release-tier mapping. @public */
  protected childCode(): string { return this.id; }

  /** Native TS lexical privacy remains independent of CML package visibility. @public */
  private privateCode(): string { return this.id; }

  /** JavaScript hard privacy cannot be represented as a release tier. */
  #hardCode(): string { return this.privateCode(); }

  /** Keep privacy examples live without exposing them as separate contracts. */
  public inspectLocal(): string { return `${this.childCode()}:${this.#hardCode()}`; }
}

/** A standalone function is reported as unsupported CML correspondence. @public */
export function makeRecord(id: string, label: string): RecordEntity { return new RecordEntity(id, label); }

/** A standalone interface is reported as unsupported CML correspondence. @public */
export interface IRecordView { readonly label: string }

/** A standalone type alias is reported as unsupported CML correspondence. @public */
export type RecordId = string;

/** Preview release tier is independently tested by existing consumer gates. @beta */
export function betaRecord(): string { return 'beta'; }

/** Sibling release tier is independently tested by existing consumer gates. @alpha */
export function alphaRecord(): string { return 'alpha'; }

/** Internal helper is not claimed by the CML operation mapping. @internal */
export function _recordHint(): string { return 'hint'; }
