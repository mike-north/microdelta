/**
 * Node module-customization resolve hook for acceptance worker processes. It
 * redirects exactly one edge: the built facade's (`packages/core/dist/src`)
 * import of `@microdelta/machine-node` resolves to the harness's instrumented
 * host module, which re-exports the real Machine and clock and wraps the real
 * SQLite capability for observation and process-termination faults. Every
 * other import, including the instrumented module's own import of the real
 * adapter, resolves normally. The facade's code and API are unchanged.
 */

/** The instrumented host module this hook substitutes for the facade's adapter import. */
const instrumented = new URL('./instrumented-host.js', import.meta.url).href;

/** The resolution context Node passes to a resolve hook. */
interface IResolveContext {
  readonly parentURL?: string;
}

/** The result a resolve hook returns. */
interface IResolveResult {
  readonly url: string;
  readonly shortCircuit?: boolean;
}

/**
 * Resolve one specifier, substituting the instrumented host for the facade's adapter import only.
 * @param specifier - The imported specifier.
 * @param context - Node's resolution context.
 * @param nextResolve - The default resolver chain.
 * @returns The resolved module.
 */
export async function resolve(
  specifier: string,
  context: IResolveContext,
  nextResolve: (specifier: string, context: IResolveContext) => Promise<IResolveResult>,
): Promise<IResolveResult> {
  if (specifier === '@microdelta/machine-node' && context.parentURL?.includes('/packages/core/dist/src/') === true) {
    return { url: instrumented, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
