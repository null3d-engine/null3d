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
