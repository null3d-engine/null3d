// The npm packages' pack: what a package's tarball holds besides its library build, and the pack of
// every public package with the checks of each tarball. The library build itself is in
// tools/lib/packages.ts. A browser test runs the library build under Node, through the CDN build,
// and the docs that a tarball carries are generated with Bun's own parsers, so the pack keeps the
// docs generator out of the library build's imports.
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { secondsSince } from './build-cache.ts';
import { refuseStaleCore } from './core-sources.ts';
import { generateDocs, writeGeneratedDocs } from './docs.ts';
import {
	buildPackageLibraries,
	LIB_DIR,
	PACKAGES,
	type PackedPackage,
	packageBuild,
	packageProblems,
	publicPackages,
	repositoryOnlyFiles,
	run,
	SHADER_ARTIFACT,
	shaderDeclarationFiles,
	shaderFiles,
	shaderModuleJsFiles,
} from './packages.ts';

/** The folder that the packed tarballs go to by default. */
export const DEFAULT_PACK_DIR = 'target/packages';

/** The license files that every package carries, copied from the repository's root. */
const LICENSES = ['LICENSE-MIT', 'LICENSE-APACHE'];

/**
 * Writes what a tarball holds beside the library and the WebAssembly builds: the license copies,
 * and the engine's docs with their generated pages and sections, which read the shader modules.
 */
function writePackageFiles(root: string, name: string): void {
	const dir = join(root, 'packages', name);
	for (const file of LICENSES) copyFileSync(join(root, file), join(dir, file));
	if (packageBuild(name).docs) {
		// Git keeps no generated docs, so the pack writes them first.
		writeGeneratedDocs(root, generateDocs(root));
		rmSync(join(dir, 'docs'), { recursive: true, force: true });
		cpSync(join(root, 'docs'), join(dir, 'docs'), { recursive: true });
	}
}

/**
 * Makes everything that a package's tarball holds besides the files git keeps and the WebAssembly
 * builds: the license copies, the built JavaScript and declarations, and the engine's shader
 * modules and docs with their generated pages and sections. Each package's `prepack` script runs
 * this, so `bun pm pack` and `npm pack` of one package pack a complete package.
 */
export async function buildPackage(root: string, name: string): Promise<void> {
	await buildPackageLibraries(root, [name]);
	writePackageFiles(root, name);
}

/**
 * Builds the packages named in `names` as their `prepack` scripts do, but each package's library
 * once: the packages that one needs build before it, and a package that several others need is
 * not compiled again for each of them. Through the prepack scripts, a pack of every package
 * compiled the engine once for itself and once more for each add-on that needs it. Prints each
 * package's time, so a long build shows where it is.
 */
export async function buildPackages(root: string, names: readonly string[]): Promise<void> {
	await buildPackageLibraries(root, names);
	for (const name of names) writePackageFiles(root, name);
}

/**
 * Packs every public package into `out`: it builds each package once (buildPackages), then packs
 * it with `bun pm pack`, which writes the real version in place of each `workspace:` one, without
 * the `prepack` script, whose build is done. Then checks each tarball, and fails with every
 * problem. The WebAssembly builds must exist first (`bun run build`). Afterwards it deletes each
 * `lib/` that the build wrote, so no check in the repository can read built files in place of the
 * source.
 */
export async function packPackages(root: string, out: string): Promise<PackedPackage[]> {
	refuseStaleCore(root);
	rmSync(out, { recursive: true, force: true });
	mkdirSync(out, { recursive: true });
	const folders = publicPackages(root);
	try {
		await buildPackages(root, folders);
		return packEach(root, out, folders);
	} finally {
		for (const folder of folders)
			rmSync(join(root, 'packages', folder, LIB_DIR), { recursive: true, force: true });
	}
}

/** Packs each package in `folders` into `out` and checks each tarball. */
function packEach(root: string, out: string, folders: readonly string[]): PackedPackage[] {
	const packed: PackedPackage[] = [];
	const problems: string[] = [];
	for (const folder of folders) {
		const dir = join(root, 'packages', folder);
		const started = performance.now();
		const printed = run(
			'bun',
			['pm', 'pack', '--ignore-scripts', '--quiet', '--destination', out],
			dir,
		);
		console.log(`  packed ${folder} in ${secondsSince(started)} s`);
		const tarball = resolve(out, printed.trim().split('\n').at(-1) ?? '');
		const manifest = JSON.parse(run('tar', ['-xOzf', tarball, 'package/package.json'], root));
		const files = new Set(
			run('tar', ['-tzf', tarball], root)
				.split('\n')
				.filter((line) => line.startsWith('package/') && !line.endsWith('/'))
				.map((line) => line.slice('package/'.length)),
		);
		const shaders = shaderFiles(root, folder);
		const required = [...(PACKAGES[folder]?.required ?? []), ...shaders.required];
		const forbidden = repositoryOnlyFiles(packageBuild(folder));
		if (PACKAGES[folder]?.shaders) {
			required.push(...shaderDeclarationFiles(root));
			forbidden.push(...shaderModuleJsFiles(root));
			// A release's package carries the address, the file name and the hash of its shader set.
			if (existsSync(join(root, 'packages', folder, SHADER_ARTIFACT)))
				required.push(SHADER_ARTIFACT);
		}
		for (const problem of packageProblems(manifest, files, required, forbidden, shaders.forbidden))
			problems.push(`${manifest.name}: ${problem}`);
		packed.push({ folder, name: manifest.name, version: manifest.version, tarball });
	}
	if (problems.length > 0)
		throw new Error(`the packed packages have problems:\n  ${problems.join('\n  ')}`);
	return packed;
}
