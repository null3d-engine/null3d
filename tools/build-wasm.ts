// Builds the engine's two WebAssembly files and the build tools' modules (the shader compiler and
// the asset tool's formats), then reports their sizes and
// the sizes of the engine's JavaScript in a production build of the engine test page. Run from
// the repository root:
//   bun tools/build-wasm.ts                 build everything, then print the size report
//   bun tools/build-wasm.ts --check-size    also compare each file's size with a build of the base
//     [--base <ref>]                        commit, and fail on growth that no trailer explains
//   bun tools/build-wasm.ts --sizes-only    build only what the size report measures, and write the
//                                           sizes for a size check that builds this commit as its base
//   bun tools/build-wasm.ts --prebuilt      measure the WebAssembly files and the build tools' modules
//                                           that an earlier build made, such as CI's build job, instead
//                                           of building them again; combines with --check-size
//   bun tools/build-wasm.ts --check-size --prebuilt --part <i>/<n>
//                                           build the engine test page, measure only part i of n of its
//                                           files, write those sizes to target/size-parts/, and judge
//                                           nothing, so CI can run the n parts at the same time
//   bun tools/build-wasm.ts --check-size --prebuilt --judge-parts <dir> [--base <ref>]
//                                           read every part's sizes from <dir> in place of building the
//                                           engine test page, then report and judge as --check-size does
//   bun tools/build-wasm.ts --print-base    print the commit that --check-size compares with, and stop
//     [--base <ref>]
//   bun tools/build-wasm.ts --cache-key     print one key of every file that --pages-only builds, as
//                                           key=<hash>, for CI's cache of them, and stop
//   bun tools/build-wasm.ts --keep-current  remove every cache entry but those of the files that
//                                           --pages-only builds now, before CI saves the cache
//   bun tools/build-wasm.ts --names         keep the core's function names, for a CPU profile;
//                                           the names add size, so this skips the size checks
//   bun tools/build-wasm.ts --pages-only    build only what the test pages and the tools need,
//                                           with no size report: the two WebAssembly files, the
//                                           shader compiler that the dev server runs on their
//                                           WGSL, and the asset tool's formats
//   bun tools/build-wasm.ts --no-cache      build every file again instead of copying a file that
//                                           an earlier build of the same inputs left in the cache
//
// The threaded build uses atomics and shared memory, so it rebuilds the standard library with
// them. The single-threaded build runs on pages that are not cross-origin isolated. The
// wasm-bindgen command-line tool must match the crate version exactly, so the script downloads
// that release into the build folder and verifies its checksum. The build tools' modules run in
// Node and Bun, never in a page, so they have no size budget. Every mode that builds also builds the
// shader modules when they are missing or out of date, because git does not keep them.
//
// The two WebAssembly files, the build tools' modules and the shader modules build at the same
// time, so that the steps of one build that use a single core (the link, wasm-bindgen and
// wasm-opt) overlap the compile of another. No Rust build reads a shader module, and a check of
// prebuilt files builds only the modules, first. Each build prints its lines as they come, with its
// name in front, and the time of each step. A failed build names itself, and its whole log prints
// again in one piece at the end.
//
// Each file goes in place whole, by a rename from a temporary name (tools/lib/atomic-files.ts). A
// dev server or a browser run of the same checkout can read the files while a build runs, as the
// GPU check's first step builds beside a running test, and a half-written core fails its page.
//
// The build's product is a pure function of its inputs, so each artifact set is cached under a key
// of every input: the core sources' stamp, the variant's flags, the target, the release profile,
// the Rust toolchain and the wasm-bindgen and wasm-opt releases. A hit copies the files in place
// and skips cargo, wasm-bindgen and wasm-opt, which is most of a no-change build and a fresh
// worktree. The cache is the `wasm-artifacts` folder under the one build cache root
// (tools/lib/build-cache.ts); `NULL3D_WASM_ARTIFACTS` still names its own folder, and
// `NULL3D_NO_CACHE=1` (or `--no-cache`) builds every file again. A different input uses another key,
// so a hit can never hold another build's files.
//
// The size check's base is a build of main, or on main and in the merge queue of the commit before:
// tools/lib/size-check.ts picks the commit, and the check builds it in a worktree under
// target/ with that commit's own build script. It keeps the sizes of each base commit it built and
// reuses them. A base build whose worktree is gone or damaged, because something removed it while
// the build ran, makes the tree again and builds once more. Every mode that measures writes the sizes
// to target/size-report.json, so CI can keep a commit's sizes as the base of later checks; a part
// writes only its own share, and the step that judges the parts writes the whole record.
//
// Almost all of the check's time goes into compressing the engine test page's files at the highest
// levels, one file after another, and the first-use shader files hold nearly all of their bytes. So
// --part splits the files: each part builds the same page and measures a share of about equal
// weight (tools/lib/size-report.ts).
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
	statSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSET_FORMATS_URL } from '../packages/cli/src/assets/formats.js';
import { memoryImportLimits } from '../packages/engine/src/shared/wasm-limits';
import { SHADER_COMPILER_URL } from '../packages/vite-plugin/src/shader-compiler';
import { explainedFiles, SIZE_GROWTH_GUIDANCE } from './hooks/check-size-growth';
import { keptCommits } from './hooks/check-trailers';
import { copyInPlace, replaceFolder } from './lib/atomic-files';
import {
	acquireLock,
	acquirePageBuildLock,
	type CargoRun,
	cacheDir,
	cacheOff,
	hashFiles,
	hashOf,
	type LineSink,
	pruneCacheLocked,
	runByLine,
	runCargoAsync,
	secondsSince,
	touchCacheEntry,
	writeFolderAtomic,
} from './lib/build-cache';
import { coreSourcesStamp, stampGlue } from './lib/core-sources';
import { ensureShaderModules, inputHash } from './lib/shader-modules';
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
	keepSizeMemo,
	mergeSizeMemoParts,
	readSizeMemo,
	recordedModules,
	sizeMemoPartFile,
	writeSizeMemo,
} from './lib/size-memo';
import {
	type Budget,
	type BuiltFile,
	budgetProblems,
	budgetWarnings,
	COLUMNS,
	COMBOS_BUDGET,
	type CORE_BUILDS,
	CORE_FILES,
	type Column,
	downloadSizes,
	ENGINE_SOURCE,
	FIRST_USE_SHADER_BUDGET,
	findEngineParts,
	findFirstUseFiles,
	isCombosPart,
	isFirstUseShaderPart,
	isSizePartFile,
	LATER_BUDGET,
	LATER_PARTS,
	measure,
	measureFiles,
	measureSizePart,
	mergeSizeParts,
	type PartSpec,
	parsePartSpec,
	partShare,
	type ReportFile,
	type SizeEntry,
	type SizePart,
	START_BUDGET,
	sizePartFile,
	totalSize,
} from './lib/size-report';

const root = process.cwd();
const CRATE = 'null3d-wasm';
const OUT_DIR = 'packages/engine/dist/wasm';
const TOOLS_DIR = 'target/tools';
/** Where each mode that measures writes the sizes, for a size check that uses this commit as its base. */
const SIZE_RECORD = 'target/size-report.json';
/** Where each part of a split size check writes its share of the sizes, one file per part. */
const SIZE_PARTS_DIR = 'target/size-parts';
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
/** Where the size report builds the engine test page, apart from the build the browser tests serve. */
const JS_BUILD_DIR = 'target/js-size';
/**
 * The modules that build tools load, each from a crate of its own: the shader compiler, which the
 * Vite plugin runs, and the asset tool's formats, which the command-line tool runs. Each goes
 * where its tool loads it from.
 */
const TOOL_MODULES = [
	{
		crate: 'null3d-shaders-wasm',
		/** The crate's folder, whose sources and flags key its cached module. */
		folder: 'crates/null3d-shaders-wasm',
		path: fileURLToPath(SHADER_COMPILER_URL),
	},
	{
		crate: 'null3d-assets-wasm',
		folder: 'crates/null3d-assets-wasm',
		path: fileURLToPath(ASSET_FORMATS_URL),
	},
] as const;

interface Variant {
	name: (typeof CORE_BUILDS)[number];
	rustflags: string;
	cargoArgs: string[];
	wasmOptFeatures: string[];
	/** True when the glue needs `releaseInstance` (`addReleaseInstance`). */
	releasesInstance: boolean;
	/**
	 * True when the core's heap takes back the pages of a reused memory, from one page past the
	 * linker's memory (`crates/null3d-wasm/src/heap.rs`), which `checkHeapStart` checks.
	 */
	reclaimsHeap: boolean;
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
		releasesInstance: true,
		reclaimsHeap: true,
	},
	{
		name: 'single',
		rustflags: '-Ctarget-feature=+simd128',
		cargoArgs: [],
		wasmOptFeatures: COMMON_WASM_FEATURES,
		releasesInstance: false,
		reclaimsHeap: false,
	},
];

/** The glue's variables that hold the instance of the thread. */
const INSTANCE_VARIABLES = 'let wasmModule, wasmInstance, wasm;';

/**
 * Adds `releaseInstance` and `dropMemoryViews` to the glue. wasm-bindgen's glue keeps the instance
 * that its thread started, with views of the instance's memory, and initSync returns that instance
 * on each later call. Each threaded engine has a shared memory of its own, so a page that runs the
 * sketch calls `releaseInstance` once the engine has stopped. The browser can then free the
 * engine's memory, and the next initSync starts a new instance in the memory of the next engine.
 * The glue makes its views again only when it next passes a string or an array, so a view made
 * before the shared memory grew would keep the old buffer object. `dropMemoryViews` forgets them,
 * and the thread's memory views call it at each growth.
 */
export function addReleaseInstance(glue: string): string {
	const views = [...glue.matchAll(/^let (cached\w*Memory0) = null;$/gm)].map((match) => match[1]);
	if (!glue.includes(INSTANCE_VARIABLES) || views.length === 0)
		throw new Error(
			'the glue no longer holds its instance as this build expects: update addReleaseInstance for this wasm-bindgen version',
		);
	const clears = views.map((view) => `    ${view} = null;\n`).join('');
	return `${glue}\nexport function dropMemoryViews() {\n${clears}}\n\nexport function releaseInstance() {\n    wasmModule = wasmInstance = wasm = undefined;\n    dropMemoryViews();\n}\n`;
}
/**
 * Checks that wasm-bindgen added exactly one page to the memory that the linker laid out, for its
 * thread counter and the stack of a starting thread. The core's heap starts after that page when it
 * takes back the pages of a reused memory, so another count would let it overwrite them.
 */
export function checkHeapStart(linked: Uint8Array, bound: Uint8Array): void {
	const before = memoryImportLimits(linked)?.initial;
	const after = memoryImportLimits(bound)?.initial;
	if (before === undefined || after !== before + 1)
		throw new Error(
			`wasm-bindgen made the threaded core's memory ${after ?? 'unknown'} pages from the linker's ${before ?? 'unknown'}, not one page more: update BINDGEN_PAGES in crates/null3d-wasm/src/heap.rs for this wasm-bindgen version`,
		);
}

/**
 * The compiler option that names the Rust library's source folder by the fixed path that the
 * toolchain's own build gives it, `/rustc/<commit>`, from `rustc -vV`'s output. With the library's
 * source installed, the compiler writes that folder's place on the machine into the panic
 * locations of the library code that it compiles. Each machine then built other bytes, and so the
 * hashed name of every file that names a module differed too, and with it that file's size.
 */
export function librarySourceRemap(sysroot: string, rustcVersion: string): string {
	const commit = /^commit-hash: ([0-9a-f]+)$/m.exec(rustcVersion)?.[1];
	if (!commit)
		throw new Error(
			'rustc -vV names no commit hash, so the build cannot give the Rust library source a fixed path',
		);
	return `--remap-path-prefix=${sysroot}/lib/rustlib/src/rust=/rustc/${commit}`;
}

/**
 * The compiler option that names cargo's home folder, where it keeps the sources of the crates that
 * the build downloads, by the fixed path `/cargo`. Those crates write their source paths into
 * their panic locations as the Rust library does, from a folder in each machine's home.
 */
export function cargoHomeRemap(cargoHome: string): string {
	return `--remap-path-prefix=${cargoHome}=/cargo`;
}

/**
 * Refuses a built module that holds one of `folders`, the folders of the machine that built it. A
 * folder in the bytes makes each machine build other bytes, and every page that loads the module
 * would download the folder's name.
 */
export function checkNoMachineFolders(
	bytes: Uint8Array,
	folders: readonly string[],
	module: string,
): void {
	const held = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const found = folders.filter((folder) => held.includes(folder));
	if (found.length > 0)
		throw new Error(
			`${module} holds the build machine's folder ${found.join(' and ')}: give the folder a fixed path with --remap-path-prefix in the build's compiler options`,
		);
}

/** A folder's path without its trailing slashes. */
const trimmed = (folder: string) => folder.replace(/\/+$/, '');

/**
 * Each folder with one trailing slash, as a path inside it starts. The root folder is left out,
 * since every absolute path starts with it.
 */
export function machineFolders(folders: readonly string[]): string[] {
	return folders
		.map(trimmed)
		.filter((folder) => folder !== '')
		.map((folder) => `${folder}/`);
}

/**
 * The compiler options that every WebAssembly build adds to its own, and the folders that no built
 * module may hold: the Rust toolchain's, cargo's home, the checkout's and the home folder. Read
 * once, on the first build that misses the cache. The compiler applies the last option whose
 * folder matches, so the library source's option comes last, in case cargo's home holds it.
 */
let machine: { options: string[]; folders: string[] } | undefined;
function buildMachine() {
	if (!machine) {
		const rustc = (args: string[]) => execFileSync('rustc', args, { cwd: root, encoding: 'utf8' });
		const sysroot = trimmed(rustc(['--print', 'sysroot']).trim());
		const cargoHome = trimmed(process.env.CARGO_HOME || join(homedir(), '.cargo'));
		machine = {
			options: [cargoHomeRemap(cargoHome), librarySourceRemap(sysroot, rustc(['-vV']))],
			folders: machineFolders([sysroot, cargoHome, root, homedir()]),
		};
	}
	return machine;
}

/**
 * The variable that hands cargo the compiler options `options`, then `added`, one by one, so that a
 * folder with a space in its name stays one option.
 */
export function compilerOptions(
	options: string,
	added: readonly string[] = buildMachine().options,
): Record<string, string> {
	return { CARGO_ENCODED_RUSTFLAGS: [...options.split(' '), ...added].join('\x1f') };
}

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

/**
 * The log of one of the builds that run at the same time. It prints each line at once, with the
 * build's name in front, so a long build shows its progress while it runs. It also keeps every line,
 * so that the whole log of a failed build can print again in one piece once every build has ended,
 * and it notes the time that each command took.
 */
export interface BuildLog {
	/** Adds a line of the build's own; `stderr` sends it to the error output. */
	say(line: string, stderr?: boolean): void;
	/** Runs a command in the checkout, adds its output line by line, and throws when it fails. */
	run(command: string, args: readonly string[]): Promise<void>;
	/**
	 * Runs cargo through the caches' one setup, which sets the build folder of the call and sccache,
	 * adds its output line by line, and throws when it fails.
	 */
	cargo(args: readonly string[], env: Record<string, string>, targetDir: string): Promise<void>;
	/** Every line that the build said and that its commands wrote, in order, without the name. */
	text(): string;
}

/** Prints a line to the output, or to the error output. */
const printLine: LineSink = (line, stderr) => (stderr ? console.error(line) : console.log(line));

/** An empty log for the build `name`, which prints through `write`. */
export function buildLog(name: string, write: LineSink = printLine): BuildLog {
	let text = '';
	const say = (line: string, stderr = false) => {
		text += `${line}\n`;
		write(`[${name}] ${line}`, stderr);
	};
	/** Runs a command, and says how long it took, or throws when it failed. */
	const timed = async (
		label: string,
		args: readonly string[],
		start: (onLine: LineSink) => Promise<CargoRun>,
	): Promise<void> => {
		const started = performance.now();
		const { status, error } = await start(say);
		if (error) throw new Error(`could not run ${label}: ${error.message}`);
		if (status !== 0) {
			const ended = status === null ? 'a signal stopped it' : `its exit status was ${status}`;
			throw new Error(`${label} ${args.join(' ')} failed: ${ended}`);
		}
		say(`${label} took ${secondsSince(started)} s`);
	};
	return {
		say,
		run: (command, args) =>
			timed(basename(command), args, (onLine) => runByLine(command, args, { cwd: root, onLine })),
		cargo: (args, env, targetDir) =>
			timed('cargo', args, (onLine) => runCargoAsync(root, args, { env, targetDir, onLine })),
		text: () => text,
	};
}

/** A build that runs beside the others: the name that its lines and its failure give, and its work. */
export interface BuildJob {
	name: string;
	work: (log: BuildLog) => Promise<void>;
}

/** The names joined as a sentence lists them: "a", "a and b", "a, b and c". */
function listed(names: readonly string[]): string {
	return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : `${names[0]}`;
}

/**
 * Runs the builds at the same time, so that the steps of one build that use a single core, such as
 * wasm-bindgen, wasm-opt and the link, overlap the compile of another. Each build prints its lines as
 * they come, with its name in front, and a line that says how it ended and after how long. A build
 * that fails ends its log with its error, and the others still run to their end, so that no command
 * keeps running after the script has stopped. Then each failed build's whole log prints again in one
 * piece, to the error output, so that the failure reads without the other builds' lines, and the call
 * throws, naming each build that failed.
 */
export async function runBuilds(
	builds: readonly BuildJob[],
	write: LineSink = printLine,
): Promise<void> {
	const ends = await Promise.all(
		builds.map(async ({ name, work }) => {
			const log = buildLog(name, write);
			const started = performance.now();
			let failed = false;
			try {
				await work(log);
			} catch (e) {
				log.say(`error: ${(e as Error).message}`, true);
				failed = true;
			}
			const seconds = secondsSince(started);
			write(`[${name}] ${failed ? 'failed after' : 'done in'} ${seconds} s`, failed);
			return { name, failed, seconds, text: log.text() };
		}),
	);
	const failed = ends.filter((end) => end.failed);
	for (const { name, seconds, text } of failed)
		write(
			`\nthe whole log of the ${name} build, which failed after ${seconds} s:\n${text.trimEnd()}`,
			true,
		);
	const names = failed.map(({ name }) => name);
	if (names.length === 1) throw new Error(`the ${names[0]} build failed; its whole log is above`);
	if (names.length > 1)
		throw new Error(`the ${listed(names)} builds failed; their whole logs are above`);
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
	/** Build only what the test pages need: the two WebAssembly files and the shader compiler. */
	pagesOnly: boolean;
	/** Measure the files that an earlier build made, and build only the engine test page. */
	prebuilt: boolean;
	/** Print the commit that the size check compares with, and build nothing. */
	printBase: boolean;
	/** Print one key of every artifact that a `--pages-only` build writes, for CI's cache of them. */
	cacheKey: boolean;
	/** Remove every cache entry but those that a `--pages-only` build writes now. */
	keepCurrent: boolean;
	/** Build every file again, instead of copying a file that an earlier build cached. */
	noCache: boolean;
	/** Build the engine test page, measure only this part of its files and write their sizes. */
	part?: PartSpec;
	/** Read every part's sizes from this folder in place of building the engine test page. */
	judgeParts?: string;
}

const USAGE =
	'usage: bun tools/build-wasm.ts [--no-cache] [--check-size [--base <ref>] [--prebuilt [--part <i>/<n> | --judge-parts <dir>]] | --sizes-only | --prebuilt | --names | --pages-only | --print-base [--base <ref>] | --cache-key | --keep-current]';

/** The options that take a value, with what each needs. */
const VALUE_OPTIONS: Readonly<Record<string, string>> = {
	'--base': 'a commit',
	'--part': 'a part as <i>/<n>',
	'--judge-parts': 'the folder that holds the parts',
};

/** Reads the command line. It throws on an unknown option and on options that exclude each other. */
export function parseOptions(args: readonly string[]): BuildOptions {
	const options: BuildOptions = {
		checkSize: false,
		sizesOnly: false,
		keepNames: false,
		pagesOnly: false,
		prebuilt: false,
		printBase: false,
		cacheKey: false,
		keepCurrent: false,
		noCache: false,
	};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i] as string;
		if (arg === '--check-size') options.checkSize = true;
		else if (arg === '--sizes-only') options.sizesOnly = true;
		else if (arg === '--names') options.keepNames = true;
		else if (arg === '--pages-only') options.pagesOnly = true;
		else if (arg === '--prebuilt') options.prebuilt = true;
		else if (arg === '--print-base') options.printBase = true;
		else if (arg === '--cache-key') options.cacheKey = true;
		else if (arg === '--keep-current') options.keepCurrent = true;
		else if (arg === '--no-cache') options.noCache = true;
		else if (Object.hasOwn(VALUE_OPTIONS, arg)) {
			const value = args[i + 1];
			if (!value || value.startsWith('-'))
				throw new Error(`${arg} needs ${VALUE_OPTIONS[arg]}. ${USAGE}`);
			i++;
			if (arg === '--base') options.base = value;
			else if (arg === '--part') options.part = parsePartSpec(value);
			else options.judgeParts = value;
		} else throw new Error(`unknown option ${arg}. ${USAGE}`);
	}
	if (options.keepNames && (options.checkSize || options.sizesOnly))
		throw new Error('--names adds the function names to the core, so it cannot measure sizes');
	if (options.pagesOnly && (options.checkSize || options.sizesOnly))
		throw new Error('--pages-only makes no size report, so it cannot measure sizes');
	if (options.checkSize && options.sizesOnly)
		throw new Error(
			'--sizes-only measures a base for the size check, so it cannot also run the check',
		);
	if (options.prebuilt && (options.keepNames || options.pagesOnly || options.sizesOnly))
		throw new Error(
			'--prebuilt measures the files of an earlier build, so it cannot build them with other options',
		);
	if (
		options.printBase &&
		(options.checkSize ||
			options.sizesOnly ||
			options.keepNames ||
			options.pagesOnly ||
			options.prebuilt)
	)
		throw new Error(`--print-base builds nothing, so it takes only --base. ${USAGE}`);
	if (options.base !== undefined && !options.checkSize && !options.printBase)
		throw new Error(`--base names the commit that --check-size compares with. ${USAGE}`);
	const split = options.part !== undefined || options.judgeParts !== undefined;
	if (split && !(options.checkSize && options.prebuilt))
		throw new Error(
			`--part and --judge-parts split the size check of an earlier build, so each needs --check-size --prebuilt. ${USAGE}`,
		);
	if (options.part && options.judgeParts !== undefined)
		throw new Error('--part measures one part and --judge-parts judges them all, in separate runs');
	if (options.part && options.base !== undefined)
		throw new Error('--part judges nothing, so it takes no --base: give --base to --judge-parts');
	return options;
}

/**
 * Where cargo builds: this checkout's own `target` unless `override` names another folder. Two
 * checkouts never share one Rust build folder. Cargo finds the engine's crates at the same
 * workspace paths in both and judges them fresh by file times, so a shared folder lets one
 * checkout's build link the other's crates, and the content-keyed caches would then store that
 * output under this checkout's key. sccache, when installed, still compiles the dependency crates
 * once for every checkout (see cargoEnv). The value `local` names this checkout's folder too.
 */
export function cargoTargetBase(checkout: string, override?: string): string {
	return override && override !== 'local' ? override : join(checkout, 'target');
}

const CARGO_TARGET_BASE = cargoTargetBase(root, process.env.NULL3D_CARGO_TARGET);

/** The Rust build folder of a variant. */
const buildFolder = (variant: Variant) => `${CARGO_TARGET_BASE}/wasm-${variant.name}`;

/**
 * Where a variant's wasm-bindgen output and its optimized wasm are staged before they go in place.
 * It lives in this checkout and carries the process id, so no two builds ever share one, in one
 * checkout or in several. A shared staging folder lets one build remove
 * another's half-written output, which makes wasm-opt fail with "Failed opening output file". Because
 * a folder belongs to one build, a build never needs to wait for another.
 */
export function variantStagingFolder(variant: Variant): string {
	return join(root, 'target', `wasm-${variant.name}`, `out-${process.pid}`);
}

/** The lock that keeps two builds of one set of output files from putting them in place at once. */
function withInstallLock<T>(name: string, work: () => T): T {
	const release = acquireLock(join(root, 'target', `install-${name}.lock`));
	try {
		return work();
	} finally {
		release();
	}
}

/**
 * The size check's lock, in the checkout that runs it. An ordinary build takes no lock: it stages in
 * a folder of its own (see variantStagingFolder), and Cargo locks the target folder while it writes.
 * A size check takes this lock, because it also builds the base commit with that commit's own build
 * script, and that tree lives in this checkout's target too. One lock over the whole check keeps two
 * checks, or a check and an older build, from removing each other's staged files. Each checkout has
 * its own lock file, so two checkouts' size checks run at the same time.
 */
export function sizeCheckLock(checkout: string): string {
	return join(checkout, 'target', 'build.lock');
}

const SIZE_CHECK_LOCK = sizeCheckLock(root);

/**
 * Takes the size check's lock and returns the function that releases it. Ordinary builds do not take
 * it, so the team's builds overlap; a size check does, across its base build too.
 */
export function acquireBuildLock(): () => void {
	// A build that a size check starts runs inside its parent's lock, and must not wait for it.
	if (process.env.NULL3D_BUILD_LOCK_HELD === '1') return () => {};
	return acquireLock(SIZE_CHECK_LOCK, { freesSlot: true });
}

/**
 * The cache of built artifacts, keyed by every input of the build. A hit copies the files in place
 * and skips cargo, wasm-bindgen and wasm-opt. It is shared by every checkout on the machine, so a
 * no-change build and a fresh worktree skip the link. Set `NULL3D_WASM_ARTIFACTS` to another
 * folder, or to `local` to keep the cache inside this checkout. `NULL3D_NO_BUILD_CACHE=1` and
 * `--no-cache` build every file again. A cache that cannot be written does not fail a build.
 */
const ARTIFACT_CACHE_BASE =
	process.env.NULL3D_WASM_ARTIFACTS === 'local'
		? join(root, 'target', 'wasm-artifacts')
		: cacheDir('wasm-artifacts', process.env.NULL3D_WASM_ARTIFACTS);
/** Bumped when the key or the layout changes, which refuses every entry an earlier version wrote. */
const ARTIFACT_FORMAT = 2;
/** The file that holds each entry's file names and their hashes. */
const ARTIFACT_RECORD = 'artifacts.json';
/**
 * Every file a core build writes into a variant's folder: wasm-bindgen's glue and its type
 * declarations, and the optimized WebAssembly file. The cache holds and restores them all, so a hit
 * leaves the folder as a full build does. The size report measures only the two in `CORE_FILES`.
 */
const CORE_ARTIFACTS = [
	'null3d.js',
	'null3d_bg.wasm',
	'null3d.d.ts',
	'null3d_bg.wasm.d.ts',
] as const;

/**
 * What identifies the exact tool binaries of a build, part of every cache key: the Rust toolchain,
 * and this machine's wasm-bindgen and wasm-opt releases.
 */
export interface ToolVersions {
	rust: string;
	bindgen: string;
	wasmOpt: string;
}

/** The versions that identify this machine's build tools, for the cache key. */
function toolVersions(cargoLock: string): ToolVersions {
	const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
		devDependencies?: Record<string, string>;
	};
	return {
		rust: readFileSync(join(root, 'rust-toolchain.toml'), 'utf8'),
		bindgen: `${lockedVersion(cargoLock, 'wasm-bindgen')}-${releaseTarget(process.platform, process.arch)}`,
		wasmOpt: `${manifest.devDependencies?.binaryen ?? 'unknown'}-${process.platform}-${process.arch}`,
	};
}

/** The hash of `data`, for a cache key and for the record that checks an entry. */
const digest = hashOf;

/**
 * A hash of the build's own code: this script and the module that rewrites a built module's glue.
 * A build writes the glue itself (see stampGlue and addReleaseInstance), and this script decides the
 * flags, the module names and the staging, so both decide what an entry holds. Neither is a Rust
 * source, so neither shows up in the sources' stamp: without this an edit to the glue kept serving
 * the entry that the earlier version wrote.
 */
export function buildCodeHash(checkout: string): string {
	return hashFiles(checkout, ['tools/build-wasm.ts', 'tools/lib/core-sources.ts']);
}

/**
 * The key of a core variant's artifacts: the sources' stamp, the variant's flags, the target, the
 * release profile, the tool versions and the build's own code, which rewrites the glue. Any other
 * input gives another key, so a hit holds exactly the bytes that this build would write.
 */
export function variantKey(
	variant: Variant,
	stamp: string,
	keepNames: boolean,
	tools: ToolVersions,
): string {
	return digest(
		[
			`format=${ARTIFACT_FORMAT}`,
			'kind=core',
			`variant=${variant.name}`,
			`code=${buildCodeHash(root)}`,
			`stamp=${stamp}`,
			`rustflags=${variant.rustflags}`,
			`cargoArgs=${variant.cargoArgs.join(' ')}`,
			`wasmOptFeatures=${variant.wasmOptFeatures.join(' ')}`,
			`keepNames=${keepNames ? '1' : '0'}`,
			'target=wasm32-unknown-unknown',
			'profile=release',
			`rust=${tools.rust}`,
			`bindgen=${tools.bindgen}`,
			`wasmOpt=${tools.wasmOpt}`,
		].join('\n'),
	);
}

/** The key of the build tools' modules, from their crates' inputs and the same code, flags and versions. */
export function toolsKey(shaders: string, assets: string, tools: ToolVersions): string {
	return digest(
		[
			`format=${ARTIFACT_FORMAT}`,
			'kind=tools',
			`code=${buildCodeHash(root)}`,
			`shaders=${shaders}`,
			`assets=${assets}`,
			'rustflags=-Cstrip=symbols',
			'target=wasm32-unknown-unknown',
			'profile=release',
			`rust=${tools.rust}`,
		].join('\n'),
	);
}

/** The key of each cache entry that a build of the cores and the tools' modules writes, as it reads them. */
export function currentArtifactKeys(): string[] {
	const tools = toolVersions(readFileSync(join(root, 'Cargo.lock'), 'utf8'));
	const stamp = coreSourcesStamp(root);
	const [shaders, assets] = toolInputs(root);
	return [
		...VARIANTS.map((variant) => variantKey(variant, stamp, false, tools)),
		toolsKey(shaders, assets, tools),
	];
}

/**
 * One key of every artifact that a build of the cores and the tools' modules writes: a hash of each
 * entry's own key, so it changes exactly when one of the entries would. CI keeps the cache folder
 * under it, so a run whose Rust sources, flags and tools did not change copies every file in place
 * and runs no cargo, wasm-bindgen or wasm-opt. A run that changed some of them restores an earlier
 * run's folder, copies the entries that still match, and builds only the others.
 */
export function artifactsKey(): string {
	return digest(currentArtifactKeys().join('\n'));
}

/**
 * Removes every entry of the cache folder `base` but those named in `keep`, and returns the names it
 * removed. An entry that another build is writing, and a lock, stay. The prune's lock keeps it from
 * running beside a prune of the same folder.
 */
export function keepOnlyArtifacts(base: string, keep: ReadonlySet<string>): string[] {
	if (!existsSync(base)) return [];
	const release = acquireLock(`${base}.prune.lock`);
	try {
		const removed: string[] = [];
		for (const name of readdirSync(base)) {
			if (keep.has(name) || name.endsWith('.partial') || name.endsWith('.lock')) continue;
			rmSync(join(base, name), { recursive: true, force: true });
			removed.push(name);
		}
		return removed;
	} finally {
		release();
	}
}

/**
 * The input hashes of the two crates that the build tools' modules come from, in `TOOL_MODULES`
 * order. A crate is named by its folder, which `inputHash` reads, so a name without its `crates/`
 * step would throw here and fail every build before it could cache anything.
 */
export function toolInputs(root: string): [string, string] {
	return [inputHash(root, TOOL_MODULES[0].folder), inputHash(root, TOOL_MODULES[1].folder)];
}

/**
 * The folder of the cache entry `key`, when it holds every named file with the recorded bytes, or
 * null on a miss. A missing or edited file, and a record that will not parse, are misses, so the
 * caller builds and writes the entry again. Every file the record names is checked, not only the
 * named ones, so a hit never serves a file that is not the one the build wrote.
 */
export function readArtifacts(base: string, key: string, names: readonly string[]): string | null {
	const folder = join(base, key);
	let record: Record<string, string>;
	try {
		record = JSON.parse(readFileSync(join(folder, ARTIFACT_RECORD), 'utf8')) as Record<
			string,
			string
		>;
	} catch {
		return null;
	}
	for (const name of names) if (!(name in record)) return null;
	for (const name of Object.keys(record)) {
		try {
			if (record[name] !== digest(readFileSync(join(folder, name)))) return null;
		} catch {
			return null;
		}
	}
	return folder;
}

/** The files of a cache entry `folder`, in order, which `readArtifacts` has already checked. */
export function artifactFiles(folder: string): string[] {
	try {
		const record = JSON.parse(readFileSync(join(folder, ARTIFACT_RECORD), 'utf8')) as Record<
			string,
			string
		>;
		return Object.keys(record)
			.filter((name) => name !== ARTIFACT_RECORD)
			.sort();
	} catch {
		return [];
	}
}

/**
 * Stores the files of `sources`, each under its name, at `base` under `key`, with the record that
 * checks them. Returns false when the cache cannot be written, which is not an error: the build's
 * output is already in place, and the next build writes the entry again.
 */
export function writeArtifacts(
	base: string,
	key: string,
	sources: readonly (readonly [string, string])[],
): boolean {
	const folder = join(base, key);
	return writeFolderAtomic(folder, (staging) => {
		const record: Record<string, string> = {};
		for (const [name, source] of sources) {
			const file = join(staging, name);
			copyFileSync(source, file);
			record[name] = digest(readFileSync(file));
		}
		writeFileSync(join(staging, ARTIFACT_RECORD), `${JSON.stringify(record, null, '\t')}\n`);
	});
}

/** Stores a build's files in the artifact cache under `key`, then prunes the cache. */
function storeArtifacts(
	log: BuildLog,
	key: string,
	sources: readonly (readonly [string, string])[],
): void {
	if (!writeArtifacts(ARTIFACT_CACHE_BASE, key, sources))
		log.say('warning: could not write the build cache; the build continues', true);
	pruneCacheLocked(ARTIFACT_CACHE_BASE);
}

/**
 * Builds a variant's WebAssembly file and its generated module, which holds `stamp`, the stamp of
 * the Rust sources that the build read. It copies the files of an earlier build of the same inputs
 * from the cache, when there is one, and skips cargo, wasm-bindgen and wasm-opt. Its lines go to
 * `log`, which names the build, because it runs at the same time as the other builds (see runBuilds).
 */
async function buildVariant(
	log: BuildLog,
	variant: Variant,
	bindgen: () => Promise<string>,
	keepNames: boolean,
	stamp: string,
	tools: ToolVersions,
	noCache: boolean,
): Promise<void> {
	const targetDir = buildFolder(variant);
	const dest = join(root, OUT_DIR, variant.name);
	const key = variantKey(variant, stamp, keepNames, tools);
	const cached = noCache ? null : readArtifacts(ARTIFACT_CACHE_BASE, key, CORE_ARTIFACTS);
	if (cached) {
		log.say(`the ${variant.name} WebAssembly file is unchanged, copying it from the cache`);
		// The entry is in use now, so pruning keeps it while this build copies from it.
		touchCacheEntry(cached);
		withInstallLock(variant.name, () => {
			for (const name of artifactFiles(cached)) copyInPlace(join(cached, name), join(dest, name));
		});
		return;
	}
	log.say(`building the ${variant.name} WebAssembly file`);
	await log.cargo(
		['build', '-p', CRATE, '--release', '--target', 'wasm32-unknown-unknown', ...variant.cargoArgs],
		compilerOptions(variant.rustflags),
		targetDir,
	);
	// The files take shape in this build's own staging folder, and go in place whole once every step
	// and check passed (see variantStagingFolder).
	const staged = variantStagingFolder(variant);
	rmSync(staged, { recursive: true, force: true });
	const linked = `${targetDir}/wasm32-unknown-unknown/release/${CRATE.replace(/-/g, '_')}.wasm`;
	await log.run(await bindgen(), [
		'--target',
		'web',
		'--out-dir',
		staged,
		'--out-name',
		'null3d',
		linked,
	]);
	const glue = join(staged, 'null3d.js');
	const text = readFileSync(glue, 'utf8');
	writeFileSync(glue, stampGlue(variant.releasesInstance ? addReleaseInstance(text) : text, stamp));
	const wasm = `${staged}/null3d_bg.wasm`;
	await log.run(join(root, 'node_modules/.bin/wasm-opt'), [
		'-O3',
		// wasm-opt drops the name section unless it keeps debug information.
		...(keepNames ? ['--debuginfo'] : []),
		...variant.wasmOptFeatures,
		wasm,
		'-o',
		wasm,
	]);
	if (variant.reclaimsHeap) checkHeapStart(readFileSync(linked), readFileSync(wasm));
	checkNoMachineFolders(
		readFileSync(wasm),
		buildMachine().folders,
		`the ${variant.name} WebAssembly file`,
	);
	// Every file the build staged, which replaceFolder then puts in place: the same set a read restores.
	const stagedFiles = readdirSync(staged)
		.filter((name) => !name.endsWith('.partial'))
		.map((name) => [name, join(staged, name)] as const);
	// The key was taken before cargo read the sources. If an edit landed while this build ran, the
	// output is not what the key names, and storing it would hand these files to every checkout whose
	// sources match the key. The glue carries the stamp of the sources that the build read, so such a
	// core fails with E1402 on the next page load and asks for a build.
	if (!noCache) {
		if (coreSourcesStamp(root) === stamp) storeArtifacts(log, key, stagedFiles);
		else
			log.say(
				'warning: the core sources changed while this build ran, so the cache stores nothing for it; build again',
				true,
			);
	}
	// Each build stages in a folder of its own, so the put-in-place step is the only place two builds
	// of one checkout can still meet. A lock over it keeps one build's file set from mixing with
	// another's, which would leave a module from one build beside a WebAssembly file from the other.
	withInstallLock(variant.name, () => replaceFolder(staged, dest));
}

/**
 * Builds the build tools' modules. Each takes and gives its data through its memory, so it needs
 * no JavaScript glue. The build drops the function names and skips wasm-opt, which on the shader
 * compiler takes longer than the whole build, saves almost nothing after Brotli and makes compiles
 * no faster. It copies the modules of an earlier build of the same inputs from the cache, when
 * there is one. Its lines go to `log`, as buildVariant's do.
 */
async function buildToolModules(
	log: BuildLog,
	tools: ToolVersions,
	noCache: boolean,
): Promise<void> {
	const names = TOOL_MODULES.map(({ crate }) => `${crate}.wasm`);
	const [shaders, assets] = toolInputs(root);
	const key = toolsKey(shaders, assets, tools);
	const cached = noCache ? null : readArtifacts(ARTIFACT_CACHE_BASE, key, names);
	if (cached) {
		log.say(
			"the shader compiler and the asset tool's formats are unchanged, copying them from the cache",
		);
		// The entry is in use now, so pruning keeps it while this build copies from it.
		touchCacheEntry(cached);
		withInstallLock('tools', () => {
			for (const { crate, path } of TOOL_MODULES) copyInPlace(join(cached, `${crate}.wasm`), path);
		});
		return;
	}
	const targetDir = `${CARGO_TARGET_BASE}/wasm-shaders`;
	log.say("building the shader compiler and the asset tool's formats");
	await log.cargo(
		[
			'build',
			...TOOL_MODULES.flatMap(({ crate }) => ['-p', crate]),
			'--release',
			'--target',
			'wasm32-unknown-unknown',
		],
		compilerOptions('-Cstrip=symbols'),
		targetDir,
	);
	const built = (crate: string) =>
		`${targetDir}/wasm32-unknown-unknown/release/${crate.replace(/-/g, '_')}.wasm`;
	for (const { crate } of TOOL_MODULES)
		checkNoMachineFolders(readFileSync(built(crate)), buildMachine().folders, `${crate}.wasm`);
	withInstallLock('tools', () => {
		for (const { crate, path } of TOOL_MODULES) copyInPlace(built(crate), path);
	});
	// The tools' crates are hashed before cargo builds them, so an edit during the build means these
	// modules are not what the key names (see buildVariant, which takes the same care).
	if (!noCache) {
		const [nowShaders, nowAssets] = toolInputs(root);
		if (nowShaders === shaders && nowAssets === assets)
			storeArtifacts(
				log,
				key,
				TOOL_MODULES.map(({ crate, path }) => [`${crate}.wasm`, path] as const),
			);
		else
			log.say(
				"warning: the tools' crate sources changed while this build ran, so the cache stores nothing for it; build again",
				true,
			);
	}
}

/**
 * Builds the engine test page for production with hidden source maps, which leave the JavaScript
 * as it ships, and reads each JavaScript file with the source files it holds. The core's glue and
 * the shader build's device modules are copied as they are and have no map: a device module's
 * file holds its module alone, which its name gives. Vite writes a worker's source paths from the
 * build folder and the page's from its assets folder, both inside the repository, so a path
 * without its leading steps up is the path from the repository's root.
 */
function buildEngineTestPage(): BuiltFile[] {
	console.log('\nbuilding the engine test page for production');
	// The build folder is outside the project, so the build does not empty it. A file of an earlier
	// build would then read as a part of this one, and a chunk that this build writes to another
	// name leaves the earlier copy behind.
	rmSync(join(root, JS_BUILD_DIR), { recursive: true, force: true });
	const release = acquirePageBuildLock();
	try {
		const args = ['vite', 'build', '--sourcemap', 'hidden', '--outDir', JS_BUILD_DIR];
		// The report names every file that the build writes, so a build with many first-use shader
		// files prints more than a capture of a megabyte holds; a smaller buffer kills the build.
		const build = spawnSync('bunx', args, {
			cwd: root,
			encoding: 'utf8',
			maxBuffer: 64 * 1024 * 1024,
		});
		if (build.status !== 0)
			throw new Error(`the production build failed:\n${build.stdout}\n${build.stderr}`);
	} finally {
		release();
	}
	const assets = join(root, JS_BUILD_DIR, 'assets');
	return readdirSync(assets).flatMap((file) => {
		if (!file.endsWith('.js')) return [];
		const text = readFileSync(join(assets, file), 'utf8');
		const mapped = join(assets, `${file}.map`);
		if (existsSync(mapped)) {
			const map = JSON.parse(readFileSync(mapped, 'utf8')) as { sources: string[] };
			const sources = map.sources.map((source) => source.replace(/^(\.\.?\/)+/, ''));
			return [{ file, text, sources }];
		}
		const shaders = /^(shaders-[a-z0-9-]+)-[\w-]{8}\.js$/.exec(file)?.[1];
		if (shaders) return [{ file, text, sources: [`${ENGINE_SOURCE}generated/${shaders}.js`] }];
		// A target's table of shared paragraphs is emitted at a name of its own, without the hash
		// that a copied file's name carries, so its name alone says which module it holds.
		const table = /^(shader-paragraphs-[a-z0-9-]+)\.js$/.exec(file)?.[1];
		return table ? [{ file, text, sources: [`${ENGINE_SOURCE}generated/${table}.js`] }] : [];
	});
}

/**
 * Builds the engine test page and lists the files that the size report measures, in the report's
 * order: the engine's JavaScript by part, then the files besides code that load on first use.
 */
function engineTestPageFiles(): ReportFile[] {
	const js = [...findEngineParts(buildEngineTestPage())].map(([part, file]) => ({
		name: `js/${part}`,
		built: file.file,
		weight: file.text.length,
		read: () => Buffer.from(file.text),
	}));
	const assets = join(root, JS_BUILD_DIR, 'assets');
	const firstUse = [...findFirstUseFiles(readdirSync(assets))].map(([file, built]) => {
		const path = join(assets, built);
		return {
			name: `first-use/${file}`,
			built,
			weight: statSync(path).size,
			read: () => readFileSync(path),
		};
	});
	return [...js, ...firstUse];
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/**
 * Builds the engine test page, measures the share of its files that `spec` names, and writes those
 * sizes to the part's file for the run that judges every part. It prints its progress, since the
 * compression takes minutes, and judges nothing.
 */
async function writeSizePart(spec: PartSpec): Promise<void> {
	const files = engineTestPageFiles();
	const share = partShare(files, spec);
	const total = files.reduce((sum, file) => sum + (share.has(file.name) ? file.weight : 0), 0);
	console.log(
		`\nmeasuring part ${spec.index} of ${spec.count}: ${share.size} of ${files.length} files, ${mb(total)}`,
	);
	const started = performance.now();
	let done = 0;
	let tenths = 0;
	const memo = readSizeMemo();
	const record = await measureSizePart(
		files,
		spec,
		({ weight }) => {
			done += weight;
			const reached = total > 0 ? Math.floor((done / total) * 10) : 10;
			if (reached <= tenths) return;
			tenths = reached;
			const seconds = secondsSince(started);
			console.log(`  ${tenths * 10}% of the part's bytes measured, after ${seconds} s`);
		},
		memo,
	);
	printMemoUse(share.size, memo.compressed);
	const path = join(root, SIZE_PARTS_DIR, sizePartFile(spec));
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(record, null, '\t')}\n`);
	writeSizeMemo(join(root, SIZE_PARTS_DIR, sizeMemoPartFile(spec)), memo);
	console.log(`\nwrote ${relative(root, path)}`);
}

/** Prints how many of a measuring's files it compressed, and how many the memo held. */
function printMemoUse(files: number, compressed: number): void {
	console.log(
		`compressed ${compressed} of ${files} files; the size memo held the sizes of the rest`,
	);
}

/** The sizes of `files`, through the memo, which then holds the entries of these files alone. */
async function measureWithMemo(files: readonly ReportFile[]): Promise<Map<string, SizeEntry>> {
	const memo = readSizeMemo();
	const sizes = await measureFiles(files, undefined, memo);
	printMemoUse(files.length, memo.compressed);
	keepSizeMemo(memo, recordedModules(root));
	return sizes;
}

/** The sizes of the engine test page's files, merged from every part's file in `dir`. */
function readSizeParts(dir: string): Map<string, SizeEntry> {
	const folder = resolve(root, dir);
	const names = existsSync(folder) ? readdirSync(folder).filter(isSizePartFile).sort() : [];
	if (names.length === 0)
		throw new Error(
			`${dir} holds no part's sizes: each --part <i>/<n> writes ${SIZE_PARTS_DIR}/part-<i>-of-<n>.json`,
		);
	console.log(`\nmerging the sizes of ${names.length} parts from ${dir}`);
	return mergeSizeParts(
		names.map((name) => JSON.parse(readFileSync(join(folder, name), 'utf8')) as SizePart),
	);
}

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

/**
 * One line of the report: the size in each column, and the share of each column's budget, where
 * the column has one. The line ends with Brotli's share, which the gate's record reads.
 */
function printSize(name: string, size: SizeEntry, budget: Partial<Budget> = {}): void {
	const share = (column: Column, limit: number) => ((size[column] / limit) * 100).toFixed(1);
	const columns = COLUMNS.map((column) => {
		const text = `${column} ${kb(size[column]).padStart(10)}`;
		const limit = budget[column];
		return limit && column !== 'brotli'
			? `${text} ${`(${share(column, limit)}%)`.padStart(8)}`
			: text;
	});
	const brotliShare = budget.brotli ? `  ${share('brotli', budget.brotli)}% of budget` : '';
	console.log(`  ${name.padEnd(28)} ${columns.join('   ')}${brotliShare}`);
}

/** A section's heading's note of a budget, in each column. */
const budgetNote = (budget: Budget) =>
	`budget: ${kb(budget.brotli)} after Brotli, ${kb(budget.gzip)} after gzip, ${kb(budget.raw)} uncompressed`;

interface Base {
	sha: string;
	subject: string;
	/** Why the check picked this commit. */
	why: string;
}

/** HEAD's merge base with a branch of origin, after a fetch of the branch. Offline, the last fetch serves. */
function mergeBaseWith(branch: string): string {
	const remote = `origin/${branch}`;
	console.error(`\nfetching ${remote} for the size check's base`);
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

/**
 * Why the base worktree is locked. `git worktree list` shows it, and `git worktree remove` and
 * `git worktree prune` refuse a locked worktree, so a tidy-up of the clone's worktrees leaves it.
 * On 24 October 2026 a sweep of worktrees whose commit had landed removed a base worktree while its
 * page build ran, and the check failed with ENOENT on a file that the build had just written.
 */
const BASE_TREE_LOCK =
	'the size check of tools/build-wasm.ts builds its base commit here, and reuses this worktree';

/** Puts the base worktree at the commit, and makes it when it is missing or broken. True when new. */
function checkoutBaseTree(tree: string, sha: string): boolean {
	if (existsSync(join(tree, '.git'))) {
		const args = ['checkout', '--force', '--quiet', '--detach', sha];
		if (spawnSync('git', args, { cwd: tree }).status === 0) {
			// A worktree from before the lock gets it now; a locked one refuses a second lock.
			spawnSync('git', ['worktree', 'lock', '--reason', BASE_TREE_LOCK, tree], { cwd: root });
			return false;
		}
	}
	rmSync(tree, { recursive: true, force: true });
	// --force twice also takes over the path when git still lists a worktree there that was deleted,
	// locked or not.
	git([
		'worktree',
		'add',
		'--force',
		'--force',
		'--lock',
		'--reason',
		BASE_TREE_LOCK,
		'--detach',
		tree,
		sha,
	]);
	return true;
}

/**
 * Copies this checkout's Rust build folders into a new base worktree with their file times, and
 * shares the downloaded wasm-bindgen, whose folder names its version. The base build then runs with
 * `NULL3D_CARGO_TARGET=local`, so it compiles into the worktree's own `target/wasm-<variant>` even
 * when the base commit's build script defaults to a shared folder. The worktree's files are newer
 * than the copies, so Cargo rebuilds the engine's crates from the base's code and reuses the standard
 * library and the dependencies.
 */
function seedBuildFolders(tree: string): void {
	mkdirSync(join(tree, 'target'), { recursive: true });
	for (const variant of VARIANTS) {
		// buildFolder is absolute: this checkout's target, or the folder that overrides it.
		const folder = buildFolder(variant);
		if (existsSync(folder))
			execFileSync('cp', ['-Rp', folder, join(tree, 'target', `wasm-${variant.name}`)]);
	}
	if (existsSync(join(root, TOOLS_DIR))) symlinkSync(join(root, TOOLS_DIR), join(tree, TOOLS_DIR));
}

/**
 * True when the base worktree cannot build as it stands: its checkout is gone, or a tracked file is
 * missing or changed. A tidy-up of worktrees, or a clean of the checkout's target folder, removes
 * the tree wherever it stands, and a removal that stops part way leaves a tree without its files.
 */
export function baseTreeDamaged(tree: string): boolean {
	if (!existsSync(join(tree, '.git'))) return true;
	const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], {
		cwd: tree,
		encoding: 'utf8',
	});
	return status.status !== 0 || status.stdout.trim() !== '';
}

/** Builds the base commit in the base worktree and keeps its sizes in `kept`. */
function buildBase(sha: string, kept: string, tree: string): void {
	console.log(`\nbuilding the base, ${sha.slice(0, 8)}, in ${BASE_TREE}`);
	if (checkoutBaseTree(tree, sha)) seedBuildFolders(tree);
	run('bun', ['install', '--frozen-lockfile'], { HUSKY: '0' }, tree);
	const committed = existsSync(join(tree, COMMITTED_RECORD));
	// The base builds into the worktree's own target, seeded from this checkout, so it never
	// writes this checkout's build folder or the shared cache's staging folder.
	run(
		'bun',
		['tools/build-wasm.ts', committed ? '--update-size' : '--sizes-only'],
		// The base runs inside this process's lock, so it must not wait for that same lock.
		{ NULL3D_CARGO_TARGET: 'local', NULL3D_BUILD_LOCK_HELD: '1' },
		tree,
	);
	mkdirSync(dirname(kept), { recursive: true });
	copyFileSync(join(tree, committed ? COMMITTED_RECORD : SIZE_RECORD), kept);
}

/**
 * The base commit's sizes. The check keeps them by commit and reuses them. Otherwise it builds the
 * commit in the base worktree with the commit's own build script, so the base has that commit's
 * flags, toolchain and list of parts. A build whose worktree is gone or damaged, because something
 * removed it while the build ran, makes the tree again and builds once more. A failure beside a
 * worktree whose checkout is whole is thrown as it comes.
 */
function baseSizes(sha: string): Record<string, Pick<SizeEntry, 'brotli'>> {
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
		for (let attempt = 1; ; attempt++) {
			try {
				buildBase(sha, kept, tree);
				break;
			} catch (error) {
				if (attempt > 1 || !baseTreeDamaged(tree)) throw error;
				console.warn(
					`\nthe base worktree is gone or damaged, so the check makes it again and builds the base once more`,
				);
			}
		}
	} finally {
		if (group) console.log('::endgroup::');
	}
	console.log(`built the base in ${secondsSince(started)} s`);
	return JSON.parse(readFileSync(kept, 'utf8'));
}

/**
 * Compares each file's size with the base build and shows the growth in the log and in CI's job
 * summary. Returns a problem for each file that grew past the limit with no trailer to explain it.
 */
function checkGrowth(sizes: Record<string, SizeEntry>, ref: string | undefined): string[] {
	const base = resolveBase(chooseBase(ref, process.env));
	const changes = compareSizes(baseSizes(base.sha), sizes);
	const grown = grownFiles(changes).map(({ file }) => file);
	const explainedBy = explainedFiles(keptCommits(`${base.sha}..HEAD`, root), grown);
	const short = base.sha.slice(0, 8);
	console.log(`\ngrowth after Brotli against the base, ${short} "${base.subject}", ${base.why}`);
	for (const line of growthLines(changes, explainedBy)) console.log(line);
	const summary = process.env.GITHUB_STEP_SUMMARY;
	if (summary)
		appendFileSync(summary, growthSummary(changes, explainedBy, `\`${short}\`, ${base.why}`));
	return growthProblems(changes, explainedBy);
}

/** Throws unless an earlier build made every file that the size report measures. */
function checkPrebuilt(): void {
	const missing = [
		...VARIANTS.flatMap((variant) =>
			CORE_FILES.map((file) => join(root, OUT_DIR, variant.name, file)),
		),
		...TOOL_MODULES.map(({ path }) => path),
	].filter((path) => !existsSync(path));
	if (missing.length > 0)
		throw new Error(
			`--prebuilt measures an earlier build, but these files are missing: ${missing.join(', ')}. Build them with bun tools/build-wasm.ts --pages-only first`,
		);
}

async function main(): Promise<void> {
	const options = parseOptions(process.argv.slice(2));
	if (options.printBase) {
		console.log(resolveBase(chooseBase(options.base, process.env)).sha);
		return;
	}
	if (options.cacheKey) {
		console.log(`key=${artifactsKey()}`);
		return;
	}
	if (options.keepCurrent) {
		const removed = keepOnlyArtifacts(ARTIFACT_CACHE_BASE, new Set(currentArtifactKeys()));
		console.log(`removed ${removed.length} cache entries that this build does not write`);
		return;
	}
	// Only a size check takes the lock: it also builds the base commit with that commit's own build
	// script, which may stage into the shared target folder. Ordinary builds overlap, because each one
	// stages in a folder of its own and Cargo locks the target folder that builds share. The lock is
	// released on exit, so a finished, failed or interrupted check leaves none behind.
	if (options.checkSize) {
		const release = acquireBuildLock();
		process.once('exit', release);
		for (const signal of ['SIGINT', 'SIGTERM'] as const)
			process.once(signal, () => {
				release();
				process.exit(signal === 'SIGINT' ? 130 : 143);
			});
	}
	// The step that judges the parts builds no page, so it reads no shader module.
	const modules = options.judgeParts === undefined;
	if (options.prebuilt) {
		if (modules) ensureShaderModules(root);
		checkPrebuilt();
	} else {
		const cargoLock = readFileSync(join(root, 'Cargo.lock'), 'utf8');
		// wasm-bindgen is fetched only when a core misses the cache, so a run that copies every file
		// in place downloads nothing.
		let bindgenPath: Promise<string> | undefined;
		const bindgen = () => (bindgenPath ??= wasmBindgen(lockedVersion(cargoLock, 'wasm-bindgen')));
		// The stamp of the sources as the build starts, which the builds then read.
		const stamp = coreSourcesStamp(root);
		const tools = toolVersions(cargoLock);
		const noCache = options.noCache || cacheOff();
		// Each build has its own Rust build folder, staging folder and install lock, so none waits for
		// another. The size report reads their files only after every build has ended.
		const builds: BuildJob[] = VARIANTS.map((variant) => ({
			name: variant.name,
			work: (log) => buildVariant(log, variant, bindgen, options.keepNames, stamp, tools, noCache),
		}));
		if (!options.sizesOnly)
			builds.push({ name: 'tools', work: (log) => buildToolModules(log, tools, noCache) });
		// No Rust build reads a shader module, so the modules build beside them, in a process of their
		// own, whose memory and cores the builds share.
		if (modules)
			builds.push({
				name: 'shaders',
				work: (log) => log.run(process.execPath, [join(root, 'tools/shaders.ts')]),
			});
		console.log(
			`\nbuilding ${listed(builds.map(({ name }) => name))} at the same time, each line headed by its build's name`,
		);
		await runBuilds(builds);
	}
	if (options.pagesOnly) return;
	if (options.part) return writeSizePart(options.part);

	// The engine test page's sizes come from every part's file when the check runs split, and from
	// a build here otherwise: the same sizes in the same order either way.
	const page =
		options.judgeParts === undefined
			? await measureWithMemo(engineTestPageFiles())
			: readSizeParts(options.judgeParts);
	if (options.judgeParts !== undefined) {
		// The parts' entries are those of every file of this build, so they make the next memo.
		const entries = mergeSizeMemoParts(resolve(root, options.judgeParts));
		// Parts can each compress the same bytes, so their count can pass the count of distinct files.
		console.log(
			`the size parts compressed ${entries.compressed} files; the next size memo holds the sizes of ${entries.met.size} distinct files${keepSizeMemo(entries, recordedModules(root)) ? '' : ', and is not kept, since it would not change'}`,
		);
	}
	const sizes: Record<string, SizeEntry> = {};
	for (const variant of VARIANTS)
		for (const file of CORE_FILES)
			sizes[`${variant.name}/${file}`] = measure(
				readFileSync(join(root, OUT_DIR, variant.name, file)),
			);
	const parts = new Map<string, SizeEntry>();
	const firstUseFiles = new Map<string, SizeEntry>();
	for (const [name, size] of page)
		if (name.startsWith('first-use/')) firstUseFiles.set(name, size);
		else parts.set(name.slice('js/'.length), size);
	for (const [part, size] of parts) sizes[`js/${part}`] = size;
	const downloads = downloadSizes(parts);

	const later = new Map([
		...LATER_PARTS.flatMap(({ name }) => {
			const size = parts.get(name);
			return size ? [[name, size] as const] : [];
		}),
		// The loader table of each feature family's combinations. The build names each after its
		// family, so the report learns them from the build rather than a fixed list (D-190).
		...[...parts]
			.filter(([name]) => isCombosPart(name))
			.map(([name, size]) => [name, size] as const),
	]);
	console.log('\nsize report (budget for each .wasm file of the core: 600 KB after Brotli)');
	for (const [file, size] of Object.entries(sizes))
		printSize(file, size, file.endsWith('.wasm') ? { brotli: WASM_BUDGET_BYTES } : undefined);
	printSize('js total', totalSize(parts.values()));
	console.log(
		`\nthe engine's JavaScript that a page downloads at its start in each thread mode, besides the core's glue (${budgetNote(START_BUDGET)})`,
	);
	for (const { mode, size } of downloads) printSize(mode, size, START_BUDGET);
	console.log(
		`\nthe engine's JavaScript that loads after the start, on a feature's first use, at the first call that reads it, or after the first frame (${budgetNote(LATER_BUDGET)} for each file; no start counts them)`,
	);
	for (const [part, size] of later)
		printSize(`js/${part}`, size, isCombosPart(part) ? COMBOS_BUDGET : LATER_BUDGET);
	printSize('after the start, total', totalSize(later.values()));
	console.log(
		`\nthe shader builds of each feature that loads on first use, and of each set of such features that builds need together, one file for each GPU path and each value of the bits a device fixes (${budgetNote(FIRST_USE_SHADER_BUDGET)} for each file; no start counts them)`,
	);
	for (const [part, size] of parts)
		if (isFirstUseShaderPart(part)) printSize(`js/${part}`, size, FIRST_USE_SHADER_BUDGET);
	console.log(
		"\nthe files besides code that load on first use: the KTX2 transcoder with the first KTX2 file, the meshopt decoder with the first glTF file that holds meshopt data, Draco's decoder with the first glTF file that holds Draco data, and the area lights' tables with the first rectangle or tube light, recorded exceptions (D-14, D-145) (no budget)",
	);
	for (const [file, size] of firstUseFiles) printSize(file, size);
	for (const [file, size] of firstUseFiles) sizes[file] = size;
	// The function names of a profiling build would add to every size.
	if (!options.keepNames) {
		writeFileSync(join(root, SIZE_RECORD), `${JSON.stringify(sizes, null, '\t')}\n`);
		console.log(`\nwrote ${SIZE_RECORD}`);
	}
	if (options.sizesOnly) return;
	console.log('\nthe modules that only build tools load (no budget)');
	for (const { path } of TOOL_MODULES) printSize(basename(path), measure(readFileSync(path)));

	const problems = Object.entries(sizes)
		.filter(
			([file, size]) =>
				file.endsWith('.wasm') && !firstUseFiles.has(file) && size.brotli > WASM_BUDGET_BYTES,
		)
		.map(([file]) => `${file} is over its 600 KB Brotli budget`);
	problems.push(...budgetProblems(parts));
	const growth = options.checkSize ? checkGrowth(sizes, options.base) : [];
	for (const warning of budgetWarnings(parts)) console.warn(`warning: ${warning}`);
	for (const p of [...problems, ...growth]) console.error(`error: ${p}`);
	if (growth.length > 0) {
		console.error('');
		for (const line of SIZE_GROWTH_GUIDANCE) console.error(line);
		console.error(
			"\nThe check reads the trailers of every commit after the base except merge commits, which main's squash drops. An empty commit can carry them.",
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
