// The strict Content-Security-Policy that a WebAssembly app usually sends, which the engine must
// start under: every file from the page's own origin, WebAssembly allowed, and no other code. The
// hosting guide gives the same policy.

/**
 * The strict policy. Inline styles are allowed only because the test pages hold style elements;
 * the engine itself sets styles through the CSSOM, which no policy blocks.
 */
export const STRICT_POLICY =
	"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline'";

/** The strict policy without `'wasm-unsafe-eval'`, which stops every WebAssembly compile. */
export const POLICY_WITHOUT_WASM = STRICT_POLICY.replace(" 'wasm-unsafe-eval'", '');

/**
 * The strict policy, with data: in connect-src for the test pages' small asset files, which the
 * build makes into data: addresses, as Vite does with a project's small files.
 */
export const STRICT_POLICY_WITH_DATA = `${STRICT_POLICY}; connect-src 'self' data:`;
