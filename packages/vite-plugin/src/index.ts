import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Connect, Plugin } from 'vite';

/** Headers that make a page cross-origin isolated, which shared memory and worker threads need. */
export const ISOLATION_HEADERS: Readonly<Record<string, string>> = {
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Embedder-Policy': 'require-corp',
};

/** Where `bun run dev-cert` writes the local HTTPS certificate. */
export const DEV_CERT_DIR = 'target/dev-cert';

export interface Null3dPluginOptions {
	/**
	 * Serve HTTPS on the local network with the certificate that `bun run dev-cert` makes. Phones
	 * and tablets reached over the network need HTTPS for shared memory and WebGPU.
	 */
	https?: boolean;
	/** Directory that holds `cert.pem` and `key.pem`; the default is `target/dev-cert` under the project root. */
	certDir?: string;
}

/** Sets the isolation headers on every response, including `.wasm` files and worker scripts. */
export const isolationMiddleware: Connect.NextHandleFunction = (_req, res, next) => {
	for (const [name, value] of Object.entries(ISOLATION_HEADERS)) res.setHeader(name, value);
	next();
};

function readCertificate(root: string, certDir: string): { cert: Buffer; key: Buffer } {
	const dir = resolve(root, certDir);
	const cert = resolve(dir, 'cert.pem');
	const key = resolve(dir, 'key.pem');
	if (!existsSync(cert) || !existsSync(key)) {
		throw new Error(`null3d: no HTTPS certificate in ${dir}. Run \`bun run dev-cert\` first.`);
	}
	return { cert: readFileSync(cert), key: readFileSync(key) };
}

/** The null3d Vite plugin: isolation headers on the dev and preview servers, and optional HTTPS. */
export default function null3d(options: Null3dPluginOptions = {}): Plugin {
	return {
		name: 'null3d',
		config(config, { mode }) {
			const root = config.root ?? process.cwd();
			const https = options.https
				? readCertificate(root, options.certDir ?? DEV_CERT_DIR)
				: undefined;
			return {
				// Development checks stay in dev builds; release builds drop them as dead code.
				define: { __NULL3D_DEV__: JSON.stringify(mode !== 'production') },
				server: { headers: { ...ISOLATION_HEADERS }, ...(https ? { https, host: true } : {}) },
				preview: { headers: { ...ISOLATION_HEADERS }, ...(https ? { https, host: true } : {}) },
				worker: { format: 'es' },
			};
		},
		configureServer(server) {
			server.middlewares.use(isolationMiddleware);
		},
		configurePreviewServer(server) {
			server.middlewares.use(isolationMiddleware);
		},
	};
}
