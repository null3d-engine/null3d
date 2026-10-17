// The fallback for the engine's shader modules: where the release asset cannot be downloaded, the
// plugin builds them from the sources that its compiler carries, and caches them for the machine.
// The compiler holds the engine's manifest and every WGSL file, so a project needs nothing else.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { engineShadersRoot } from './engine-shaders.ts';
import { engineModule, prepareEngineModules, SHADER_COMPILER_URL } from './shader-compiler.ts';

/** The record of a set that a project may use, written last. */
const MARKER = '.complete';

/**
 * Builds one engine package's shader modules from the sources inside the compiler, and gives the
 * folder that holds them. It reports the wait before it starts and how far it has got, because a
 * first build takes minutes. It gives nothing when the build fails, so the caller reports that.
 */
export async function buildEngineShadersLocally(
	lib: string,
	report: (message: string) => void,
): Promise<string | undefined> {
	const folder = join(engineShadersRoot(), 'local', key(lib));
	if (existsSync(join(folder, MARKER))) return folder;
	report(
		"null3D: the engine's shaders could not be downloaded, so they are built here from the engine's sources. This happens once for this machine and can take many minutes; later builds read the result from the cache.",
	);
	const staging = `${folder}.incoming-${process.pid}`;
	try {
		const names = prepareEngineModules();
		rmSync(staging, { recursive: true, force: true });
		mkdirSync(staging, { recursive: true });
		let shown = -1;
		for (const [index, name] of names.entries()) {
			if (!/^[A-Za-z0-9_.-]+$/.test(name)) throw new Error(`the build named ${name}`);
			writeFileSync(join(staging, name), engineModule(name).text);
			const percent = Math.floor(((index + 1) * 10) / names.length) * 10;
			if (percent > shown) {
				shown = percent;
				report(
					`null3D: building the engine's shaders: ${percent}% (${index + 1} of ${names.length})`,
				);
			}
		}
		writeFileSync(join(staging, MARKER), '');
		rmSync(folder, { recursive: true, force: true });
		mkdirSync(join(folder, '..'), { recursive: true });
		renameSync(staging, folder);
		return folder;
	} catch (error) {
		rmSync(staging, { recursive: true, force: true });
		report(`null3D: the engine's shaders could not be built: ${(error as Error).message}`);
		return undefined;
	}
}

/**
 * The folder's key: the engine's version and the bytes of the compiler that builds it, so an
 * upgrade of either builds the modules again rather than reading an older set.
 */
function key(lib: string): string {
	let version = 'unknown';
	try {
		const manifest = JSON.parse(readFileSync(join(lib, '..', 'package.json'), 'utf8')) as {
			version?: unknown;
		};
		if (typeof manifest.version === 'string') version = manifest.version;
	} catch {
		// A package without a readable manifest still gets a folder of its own.
	}
	let compiler = 'missing';
	try {
		compiler = createHash('sha256')
			.update(readFileSync(SHADER_COMPILER_URL))
			.digest('hex')
			.slice(0, 16);
	} catch {
		// A missing compiler fails the build itself, with the compiler's own message.
	}
	return `${version.replace(/[^A-Za-z0-9.-]/g, '_')}-${compiler}`;
}
