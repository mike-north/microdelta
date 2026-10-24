/** The compiler policy is varied only through source text, never runtime monkeypatching. */
export function dependency(value: number): number {
  return value * 2;
}
