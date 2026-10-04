// The npm packages: what each one's pack step builds, and the checks of a packed tarball.
//
// In the repository, each package's `exports` give its TypeScript source under the `null3d-source`
// condition, which the repository's tsconfig files and Vite configs set. A project that installs
// a package gets the built JavaScript and type declarations in `lib/` instead. TypeScript writes
// `lib/` file for file, so each worker entry point and each file that the engine loads by address
// keeps its place beside the others. The source imports its own modules without an extension or
// with `.ts`, and passes worker scripts as `.ts` addresses; the build rewrites each to the `.js`
// file it wrote, so each address resolves under Node's own module rules. null3D supports one
// bundler, Vite with the null3D plugin (D-54). The plugin builds the workers as ES modules, so that
// they share the shader files instead of each taking in all of them.
import { spawnSync } from 'node:child_process';
import {
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import ts from 'typescript';
import { CORE_FILES } from '../../packages/vite-plugin/src/index.ts';
import { walkFiles } from './files.ts';
import { ensureShaderModules, isShaderModule, MODULE_DIR } from './shader-modules.ts';
import { SOURCE_CONDITION } from './source-condition.ts';

/** The folder of a package's built JavaScript and type declarations. */
export const LIB_DIR = 'lib';

/** The folder that the packed tarballs go to by default. */
export const DEFAULT_PACK_DIR = 'target/packages';

/** The license files that every package carries, copied from the repository's root. */
const LICENSES = ['LICENSE-MIT', 'LICENSE-APACHE'];

/** What a package's pack step makes, besides its license copies. */
export interface PackageBuild {
	/** Build `src/` into `lib/` with TypeScript. */
	readonly compile: boolean;
	/** Build the shader modules first, which the engine's source imports. */
	readonly shaders: boolean;
	/** Copy the repository's `docs/` into the package. */
	readonly docs: boolean;
	/** The packages whose built declarations this one's build reads, which it builds first. */
	readonly needs: readonly string[];
	/**
	 * Files that the packed tarball must hold besides the targets of its `exports` and `bin`: the
	 * files that the code loads by address, which no entry point names.
	 */
	readonly required: readonly string[];
}

/** Each package in `packages/` by folder name. */
export const PACKAGES: Readonly<Record<string, PackageBuild>> = {
	engine: {
		compile: true,
		shaders: true,
		docs: true,
		needs: [],
		required: [
			...CORE_FILES.map((file) => `dist/wasm/${file}`),
			'lib/workers/sketch-worker.js',
			'lib/workers/render-worker.js',
			'lib/workers/job-worker.js',
			'lib/workers/probe-worker.js',
			'lib/workers/transcoder-worker.js',
			'vendor/basis/basis_transcoder.js',
			'vendor/basis/basis_transcoder.wasm',
			'THIRD-PARTY-NOTICES.txt',
			'environments/room.ktx2',
			'docs/index.md',
		],
	},
	'vite-plugin': {
		compile: true,
		shaders: false,
		docs: false,
		needs: [],
		required: ['dist/shader-compiler.wasm', 'lib/client.d.ts'],
	},
	controls: { compile: true, shaders: false, docs: false, needs: ['engine'], required: [] },
	cli: {
		compile: false,
		shaders: false,
		docs: false,
		needs: [],
		required: [
			'dist/assets.wasm',
			'src/assets/encode-worker.js',
			'vendor/basis/basis_encoder.js',
			'vendor/basis/basis_encoder.wasm',
			'vendor/basis/package.json',
			'vendor/basis/LICENSE',
			'vendor/basis/NOTICE',
		],
	},
};

/** A package's build, or an error that lists the packages. */
function packageBuild(name: string): PackageBuild {
	const build = PACKAGES[name];
	if (!build)
		throw new Error(
			`unknown package ${name}; the packages are ${Object.keys(PACKAGES).join(', ')}`,
		);
	return build;
}

/** A relative module address, as an import or a script address gives it. */
const RELATIVE = /^\.{1,2}\//;

/** A built file whose imports the build rewrites: JavaScript or a type declaration. */
const BUILT_FILE = /\.(?:js|d\.ts)$/;

/** A text edit: the range of a module address and the address that replaces it. */
interface Edit {
	readonly start: number;
	readonly end: number;
	readonly text: string;
}

/**
 * The address of the built file that a relative address in the built file `from` means, or null
 * when no built file answers. `exists` reads paths in the same form as `from`. An address with
 * `.ts` means the `.js` file that TypeScript wrote for it, and one without an extension means the
 * module's `.js` file or its folder's `index.js`.
 */
export function builtAddress(
	from: string,
	address: string,
	exists: (path: string) => boolean,
): string | null {
	const base = posix.join(posix.dirname(from), address);
	const candidates: [string, string][] = address.endsWith('.ts')
		? [[`${base.slice(0, -3)}.js`, `${address.slice(0, -3)}.js`]]
		: [
				[base, address],
				[`${base}.js`, `${address}.js`],
				[`${base}/index.js`, `${address}/index.js`],
			];
	for (const [path, rewritten] of candidates)
		if (/\.[cm]?js$/.test(path) && exists(path)) return rewritten;
	return null;
}

/** The module address of an import, an export, an `import()` call or an import type, if any. */
function importedAddress(node: ts.Node): ts.StringLiteralLike | undefined {
	const literal = (node: ts.Node | undefined) =>
		node && ts.isStringLiteralLike(node) ? node : undefined;
	if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
		return literal(node.moduleSpecifier);
	if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
		return literal(node.arguments[0]);
	if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
		return literal(node.argument.literal);
	return undefined;
}

/** The address of a script that `new URL(address, import.meta.url)` passes, if `node` is one. */
function scriptAddress(node: ts.Node): ts.StringLiteralLike | undefined {
	if (!ts.isNewExpression(node) || !ts.isIdentifier(node.expression)) return undefined;
	const [address, base] = node.arguments ?? [];
	if (node.expression.text !== 'URL' || !address || !ts.isStringLiteralLike(address))
		return undefined;
	return base?.getText() === 'import.meta.url' ? address : undefined;
}

/**
 * Rewrites the relative module addresses in the built file `path`, with text `text`, to the built
 * files they mean: its imports, exports, `import()` calls and import types, and the scripts it
 * passes as `new URL(address, import.meta.url)`. Returns the new text, and the imports that no
 * built file answers. A script address that answers no built file, such as the core's WebAssembly,
 * stays as it is. TypeScript's parser finds each address, so the same text in a string or a
 * comment, such as a message that quotes an address, stays as it is.
 */
export function rewriteAddresses(
	path: string,
	text: string,
	exists: (path: string) => boolean,
): { text: string; unresolved: string[] } {
	const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
	const edits: Edit[] = [];
	const unresolved: string[] = [];
	const visit = (node: ts.Node): void => {
		const imported = importedAddress(node);
		const script = imported ? undefined : scriptAddress(node);
		const literal = imported ?? script;
		const address = literal?.text ?? '';
		if (literal && RELATIVE.test(address)) {
			const [file = '', query = ''] = address.split(/(?=\?)/);
			const rewritten = builtAddress(path, file, exists);
			if (rewritten === null) {
				if (imported) unresolved.push(address);
			} else if (rewritten !== file) {
				// The literal's text sits between its quotes.
				edits.push({
					start: literal.getStart(source) + 1,
					end: literal.end - 1,
					text: rewritten + query,
				});
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	edits.sort((a, b) => b.start - a.start);
	let out = text;
	for (const { start, end, text: replacement } of edits)
		out = out.slice(0, start) + replacement + out.slice(end);
	return { text: out, unresolved };
}

/** Runs a command in `cwd`, and fails with its output when it fails. */
function run(command: string, args: readonly string[], cwd: string): string {
	const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
	if (result.status !== 0)
		throw new Error(
			`${command} ${args.join(' ')} failed with status ${result.status}:\n${result.stdout}${result.stderr}`,
		);
	return result.stdout;
}

/**
 * Builds a package's `src/` into `lib/`: TypeScript writes the JavaScript and the declarations,
 * the build copies the JavaScript and declaration files that `src/` holds as they are, and then
 * rewrites every relative address to the built file. Fails when an import answers no built file.
 */
function compile(root: string, dir: string): void {
	const lib = join(dir, LIB_DIR);
	rmSync(lib, { recursive: true, force: true });
	const tsc = join(root, 'node_modules/typescript/bin/tsc');
	run(
		process.execPath,
		[
			tsc,
			'-p',
			join(dir, 'tsconfig.json'),
			// Without the source condition, another package that this one imports gives its built
			// declarations, as in a project that installs both, and its source stays out of `lib/`.
			'--customConditions',
			'null',
			'--noEmit',
			'false',
			'--declaration',
			'--rewriteRelativeImportExtensions',
			'--rootDir',
			join(dir, 'src'),
			'--outDir',
			lib,
		],
		root,
	);
	for (const path of walkFiles(dir, 'src', (path) => BUILT_FILE.test(path))) {
		const to = join(lib, path.slice('src/'.length));
		mkdirSync(dirname(to), { recursive: true });
		copyFileSync(join(dir, path), to);
	}
	const exists = (path: string) => existsSync(join(lib, path));
	const problems: string[] = [];
	for (const path of walkFiles(lib, '.', (path) => BUILT_FILE.test(path))) {
		const file = join(lib, path);
		const before = readFileSync(file, 'utf8');
		const { text, unresolved } = rewriteAddresses(posix.normalize(path), before, exists);
		for (const address of unresolved) problems.push(`${path} imports ${address}`);
		if (text !== before) writeFileSync(file, text);
	}
	if (problems.length > 0)
		throw new Error(
			`${relative(root, lib)} has imports that no built file answers:\n  ${problems.join('\n  ')}`,
		);
}

/**
 * Makes everything that a package's tarball holds besides the files git keeps and the WebAssembly
 * builds: the license copies, the built JavaScript and declarations, and the engine's shader
 * modules and docs. Each package's `prepack` script runs this, so `bun pm pack` and `npm pack`
 * both pack a complete package.
 */
export function buildPackage(root: string, name: string): void {
	const build = packageBuild(name);
	const dir = join(root, 'packages', name);
	for (const file of LICENSES) copyFileSync(join(root, file), join(dir, file));
	for (const needed of [...build.needs, name]) {
		if (packageBuild(needed).shaders) ensureShaderModules(root);
		if (packageBuild(needed).compile) compile(root, join(root, 'packages', needed));
	}
	if (build.docs) {
		rmSync(join(dir, 'docs'), { recursive: true, force: true });
		cpSync(join(root, 'docs'), join(dir, 'docs'), { recursive: true });
	}
}

/** The fields of a package manifest that the checks read. */
export interface Manifest {
	readonly name: string;
	readonly version: string;
	readonly private?: boolean;
	readonly exports?: unknown;
	readonly bin?: string | Readonly<Record<string, string>>;
	readonly publishConfig?: { readonly access?: string; readonly provenance?: boolean };
	readonly dependencies?: Readonly<Record<string, string>>;
	readonly peerDependencies?: Readonly<Record<string, string>>;
	readonly optionalDependencies?: Readonly<Record<string, string>>;
}

/**
 * The files that a project gets from an `exports` value: each target outside the source
 * condition. A target with `*` gives its folder, which must hold at least one file.
 */
export function exportTargets(exports: unknown): string[] {
	if (typeof exports === 'string') return [exports];
	if (exports === null || typeof exports !== 'object') return [];
	return Object.entries(exports).flatMap(([key, value]) =>
		key === SOURCE_CONDITION ? [] : exportTargets(value),
	);
}

/**
 * What is wrong with a packed package, from its manifest and the paths of the files it holds
 * (without the tarball's `package/` folder). The rules: public with provenance, no `workspace:`
 * versions, every export and command present, and every file in `required` present.
 */
export function packageProblems(
	manifest: Manifest,
	files: ReadonlySet<string>,
	required: readonly string[],
): string[] {
	const problems: string[] = [];
	const { publishConfig } = manifest;
	if (publishConfig?.access !== 'public' || publishConfig.provenance !== true)
		problems.push('publishConfig must set "access": "public" and "provenance": true');
	for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies'] as const)
		for (const [dep, version] of Object.entries(manifest[field] ?? {}))
			if (version.startsWith('workspace:'))
				problems.push(`${field} gives ${dep} the version ${version}, which npm cannot install`);
	const bins =
		typeof manifest.bin === 'string' ? [manifest.bin] : Object.values(manifest.bin ?? {});
	const holds = (target: string) => {
		const path = posix.normalize(target);
		if (!path.includes('*')) return files.has(path);
		const folder = path.slice(0, path.indexOf('*'));
		return [...files].some((file) => file.startsWith(folder));
	};
	for (const target of [...exportTargets(manifest.exports), ...bins])
		if (!holds(target)) problems.push(`it lacks ${target}, which its manifest names`);
	for (const file of required) if (!files.has(file)) problems.push(`it lacks ${file}`);
	return problems;
}

/** A packed package. */
export interface PackedPackage {
	/** The package's folder name in `packages/`. */
	readonly folder: string;
	readonly name: string;
	readonly version: string;
	/** The tarball's path. */
	readonly tarball: string;
}

/** The folder names of the packages that are not private, in a fixed order. */
export function publicPackages(root: string): string[] {
	return readdirSync(join(root, 'packages'))
		.filter((folder) => existsSync(join(root, 'packages', folder, 'package.json')))
		.filter((folder) => {
			const manifest = JSON.parse(
				readFileSync(join(root, 'packages', folder, 'package.json'), 'utf8'),
			) as Manifest;
			return manifest.private !== true;
		})
		.sort();
}

/**
 * The files that the engine's shader build wrote, as the engine's package holds them: built
 * into `lib/`.
 */
function shaderModuleFiles(root: string): string[] {
	const folder = MODULE_DIR.replace(/^packages\/engine\/src\//, `${LIB_DIR}/`);
	return readdirSync(join(root, MODULE_DIR))
		.filter(isShaderModule)
		.map((name) => `${folder}/${name.replace(/\.ts$/, '.js')}`);
}

/**
 * Packs every public package with `bun pm pack`, which runs its `prepack` script and writes the
 * real version in place of each `workspace:` one, into `out`. Then checks each tarball, and fails
 * with every problem. The WebAssembly builds must exist first (`bun run build`). Afterwards it
 * deletes each `lib/` that a pack built, so no check in the repository can read built files in
 * place of the source.
 */
export function packPackages(root: string, out: string): PackedPackage[] {
	rmSync(out, { recursive: true, force: true });
	mkdirSync(out, { recursive: true });
	const folders = publicPackages(root);
	try {
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
		const printed = run('bun', ['pm', 'pack', '--quiet', '--destination', out], dir);
		const tarball = resolve(out, printed.trim().split('\n').at(-1) ?? '');
		const manifest = JSON.parse(run('tar', ['-xOzf', tarball, 'package/package.json'], root));
		const files = new Set(
			run('tar', ['-tzf', tarball], root)
				.split('\n')
				.filter((line) => line.startsWith('package/') && !line.endsWith('/'))
				.map((line) => line.slice('package/'.length)),
		);
		const required = [...(PACKAGES[folder]?.required ?? [])];
		if (PACKAGES[folder]?.shaders) required.push(...shaderModuleFiles(root));
		for (const problem of packageProblems(manifest, files, required))
			problems.push(`${manifest.name}: ${problem}`);
		packed.push({ folder, name: manifest.name, version: manifest.version, tarball });
	}
	if (problems.length > 0)
		throw new Error(`the packed packages have problems:\n  ${problems.join('\n  ')}`);
	return packed;
}
