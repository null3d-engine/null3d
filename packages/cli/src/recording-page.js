// Serves a recording to the page that replays it, at an address of its own on the project's dev
// server. The file that a phone saved stays where it is, so a replay needs no copy into the
// project's folder.

/** The recording's address on the dev server. It has no file ending, so no file of the project hides it. */
export const RECORDING_PATH = '/@null3d/recording';

/**
 * The Vite plugin that serves `bytes` at [`RECORDING_PATH`].
 *
 * @param {Uint8Array} bytes
 * @returns {import('vite').Plugin}
 */
export function recordingPlugin(bytes) {
	return {
		name: 'null3d-recording',
		// Before Vite's own resolver, which would look for a file of the project at the address.
		enforce: 'pre',
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				if (req.url?.split('?')[0] !== RECORDING_PATH) return next();
				res.setHeader('Content-Type', 'application/octet-stream');
				res.setHeader('Content-Length', String(bytes.length));
				res.setHeader('Cache-Control', 'no-store');
				res.end(Buffer.from(bytes));
			});
		},
	};
}
