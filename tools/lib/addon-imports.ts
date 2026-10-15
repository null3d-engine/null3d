// Finds imports that break the add-on rule of D-173: add-ons reach the engine only through its
// public entry points. The shipped code of every package beside the engine, and every file of the
// examples, may import `@null3d/engine` and its public sub-paths, never another engine entry point
// or the engine's source files. Tests may read engine source, and the build tools are not add-ons,
// so neither is checked. `tools/check-addon-imports.ts` runs the check over the repository.
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

/** The checked source files under `dir`, as absolute paths: no tests, declarations or installed packages. */
function sourceFiles(dir: string): string[] {
	let entries: string[];
	try {
		entries = readdirSync(dir, { recursive: true, encoding: 'utf8' });
	} catch {
		return [];
	}
	return entries
		.filter((entry) => SOURCE.test(entry) && !TEST.test(entry) && !entry.endsWith('.d.ts'))
		.filter((entry) => !entry.split(sep).includes('node_modules'))
		.map((entry) => join(dir, entry));
}

/** Every import in the repository at `root` that breaks the rule, as `path: problem`, and the count of files read. */
export function addonImportProblems(root: string): { problems: string[]; files: number } {
	const engineDir = join(root, 'packages/engine');
	const dirs = readdirSync(join(root, 'packages'))
		.filter((name) => !NOT_ADDONS.has(name))
		.map((name) => join(root, 'packages', name, 'src'));
	dirs.push(join(root, 'examples'));
	const problems: string[] = [];
	let files = 0;
	for (const file of dirs.flatMap(sourceFiles)) {
		files++;
		const { importedFiles } = ts.preProcessFile(readFileSync(file, 'utf8'), true, true);
		for (const { fileName } of importedFiles) {
			const problem = importProblem(file, fileName, engineDir);
			if (problem) problems.push(`${relative(root, file)}: ${problem}`);
		}
	}
	return { problems, files };
}
