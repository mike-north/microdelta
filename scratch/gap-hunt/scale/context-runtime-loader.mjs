/** Optional read-only runtime comparison; generated consumer code remains unchanged. */
import { pathToFileURL } from 'node:url';
export function resolve(specifier, context, nextResolve) {
  if (specifier === 'microdelta' && process.env.CONTEXT_MICRODELTA !== undefined) return nextResolve(pathToFileURL(process.env.CONTEXT_MICRODELTA).href, context);
  return nextResolve(specifier, context);
}
