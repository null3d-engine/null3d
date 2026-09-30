// Starts a project's own Vite dev server in the current folder, as `vite` would, with the project's
// own Vite and config, or builds the project for production and serves the build, as `vite build`
// and `vite preview` would. Each server listens on a free port, so it never meets a server that
// already runs, and it keeps the errors that it logs, such as a module that failed to compile, for
// the tool that started it to report.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

/** @import { Logger } from 'vite' */

/**
 * @typedef {object} DevServer
 * @property {string} url The server's address, such as `http://localhost:51234/`.
 * @property {string[]} errors The errors that the server logged, oldest first.
 * @property {(path: string) => boolean} hasFile Whether the server serves a file at a path from
 *   its root, from the project's folder or from its folder of public files.
 * @property {() => Promise<void>} close
 */

/**
 * The Vite that the project in `root` installs, which its config was written for.
 *
 * @param {string} root
 * @returns {Promise<typeof import('vite')>}
 */
async function projectVite(root) {
	let entry;
	try {
		entry = createRequire(join(root, 'package.json')).resolve('vite');
	} catch {
		throw new Error(
			`the project in ${root} does not install Vite. Add it with bun add -d vite @null3d/vite-plugin`,
		);
	}
	return import(pathToFileURL(entry).href);
}

/**
 * A logger that prints nothing and keeps each error's text in `errors`.
 *
 * @param {string[]} errors
 * @returns {Logger}
 */
function collectingLogger(errors) {
	/** @type {WeakSet<object>} */
	const logged = new WeakSet();
	return {
		hasWarned: false,
		info() {},
		warn() {
			this.hasWarned = true;
		},
		warnOnce() {
			this.hasWarned = true;
		},
		error(message, options) {
			if (options?.error) logged.add(options.error);
			errors.push(stripVTControlCharacters(message).trim());
		},
		clearScreen() {},
		hasErrorLogged(error) {
			return logged.has(error);
		},
	};
}

/**
 * Starts the Vite dev server of the project in the current folder, and waits until it listens.
 *
 * @returns {Promise<DevServer>}
 */
export async function startDevServer() {
	const vite = await projectVite(process.cwd());
	/** @type {string[]} */
	const errors = [];
	// The tools read the browser's console themselves, so the server does not copy it into its log.
	const server = await vite.createServer({
		clearScreen: false,
		customLogger: collectingLogger(errors),
		server: { port: 0, strictPort: true, open: false, forwardConsole: false },
	});
	try {
		await server.listen();
		const url = server.resolvedUrls?.local[0];
		if (!url) throw new Error('the dev server listens on no local address');
		const { root, publicDir } = server.config;
		const folders = publicDir ? [root, publicDir] : [root];
		return {
			url,
			errors,
			hasFile: (path) => folders.some((folder) => existsSync(join(folder, path))),
			close: () => server.close(),
		};
	} catch (error) {
		await server.close();
		throw error;
	}
}

/**
 * Builds the project in the current folder for production, as `vite build` would with its own
 * config, into a new temporary folder, and serves the build as `vite preview` would. The project's
 * own build folder stays as it was, and closing the server deletes the temporary one.
 *
 * @returns {Promise<DevServer>}
 */
export async function startBuildServer() {
	const vite = await projectVite(process.cwd());
	/** @type {string[]} */
	const errors = [];
	const outDir = mkdtempSync(join(tmpdir(), 'null3d-build-'));
	const remove = () => rmSync(outDir, { recursive: true, force: true });
	const shared = {
		clearScreen: false,
		logLevel: /** @type {const} */ ('warn'),
		customLogger: collectingLogger(errors),
	};
	try {
		await vite.build({ ...shared, build: { outDir, emptyOutDir: true } });
	} catch (error) {
		remove();
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`the production build of the project failed: ${message}`);
	}
	/** @type {import('vite').PreviewServer | undefined} */
	let server;
	try {
		server = await vite.preview({
			...shared,
			build: { outDir },
			preview: { port: 0, strictPort: true, open: false },
		});
		const url = server.resolvedUrls?.local[0];
		if (!url) throw new Error('the preview server listens on no local address');
		const preview = server;
		return {
			url,
			errors,
			hasFile: (path) => existsSync(join(outDir, path)),
			async close() {
				await preview.close();
				remove();
			},
		};
	} catch (error) {
		await server?.close();
		remove();
		throw error;
	}
}
