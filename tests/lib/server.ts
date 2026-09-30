// The dev server that serves every browser page, and a way for scripts to start it and wait until
// it answers. Plain HTTP stays on localhost, which phones reach through adb; HTTPS on the local
// network serves tablets and phones that reach the Mac by its .local name.
import { type ChildProcess, spawn } from 'node:child_process';
import { join } from 'node:path';
import { localHostName } from '../../tools/lib/host.ts';

/**
 * The dev server's port: 5173, or the one that NULL3D_PORT names. Each copy of the repository, such
 * as a second worktree, can then run its own server, and its tools reach that one. The HTTPS server
 * takes the next port, `vite preview`, which serves the production build of the test pages, the
 * one after, and the Chrome debugging port of the benchmark tools the one after that.
 */
export const HTTP_PORT = devServerPort(process.env.NULL3D_PORT);
export const HTTPS_PORT = HTTP_PORT + 1;
/** Where `vite preview` serves the production build of the test pages. */
export const PREVIEW_PORT = HTTP_PORT + 2;
/**
 * Chrome's debugging port for the benchmark tools that drive Chrome through its debugging protocol:
 * a Chrome they start here, or Chrome on a phone that adb forwards here. Each copy of the repository
 * has its own, so two copies can run these tools at the same time.
 */
export const DEBUG_PORT = HTTP_PORT + 3;
export const REPO_ROOT = join(import.meta.dirname, '../..');

/** The port NULL3D_PORT names, or 5173 without it. */
export function devServerPort(value: string | undefined): number {
	if (value === undefined || value === '') return 5173;
	const port = Number(value);
	if (!Number.isInteger(port) || port < 1024 || port > 65533)
		throw new Error(`NULL3D_PORT must be a port from 1024 to 65533, not ${value}`);
	return port;
}

const START_TIMEOUT_MS = 30_000;

export interface DevServer {
	/** The address browsers use: localhost for HTTP, the Mac's .local name for HTTPS. */
	url: string;
	/** The address this computer uses: localhost for both. */
	selfUrl: string;
	stop(): void;
}

/**
 * Fetches from a server on this computer. The local certificate authority is not in Bun's trust
 * store, so HTTPS skips verification here.
 */
export function localFetch(url: string): Promise<Response> {
	return fetch(url, { tls: { rejectUnauthorized: false } });
}

async function answers(url: string): Promise<boolean> {
	try {
		return (await localFetch(url)).ok;
	} catch {
		return false;
	}
}

/** The page a starting dev server answers first, below its address. */
const probeOf = (selfUrl: string) => `${selfUrl}/tests/pages/index.html`;

/**
 * Runs the dev server of the repository copy at `root` with `env` added, and waits until it answers
 * at `selfUrl`. Stopping the server ends its process.
 */
async function spawnServer(
	root: string,
	env: Record<string, string>,
	url: string,
	selfUrl: string,
): Promise<DevServer> {
	const probe = probeOf(selfUrl);
	const child: ChildProcess = spawn('bunx', ['vite'], {
		cwd: root,
		stdio: ['ignore', 'ignore', 'pipe'],
		env: { ...process.env, ...env },
	});
	let errors = '';
	child.stderr?.on('data', (chunk: Buffer) => {
		errors += chunk.toString();
	});
	const deadline = Date.now() + START_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (await answers(probe)) return { url, selfUrl, stop: () => child.kill() };
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	child.kill();
	throw new Error(`the dev server did not answer at ${probe}\n${errors.trim()}`);
}

/** Starts the dev server, or reuses one that already runs, and waits until it answers. */
export async function startServer(https = false): Promise<DevServer> {
	const url = https
		? `https://${localHostName()}.local:${HTTPS_PORT}`
		: `http://localhost:${HTTP_PORT}`;
	const selfUrl = https ? `https://localhost:${HTTPS_PORT}` : url;
	if (await answers(probeOf(selfUrl))) return { url, selfUrl, stop: () => {} };
	return spawnServer(REPO_ROOT, { NULL3D_HTTPS: https ? '1' : '0' }, url, selfUrl);
}

/**
 * Starts the dev server of another copy of the repository, such as a git worktree that holds
 * another build, on plain HTTP at `port`. It never reuses a server: one that already answers there
 * could serve another copy's code, so the start fails instead.
 */
export async function startServerAt(root: string, port: number): Promise<DevServer> {
	const url = `http://localhost:${port}`;
	if (await answers(probeOf(url)))
		throw new Error(
			`a server already answers at ${url}; stop it, or give this checkout other ports with NULL3D_PORT`,
		);
	return spawnServer(root, { NULL3D_HTTPS: '0', NULL3D_PORT: String(port) }, url, url);
}

/**
 * Chromium's flags for WebGPU and WebGL2 on SwiftShader, the software GPU that CI's Linux machines
 * draw with.
 */
export const SWIFTSHADER_ARGS = [
	'--enable-unsafe-webgpu',
	'--enable-features=Vulkan',
	'--use-angle=swiftshader',
	'--use-vulkan=swiftshader',
	'--enable-unsafe-swiftshader',
	'--ignore-gpu-blocklist',
	'--no-sandbox',
	'--hide-scrollbars',
];
