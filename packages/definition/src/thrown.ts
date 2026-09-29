/**
 * Diagnostics for values thrown by author callbacks that Definition invokes
 * (custom keys, slot subject functions) or by libraries it calls. Anything can
 * be thrown, including values with no string form or with hostile accessors,
 * so describing a thrown value must never run author code or throw itself:
 * the caller's own typed rejection must always be what escapes.
 */

/**
 * Describe a thrown value without running author code: an Error's own string
 * `message` data property, a thrown string, or the thrown value's type.
 * Inspection that itself throws (for example a revoked proxy) falls back to a
 * fixed detail.
 * @param error - Any thrown value.
 * @returns A diagnostic detail that is always a string.
 */
export function thrownDetail(error: unknown): string {
  try {
    if (error instanceof Error) {
      const message = Object.getOwnPropertyDescriptor(error, 'message');
      if (message !== undefined && 'value' in message && typeof message.value === 'string') {
        return message.value;
      }
    }
    return typeof error === 'string' ? error : `a thrown ${error === null ? 'null' : typeof error}`;
  } catch {
    return 'non-printable error';
  }
}
