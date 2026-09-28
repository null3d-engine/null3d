import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import MagicString from 'magic-string';
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
	 * Serve HTTPS on the local network with the certificate in `certDir`, such as one made with
	 * mkcert. Phones and tablets reached over the network need HTTPS for shared memory and WebGPU.
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
		throw new Error(
			`null3d: no HTTPS certificate in ${dir}. Put cert.pem and key.pem there, or set certDir to their folder. Docs: getting-started/hosting.`,
		);
	}
	return { cert: readFileSync(cert), key: readFileSync(key) };
}

/** A script that a page passes by address, such as `new URL('./game.ts', import.meta.url)`. */
const SCRIPT_URL =
	/new\s+URL\(\s*(['"])(\.{1,2}\/[^'"]+?\.[cm]?[jt]sx?)\1\s*,\s*import\.meta\.url\s*\)/g;

/** Text just before a script address that a worker constructor takes; Vite builds those itself. */
const WORKER_BEFORE = /new\s+(?:Shared)?Worker\(\s*$/;

/** The engine core's files, which every production build ships. */
export const CORE_FILES = [
	'threaded/null3d.js',
	'threaded/null3d_bg.wasm',
	'threaded/null3d_memory.json',
	'single/null3d.js',
	'single/null3d_bg.wasm',
];

/** True for a game module: a script that calls `defineGame`. */
function isGameModule(path: string): boolean {
	return existsSync(path) && readFileSync(path, 'utf8').includes('defineGame(');
}

/**
 * The core files missing from the installed engine package, or null when the project does not
 * install the engine.
 */
export function missingCoreFiles(root: string): string[] | null {
	const require = createRequire(resolve(root, 'package.json'));
	try {
		require.resolve('@null3d/engine');
	} catch {
		return null;
	}
	return CORE_FILES.filter((file) => {
		try {
			require.resolve(`@null3d/engine/wasm/${file}`);
			return false;
		} catch {
			return true;
		}
	});
}

/**
 * The null3d Vite plugin: isolation headers on the dev and preview servers, optional HTTPS, and a
 * production build that compiles each game module and ships the engine core.
 */
export default function null3d(options: Null3dPluginOptions = {}): Plugin {
	let building = false;
	let root = process.cwd();
	return {
		name: 'null3d',
		// Runs before Vite's own asset handling, which would copy a game file as raw text.
		enforce: 'pre',
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
				// A prebundled copy of the engine would lose the addresses of its workers and core files.
				optimizeDeps: { exclude: ['@null3d/engine'] },
			};
		},
		configResolved(config) {
			building = config.command === 'build';
			root = config.root;
		},
		buildStart() {
			if (!building) return;
			const missing = missingCoreFiles(root);
			if (missing && missing.length > 0) {
				this.error(
					`null3d: the installed @null3d/engine lacks its WebAssembly core (${missing.join(', ')}). Reinstall the package; in a copy of the engine's source, run bun run build first.`,
				);
			}
		},
		async transform(code, id) {
			if (!building || id.includes('/node_modules/') || !code.includes('import.meta.url')) return;
			let out: MagicString | undefined;
			for (const match of code.matchAll(SCRIPT_URL)) {
				const start = match.index;
				if (WORKER_BEFORE.test(code.slice(Math.max(0, start - 40), start))) continue;
				const script = await this.resolve(match[2] ?? '', id);
				if (!script || !isGameModule(script.id)) continue;
				// The game worker imports the compiled module by this address.
				const ref = this.emitFile({ type: 'chunk', id: script.id, preserveSignature: 'strict' });
				out ??= new MagicString(code);
				out.overwrite(
					start,
					start + match[0].length,
					`new URL(import.meta.ROLLUP_FILE_URL_${ref}, import.meta.url)`,
				);
			}
			return out
				? { code: out.toString(), map: out.generateMap({ hires: 'boundary' }) }
				: undefined;
		},
		configureServer(server) {
			server.middlewares.use(isolationMiddleware);
		},
		configurePreviewServer(server) {
			server.middlewares.use(isolationMiddleware);
		},
	};
}
