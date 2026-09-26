/**
 * Exact synthetic names rejected when deriving a step's name (NM-1 and NM-2).
 * Explicit overrides are intentional author declarations and bypass this list.
 * The array is frozen so tooling and callers share an immutable vocabulary.
 * @public
 */
export const syntheticNames: readonly string[] = Object.freeze(['', 'anonymous', 'default']);

/**
 * Prefixes identifying synthetic function names, including names made by bind.
 * Kept separate from exact names so a declared name such as `boundary` survives.
 * @public
 */
export const syntheticNamePrefixes: readonly string[] = Object.freeze(['bound ']);

/**
 * Return an explicit name or the non-synthetic name already declared by the author.
 *
 * An override is present whenever it is not `undefined`, including an empty string.
 * A missing, malformed, or inaccessible function name reports absence; callers
 * decide whether that absence is fatal. This operation never invokes the function.
 * Function names can change under minification, so authors must preserve names or
 * provide overrides when their build changes the names used for durable keys.
 *
 * @param fn - A function or class whose existing name should be inspected.
 * @param override - An author-supplied name that takes precedence over inference.
 * @returns The existing name, or `undefined` when no usable name is available.
 * @public
 */
export function nameOf(fn: Function, override?: string): string | undefined {
  if (override !== undefined) {
    return override;
  }

  // Callable proxies and configurable name accessors may throw even for a valid
  // Function. NM-1 assigns fatal-name decisions to callers, so report absence.
  try {
    const name: unknown = fn.name;
    if (typeof name !== 'string' || syntheticNames.includes(name)) {
      return undefined;
    }
    if (syntheticNamePrefixes.some((prefix: string): boolean => name.startsWith(prefix))) {
      return undefined;
    }
    return name;
  } catch {
    return undefined;
  }
}
