// Finds imports that break the add-on rules of D-173: add-ons reach the engine only through its
// public entry points, and the example add-ons are not packages that a package may depend on. The
// shipped code of every package beside the engine, and every file of the examples, may import
// `@null3d/engine` and its public sub-paths, never another engine entry point or the engine's
// source files. An import from any package into `examples/` is refused, because a shipped package
// cannot carry an example with it. Tests may read engine source, and the build tools are not
// add-ons, so neither takes the public-entry rule. One add-on reaches another by its package name
// or an exported sub-path, never by a relative path into its folder, so each feature stays in one
// place and a packed add-on still resolves. `tools/check-addon-imports.ts` runs the check over the
// repository.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

/** The engine's entry points that an add-on may import. */
export const PUBLIC_ENTRIES: ReadonlySet<string> = new Set([
	'@null3d/engine',
	'@null3d/engine/stats',
]);
/** Packages that are the engine, or that build or serve projects rather than run beside it. */
const NOT_ADDONS = new Set(['engine', 'cli', 'vite-plugin']);
/** The engine's package name, whose entry points the public-entry rule owns. */
const ENGINE_PACKAGE = '@null3d/engine';
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const TEST = /\.test\.[cm]?[jt]sx?$/;

/** Why `file` importing `specifier` breaks the rule, or nothing when the import keeps it. */
export function importProblem(
	file: string,
	specifier: string,
	engineDir: string,
): string | undefined {
	if (specifier === '@null3d/engine' || specifier.startsWith('@null3d/engine/')) {
		return PUBLIC_ENTRIES.has(specifier)
			? undefined
			: `imports ${specifier}, which is not a public entry point`;
	}
	if (
		specifier.startsWith('.') &&
		`${resolve(file, '..', specifier)}${sep}`.startsWith(`${engineDir}${sep}`)
	) {
		return `imports the engine's source (${specifier})`;
	}
	return undefined;
}

/**
 * Why `file` importing `specifier` reaches into the examples, or nothing when the import stays out.
 * An example add-on is never published, so no package may take one as a dependency (D-173 ruling 5).
 */
export function exampleImportProblem(
	file: string,
	specifier: string,
	examplesDir: string,
): string | undefined {
	if (!specifier.startsWith('.')) return undefined;
	const target = `${resolve(file, '..', specifier)}${sep}`;
	return target.startsWith(`${examplesDir}${sep}`)
		? `imports the examples (${specifier}), which no package may depend on`
		: undefined;
}

/** Each package in `packages/`, by name, with the folder that holds it. */
export interface PackageFolder {
	readonly name: string;
	readonly folder: string;
	/** The sub-paths that its `exports` names, such as `.` and `./package.json`. */
	readonly exports: ReadonlySet<string>;
}

/** The `exports` keys of one package.json, or null when the file names none. */
function exportKeys(value: unknown): Set<string> | null {
	if (typeof value === 'string') return new Set(['.']);
	if (typeof value !== 'object' || value === null) return null;
	const keys = new Set<string>();
	for (const [key, target] of Object.entries(value)) if (target !== null) keys.add(key);
	return keys;
}

/** Every package in `packages/`, by name, as the checker reads them. */
export function packageFolders(root: string): Map<string, PackageFolder> {
	const result = new Map<string, PackageFolder>();
	let folders: string[];
	try {
		folders = readdirSync(join(root, 'packages'));
	} catch {
		return result;
	}
	for (const entry of folders) {
		const folder = join(root, 'packages', entry);
		let manifest: { name?: unknown; exports?: unknown };
		try {
			manifest = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));
		} catch {
			continue;
		}
		if (typeof manifest.name !== 'string') continue;
		result.set(manifest.name, {
			name: manifest.name,
			folder,
			exports: exportKeys(manifest.exports) ?? new Set(),
		});
	}
	return result;
}

/** The package whose folder holds `file`, or undefined for a file outside every package. */
function holdingPackage(
	file: string,
	packages: Map<string, PackageFolder>,
): PackageFolder | undefined {
	const at = `${file}${sep}`;
	for (const pkg of packages.values()) if (at.startsWith(`${pkg.folder}${sep}`)) return pkg;
	return undefined;
}

/** True when an `exports` set answers `sub`, a key such as `./stats`, wildcards included. */
function exported(exports: ReadonlySet<string>, sub: string): boolean {
	if (exports.has(sub)) return true;
	for (const key of exports) {
		const star = key.indexOf('*');
		if (star < 0) continue;
		const before = key.slice(0, star);
		const after = key.slice(star + 1);
		if (sub.startsWith(before) && sub.endsWith(after) && sub.length >= before.length + after.length)
			return true;
	}
	return false;
}

/**
 * Why `file` importing `specifier` breaks the rule between two add-ons, or nothing when it keeps
 * it: an add-on reaches another only by its package name or an exported sub-path, never by a
 * relative path into the other's folder (D-173).
 */
export function packageImportProblem(
	file: string,
	specifier: string,
	packages: Map<string, PackageFolder>,
): string | undefined {
	const own = holdingPackage(file, packages);
	// The engine's entry points and source have their own rule above, which names them better.
	if (own?.name === ENGINE_PACKAGE) return undefined;
	if (specifier.startsWith('.')) {
		const target = resolve(file, '..', specifier);
		const other = holdingPackage(target, packages);
		if (!other || other === own || other.name === ENGINE_PACKAGE) return undefined;
		return `imports ${specifier}, a file of the ${other.name} package, which another add-on reaches by its package name`;
	}
	const owner = [...packages.values()].find(
		(pkg) => specifier === pkg.name || specifier.startsWith(`${pkg.name}/`),
	);
	if (!owner || owner.name === ENGINE_PACKAGE) return undefined;
	const sub = specifier === owner.name ? '.' : `./${specifier.slice(owner.name.length + 1)}`;
	if (exported(owner.exports, sub)) return undefined;
	return `imports ${specifier}, a sub-path that ${owner.name} does not export`;
}

/** The checked source files under `dir`, as absolute paths: no tests, declarations or installed packages. */
function sourceFiles(dir: string): string[] {
	let entries: string[];
	try {
		entries = readdirSync(dir, { recursive: true, encoding: 'utf8' });
	} catch {
		return [];
	}
	return (
		entries
			.filter((entry) => SOURCE.test(entry) && !TEST.test(entry) && !entry.endsWith('.d.ts'))
			.filter((entry) => !entry.split(sep).includes('node_modules'))
			// The build writes the shader modules under the engine's source. They are generated,
			// gigabytes large, and no add-on reads them.
			.filter((entry) => !entry.split(sep).includes('generated'))
			.sort()
			.map((entry) => join(dir, entry))
	);
}

/** Which rules a checked file takes: the public-entry rule, the examples rule, or both. */
interface Rules {
	engine: boolean;
	examples: boolean;
	package: boolean;
}

/** Every import in the repository at `root` that breaks a rule, as `path: problem`, and the count of files read. */
export function addonImportProblems(root: string): { problems: string[]; files: number } {
	const engineDir = join(root, 'packages/engine');
	const examplesDir = join(root, 'examples');
	const packages = readdirSync(join(root, 'packages')).sort();
	const folders = packageFolders(root);
	const rules = new Map<string, Rules>();
	const add = (file: string, rule: keyof Rules) => {
		const held = rules.get(file) ?? { engine: false, examples: false, package: false };
		held[rule] = true;
		rules.set(file, held);
	};
	// The add-ons and the examples take the public-entry rule, and the add-ons also take the rule
	// between two packages. Every package's shipped code takes the examples rule, including the
	// engine and the build tools, since none of them ships an example with it.
	for (const file of packages
		.filter((name) => !NOT_ADDONS.has(name))
		.flatMap((name) => sourceFiles(join(root, 'packages', name, 'src')))) {
		add(file, 'engine');
		add(file, 'package');
	}
	for (const file of sourceFiles(examplesDir)) add(file, 'engine');
	for (const file of packages.flatMap((name) => sourceFiles(join(root, 'packages', name, 'src'))))
		add(file, 'examples');
	const problems: string[] = [];
	for (const [file, held] of rules) {
		const { importedFiles } = ts.preProcessFile(readFileSync(file, 'utf8'), true, true);
		for (const { fileName } of importedFiles) {
			const problem =
				(held.engine ? importProblem(file, fileName, engineDir) : undefined) ??
				(held.examples ? exampleImportProblem(file, fileName, examplesDir) : undefined) ??
				(held.package ? packageImportProblem(file, fileName, folders) : undefined);
			if (problem) problems.push(`${relative(root, file)}: ${problem}`);
		}
	}
	return { problems, files: rules.size };
}
