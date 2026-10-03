import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { relative, resolve, sep } from 'node:path';
import MagicString from 'magic-string';
import type { Connect, Plugin } from 'vite';
import { writeWgslDeclaration } from './declarations.ts';
import { compileTaggedWgsl, compileWgslFile, WGSL_TAG } from './wgsl.ts';

export type * from './shader-types.ts';

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
	/**
	 * Write a TypeScript declaration beside each `.wgsl` file that a module imports, such as
	 * `glow.wgsl.d.ts` beside `glow.wgsl`, with the types of the file's uniforms. The default is
	 * true. Set it to false in a project without TypeScript.
	 */
	wgslDeclarations?: boolean;
}

/** Sets the isolation headers on every response, including `.wasm` files and worker scripts. */
export const isolationMiddleware: Connect.NextHandleFunction = (_req, res, next) => {
	for (const [name, value] of Object.entries(ISOLATION_HEADERS)) res.setHeader(name, value);
	next();
};

/** Build files whose names carry a content hash, which never change under that name. */
const HASHED_ASSET = /^\/assets\/[^/?]+-[\w-]{8}\.\w+(\?|$)/;

/**
 * Lets the browser keep hashed build files, as a host should. Each engine thread loads its own copy
 * of its script and the core's loader; without this, the browser checks each copy with the server
 * in turn, one round trip per thread.
 */
export const immutableAssetsMiddleware: Connect.NextHandleFunction = (req, res, next) => {
	if (HASHED_ASSET.test(req.url ?? ''))
		res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
	next();
};

/**
 * The HTTPS server's settings: the certificate, and HTTP/1.1 only. Vite serves HTTPS over HTTP/2,
 * where Safari on iPad sometimes stalls while a worker loads its modules: a development server
 * sends each module as its own file, and every engine thread loads its own copies.
 */
function httpsOptions(certificate: { cert: Buffer; key: Buffer }) {
	return { ...certificate, ALPNCallback: () => 'http/1.1' };
}

function readCertificate(root: string, certDir: string): { cert: Buffer; key: Buffer } {
	const dir = resolve(root, certDir);
	const cert = resolve(dir, 'cert.pem');
	const key = resolve(dir, 'key.pem');
	if (!existsSync(cert) || !existsSync(key)) {
		throw new Error(
			`null3D: no HTTPS certificate in ${dir}. Put cert.pem and key.pem there, or set certDir to their folder. Docs: getting-started/hosting.`,
		);
	}
	return { cert: readFileSync(cert), key: readFileSync(key) };
}

/** A script that a page passes by address, such as `new URL('./sketch.ts', import.meta.url)`. */
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

/** True for a sketch module: a script that calls `defineSketch`. */
function isSketchModule(path: string): boolean {
	return existsSync(path) && readFileSync(path, 'utf8').includes('defineSketch(');
}

/** A WGSL file that a module imports, without a query such as `?raw`. */
const WGSL_FILE = /\.wgsl$/;

/** A script module, whose code the plugin parses for tagged WGSL. */
const SCRIPT_FILE = /\.[cm]?[jt]sx?$/;

/** Modules of installed packages, which the plugin leaves as they are. */
const PACKAGE_MODULE = /\/node_modules\//;

/** A file's path from the project's root, as messages name it. */
function projectPath(root: string, file: string): string {
	return relative(root, file).split(sep).join('/');
}

/** A compiled shader as the JavaScript value that takes its source's place. */
function shaderValue(shader: unknown): string {
	return `(${JSON.stringify(shader)})`;
}

/**
 * The core files missing from the installed engine package, or null when the project does not
 * install the engine.
 */
export function missingCoreFiles(root: string): string[] | null {
	const require = createRequire(resolve(root, 'package.json'));
	try {
		require.resolve('@null3d/engine/package.json');
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
 * The null3D Vite plugin: isolation headers on the dev and preview servers, optional HTTPS, WGSL
 * compiled for WebGPU and WebGL2 in dev and in builds, and a production build that compiles each
 * sketch module and ships the engine core.
 */
export default function null3d(options: Null3dPluginOptions = {}): Plugin {
	let building = false;
	let root = process.cwd();
	return {
		name: 'null3d',
		// Runs before Vite's own asset handling, which would copy a sketch file as raw text, and
		// before TypeScript becomes JavaScript, so tagged WGSL sits where the source file has it.
		enforce: 'pre',
		config(config, { mode }) {
			const root = config.root ?? process.cwd();
			const https = options.https
				? httpsOptions(readCertificate(root, options.certDir ?? DEV_CERT_DIR))
				: undefined;
			return {
				// Development checks stay in dev builds; release builds drop them as dead code.
				define: { __NULL3D_DEV__: JSON.stringify(mode !== 'production') },
				server: { headers: { ...ISOLATION_HEADERS }, ...(https ? { https, host: true } : {}) },
				preview: { headers: { ...ISOLATION_HEADERS }, ...(https ? { https, host: true } : {}) },
				worker: { format: 'es' },
				// A prebundled copy of the engine would lose the addresses of its workers and core files.
				// The meshopt decoder is a plain module that the glTF worker imports on first use; a
				// prebundle found that late would reload the page.
				optimizeDeps: { exclude: ['@null3d/engine', 'meshoptimizer'] },
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
					`null3D: the installed @null3d/engine lacks its WebAssembly core (${missing.join(', ')}). Reinstall the package; in a copy of the engine's source, run bun run build first.`,
				);
			}
		},
		load: {
			filter: { id: { include: WGSL_FILE, exclude: /^\0/ } },
			handler(id) {
				const compiled = compileWgslFile(projectPath(root, id), id, readFileSync(id, 'utf8'));
				if ('error' in compiled) return this.error(compiled.error);
				if (options.wgslDeclarations !== false && !PACKAGE_MODULE.test(id)) {
					try {
						writeWgslDeclaration(id, compiled.shader);
					} catch (e) {
						this.warn(
							`null3D could not write the types of ${projectPath(root, id)} beside it (${(e as Error).message}). TypeScript then takes any uniform name for the file.`,
						);
					}
				}
				return {
					code: `export default ${shaderValue(compiled.shader)};\n`,
					map: { mappings: '' },
					moduleType: 'js',
				};
			},
		},
		transform: {
			filter: {
				id: { exclude: PACKAGE_MODULE },
				code: { include: [WGSL_TAG, 'import.meta.url'] },
			},
			async handler(code, id) {
				const file = id.split('?')[0] ?? id;
				let out: MagicString | undefined;
				if (SCRIPT_FILE.test(file) && WGSL_TAG.test(code)) {
					const tagged = compileTaggedWgsl(code, file, projectPath(root, file));
					if ('error' in tagged) return this.error(tagged.error);
					for (const { start, end, shader } of tagged.shaders) {
						out ??= new MagicString(code);
						out.overwrite(start, end, shaderValue(shader));
					}
				}
				if (building && code.includes('import.meta.url')) {
					for (const match of code.matchAll(SCRIPT_URL)) {
						const start = match.index;
						if (WORKER_BEFORE.test(code.slice(Math.max(0, start - 40), start))) continue;
						const script = await this.resolve(match[2] ?? '', id);
						if (!script || !isSketchModule(script.id)) continue;
						// The sketch worker imports the compiled module by this address.
						const ref = this.emitFile({
							type: 'chunk',
							id: script.id,
							preserveSignature: 'strict',
						});
						out ??= new MagicString(code);
						out.overwrite(
							start,
							start + match[0].length,
							`new URL(import.meta.ROLLUP_FILE_URL_${ref}, import.meta.url)`,
						);
					}
				}
				return out
					? { code: out.toString(), map: out.generateMap({ hires: 'boundary' }) }
					: undefined;
			},
		},
		configureServer(server) {
			server.middlewares.use(isolationMiddleware);
		},
		configurePreviewServer(server) {
			server.middlewares.use(isolationMiddleware);
			server.middlewares.use(immutableAssetsMiddleware);
		},
	};
}
