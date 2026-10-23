import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { hashOf } from './build-cache';
import { fixture } from './fixture';
import {
	buildEntriesShard,
	compilerStamp,
	crateFolders,
	ensureShaderModules,
	entryCacheDir,
	folderIsComplete,
	inputHash,
	isShaderModule,
	MODULE_DIR,
	moduleHash,
	modulesCacheDir,
	RECORD,
	setIsComplete,
} from './shader-modules';

/**
 * Runs a test with the shared caches in a scratch folder and a stub `cargo` first on the `PATH`. A
 * test then never reads or writes the caches of the machine it runs on, and never runs the real
 * toolchain: the stub prints and exits, which is how a test drives a build that fails. `script`,
 * when given, runs in the stub before it exits, with cargo's arguments.
 */
function withScratchCaches(run: () => void, cargoStatus = 3, script = ''): void {
	const folder = mkdtempSync(join(tmpdir(), 'null3d-shaders-test-'));
	const bin = join(folder, 'bin');
	mkdirSync(bin);
	const cargo = join(bin, 'cargo');
	writeFileSync(cargo, `#!/bin/sh\necho "stub cargo" >&2\n${script}\nexit ${cargoStatus}\n`);
	chmodSync(cargo, 0o755);
	const before = { cache: process.env.NULL3D_BUILD_CACHE, path: process.env.PATH };
	process.env.NULL3D_BUILD_CACHE = join(folder, 'cache');
	process.env.PATH = `${bin}${delimiter}${before.path ?? ''}`;
	try {
		run();
	} finally {
		if (before.cache === undefined) delete process.env.NULL3D_BUILD_CACHE;
		else process.env.NULL3D_BUILD_CACHE = before.cache;
		if (before.path === undefined) delete process.env.PATH;
		else process.env.PATH = before.path;
		rmSync(folder, { recursive: true, force: true });
	}
}

/** A repository with the shader crate, its path dependencies and one generated module. */
function repository(): string {
	return fixture({
		'Cargo.toml': '[workspace]\n',
		'Cargo.lock': '',
		'rust-toolchain.toml': '',
		'crates/null3d-shaders/Cargo.toml': '[dependencies]\ngpu = { path = "../null3d-gpu" }\n',
		'crates/null3d-shaders/src/lib.rs': '',
		'crates/null3d-shaders/wgsl/lit.wgsl': 'fn main() {}\n',
		'crates/null3d-shaders/tests/cli.rs': '',
		'crates/null3d-gpu/Cargo.toml': '[dependencies]\ncore = { path = "../null3d-core" }\n',
		'crates/null3d-gpu/src/lib.rs': '',
		'crates/null3d-core/Cargo.toml': '',
		'crates/unrelated/Cargo.toml': '',
		[`${MODULE_DIR}/shaders.ts`]: 'export {};\n',
		[`${MODULE_DIR}/gpu.ts`]: 'export {};\n',
	});
}

/** The environment without CI's demand that the shader set be freshly built. */
function withoutFreshShaders(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const copy = { ...env };
	delete copy.NULL3D_REQUIRE_FRESH_SHADERS;
	return copy;
}

describe('the shader modules', () => {
	it('are the main module and the device modules beside it', () => {
		expect(isShaderModule('shaders.ts')).toBe(true);
		expect(isShaderModule('shaders-glsl-draw-index.js')).toBe(true);
		expect(isShaderModule('shaders-wgsl-combos.ts')).toBe(true);
		// Each target's combos table is split by the half-precision bit, and the suffixed files count.
		expect(isShaderModule('shaders-wgsl-combos-half.ts')).toBe(true);
		expect(isShaderModule('shaders-glsl-combos-half.ts')).toBe(true);
		expect(isShaderModule('shaders-glsl-draw-index.ts')).toBe(false);
		expect(isShaderModule('shader-features.ts')).toBe(true);
		expect(isShaderModule('shaders-environment-wgsl.ts')).toBe(true);
		// A target's table of shared paragraphs is plain JavaScript beside the device modules. Its
		// name carries no `shaders-` prefix, so the offline file list reads it as no feature.
		expect(isShaderModule('shader-paragraphs-glsl.js')).toBe(true);
		expect(isShaderModule('shader-paragraphs-wgsl.js')).toBe(true);
		expect(isShaderModule('gpu.ts')).toBe(false);
		expect(isShaderModule('shaders.ts.map')).toBe(false);
	});

	it('come from the shader crate and the crates it depends on by path', () => {
		expect(crateFolders(repository())).toEqual([
			'crates/null3d-core',
			'crates/null3d-gpu',
			'crates/null3d-shaders',
		]);
	});

	it('are out of date when an input changes, and not when a crate test changes', () => {
		const root = repository();
		const before = inputHash(root);
		writeFileSync(join(root, 'crates/null3d-shaders/tests/cli.rs'), '// another test\n');
		expect(inputHash(root)).toBe(before);
		writeFileSync(join(root, 'crates/null3d-shaders/wgsl/lit.wgsl'), 'fn main() { }\n');
		expect(inputHash(root)).not.toBe(before);
		const gpu = inputHash(root);
		writeFileSync(join(root, 'crates/null3d-gpu/src/lib.rs'), 'pub const A: u32 = 1;\n');
		expect(inputHash(root)).not.toBe(gpu);
	});

	it('hash every module, and none without the main module', () => {
		const root = repository();
		const one = moduleHash(root);
		expect(one).not.toBeNull();
		writeFileSync(join(root, MODULE_DIR, 'shaders-wgsl.js'), 'export {};\n');
		const two = moduleHash(root);
		expect(two).not.toBe(one);
		writeFileSync(join(root, MODULE_DIR, 'gpu.ts'), 'export const A = 1;\n');
		expect(moduleHash(root)).toBe(two);
		expect(moduleHash(fixture({ [`${MODULE_DIR}/gpu.ts`]: '' }))).toBeNull();
	});

	it('are incomplete when the main module loads a module that is missing', () => {
		const root = repository();
		// The build's main module loads each target's combos table for the half-precision bit too.
		writeFileSync(
			join(root, MODULE_DIR, 'shaders.ts'),
			"const load = () => import('./shaders-wgsl-combos-half');\n",
		);
		expect(folderIsComplete(join(root, MODULE_DIR))).toBe(false);
		expect(moduleHash(root)).toBeNull();
		writeFileSync(
			join(root, MODULE_DIR, 'shaders-wgsl-combos-half.ts'),
			'export const FILES = {};\n',
		);
		expect(folderIsComplete(join(root, MODULE_DIR))).toBe(true);
		expect(moduleHash(root)).not.toBeNull();
	});

	it('change the cache key with the manifest feature list', () => {
		const root = repository();
		writeFileSync(join(root, 'crates/null3d-shaders/shaders.toml'), '[features]\n');
		const before = inputHash(root);
		writeFileSync(
			join(root, 'crates/null3d-shaders/shaders.toml'),
			'[features]\n[first_use.new]\n',
		);
		expect(inputHash(root)).not.toBe(before);
	});

	it('skip the build when the record matches the inputs and the modules', () => {
		const root = repository();
		mkdirSync(join(root, 'target'));
		const record = { inputs: inputHash(root), modules: moduleHash(root) };
		writeFileSync(join(root, RECORD), JSON.stringify(record));
		expect(ensureShaderModules(root)).toBe(false);
	});

	it('run the build when a module changed, and release the lock when the build fails', () => {
		withScratchCaches(() => {
			const root = repository();
			mkdirSync(join(root, 'target'));
			const record = { inputs: inputHash(root), modules: moduleHash(root) };
			writeFileSync(join(root, RECORD), JSON.stringify(record));
			writeFileSync(join(root, MODULE_DIR, 'shaders.ts'), 'export const EDITED = 1;\n');
			// The stub cargo fails at once, which is what a build on a machine without the toolchain
			// does too: the command reports the failure and the lock is released.
			expect(() => ensureShaderModules(root)).toThrow();
			expect(existsSync(join(root, 'target/shader-modules.lock'))).toBe(false);
		});
	});

	it("copy a set that the shared cache holds without waiting for another checkout's build", () => {
		withScratchCaches(() => {
			const root = repository();
			mkdirSync(join(root, 'target'));
			// The set of these inputs, as another checkout's build stored it.
			const cached = join(modulesCacheDir(), inputHash(root));
			mkdirSync(cached, { recursive: true });
			const files = {
				'shaders.ts': 'export const CACHED = 1;\n',
				'shaders-wgsl.js': 'export {};\n',
			};
			const record: Record<string, string> = {};
			for (const [name, text] of Object.entries(files)) {
				writeFileSync(join(cached, name), text);
				record[name] = hashOf(text);
			}
			writeFileSync(join(cached, 'modules.json'), JSON.stringify(record));
			// A build holds the lock, under the id of a running process: this test's.
			const lock = join(process.env.NULL3D_BUILD_CACHE ?? '', 'shader-modules.lock');
			mkdirSync(lock, { recursive: true });
			writeFileSync(join(lock, 'pid'), String(process.pid));
			// In a process of its own, so that a wait for the lock fails the test rather than hanging it.
			// The script is a file of its own because a `-e` import of an absolute TypeScript path is
			// not portable: on CI's runner the child prints nothing at all.
			const script = join(root, 'copy-set.ts');
			writeFileSync(
				script,
				`import { ensureShaderModules } from ${JSON.stringify(join(import.meta.dirname, 'shader-modules.ts'))};\nconsole.log(ensureShaderModules(${JSON.stringify(root)}));\n`,
			);
			const run = spawnSync('bun', [script], {
				// CI's docs-and-tools job asks for fresh shaders, and the child would inherit it and
				// refuse the cached set before it read it, which is not what this test is about.
				env: withoutFreshShaders(process.env),
				encoding: 'utf8',
				timeout: 30_000,
			});
			if (run.stdout.trim() !== 'false')
				throw new Error(
					`the child printed ${JSON.stringify(run.stdout.trim())}, not false, and wrote ${JSON.stringify(run.stderr.trim())}`,
				);
			expect(readFileSync(join(root, MODULE_DIR, 'shaders.ts'), 'utf8')).toBe(files['shaders.ts']);
			expect(existsSync(join(lock, 'pid'))).toBe(true);
		});
		// The run starts a process of its own, which a loaded machine starts slowly.
	}, 60_000);

	it('fail at once instead of building when the run takes the modules from the build job', () => {
		withScratchCaches(() => {
			const root = repository();
			mkdirSync(join(root, 'target'));
			process.env.NULL3D_REQUIRE_FRESH_SHADERS = '1';
			try {
				// A set that matches its record passes with no build, as it does without the switch.
				writeFileSync(
					join(root, RECORD),
					JSON.stringify({ inputs: inputHash(root), modules: moduleHash(root) }),
				);
				expect(ensureShaderModules(root)).toBe(false);
				// A record that names modules the artifact did not deliver stops the run at once, and
				// names the file it lacks, in place of a build that costs minutes in every job.
				writeFileSync(
					join(root, RECORD),
					JSON.stringify({
						inputs: inputHash(root),
						modules: 'another set',
						names: ['shaders.ts', 'shader-paragraphs-wgsl.js'],
					}),
				);
				expect(() => ensureShaderModules(root)).toThrow(/shader-paragraphs-wgsl\.js/);
			} finally {
				delete process.env.NULL3D_REQUIRE_FRESH_SHADERS;
			}
		});
	});
});

describe('a shard of the shader entries', () => {
	// The stub stands in for the shader build: it stores one new entry in the folder it is given.
	const storeOne =
		'while [ $# -gt 0 ]; do if [ "$1" = --cache ]; then mkdir -p "$2"; echo {} > "$2/lit.new.json"; fi; shift; done';

	it('copies the entries that it stored, and none that the cache held before', () => {
		withScratchCaches(
			() => {
				const root = repository();
				const folder = join(entryCacheDir(), compilerStamp(root));
				mkdirSync(folder, { recursive: true });
				writeFileSync(join(folder, 'pick.old.json'), '{}');
				const out = join(root, 'target', 'shader-entries');
				expect(buildEntriesShard(root, '0/2', out)).toEqual(['lit.new.json']);
				expect(readdirSync(out)).toEqual(['lit.new.json']);
				expect(readdirSync(folder).sort()).toEqual(['lit.new.json', 'pick.old.json']);
			},
			0,
			storeOne,
		);
	});

	it('refuses to run while the caches are off', () => {
		withScratchCaches(() => {
			process.env.NULL3D_NO_CACHE = '1';
			try {
				expect(() => buildEntriesShard(repository(), '0/2')).toThrow(/per-entry shader cache/);
			} finally {
				delete process.env.NULL3D_NO_CACHE;
			}
		});
	});
});

describe('a set in the shared cache', () => {
	/** A cache entry that holds `shaders.ts` and one device module, with their record. */
	function set(folder: string): void {
		mkdirSync(folder, { recursive: true });
		const files: Record<string, string> = {
			'shaders.ts': 'export {};\n',
			'shaders-wgsl.js': 'export {};\n',
		};
		const record: Record<string, string> = {};
		for (const [name, text] of Object.entries(files)) {
			writeFileSync(join(folder, name), text);
			record[name] = hashOf(text);
		}
		writeFileSync(join(folder, 'modules.json'), JSON.stringify(record));
	}

	it('is complete only while every file is the one its record names', () => {
		const cache = join(mkdtempSync(join(tmpdir(), 'null3d-set-')), 'entry');
		try {
			set(cache);
			expect(setIsComplete(cache)).toBe(true);
			// A file whose bytes changed, or one that lost a file, is a miss: a set that a stopped or
			// two racing builds left half written must never be handed to a checkout as a built set.
			writeFileSync(join(cache, 'shaders-wgsl.js'), 'export const A = 1;\n');
			expect(setIsComplete(cache)).toBe(false);
			set(cache);
			rmSync(join(cache, 'modules.json'));
			expect(setIsComplete(cache)).toBe(false);
			set(cache);
			rmSync(join(cache, 'shaders-wgsl.js'));
			expect(setIsComplete(cache)).toBe(false);
		} finally {
			rmSync(cache, { recursive: true, force: true });
		}
	});
});
