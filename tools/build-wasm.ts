// Builds the engine's two WebAssembly files and the shader compiler, then reports their sizes and
// the sizes of the engine's JavaScript in a production build of the engine test page. Run from
// the repository root:
//   bun tools/build-wasm.ts                 build everything, then print the size report
//   bun tools/build-wasm.ts --check-size    also compare each file's size with a build of the base
//     [--base <ref>]                        commit, and fail on growth that no trailer explains
//   bun tools/build-wasm.ts --sizes-only    build only what the size report measures, and write the
//                                           sizes for a size check that builds this commit as its base
//   bun tools/build-wasm.ts --names         keep the core's function names, for a CPU profile;
//                                           the names add size, so this skips the size checks
//   bun tools/build-wasm.ts --core-only     build only the two WebAssembly files, which is all
//                                           that the test pages load, with no size report
//
// The threaded build uses atomics and shared memory, so it rebuilds the standard library with
// them. The single-threaded build runs on pages that are not cross-origin isolated. The
// wasm-bindgen command-line tool must match the crate version exactly, so the script downloads
// that release into the build folder and verifies its checksum. The shader compiler runs in build
// tools, never in a page, so it has no size budget.
//
// The size check's base is main's own build: tools/lib/size-check.ts picks the commit, and the
// check builds it in a worktree under target/ with that commit's own build script. It keeps the
// sizes of each base commit it built and reuses them.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	appendFileSync,
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHADER_COMPILER_URL } from '../packages/vite-plugin/src/shader-compiler';
import { explainedFiles, SIZE_GROWTH_GUIDANCE } from './hooks/check-size-growth';
import {
	type BaseChoice,
	chooseBase,
	compareSizes,
	grownFiles,
	growthLines,
	growthProblems,
	growthSummary,
} from './lib/size-check';
import {
	type BuiltFile,
	type CORE_BUILDS,
	CORE_FILES,
	downloadSizes,
	findEngineParts,
	measure,
	type SizeEntry,
	totalSize,
} from './lib/size-report';

const root = process.cwd();
const CRATE = 'null3d-wasm';
const OUT_DIR = 'packages/engine/dist/wasm';
const TOOLS_DIR = 'target/tools';
/** Where `--sizes-only` writes the sizes it measured, for the size check that asked for them. */
const SIZE_RECORD = 'target/size-report.json';
/**
 * Where the size check keeps its bases: a worktree that it reuses, and each base commit's sizes. The
 * folder is hidden because `bun test` finds the tests of a git checkout in any other folder, even an
 * ignored one, and would run the base's tests with this checkout's.
 */
const BASE_DIR = 'target/.size-base';
/** The worktree where the size check builds each base commit with that commit's own build script. */
const BASE_TREE = `${BASE_DIR}/tree`;
/**
 * The committed size record of a base from before the size check compared with main's build. That
 * base's build script rewrites the record with `--update-size`.
 */
const COMMITTED_RECORD = 'tools/size-baseline.json';
/** Brotli budget for each core WebAssembly file. */
const WASM_BUDGET_BYTES = 600 * 1024;
/**
 * Brotli budget for the engine's JavaScript that a page downloads, in whichever thread mode
 * downloads the most. The core's generated glue counts with the WebAssembly files instead.
 */
const JS_BUDGET_BYTES = 70 * 1024;
/** Where the size report builds the engine test page, apart from the build the browser tests serve. */
const JS_BUILD_DIR = 'target/js-size';
/** The crate that builds the shader compiler, the shader crate as a WebAssembly module. */
const SHADER_COMPILER_CRATE = 'null3d-shaders-wasm';
/** Where the Vite plugin loads the shader compiler from. */
const SHADER_COMPILER_PATH = fileURLToPath(SHADER_COMPILER_URL);

interface Variant {
	name: (typeof CORE_BUILDS)[number];
	rustflags: string;
	cargoArgs: string[];
	wasmOptFeatures: string[];
}

const COMMON_WASM_FEATURES = [
	'--enable-simd',
	'--enable-bulk-memory',
	'--enable-nontrapping-float-to-int',
	'--enable-sign-ext',
	'--enable-mutable-globals',
	'--enable-multivalue',
	'--enable-reference-types',
];

/** Linker settings for a module that imports shared memory and sets up thread-local storage. */
const SHARED_MEMORY_LINK_ARGS = [
	'--shared-memory',
	'--import-memory',
	'--max-memory=4294967296',
	'--export=__wasm_init_tls',
	'--export=__tls_size',
	'--export=__tls_align',
	'--export=__tls_base',
];

export const VARIANTS: Variant[] = [
	{
		name: 'threaded',
		rustflags: [
			'-Zllvm-target-feature=+atomics',
			'-Ctarget-feature=+bulk-memory,+simd128',
			// The compiler does not add the shared-memory linker settings for this flag. The declared
			// maximum is only a ceiling: the loader creates the memory with a smaller maximum.
			...SHARED_MEMORY_LINK_ARGS.map((arg) => `-Clink-arg=${arg}`),
		].join(' '),
		cargoArgs: ['-Z', 'build-std=panic_abort,std'],
		wasmOptFeatures: [...COMMON_WASM_FEATURES, '--enable-threads'],
	},
	{
		name: 'single',
		rustflags: '-Ctarget-feature=+simd128',
		cargoArgs: [],
		wasmOptFeatures: COMMON_WASM_FEATURES,
	},
];

/** The locked version of a package in Cargo.lock. */
export function lockedVersion(cargoLock: string, name: string): string {
	const match = cargoLock.match(
		new RegExp(`\\[\\[package\\]\\]\\nname = "${name}"\\nversion = "([^"]+)"`),
	);
	if (!match?.[1]) throw new Error(`${name} is not in Cargo.lock`);
	return match[1];
}

/** The wasm-bindgen release asset name for this machine. */
export function releaseTarget(platform: string, arch: string): string {
	const cpu = arch === 'arm64' ? 'aarch64' : arch === 'x64' ? 'x86_64' : null;
	if (cpu && platform === 'darwin') return `${cpu}-apple-darwin`;
	if (cpu && platform === 'linux') return `${cpu}-unknown-linux-musl`;
	throw new Error(`no prebuilt wasm-bindgen for ${platform} on ${arch}`);
}

async function download(url: string): Promise<Buffer> {
	const res = await fetch(url, { redirect: 'follow' });
	if (!res.ok) throw new Error(`download failed with ${res.status}: ${url}`);
	return Buffer.from(await res.arrayBuffer());
}

/** Path to a wasm-bindgen binary of exactly `version`, downloading and verifying it when missing. */
async function wasmBindgen(version: string): Promise<string> {
	const dir = join(root, TOOLS_DIR, `wasm-bindgen-${version}`);
	const bin = join(dir, 'wasm-bindgen');
	if (existsSync(bin)) return bin;

	const target = releaseTarget(process.platform, process.arch);
	const name = `wasm-bindgen-${version}-${target}`;
	const base = `https://github.com/wasm-bindgen/wasm-bindgen/releases/download/${version}/${name}.tar.gz`;
	console.log(`downloading ${name}`);
	const archive = await download(base);
	const expected = (await download(`${base}.sha256sum`)).toString('utf8').trim().split(/\s+/)[0];
	const actual = createHash('sha256').update(archive).digest('hex');
	if (actual !== expected) throw new Error(`checksum mismatch for ${name}.tar.gz`);

	const staging = `${dir}.partial`;
	rmSync(staging, { recursive: true, force: true });
	mkdirSync(staging, { recursive: true });
	writeFileSync(join(staging, 'archive.tar.gz'), archive);
	execFileSync('tar', ['-xzf', 'archive.tar.gz', '--strip-components=1'], { cwd: staging });
	chmodSync(join(staging, 'wasm-bindgen'), 0o755);
	rmSync(dir, { recursive: true, force: true });
	renameSync(staging, dir);
	return bin;
}

function run(cmd: string, args: string[], env: Record<string, string> = {}, cwd = root): void {
	execFileSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
}

const git = (args: string[], cwd = root) =>
	execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

export interface BuildOptions {
	/** Compare each file's size after Brotli with a build of the base commit. */
	checkSize: boolean;
	/** The commit that the size check compares with, in place of the one it picks. */
	base?: string;
	/** Build and measure only the files that the size report covers, and write their sizes. */
	sizesOnly: boolean;
	/** Keep the core's function names, which a CPU profile shows. */
	keepNames: boolean;
	/** Build only the two WebAssembly files: no shader compiler and no size report. */
	coreOnly: boolean;
}

const USAGE =
	'usage: bun tools/build-wasm.ts [--check-size [--base <ref>] | --sizes-only | --names | --core-only]';

/** Reads the command line. It throws on an unknown option and on options that exclude each other. */
export function parseOptions(args: readonly string[]): BuildOptions {
	const options: BuildOptions = {
		checkSize: false,
		sizesOnly: false,
		keepNames: false,
		coreOnly: false,
	};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === '--check-size') options.checkSize = true;
		else if (arg === '--sizes-only') options.sizesOnly = true;
		else if (arg === '--names') options.keepNames = true;
		else if (arg === '--core-only') options.coreOnly = true;
		else if (arg === '--base' && args[i + 1] && !args[i + 1]?.startsWith('-'))
			options.base = args[++i];
		else
			throw new Error(
				`${arg === '--base' ? '--base needs a commit' : `unknown option ${arg}`}. ${USAGE}`,
			);
	}
	if (options.keepNames && (options.checkSize || options.sizesOnly))
		throw new Error('--names adds the function names to the core, so it cannot measure sizes');
	if (options.coreOnly && (options.checkSize || options.sizesOnly))
		throw new Error('--core-only makes no size report, so it cannot measure sizes');
	if (options.checkSize && options.sizesOnly)
		throw new Error(
			'--sizes-only measures a base for the size check, so it cannot also run the check',
		);
	if (options.base !== undefined && !options.checkSize)
		throw new Error(`--base names the commit that --check-size compares with. ${USAGE}`);
	return options;
}

/** The Rust build folder of a variant, relative to the checkout. */
const buildFolder = (variant: Variant) => `target/wasm-${variant.name}`;

function buildVariant(variant: Variant, bindgen: string, keepNames: boolean): void {
	const targetDir = buildFolder(variant);
	console.log(`\nbuilding the ${variant.name} WebAssembly file`);
	run(
		'cargo',
		[
			'build',
			'-p',
			CRATE,
			'--release',
			'--target',
			'wasm32-unknown-unknown',
			'--target-dir',
			targetDir,
			...variant.cargoArgs,
		],
		{ RUSTFLAGS: variant.rustflags },
	);
	const outDir = `${OUT_DIR}/${variant.name}`;
	rmSync(join(root, outDir), { recursive: true, force: true });
	run(bindgen, [
		'--target',
		'web',
		'--out-dir',
		outDir,
		'--out-name',
		'null3d',
		`${targetDir}/wasm32-unknown-unknown/release/${CRATE.replace(/-/g, '_')}.wasm`,
	]);
	const wasm = `${outDir}/null3d_bg.wasm`;
	run(join(root, 'node_modules/.bin/wasm-opt'), [
		'-O3',
		// wasm-opt drops the name section unless it keeps debug information.
		...(keepNames ? ['--debuginfo'] : []),
		...variant.wasmOptFeatures,
		wasm,
		'-o',
		wasm,
	]);
	// The loader creates the shared memory itself, so it needs the module's declared sizes.
	const limits = memoryImportLimits(readFileSync(join(root, wasm)));
	if (limits)
		writeFileSync(join(root, outDir, 'null3d_memory.json'), `${JSON.stringify(limits)}\n`);
}

/**
 * Builds the shader compiler. It takes and gives JSON through its memory, so it needs no
 * JavaScript glue. The build drops the function names and skips wasm-opt, which on this module
 * takes longer than the whole build, saves almost nothing after Brotli and makes compiles no faster.
 */
function buildShaderCompiler(): void {
	const targetDir = 'target/wasm-shaders';
	console.log('\nbuilding the shader compiler');
	run(
		'cargo',
		[
			'build',
			'-p',
			SHADER_COMPILER_CRATE,
			'--release',
			'--target',
			'wasm32-unknown-unknown',
			'--target-dir',
			targetDir,
		],
		{ RUSTFLAGS: '-Cstrip=symbols' },
	);
	const built = `${targetDir}/wasm32-unknown-unknown/release/${SHADER_COMPILER_CRATE.replace(/-/g, '_')}.wasm`;
	mkdirSync(dirname(SHADER_COMPILER_PATH), { recursive: true });
	copyFileSync(join(root, built), SHADER_COMPILER_PATH);
}

export interface MemoryLimits {
	/** Initial size in 64 KB pages. */
	initial: number;
	/** Declared maximum in 64 KB pages, or null when the module declares none. */
	maximum: number | null;
	shared: boolean;
}

/** Reads an unsigned LEB128 number at `offset`; returns the value and the offset after it. */
function readLeb(bytes: Uint8Array, offset: number): [number, number] {
	let value = 0;
	let shift = 0;
	let at = offset;
	for (;;) {
		const byte = bytes[at++] ?? 0;
		value += (byte & 0x7f) * 2 ** shift;
		if ((byte & 0x80) === 0) return [value, at];
		shift += 7;
	}
}

/** The limits of the memory a module imports, from its import section, or null when it imports none. */
export function memoryImportLimits(bytes: Uint8Array): MemoryLimits | null {
	let at = 8;
	while (at < bytes.length) {
		const id = bytes[at++];
		const [size, contentStart] = readLeb(bytes, at);
		at = contentStart;
		if (id !== 2) {
			at += size;
			continue;
		}
		let [count, cursor] = readLeb(bytes, at);
		for (; count > 0; count--) {
			for (let name = 0; name < 2; name++) {
				const [length, afterLength] = readLeb(bytes, cursor);
				cursor = afterLength + length;
			}
			const kind = bytes[cursor++];
			if (kind === 0) {
				cursor = readLeb(bytes, cursor)[1];
			} else if (kind === 1) {
				cursor++;
				const flags = bytes[cursor++] ?? 0;
				cursor = readLeb(bytes, cursor)[1];
				if (flags & 1) cursor = readLeb(bytes, cursor)[1];
			} else if (kind === 2) {
				const flags = bytes[cursor++] ?? 0;
				const [initial, afterInitial] = readLeb(bytes, cursor);
				const maximum = flags & 1 ? readLeb(bytes, afterInitial)[0] : null;
				return { initial, maximum, shared: (flags & 2) !== 0 };
			} else if (kind === 3) {
				cursor += 2;
			} else {
				cursor++;
				cursor = readLeb(bytes, cursor)[1];
			}
		}
		return null;
	}
	return null;
}

/**
 * Builds the engine test page for production with hidden source maps, which leave the JavaScript
 * as it ships, and reads each JavaScript file with the source files it holds. The core's glue is
 * copied as it is and has no map. Vite writes a worker's source paths from the build folder and
 * the page's from its assets folder, both inside the repository, so a path without its leading
 * steps up is the path from the repository's root.
 */
function buildEngineTestPage(): BuiltFile[] {
	console.log('\nbuilding the engine test page for production');
	const args = ['vite', 'build', '--sourcemap', 'hidden', '--outDir', JS_BUILD_DIR];
	const build = spawnSync('bunx', args, { cwd: root, encoding: 'utf8' });
	if (build.status !== 0)
		throw new Error(`the production build failed:\n${build.stdout}\n${build.stderr}`);
	const assets = join(root, JS_BUILD_DIR, 'assets');
	return readdirSync(assets)
		.filter((file) => file.endsWith('.js') && existsSync(join(assets, `${file}.map`)))
		.map((file) => {
			const map = JSON.parse(readFileSync(join(assets, `${file}.map`), 'utf8')) as {
				sources: string[];
			};
			return {
				file,
				text: readFileSync(join(assets, file), 'utf8'),
				sources: map.sources.map((source) => source.replace(/^(\.\.?\/)+/, '')),
			};
		});
}

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

function printSize(name: string, size: SizeEntry, budgetBytes?: number): void {
	const budget = budgetBytes
		? `  ${((size.brotli / budgetBytes) * 100).toFixed(1)}% of budget`
		: '';
	console.log(
		`  ${name.padEnd(28)} raw ${kb(size.raw).padStart(10)}   brotli ${kb(size.brotli).padStart(10)}${budget}`,
	);
}

interface Base {
	sha: string;
	subject: string;
	/** Why the check picked this commit. */
	why: string;
}

/** HEAD's merge base with a branch of origin, after a fetch of the branch. Offline, the last fetch serves. */
function mergeBaseWith(branch: string): string {
	const remote = `origin/${branch}`;
	console.log(`\nfetching ${remote} for the size check's base`);
	const fetch = spawnSync('git', ['fetch', '--quiet', 'origin', branch], {
		cwd: root,
		encoding: 'utf8',
		env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
	});
	if (fetch.status !== 0)
		console.warn(
			`could not fetch ${remote}, so the check uses the last fetch: ${fetch.stderr.trim()}`,
		);
	try {
		return git(['merge-base', 'HEAD', remote]);
	} catch {
		throw new Error(`HEAD has no merge base with ${remote}: fetch it, or pass --base <ref>`);
	}
}

/** The commit that the choice names, with its subject. */
function resolveBase(choice: BaseChoice): Base {
	const ref = 'ref' in choice ? choice.ref : mergeBaseWith(choice.branch);
	let sha: string;
	try {
		sha = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
	} catch {
		throw new Error(`${ref} names no commit in this clone: fetch it, or pass --base <ref>`);
	}
	return { sha, subject: git(['log', '-1', '--format=%s', sha]), why: choice.why };
}

/** Puts the base worktree at the commit, and makes it when it is missing or broken. True when new. */
function checkoutBaseTree(tree: string, sha: string): boolean {
	if (existsSync(join(tree, '.git'))) {
		const args = ['checkout', '--force', '--quiet', '--detach', sha];
		if (spawnSync('git', args, { cwd: tree }).status === 0) return false;
	}
	rmSync(tree, { recursive: true, force: true });
	// --force also takes over the path when git still lists a worktree there that was deleted.
	git(['worktree', 'add', '--force', '--detach', tree, sha]);
	return true;
}

/**
 * Copies this checkout's Rust build folders into a new base worktree with their file times, and
 * shares the downloaded wasm-bindgen, whose folder names its version. The worktree's files are
 * newer than the copies, so Cargo rebuilds the engine's crates from the base's code and reuses the
 * standard library and the dependencies. Two checkouts never share one Rust build folder: Cargo
 * finds the engine's crates at the same paths in both, and judges them fresh by file times, so the
 * next build of one checkout could take the other's crates.
 */
function seedBuildFolders(tree: string): void {
	mkdirSync(join(tree, 'target'), { recursive: true });
	for (const variant of VARIANTS) {
		const folder = buildFolder(variant);
		if (existsSync(join(root, folder)))
			execFileSync('cp', ['-Rp', join(root, folder), join(tree, folder)]);
	}
	if (existsSync(join(root, TOOLS_DIR))) symlinkSync(join(root, TOOLS_DIR), join(tree, TOOLS_DIR));
}

/**
 * The base commit's sizes. The check keeps them by commit and reuses them. Otherwise it builds the
 * commit in the base worktree with the commit's own build script, so the base has that commit's
 * flags, toolchain and list of parts.
 */
function baseSizes(sha: string): Record<string, SizeEntry> {
	const kept = join(root, BASE_DIR, `${sha}.json`);
	if (existsSync(kept)) {
		console.log(`reusing the sizes of the base build of ${sha.slice(0, 8)}, kept in ${BASE_DIR}`);
		return JSON.parse(readFileSync(kept, 'utf8'));
	}
	const started = performance.now();
	const tree = join(root, BASE_TREE);
	const group = process.env.GITHUB_ACTIONS === 'true';
	if (group) console.log(`::group::the base build of ${sha.slice(0, 8)}`);
	try {
		console.log(`\nbuilding the base, ${sha.slice(0, 8)}, in ${BASE_TREE}`);
		if (checkoutBaseTree(tree, sha)) seedBuildFolders(tree);
		run('bun', ['install', '--frozen-lockfile'], { HUSKY: '0' }, tree);
		const committed = existsSync(join(tree, COMMITTED_RECORD));
		run('bun', ['tools/build-wasm.ts', committed ? '--update-size' : '--sizes-only'], {}, tree);
		mkdirSync(dirname(kept), { recursive: true });
		copyFileSync(join(tree, committed ? COMMITTED_RECORD : SIZE_RECORD), kept);
	} finally {
		if (group) console.log('::endgroup::');
	}
	console.log(`built the base in ${Math.round((performance.now() - started) / 1000)} s`);
	return JSON.parse(readFileSync(kept, 'utf8'));
}

/** The commits after the base up to HEAD, with their messages. */
function commitsSince(base: string): { sha: string; message: string }[] {
	return git(['log', '--format=%H%x1f%B%x1e', `${base}..HEAD`])
		.split('\x1e')
		.map((entry) => entry.trim().split('\x1f'))
		.filter(([sha]) => sha)
		.map(([sha = '', message = '']) => ({ sha, message }));
}

/**
 * Compares each file's size with the base build and shows the growth in the log and in CI's job
 * summary. Returns a problem for each file that grew past the limit with no trailer to explain it.
 */
function checkGrowth(sizes: Record<string, SizeEntry>, ref: string | undefined): string[] {
	const base = resolveBase(chooseBase(ref, process.env));
	const changes = compareSizes(baseSizes(base.sha), sizes);
	const grown = grownFiles(changes).map(({ file }) => file);
	const explainedBy = explainedFiles(commitsSince(base.sha), grown);
	const short = base.sha.slice(0, 8);
	console.log(`\ngrowth after Brotli against the base, ${short} "${base.subject}", ${base.why}`);
	for (const line of growthLines(changes, explainedBy)) console.log(line);
	const summary = process.env.GITHUB_STEP_SUMMARY;
	if (summary)
		appendFileSync(summary, growthSummary(changes, explainedBy, `\`${short}\`, ${base.why}`));
	return growthProblems(changes, explainedBy);
}

async function main(): Promise<void> {
	const options = parseOptions(process.argv.slice(2));
	const version = lockedVersion(readFileSync(join(root, 'Cargo.lock'), 'utf8'), 'wasm-bindgen');
	const bindgen = await wasmBindgen(version);
	for (const variant of VARIANTS) buildVariant(variant, bindgen, options.keepNames);
	if (options.coreOnly) return;
	if (!options.sizesOnly) buildShaderCompiler();

	const sizes: Record<string, SizeEntry> = {};
	for (const variant of VARIANTS)
		for (const file of CORE_FILES)
			sizes[`${variant.name}/${file}`] = measure(
				readFileSync(join(root, OUT_DIR, variant.name, file)),
			);
	const parts = new Map(
		[...findEngineParts(buildEngineTestPage())].map(([part, file]) => [
			part,
			measure(Buffer.from(file.text)),
		]),
	);
	for (const [part, size] of parts) sizes[`js/${part}`] = size;
	const downloads = downloadSizes(parts);

	console.log('\nsize report (budget for each .wasm file: 600 KB after Brotli)');
	for (const [file, size] of Object.entries(sizes))
		printSize(file, size, file.endsWith('.wasm') ? WASM_BUDGET_BYTES : undefined);
	printSize('js total', totalSize(parts.values()));
	console.log(
		"\nthe engine's JavaScript that a page downloads in each thread mode, besides the core's glue (budget: 70 KB after Brotli)",
	);
	for (const { mode, size } of downloads) printSize(mode, size, JS_BUDGET_BYTES);
	if (options.sizesOnly) {
		writeFileSync(join(root, SIZE_RECORD), `${JSON.stringify(sizes, null, '\t')}\n`);
		console.log(`\nwrote ${SIZE_RECORD}`);
		return;
	}
	console.log('\nthe shader compiler, which only build tools load (no budget)');
	printSize('shader-compiler.wasm', measure(readFileSync(SHADER_COMPILER_PATH)));

	const problems = Object.entries(sizes)
		.filter(([file, size]) => file.endsWith('.wasm') && size.brotli > WASM_BUDGET_BYTES)
		.map(([file]) => `${file} is over its 600 KB Brotli budget`);
	for (const { mode, size } of downloads)
		if (size.brotli > JS_BUDGET_BYTES)
			problems.push(
				`the engine JavaScript that a page downloads in ${mode} mode is over its 70 KB Brotli budget`,
			);
	const growth = options.checkSize ? checkGrowth(sizes, options.base) : [];
	for (const p of [...problems, ...growth]) console.error(`error: ${p}`);
	if (growth.length > 0) {
		console.error('');
		for (const line of SIZE_GROWTH_GUIDANCE) console.error(line);
		console.error(
			'\nThe check reads the trailers of every commit after the base, so an empty commit can carry them.',
		);
	}
	if (problems.length + growth.length > 0) process.exit(1);
}

if (import.meta.main) {
	main().catch((e) => {
		console.error(`error: ${(e as Error).message}`);
		process.exit(1);
	});
}
