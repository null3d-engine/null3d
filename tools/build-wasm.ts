// Builds the engine's two WebAssembly files, then reports their sizes and the sizes of the engine's
// JavaScript in a production build of the engine test page. Run from the repository root:
//   bun tools/build-wasm.ts                 build both variants, then print the size report
//   bun tools/build-wasm.ts --check-size    also fail when a file grew past the allowed margin
//   bun tools/build-wasm.ts --update-size   also rewrite the committed size baseline
//
// The threaded build uses atomics and shared memory, so it rebuilds the standard library with
// them. The single-threaded build runs on pages that are not cross-origin isolated. The
// wasm-bindgen command-line tool must match the crate version exactly, so the script downloads
// that release into the build folder and verifies its checksum.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
	type BuiltFile,
	downloadSizes,
	findEngineParts,
	growthProblems,
	measure,
	type SizeEntry,
	totalSize,
} from './lib/size-report';

const root = process.cwd();
const CRATE = 'null3d-wasm';
const OUT_DIR = 'packages/engine/dist/wasm';
const TOOLS_DIR = 'target/tools';
const SIZE_BASELINE = 'tools/size-baseline.json';
/** Brotli budget for each core WebAssembly file. */
const WASM_BUDGET_BYTES = 600 * 1024;
/**
 * Brotli budget for the engine's JavaScript that a page downloads, in whichever thread mode
 * downloads the most. The core's generated glue counts with the WebAssembly files instead.
 */
const JS_BUDGET_BYTES = 60 * 1024;
/** Where the size report builds the engine test page, apart from the build the browser tests serve. */
const JS_BUILD_DIR = 'target/js-size';

interface Variant {
	name: 'threaded' | 'single';
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

function run(cmd: string, args: string[], env: Record<string, string> = {}): void {
	execFileSync(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
}

function buildVariant(variant: Variant, bindgen: string): void {
	const targetDir = `target/wasm-${variant.name}`;
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

async function main(): Promise<void> {
	const version = lockedVersion(readFileSync(join(root, 'Cargo.lock'), 'utf8'), 'wasm-bindgen');
	const bindgen = await wasmBindgen(version);
	for (const variant of VARIANTS) buildVariant(variant, bindgen);

	const sizes: Record<string, SizeEntry> = {};
	for (const variant of VARIANTS) {
		for (const file of ['null3d_bg.wasm', 'null3d.js']) {
			const path = `${OUT_DIR}/${variant.name}/${file}`;
			sizes[`${variant.name}/${file}`] = measure(readFileSync(join(root, path)));
		}
	}
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
		"\nthe engine's JavaScript that a page downloads in each thread mode, besides the core's glue (budget: 60 KB after Brotli)",
	);
	for (const { mode, size } of downloads) printSize(mode, size, JS_BUDGET_BYTES);

	const problems = Object.entries(sizes)
		.filter(([file, size]) => file.endsWith('.wasm') && size.brotli > WASM_BUDGET_BYTES)
		.map(([file]) => `${file} is over its 600 KB Brotli budget`);
	for (const { mode, size } of downloads)
		if (size.brotli > JS_BUDGET_BYTES)
			problems.push(
				`the engine JavaScript that a page downloads in ${mode} mode is over its 60 KB Brotli budget`,
			);
	const baselinePath = join(root, SIZE_BASELINE);
	if (process.argv.includes('--update-size')) {
		writeFileSync(baselinePath, `${JSON.stringify(sizes, null, '\t')}\n`);
		console.log(`\nwrote ${SIZE_BASELINE}`);
	} else if (process.argv.includes('--check-size') && existsSync(baselinePath)) {
		problems.push(...growthProblems(sizes, JSON.parse(readFileSync(baselinePath, 'utf8'))));
	}
	for (const p of problems) console.error(`error: ${p}`);
	if (problems.length > 0) process.exit(1);
}

if (import.meta.main) {
	main().catch((e) => {
		console.error(`error: ${(e as Error).message}`);
		process.exit(1);
	});
}
