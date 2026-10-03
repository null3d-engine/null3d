// The dev server that serves every browser page, and a way for scripts to start it and wait until
// it answers. Plain HTTP stays on localhost, which phones reach through adb; HTTPS on the local
// network serves tablets and phones that reach the Mac by its .local name.
import { type ChildProcess, spawn } from 'node:child_process';
import { constants } from 'node:os';
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

/** Servers that this process started and has not stopped yet. */
const running = new Set<ChildProcess>();
/** Work that a signal waits for before the process ends, such as ending remote sessions. */
const cleanups = new Set<() => Promise<unknown>>();
const STOP_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
/** How long a signal waits for the cleanups before the process ends anyway. */
const CLEANUP_LIMIT_MS = 20_000;
let stopping = false;

/**
 * Runs the cleanups, for a limited time, then stops every server this process started and ends the
 * process as the signal asks. A second signal while the first one's cleanups run changes nothing.
 */
async function stopAllAndExit(signal: NodeJS.Signals): Promise<void> {
	if (stopping) return;
	stopping = true;
	await Promise.race([
		Promise.allSettled([...cleanups].map((cleanup) => cleanup())),
		new Promise((resolve) => setTimeout(resolve, CLEANUP_LIMIT_MS)),
	]);
	for (const child of running) child.kill();
	process.exit(128 + (constants.signals[signal] ?? 1));
}

/** Listens for the stop signals while any server or cleanup needs them, and not after. */
function updateSignalHandlers(): void {
	const listening = process.listeners('SIGINT').includes(stopAllAndExit);
	const needed = running.size > 0 || cleanups.size > 0;
	if (needed && !listening) for (const signal of STOP_SIGNALS) process.on(signal, stopAllAndExit);
	if (!needed && listening) for (const signal of STOP_SIGNALS) process.off(signal, stopAllAndExit);
}

/**
 * Keeps track of a server that this process started, and returns the function that stops it. A
 * process stopped by a signal, such as Ctrl-C or `kill`, then stops its servers first, so no
 * server stays behind on its port for the next run to trip over.
 */
export function trackServer(child: ChildProcess): () => void {
	running.add(child);
	updateSignalHandlers();
	const forget = () => {
		running.delete(child);
		updateSignalHandlers();
	};
	child.once('exit', forget);
	return () => {
		forget();
		child.kill();
	};
}

/**
 * Runs `cleanup` when a signal stops the process, before its servers stop, and returns the function
 * that forgets it. The process waits a limited time for it.
 */
export function onStopSignal(cleanup: () => Promise<unknown>): () => void {
	cleanups.add(cleanup);
	updateSignalHandlers();
	return () => {
		cleanups.delete(cleanup);
		updateSignalHandlers();
	};
}

/** The page a starting dev server answers first, below its address. */
const DEV_PROBE = '/tests/pages/index.html';

/**
 * Runs Vite with `args` in the repository copy at `root`, with `env` added, and waits until the
 * server answers at `selfUrl` followed by `probe`. Stopping the server ends its process, and so does
 * a signal that stops this one.
 */
async function spawnServer(
	root: string,
	args: readonly string[],
	env: Record<string, string>,
	url: string,
	selfUrl: string,
	probe = DEV_PROBE,
): Promise<DevServer> {
	const child: ChildProcess = spawn('bunx', ['vite', ...args], {
		cwd: root,
		stdio: ['ignore', 'ignore', 'pipe'],
		env: { ...process.env, ...env },
	});
	const stop = trackServer(child);
	let errors = '';
	child.stderr?.on('data', (chunk: Buffer) => {
		errors += chunk.toString();
	});
	const deadline = Date.now() + START_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (await answers(`${selfUrl}${probe}`)) return { url, selfUrl, stop };
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	stop();
	throw new Error(`the server did not answer at ${selfUrl}${probe}\n${errors.trim()}`);
}

/** Throws when any server answers at `url`: it could serve another copy's files or another build. */
async function refuseTaken(url: string): Promise<void> {
	const taken = await localFetch(url).then(
		() => true,
		() => false,
	);
	if (taken)
		throw new Error(
			`a server already answers at ${url}; stop it, or give this checkout other ports with NULL3D_PORT`,
		);
}

/** Starts the dev server, or reuses one that already runs, and waits until it answers. */
export async function startServer(https = false): Promise<DevServer> {
	const url = https
		? `https://${localHostName()}.local:${HTTPS_PORT}`
		: `http://localhost:${HTTP_PORT}`;
	const selfUrl = https ? `https://localhost:${HTTPS_PORT}` : url;
	if (await answers(`${selfUrl}${DEV_PROBE}`)) return { url, selfUrl, stop: () => {} };
	return spawnServer(REPO_ROOT, [], { NULL3D_HTTPS: https ? '1' : '0' }, url, selfUrl);
}

/**
 * Starts the dev server of another copy of the repository, such as a git worktree that holds
 * another build, on plain HTTP at `port`. It never reuses a server: one that already answers there
 * could serve another copy's code, so the start fails instead.
 */
export async function startServerAt(root: string, port: number): Promise<DevServer> {
	const url = `http://localhost:${port}`;
	await refuseTaken(url);
	return spawnServer(root, [], { NULL3D_HTTPS: '0', NULL3D_PORT: String(port) }, url, url);
}

/**
 * Serves the production build in `outDir` with `vite preview` at `port`, as a developer checks a
 * build before shipping it, and waits until it answers at `probe`, a path in the build. It never
 * reuses a server, which could serve another build.
 */
export async function startPreview(
	outDir: string,
	port: number,
	probe: string,
): Promise<DevServer> {
	const url = `http://localhost:${port}`;
	await refuseTaken(url);
	const args = ['preview', '--outDir', outDir, '--port', String(port), '--strictPort'];
	return spawnServer(REPO_ROOT, args, {}, url, url, probe);
}
