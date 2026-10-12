// The pinned Emscripten SDK that builds the repository's C and C++ code to WebAssembly: the KTX2
// transcoder that the engine ships and the FBX reader of the asset tool. The SDK downloads once
// into target/emsdk, which git ignores, and nothing installs outside it.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../..');
const SDK_FOLDER = join(ROOT, 'target/emsdk');

/** The Emscripten SDK release, and the SHA-256 of its source archive. */
export const EMSDK = {
	version: '4.0.15',
	url: 'https://github.com/emscripten-core/emsdk/archive/refs/tags/4.0.15.tar.gz',
	sha256: '35be7626493e3bd22860ee2177147f9bca3b6ff871edeab27c5b061a9ed9d23d',
};

/** Runs a command, and throws when it fails. */
export function run(command: string, args: string[], cwd: string): void {
	const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
	if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
}

/**
 * Downloads an archive into `folder` once, checks its SHA-256 and unpacks it there.
 *
 * @param name The archive's file name in the folder, without `.tar.gz`.
 */
export async function unpack(
	folder: string,
	name: string,
	{ url, sha256 }: { url: string; sha256: string },
): Promise<void> {
	mkdirSync(folder, { recursive: true });
	const archive = join(folder, `${name}.tar.gz`);
	if (!existsSync(archive)) {
		const response = await fetch(url);
		if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
		writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
	}
	const got = createHash('sha256').update(readFileSync(archive)).digest('hex');
	if (got !== sha256) throw new Error(`${archive}: SHA-256 ${got}, expected ${sha256}`);
	run('tar', ['-xzf', archive, '-C', folder], folder);
}

/**
 * Installs the SDK, once, and returns a function that runs a command with the SDK's environment
 * in a folder.
 */
export async function emscripten(): Promise<(command: string, cwd: string) => void> {
	await unpack(SDK_FOLDER, 'emsdk', EMSDK);
	const sdk = join(SDK_FOLDER, `emsdk-${EMSDK.version}`);
	run('./emsdk', ['install', EMSDK.version], sdk);
	run('./emsdk', ['activate', EMSDK.version], sdk);
	return (command, cwd) =>
		run('bash', ['-c', `EMSDK_QUIET=1 source "${sdk}/emsdk_env.sh" && ${command}`], cwd);
}
