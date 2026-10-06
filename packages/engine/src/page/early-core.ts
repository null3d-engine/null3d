// Starts the engine core's download as soon as the page's HTML arrives. The null3D Vite plugin adds
// this module to each built page whose scripts load the core, as a script of its own with no
// imports, so it runs one round trip after the HTML. The page's own scripts arrive in that same round
// trip but run only once all of them have downloaded, so the core would otherwise wait for them. The
// module picks the build as createEngine does, and leaves the response for the core's loader, which
// compiles it as it streams in. A page that never starts the engine leaves the response unread.
//
// It imports only a constant, which the bundler folds in, so the built file imports nothing and has
// nothing else to wait for. The loader keeps its own copy of the slot's name, and a test checks that
// the two agree.

import { URL_SWITCHES } from '../shared/dev';

/** Where the response waits for the loader: a slot on the page's global object. */
const SLOT = Symbol.for('null3d.early-core');

const threaded =
	globalThis.crossOriginIsolated === true &&
	typeof SharedArrayBuffer === 'function' &&
	!(
		URL_SWITCHES && new URLSearchParams(globalThis.location?.search ?? '').get('threads') === 'off'
	);
const url = threaded
	? new URL('../../dist/wasm/threaded/null3d_bg.wasm', import.meta.url)
	: new URL('../../dist/wasm/single/null3d_bg.wasm', import.meta.url);
const response = fetch(url);
// A failed download surfaces when the loader takes the response, not as an unhandled rejection now.
response.catch(() => {});
(globalThis as Record<symbol, unknown>)[SLOT] = { url: url.href, response };
