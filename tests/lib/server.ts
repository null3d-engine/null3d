// The dev server that serves every browser page, and a way for scripts to start it and wait until
// it answers. Plain HTTP stays on localhost, which phones reach through adb; HTTPS on the local
// network serves tablets and phones that reach the Mac by its .local name.
import { type ChildProcess, spawn } from 'node:child_process';
import { join } from 'node:path';
import { localHostName } from '../../tools/lib/host.ts';

export const HTTP_PORT = 5173;
/** Where `vite preview` serves the production build of the test pages. */
export const PREVIEW_PORT = 4173;
export const HTTPS_PORT = 5174;
export const REPO_ROOT = join(import.meta.dirname, '../..');

const START_TIMEOUT_MS = 30_000;

export interface DevServer {
	/** The address browsers use: localhost for HTTP, the Mac's .local name for HTTPS. */
	url: string;
	stop(): void;
}

async function answers(url: string): Promise<boolean> {
	try {
		// The local certificate authority is not in Bun's trust store, so HTTPS skips verification here.
		return (await fetch(url, { tls: { rejectUnauthorized: false } })).ok;
	} catch {
		return false;
	}
}

/** Starts the dev server, or reuses one that already runs, and waits until it answers. */
export async function startServer(https = false): Promise<DevServer> {
	const url = https
		? `https://${localHostName()}.local:${HTTPS_PORT}`
		: `http://localhost:${HTTP_PORT}`;
	const probe = `${https ? `https://localhost:${HTTPS_PORT}` : url}/tests/pages/index.html`;
	if (await answers(probe)) return { url, stop: () => {} };
	const child: ChildProcess = spawn('bunx', ['vite'], {
		cwd: REPO_ROOT,
		stdio: ['ignore', 'ignore', 'pipe'],
		env: { ...process.env, NULL3D_HTTPS: https ? '1' : '0' },
	});
	let errors = '';
	child.stderr?.on('data', (chunk: Buffer) => {
		errors += chunk.toString();
	});
	const deadline = Date.now() + START_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (await answers(probe)) return { url, stop: () => child.kill() };
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	child.kill();
	throw new Error(`the dev server did not answer at ${probe}\n${errors.trim()}`);
}
