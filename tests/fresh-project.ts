// The packed packages in a fresh project, as a developer installs them from npm. It packs every
// public package as the publish job does, makes a new Vite project in a temporary folder outside
// the repository, so that no file of the repository can stand in for a missing one, and installs
// the tarballs there with Bun. In that project it runs the command-line tool's test command twice:
// once to keep the images of the first run as the references, then once to match them. The test
// command type checks the project against the packages' declarations, and draws the project's
// sketch on every GPU tier. Last, it builds the project for production. Run `bun run build` first,
// for the WebAssembly files. Run from the repository root:
//   bun run test:packages [--keep]    --keep leaves the project's folder in place after a pass
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PACK_DIR, type PackedPackage, packPackages } from '../tools/lib/packages.ts';

const ROOT = join(import.meta.dirname, '..');
/** The project's files besides its package manifest. */
const TEMPLATE = join(ROOT, 'tests/fixtures/fresh-project');
/** The packages that the project's page and sketch import. */
const DEPENDENCIES = ['@null3d/engine', '@null3d/controls'];
/** The packages that the project's tools run. */
const DEV_DEPENDENCIES = ['@null3d/vite-plugin', '@null3d/cli'];
/** Tools from npm, at the versions that the repository pins. */
const TOOLS = ['vite', 'typescript'];

/** The project's package manifest, with each package from its tarball. */
export function projectManifest(
	packed: readonly PackedPackage[],
	pinned: Readonly<Record<string, string>>,
): object {
	const tarball = (name: string) => {
		const found = packed.find((pkg) => pkg.name === name);
		if (!found) throw new Error(`${name} was not packed; is it private?`);
		return `file:${found.tarball}`;
	};
	const versions = (names: readonly string[], version: (name: string) => string) =>
		Object.fromEntries(names.map((name) => [name, version(name)]));
	return {
		name: 'null3d-fresh-project',
		private: true,
		type: 'module',
		// npm may not have the packed version of a package that another one names, such as the
		// engine that the controls name, so every copy comes from its tarball.
		overrides: versions([...DEPENDENCIES, ...DEV_DEPENDENCIES], tarball),
		dependencies: versions(DEPENDENCIES, tarball),
		devDependencies: {
			...versions(DEV_DEPENDENCIES, tarball),
			...versions(TOOLS, (name) => {
				const version = pinned[name];
				if (!version) throw new Error(`the repository's package.json pins no ${name}`);
				return version;
			}),
		},
	};
}

/** Runs a command in the project's folder with its output shown, and fails when it fails. */
function step(title: string, cwd: string, command: string, args: readonly string[]): void {
	console.log(`\n${title}: ${command} ${args.join(' ')}`);
	const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
	if (result.status !== 0)
		throw new Error(`${title} failed with ${result.error?.message ?? `status ${result.status}`}`);
}

function main(): void {
	const keep = process.argv.includes('--keep');
	console.log('Packing the public packages');
	const packed = packPackages(ROOT, join(ROOT, DEFAULT_PACK_DIR));
	for (const { name, version, tarball } of packed) console.log(`  ${name}@${version}: ${tarball}`);

	const project = mkdtempSync(join(tmpdir(), 'null3d-fresh-project-'));
	console.log(`\nThe fresh project: ${project}`);
	let passed = false;
	try {
		cpSync(TEMPLATE, project, { recursive: true });
		const pinned = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).devDependencies;
		writeFileSync(
			join(project, 'package.json'),
			`${JSON.stringify(projectManifest(packed, pinned), null, '\t')}\n`,
		);
		step('Install', project, 'bun', ['install']);
		// The installed command, as `bunx @null3d/cli` runs it in a project that installs the tool.
		const cli = join(project, 'node_modules/.bin/null3d');
		step('Keep the first images as references', project, cli, ['test', '--update-references']);
		step('Match the references', project, cli, ['test']);
		step('Production build', project, join(project, 'node_modules/.bin/vite'), ['build']);
		// The threaded core and the single-threaded one.
		const cores = readdirSync(join(project, 'dist/assets')).filter((file) =>
			/^null3d_bg-[\w-]+\.wasm$/.test(file),
		);
		if (cores.length !== 2)
			throw new Error(`the production build holds ${cores.length} engine cores, not 2`);
		passed = true;
		console.log(`\nThe packed packages pass in a fresh project (${packed.length} packages).`);
	} finally {
		if (passed && !keep) rmSync(project, { recursive: true, force: true });
		else console.log(`The project stays in ${project}.`);
	}
}

if (import.meta.main) {
	try {
		main();
	} catch (e) {
		console.error(`error: ${(e as Error).message}`);
		process.exit(1);
	}
}
