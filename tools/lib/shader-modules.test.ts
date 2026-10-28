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
	statSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, join } from 'node:path';
import { scaledBudget } from '../../tests/lib/run-budget.ts';
import { hashOf } from './build-cache';
import { fixture } from './fixture';
import {
	buildEntriesShard,
	compilerStamp,
	crateFolders,
	ensureShaderModules,
	entryCacheDir,
	entryCacheFolder,
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
		// A test that logs the folders its stub program read names the log this way, and no other
		// test may inherit it.
		delete process.env.ENTRY_LOG;
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

/** Stores `files` in the shared cache as the set of `root`'s inputs, with its record. */
function storeCachedSet(root: string, files: Record<string, string>): string {
	const cached = join(modulesCacheDir(), inputHash(root));
	mkdirSync(cached, { recursive: true });
	const record: Record<string, string> = {};
	for (const [name, text] of Object.entries(files)) {
		writeFileSync(join(cached, name), text);
		record[name] = hashOf(text);
	}
	writeFileSync(join(cached, 'modules.json'), JSON.stringify(record));
	return cached;
}

/**
 * Runs `ensureShaderModules` on `root` in a process of its own with `env`, and returns what it
 * printed. The script is a file of its own because a `-e` import of an absolute TypeScript path is
 * not portable: on CI's runner the child prints nothing at all.
 */
function ensureInChild(root: string, env: NodeJS.ProcessEnv): string {
	const script = join(root, 'copy-set.ts');
	writeFileSync(
		script,
		`import { ensureShaderModules } from ${JSON.stringify(join(import.meta.dirname, 'shader-modules.ts'))};\nconsole.log(ensureShaderModules(${JSON.stringify(root)}));\n`,
	);
	const run = spawnSync('bun', [script], { env, encoding: 'utf8', timeout: scaledBudget(30_000) });
	if (run.stdout.trim() !== 'false')
		throw new Error(
			`the child printed ${JSON.stringify(run.stdout.trim())}, not false, and wrote ${JSON.stringify(run.stderr.trim())}`,
		);
	return run.stdout;
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

	it('read no module byte when every file has the size and time that the record keeps', () => {
		withScratchCaches(() => {
			const root = repository();
			mkdirSync(join(root, 'target'));
			const record = { inputs: inputHash(root), modules: moduleHash(root) };
			writeFileSync(join(root, RECORD), JSON.stringify(record));
			// The first check reads the bytes, which match, and keeps the files' sizes and times.
			expect(ensureShaderModules(root)).toBe(false);
			expect(JSON.parse(readFileSync(join(root, RECORD), 'utf8')).stats).toBeString();
			// The main module, which the hash reads, cannot be read, so a check that passes read no byte.
			const main = join(root, MODULE_DIR, 'shaders.ts');
			chmodSync(main, 0o000);
			try {
				expect(ensureShaderModules(root)).toBe(false);
			} finally {
				chmodSync(main, 0o644);
			}
			// A module of another size is a change: the bytes then decide, and the stub cargo fails the build.
			writeFileSync(main, 'export const CHANGED = 1;\n');
			expect(() => ensureShaderModules(root)).toThrow();
		});
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

	it(
		"take a set that the shared cache holds without waiting for another checkout's build",
		() => {
			withScratchCaches(() => {
				const root = repository();
				mkdirSync(join(root, 'target'));
				// The set of these inputs, as another checkout's build stored it.
				const files = {
					'shaders.ts': 'export const CACHED = 1;\n',
					'shaders-wgsl.js': 'export {};\n',
				};
				storeCachedSet(root, files);
				// A build holds the lock, under the id of a running process: this test's.
				const lock = join(process.env.NULL3D_BUILD_CACHE ?? '', 'shader-modules.lock');
				mkdirSync(lock, { recursive: true });
				writeFileSync(join(lock, 'pid'), String(process.pid));
				// In a process of its own, so that a wait for the lock fails the test rather than hanging it.
				// CI's docs-and-tools job asks for fresh shaders, and the child would inherit it and refuse
				// the cached set before it read it, which is not what this test is about.
				ensureInChild(root, withoutFreshShaders(process.env));
				expect(readFileSync(join(root, MODULE_DIR, 'shaders.ts'), 'utf8')).toBe(
					files['shaders.ts'],
				);
				expect(existsSync(join(lock, 'pid'))).toBe(true);
			});
			// The run starts a process of its own, which a loaded machine starts slowly.
		},
		scaledBudget(60_000),
	);

	it(
		'link a cached set into place on a machine that GitHub hosts for CI, and copy it on any other',
		() => {
			withScratchCaches(() => {
				const files = { 'shaders.ts': 'export const CACHED = 1;\n' };
				for (const ci of [true, false]) {
					const root = repository();
					mkdirSync(join(root, 'target'));
					const cached = storeCachedSet(root, files);
					const env = withoutFreshShaders(process.env);
					if (ci) env.RUNNER_ENVIRONMENT = 'github-hosted';
					else delete env.RUNNER_ENVIRONMENT;
					ensureInChild(root, env);
					const placed = statSync(join(root, MODULE_DIR, 'shaders.ts'));
					expect(readFileSync(join(root, MODULE_DIR, 'shaders.ts'), 'utf8')).toBe(
						files['shaders.ts'],
					);
					expect(placed.ino === statSync(join(cached, 'shaders.ts')).ino, String(ci)).toBe(ci);
					rmSync(cached, { recursive: true, force: true });
				}
			});
		},
		scaledBudget(60_000),
	);

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
	// The stub cargo notes each build in the checkout's target folder, and copies the checkout's
	// `program-shape` as the shader build. A test gives that shape the program that it needs: the
	// program stores one new entry in the folder it is given, and writes that folder to `ENTRY_LOG`
	// when the test sets it.
	const buildsProgram = `
if [ "$1" = build ]; then
	mkdir -p "$CARGO_TARGET_DIR/shader"
	echo build >> "$CARGO_TARGET_DIR/cargo-builds"
	cp "$PWD/program-shape" "$CARGO_TARGET_DIR/shader/shader-build"
	chmod 755 "$CARGO_TARGET_DIR/shader/shader-build"
fi`;

	const shape = `#!/bin/sh
while [ $# -gt 0 ]; do
	if [ "$1" = --cache ]; then
		mkdir -p "$2"
		if [ -n "$ENTRY_LOG" ]; then echo "$2" >> "$ENTRY_LOG"; fi
		echo {} > "$2/lit.new.json"
	fi
	shift
done`;

	/** A repository whose stub program has the given text, and the log of the folders it read. */
	function shardRepository(program = shape): { root: string; log: string } {
		const root = repository();
		writeFileSync(join(root, 'program-shape'), program);
		const log = join(root, 'entry-folders');
		process.env.ENTRY_LOG = log;
		return { root, log };
	}

	it('copies the entries that it stored, and none that the cache held before', () => {
		withScratchCaches(
			() => {
				const { root } = shardRepository();
				const folder = join(entryCacheDir(), compilerStamp(root));
				mkdirSync(folder, { recursive: true });
				writeFileSync(join(folder, 'pick.old.json'), '{}');
				const out = join(root, 'target', 'shader-entries');
				expect(buildEntriesShard(root, '1/2', out).stored).toEqual(['lit.new.json']);
				// They go out under the name of the folder that holds them.
				expect(readdirSync(out)).toEqual([compilerStamp(root)]);
				expect(readdirSync(join(out, compilerStamp(root)))).toEqual(['lit.new.json']);
				// The folder records the compiler whose program wrote the entries it holds.
				expect(readdirSync(folder).sort()).toEqual([
					'compiler',
					'lit.new.json',
					'pick.old.json',
					'program',
				]);
			},
			0,
			buildsProgram,
		);
	});

	it("keeps the program under its compiler's stamp, and the first shard hands it over", () => {
		withScratchCaches(
			() => {
				const { root } = shardRepository();
				const out = join(root, 'target', 'shader-entries');
				const first = buildEntriesShard(root, '0/2', out);
				expect(first.folder).toBe(join(entryCacheDir(), compilerStamp(root)));
				const handed = join(out, compilerStamp(root));
				expect(readdirSync(handed).sort()).toEqual(['lit.new.json', 'program']);
				expect(readdirSync(join(handed, 'program'))).toEqual(['shader-build']);
				// Another checkout of the same compiler runs the kept program, and cargo builds nothing.
				const other = repository();
				rmSync(join(first.folder, 'lit.new.json'));
				const second = buildEntriesShard(other, '1/2');
				expect(second.stored).toEqual(['lit.new.json']);
				expect(second.folder).toBe(first.folder);
				expect(readFileSync(join(root, 'target', 'cargo-builds'), 'utf8')).toBe('build\n');
				expect(existsSync(join(other, 'target', 'cargo-builds'))).toBe(false);
			},
			0,
			buildsProgram,
		);
	});

	it('keeps every entry when a compiler source changes but its program does not', () => {
		withScratchCaches(
			() => {
				const { root, log } = shardRepository();
				const first = buildEntriesShard(root, '0/1');
				// A comment in a crate that the compiler depends on changes the stamp of its sources.
				writeFileSync(join(root, 'crates/null3d-gpu/src/lib.rs'), '// a comment\n');
				const second = buildEntriesShard(root, '0/1');
				expect(second.folder).toBe(first.folder);
				expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual([first.folder, first.folder]);
			},
			0,
			buildsProgram,
		);
	});

	it('hands over new entries under the earlier folder that the same program reads', () => {
		withScratchCaches(
			() => {
				const { root } = shardRepository();
				const first = buildEntriesShard(root, '0/1');
				rmSync(join(first.folder, 'lit.new.json'));
				// A comment changes the stamp of the compiler's sources and leaves its program as it was,
				// so the shard fills the earlier folder, and the job that joins the entries must too.
				writeFileSync(join(root, 'crates/null3d-gpu/src/lib.rs'), '// a comment\n');
				const out = join(root, 'target', 'shader-entries');
				const second = buildEntriesShard(root, '0/1', out);
				expect(second.folder).toBe(first.folder);
				const stamp = compilerStamp(root);
				expect(basename(first.folder)).not.toBe(stamp);
				expect(readdirSync(join(out, basename(first.folder)))).toEqual(['lit.new.json']);
				// The program goes under this stamp's folder, where the joining job's build looks first.
				expect(readdirSync(join(out, stamp, 'program'))).toEqual(['shader-build']);
			},
			0,
			buildsProgram,
		);
	});

	it('names the folder a build used, also when the module set came from the cache', () => {
		withScratchCaches(
			() => {
				const { root } = shardRepository();
				const first = buildEntriesShard(root, '0/1');
				expect(entryCacheFolder(root)).toBe(first.folder);
				// A source change leaves no kept program of its own. The restored folder still names
				// the compiler, and its entries are checked against their own inputs.
				writeFileSync(join(root, 'crates/null3d-gpu/src/lib.rs'), '// a comment\n');
				expect(entryCacheFolder(root)).toBe(first.folder);
			},
			0,
			buildsProgram,
		);
	});

	it('takes a folder of its own when another compiler holds the stamp', () => {
		withScratchCaches(
			() => {
				const { root } = shardRepository();
				// A folder of another compiler under this source stamp: its entries share the stamp
				// in their keys, so this compiler must not write its entries beside them.
				const named = join(entryCacheDir(), compilerStamp(root));
				mkdirSync(named, { recursive: true });
				writeFileSync(join(named, 'compiler'), 'another compiler\n');
				writeFileSync(join(named, 'pick.old.json'), '{}');
				const run = buildEntriesShard(root, '0/1');
				expect(run.folder).not.toBe(named);
				expect(run.folder.startsWith(`${named}-`)).toBe(true);
				// The other compiler's folder keeps its marker and entry.
				expect(readFileSync(join(named, 'compiler'), 'utf8').trim()).toBe('another compiler');
				expect(existsSync(join(named, 'pick.old.json'))).toBe(true);
			},
			0,
			buildsProgram,
		);
	});

	it('never reads a folder whose recorded program has other bytes', () => {
		withScratchCaches(
			() => {
				const { root } = shardRepository();
				const first = buildEntriesShard(root, '0/1');
				// A program that compiles differently is another compiler, so its entries are its own.
				writeFileSync(join(root, 'crates/null3d-gpu/src/lib.rs'), 'pub const A: u32 = 1;\n');
				writeFileSync(join(root, 'program-shape'), `${shape}\n# another output\n`);
				const second = buildEntriesShard(root, '0/1');
				expect(second.folder).not.toBe(first.folder);
				expect(readFileSync(join(first.folder, 'compiler'), 'utf8').trim()).not.toBe(
					readFileSync(join(second.folder, 'compiler'), 'utf8').trim(),
				);
			},
			0,
			buildsProgram,
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
