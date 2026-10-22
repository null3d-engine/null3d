import { describe, expect, it } from 'bun:test';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
	addReleaseInstance,
	artifactFiles,
	type BuildJob,
	buildCodeHash,
	buildLog,
	cargoTargetBase,
	checkHeapStart,
	lockedVersion,
	parseOptions,
	readArtifacts,
	releaseTarget,
	runBuilds,
	sizeCheckLock,
	type ToolVersions,
	toolInputs,
	toolsKey,
	VARIANTS,
	variantKey,
	variantStagingFolder,
	writeArtifacts,
} from './build-wasm';
import { CACHE_ROOT } from './lib/build-cache';
import { inputFiles } from './lib/shader-modules';

/** The crate folders of the build tools' modules, whose files key their cache entry. */
const TOOL_FOLDERS = ['crates/null3d-shaders-wasm', 'crates/null3d-assets-wasm'];

describe('parseOptions', () => {
	it('reads the size check, its base, the base build, the names build, the pages build, an earlier build and the base alone', () => {
		expect(parseOptions([])).toEqual({
			checkSize: false,
			sizesOnly: false,
			keepNames: false,
			pagesOnly: false,
			prebuilt: false,
			printBase: false,
			noCache: false,
		});
		expect(parseOptions(['--check-size', '--base', 'origin/main'])).toEqual({
			checkSize: true,
			base: 'origin/main',
			sizesOnly: false,
			keepNames: false,
			pagesOnly: false,
			prebuilt: false,
			printBase: false,
			noCache: false,
		});
		expect(parseOptions(['--check-size', '--prebuilt'])).toMatchObject({
			checkSize: true,
			prebuilt: true,
		});
		expect(parseOptions(['--print-base', '--base', 'HEAD^'])).toMatchObject({
			printBase: true,
			base: 'HEAD^',
		});
		expect(parseOptions(['--sizes-only']).sizesOnly).toBe(true);
		expect(parseOptions(['--names']).keepNames).toBe(true);
		expect(parseOptions(['--no-cache']).noCache).toBe(true);
		expect(parseOptions(['--pages-only', '--names', '--no-cache'])).toMatchObject({
			pagesOnly: true,
			keepNames: true,
			noCache: true,
		});
	});

	it('rejects unknown options, a base without a commit or a check, and builds that exclude each other', () => {
		expect(() => parseOptions(['--update-size'])).toThrow('unknown option --update-size');
		expect(() => parseOptions(['--check-size', '--base'])).toThrow('--base needs a commit');
		expect(() => parseOptions(['--base', 'main'])).toThrow('--base names the commit');
		expect(() => parseOptions(['--check-size', '--names'])).toThrow('cannot measure sizes');
		expect(() => parseOptions(['--sizes-only', '--names'])).toThrow('cannot measure sizes');
		expect(() => parseOptions(['--check-size', '--sizes-only'])).toThrow(
			'cannot also run the check',
		);
		for (const other of ['--check-size', '--sizes-only'])
			expect(() => parseOptions(['--pages-only', other])).toThrow(
				'--pages-only makes no size report',
			);
		for (const other of ['--names', '--pages-only', '--sizes-only'])
			expect(() => parseOptions(['--prebuilt', other])).toThrow(
				'--prebuilt measures the files of an earlier build',
			);
		for (const other of ['--check-size', '--prebuilt', '--sizes-only'])
			expect(() => parseOptions(['--print-base', other])).toThrow('--print-base builds nothing');
	});

	it('reads a part of a split size check, and the run that judges every part', () => {
		expect(parseOptions(['--check-size', '--prebuilt', '--part', '2/6'])).toMatchObject({
			checkSize: true,
			prebuilt: true,
			part: { index: 2, count: 6 },
		});
		expect(
			parseOptions([
				'--check-size',
				'--prebuilt',
				'--judge-parts',
				'target/size-parts',
				'--base',
				'HEAD^',
			]),
		).toMatchObject({ judgeParts: 'target/size-parts', base: 'HEAD^' });
		expect(parseOptions(['--check-size', '--prebuilt'])).not.toHaveProperty('part');
	});

	it('rejects a split size check without its values, outside a check of an earlier build, or mixed', () => {
		const check = ['--check-size', '--prebuilt'];
		expect(() => parseOptions([...check, '--part'])).toThrow('--part needs a part as <i>/<n>');
		expect(() => parseOptions([...check, '--part', '7/6'])).toThrow('a part is <i>/<n>');
		expect(() => parseOptions([...check, '--judge-parts'])).toThrow(
			'--judge-parts needs the folder',
		);
		for (const options of [['--check-size'], ['--prebuilt'], []])
			for (const split of [
				['--part', '1/2'],
				['--judge-parts', 'parts'],
			])
				expect(() => parseOptions([...options, ...split])).toThrow(
					'each needs --check-size --prebuilt',
				);
		expect(() => parseOptions([...check, '--part', '1/2', '--judge-parts', 'parts'])).toThrow(
			'in separate runs',
		);
		expect(() => parseOptions([...check, '--part', '1/2', '--base', 'HEAD^'])).toThrow(
			'--part judges nothing',
		);
	});
});

describe('lockedVersion', () => {
	it('reads a package version from Cargo.lock', () => {
		const lock =
			'[[package]]\nname = "once_cell"\nversion = "1.21.4"\n\n[[package]]\nname = "wasm-bindgen"\nversion = "0.2.129"\n';
		expect(lockedVersion(lock, 'wasm-bindgen')).toBe('0.2.129');
		expect(() => lockedVersion(lock, 'missing')).toThrow('missing is not in Cargo.lock');
	});
});

describe('releaseTarget', () => {
	it('names the prebuilt wasm-bindgen download for each supported machine', () => {
		expect(releaseTarget('darwin', 'arm64')).toBe('aarch64-apple-darwin');
		expect(releaseTarget('darwin', 'x64')).toBe('x86_64-apple-darwin');
		expect(releaseTarget('linux', 'x64')).toBe('x86_64-unknown-linux-musl');
		expect(() => releaseTarget('win32', 'x64')).toThrow('no prebuilt wasm-bindgen');
	});
});

describe('addReleaseInstance', () => {
	const glue = [
		'let cachedFloat64ArrayMemory0 = null;',
		'let cachedTextDecoder = new TextDecoder();',
		'let cachedUint8ArrayMemory0 = null;',
		'let wasmModule, wasmInstance, wasm;',
		'function initSync(module, memory) {',
		'    if (wasm !== undefined) return wasm;',
		'}',
		'',
	].join('\n');

	it('adds functions that drop every view of its memory, and the instance with them', () => {
		const released = addReleaseInstance(glue);
		expect(released.startsWith(glue)).toBe(true);
		expect(released.slice(glue.length)).toBe(
			[
				'',
				'export function dropMemoryViews() {',
				'    cachedFloat64ArrayMemory0 = null;',
				'    cachedUint8ArrayMemory0 = null;',
				'}',
				'',
				'export function releaseInstance() {',
				'    wasmModule = wasmInstance = wasm = undefined;',
				'    dropMemoryViews();',
				'}',
				'',
			].join('\n'),
		);
	});

	it('fails on glue that holds its instance in another way', () => {
		expect(() => addReleaseInstance(glue.replace('wasmInstance, ', ''))).toThrow(
			'update addReleaseInstance',
		);
	});
});

describe('checkHeapStart', () => {
	/** A module's first bytes up to an import section with a shared memory of `initial` pages. */
	const withMemory = (initial: number) => {
		const entry = [1, 0x61, 1, 0x6d, 2, 3, initial, 0x80, 0x80, 0x04];
		return new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 2, entry.length + 1, 1, ...entry]);
	};

	it('passes when wasm-bindgen added one page', () => {
		expect(() => checkHeapStart(withMemory(17), withMemory(18))).not.toThrow();
	});

	it('fails on any other count, which would move the heap onto its pages', () => {
		expect(() => checkHeapStart(withMemory(17), withMemory(17))).toThrow('BINDGEN_PAGES');
		expect(() => checkHeapStart(withMemory(17), withMemory(19))).toThrow('19 pages');
	});
});

const TOOLS: ToolVersions = {
	rust: 'channel = "nightly-2026-09-26"',
	bindgen: '0.2.129-aarch64-apple-darwin',
	wasmOpt: '132.0.0-darwin-arm64',
};

describe('variantKey', () => {
	it('is the same for the same inputs and differs for a changed source, flag, variant or tool', () => {
		const variant = VARIANTS[0]!;
		const key = variantKey(variant, 'stamp', false, TOOLS);
		expect(variantKey(variant, 'stamp', false, TOOLS)).toBe(key);
		expect(variantKey(variant, 'other sources', false, TOOLS)).not.toBe(key);
		expect(variantKey(variant, 'stamp', true, TOOLS)).not.toBe(key);
		expect(variantKey(VARIANTS[1]!, 'stamp', false, TOOLS)).not.toBe(key);
		expect(variantKey(variant, 'stamp', false, { ...TOOLS, rust: 'other' })).not.toBe(key);
		expect(variantKey(variant, 'stamp', false, { ...TOOLS, bindgen: '0.2.130' })).not.toBe(key);
		expect(variantKey(variant, 'stamp', false, { ...TOOLS, wasmOpt: '133.0.0' })).not.toBe(key);
	});
});

describe('buildCodeHash', () => {
	it('changes with this script or with the module that rewrites the glue', () => {
		// Both decide what an entry holds: the script sets the flags and the staging, and the glue
		// module rewrites every built module. Neither is a Rust source, so neither reaches the
		// sources' stamp, and without this an edit here kept serving an entry an earlier version wrote.
		const root = mkdtempSync(join(tmpdir(), 'null3d-code-'));
		try {
			for (const file of ['tools/build-wasm.ts', 'tools/lib/core-sources.ts']) {
				mkdirSync(dirname(join(root, file)), { recursive: true });
				cpSync(join(process.cwd(), file), join(root, file));
			}
			const before = buildCodeHash(root);
			expect(buildCodeHash(root)).toBe(before);
			writeFileSync(join(root, 'tools/lib/core-sources.ts'), '// another glue\n', { flag: 'a' });
			expect(buildCodeHash(root)).not.toBe(before);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe('variantStagingFolder', () => {
	it('stages inside the checkout, in a folder of its own', () => {
		// A shared staging folder lets one build's rm -rf take another's half-written core out from
		// under wasm-opt. The process id keeps two builds from sharing one staging folder even in the
		// same checkout, which is what lets ordinary builds run at the same time.
		for (const variant of VARIANTS) {
			const staged = variantStagingFolder(variant);
			expect(staged.startsWith(`${process.cwd()}/target/`)).toBe(true);
			expect(staged.endsWith(`out-${process.pid}`)).toBe(true);
		}
	});
});

describe('cargoTargetBase', () => {
	it('gives two checkouts two Rust build folders by default, each inside its checkout', () => {
		// Cargo finds the engine's crates at the same workspace paths in every checkout and judges
		// them fresh by file times, so a shared folder lets one checkout link another's crates.
		for (const override of [undefined, '', 'local']) {
			const one = cargoTargetBase('/work/one', override);
			const two = cargoTargetBase('/work/two', override);
			expect(one).toBe('/work/one/target');
			expect(two).toBe('/work/two/target');
		}
		expect(cargoTargetBase(process.cwd()).startsWith(CACHE_ROOT)).toBe(false);
		expect(cargoTargetBase('/work/one', '/elsewhere')).toBe('/elsewhere');
	});
});

describe('sizeCheckLock', () => {
	it('gives two checkouts two lock files, each inside its own target folder', () => {
		// A lock in the shared cache root serialised the whole machine: every size check on the Mac
		// waited on one file, and a size check holds it across its base build.
		expect(sizeCheckLock('/work/one')).toBe('/work/one/target/build.lock');
		expect(sizeCheckLock('/work/two')).not.toBe(sizeCheckLock('/work/one'));
		expect(sizeCheckLock(process.cwd()).startsWith(CACHE_ROOT)).toBe(false);
	});
});

describe('toolsKey', () => {
	it('is the same for the same crate inputs and differs for a changed crate input or toolchain', () => {
		const key = toolsKey('shaders', 'assets', TOOLS);
		expect(toolsKey('shaders', 'assets', TOOLS)).toBe(key);
		expect(toolsKey('changed', 'assets', TOOLS)).not.toBe(key);
		expect(toolsKey('shaders', 'changed', TOOLS)).not.toBe(key);
		expect(toolsKey('shaders', 'assets', { ...TOOLS, rust: 'other' })).not.toBe(key);
	});
});

describe('toolInputs', () => {
	it('hashes each tool crate by the folder that holds it, which must exist', () => {
		// A crate named by its package instead of its folder throws here, which would fail every
		// build before it could write or read an entry.
		const [shaders, assets] = toolInputs(process.cwd());
		expect(shaders).toMatch(/^[0-9a-f]{64}$/);
		expect(assets).toMatch(/^[0-9a-f]{64}$/);
		expect(shaders).not.toBe(assets);
	});
});

describe('the cache keys', () => {
	it("come from the checkout's own crate files alone, never from its path or another checkout", () => {
		// A key is a hash of the files that a checkout's build compiles, by their paths inside the
		// checkout, and the build compiles them into that checkout's own Rust build folder. So an
		// entry's key and its contents come from one checkout's crates, and two checkouts with the
		// same crates share the entry.
		const files = [...new Set(TOOL_FOLDERS.flatMap((folder) => inputFiles(process.cwd(), folder)))];
		const copies = mkdtempSync(join(tmpdir(), 'null3d-keys-'));
		try {
			const [one, two] = ['one', 'two'].map((name) => join(copies, name));
			for (const checkout of [one!, two!])
				for (const file of files) cpSync(join(process.cwd(), file), join(checkout, file));
			const here = toolInputs(process.cwd());
			expect(toolInputs(one!)).toEqual(here);
			expect(toolInputs(two!)).toEqual(here);
			// A crate that the shader compiler depends on, edited in one checkout only.
			const gpu = files.find((file) => file.startsWith('crates/null3d-gpu/src/'));
			expect(gpu).toBeDefined();
			writeFileSync(join(two!, gpu!), "// another checkout's edit\n", { flag: 'a' });
			expect(toolInputs(two!)[0]).not.toBe(here[0]);
			expect(toolInputs(one!)).toEqual(here);
			expect(dirname(cargoTargetBase(two!))).toBe(two!);
		} finally {
			rmSync(copies, { recursive: true, force: true });
		}
	});
});

describe('the artifact cache', () => {
	/** A temporary cache base, removed after the test. */
	const withBase = (run: (base: string) => void): void => {
		const base = mkdtempSync(join(tmpdir(), 'null3d-artifacts-'));
		try {
			run(base);
		} finally {
			rmSync(base, { recursive: true, force: true });
		}
	};

	it('misses a missing entry, hits a complete one, and misses a corrupted file or record', () => {
		withBase((base) => {
			const source = join(base, 'source.bin');
			writeFileSync(source, 'the bytes');
			expect(readArtifacts(base, 'key', ['a.bin'])).toBeNull();
			expect(artifactFiles(join(base, 'key'))).toEqual([]);
			writeArtifacts(base, 'key', [['a.bin', source]]);
			expect(readArtifacts(base, 'key', ['a.bin'])).toBe(join(base, 'key'));
			expect(artifactFiles(join(base, 'key'))).toEqual(['a.bin']);
			// A stored file with other bytes is a miss, so the caller builds again.
			writeFileSync(join(base, 'key', 'a.bin'), 'other bytes');
			expect(readArtifacts(base, 'key', ['a.bin'])).toBeNull();
			// A record that is not the recorded hash is a miss too.
			writeFileSync(join(base, 'key', 'artifacts.json'), 'not json');
			expect(readArtifacts(base, 'key', ['a.bin'])).toBeNull();
			// An entry that lacks a named file is a miss.
			writeArtifacts(base, 'key', [['a.bin', source]]);
			expect(readArtifacts(base, 'key', ['a.bin', 'b.bin'])).toBeNull();
		});
	});

	it('names every file of an entry, and misses the entry when an extra file changed', () => {
		withBase((base) => {
			const source = join(base, 'source.bin');
			writeFileSync(source, 'the bytes');
			writeArtifacts(base, 'key', [
				['a.bin', source],
				['b.bin', source],
			]);
			expect(artifactFiles(join(base, 'key'))).toEqual(['a.bin', 'b.bin']);
			// A hit copies every file, so a changed file that no caller named is a miss too.
			writeFileSync(join(base, 'key', 'b.bin'), 'other bytes');
			expect(readArtifacts(base, 'key', ['a.bin'])).toBeNull();
		});
	});

	it('returns false, and does not throw, when the cache cannot be written', () => {
		withBase((base) => {
			const source = join(base, 'source.bin');
			writeFileSync(source, 'bytes');
			// A base that is a file, not a folder, cannot hold an entry.
			const blocked = join(base, 'blocked');
			writeFileSync(blocked, 'a file, not a folder');
			expect(writeArtifacts(blocked, 'key', [['a.bin', source]])).toBe(false);
			expect(readArtifacts(blocked, 'key', ['a.bin'])).toBeNull();
			expect(writeArtifacts(base, 'key', [['a.bin', source]])).toBe(true);
		});
	});
});

describe('buildLog', () => {
	it("prints each line at once with the build's name, keeps it, and names a command that failed", async () => {
		const printed: [string, boolean][] = [];
		const log = buildLog('tools', (line, stderr) => printed.push([line, stderr]));
		log.say('building');
		await log.run('sh', ['-c', 'echo compiled; echo warned >&2']);
		await expect(log.run('sh', ['-c', 'echo broke; exit 2'])).rejects.toThrow(
			'sh -c echo broke; exit 2 failed: its exit status was 2',
		);
		expect(printed[0]).toEqual(['[tools] building', false]);
		// Each output's lines arrive through a pipe of its own, so only each one's own order is certain.
		expect(printed.slice(1, 3).sort()).toEqual([
			['[tools] compiled', false],
			['[tools] warned', true],
		]);
		expect(printed.slice(3)).toEqual([
			[expect.stringMatching(/^\[tools\] sh took \d+ s$/), false],
			['[tools] broke', false],
		]);
		expect(log.text()).toBe(
			`${printed.map(([line]) => line.slice('[tools] '.length)).join('\n')}\n`,
		);
	});
});

describe('runBuilds', () => {
	it('prints every line as it comes, runs every build to its end, then prints a failed log whole', async () => {
		const printed: [string, boolean][] = [];
		const run = runBuilds(
			[
				{
					name: 'slow',
					work: async (log) => {
						log.say('slow starts');
						await Bun.sleep(40);
						log.say('slow ends');
					},
				},
				{
					name: 'broken',
					work: async (log) => {
						log.say('broken starts');
						await Bun.sleep(15);
						throw new Error('cargo build failed');
					},
				},
				{
					name: 'quick',
					work: async (log) => {
						log.say('quick starts');
						await Bun.sleep(1);
						log.say('quick ends');
					},
				},
			],
			(line, stderr) => printed.push([line.replace(/\d+ s/, 'N s'), stderr]),
		);
		await expect(run).rejects.toThrow('the broken build failed; its whole log is above');
		// The builds' lines mix as they come, each with its build's name; the slow build ran to its
		// end after the broken one failed; and the failed build's log then printed again in one piece.
		expect(printed).toEqual([
			['[slow] slow starts', false],
			['[broken] broken starts', false],
			['[quick] quick starts', false],
			['[quick] quick ends', false],
			['[quick] done in N s', false],
			['[broken] error: cargo build failed', true],
			['[broken] failed after N s', true],
			['[slow] slow ends', false],
			['[slow] done in N s', false],
			[
				'\nthe whole log of the broken build, which failed after N s:\nbroken starts\nerror: cargo build failed',
				true,
			],
		]);
	});

	it('names every build that failed, in the order of the builds', async () => {
		const failing = (name: string, ms: number): BuildJob => ({
			name,
			work: async () => {
				await Bun.sleep(ms);
				throw new Error('cargo build failed');
			},
		});
		const builds = [failing('threaded', 20), failing('single', 1), failing('tools', 10)];
		await expect(runBuilds(builds, () => {})).rejects.toThrow(
			'the threaded, single and tools builds failed; their whole logs are above',
		);
		await expect(runBuilds([{ name: 'tools', work: async () => {} }], () => {})).resolves.toBe(
			undefined,
		);
	});
});
