// Checks the CI workflow's job graph, its shard lists and the reuse of its work. A typo in the
// graph or the lists breaks CI without failing any job: a job missing from ci-passed's needs never
// gates main, a job that skips on an answer ci-passed does not expect fails every docs-only run,
// and a shard missing from a matrix never runs its tests. A fault in the reuse costs time on every
// run, or reuses a pass that no longer holds, and fails nothing: a job that builds what the build
// job made, a test of the whole shader set in two jobs, and a pass key that misses a script that
// its part starts ([Efficient jobs](../../.dev/pull-requests.md#efficient-jobs)).
import { describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { PRODUCTION_BUILD_PAGES, PRODUCTION_BUILD_TESTS } from '../../tests/lib/server.ts';

interface Step {
	id?: string;
	name?: string;
	run?: string;
	uses?: string;
	'continue-on-error'?: boolean;
	'timeout-minutes'?: number;
	if?: string;
	with?: Record<string, unknown>;
	env?: Record<string, string>;
}

interface Job {
	needs?: string | string[];
	outputs?: Record<string, string>;
	if?: string;
	env?: Record<string, string>;
	strategy?: { matrix?: Record<string, unknown> & { include?: Record<string, unknown>[] } };
	steps?: Step[];
}

const ROOT = join(import.meta.dirname, '../..');
const workflow = Bun.YAML.parse(readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8')) as {
	jobs: Record<string, Job>;
};
const jobs = workflow.jobs;
const scripts = (
	JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
		scripts: Record<string, string>;
	}
).scripts;

const needsOf = (job: Job | undefined): string[] =>
	job?.needs === undefined ? [] : Array.isArray(job.needs) ? job.needs : [job.needs];
const oneTo = (count: number) => Array.from({ length: count }, (_, i) => i + 1);
const jobNamed = (name: string): Job => {
	const job = jobs[name];
	if (!job) throw new Error(`the workflow has no job ${name}`);
	return job;
};
const matrixOf = (name: string) => jobNamed(name).strategy?.matrix ?? {};

/** A command with each `bun run <script>` of package.json written out as the script's commands. */
function expanded(command: string, seen: ReadonlySet<string> = new Set()): string {
	return command.replace(/\bbun run ([\w:-]+)/g, (call, name: string) => {
		const script = scripts[name];
		return script === undefined || seen.has(name)
			? call
			: expanded(script, new Set([...seen, name]));
	});
}

/** The matrix's combinations: its include entries, or else each value of its one list. */
function combinations(job: Job): Record<string, unknown>[] {
	const { include, ...lists } = job.strategy?.matrix ?? {};
	if (include) return include;
	const [key, values] = Object.entries(lists)[0] ?? [];
	return Array.isArray(values) && key ? values.map((value) => ({ [key]: value })) : [{}];
}

/** One command that a job runs, for one combination of its matrix, with the environment it sees. */
interface Command {
	text: string;
	env: Record<string, string>;
	entry: Record<string, unknown>;
}

/**
 * Every command that a job runs, for each combination of its matrix, with the matrix's values in
 * place and package.json's scripts written out.
 */
function commandsOf(job: Job): Command[] {
	return combinations(job).flatMap((entry) =>
		(job.steps ?? []).flatMap(({ run, env }) => {
			if (run === undefined) return [];
			const text = run.replace(/\$\{\{\s*matrix\.(\w+)\s*\}\}/g, (_, key: string) =>
				String(entry[key] ?? ''),
			);
			return [{ text: expanded(text), env: { ...job.env, ...env }, entry }];
		}),
	);
}

/** The archive action, which hands the build job's files and the load builds on (D-222). */
const ARCHIVE = './.github/actions/archive';

/** True when `job` moves the archive `name` through the archive action, in `mode`. */
const hands = (job: Job, name: string, mode: 'upload' | 'download') =>
	(job.steps ?? []).some(
		({ uses, with: given }) => uses === ARCHIVE && given?.name === name && given?.mode === mode,
	);

/** The jobs whose steps download the build job's files. */
const downloadsBuild = (job: Job) => hands(job, 'page-wasm', 'download');

/** Every file below a folder of the repository, by its path from the root. */
function filesBelow(folder: string): string[] {
	return readdirSync(join(ROOT, folder), { recursive: true, encoding: 'utf8' })
		.map((file) => join(folder, file))
		.filter((file) => statSync(join(ROOT, file)).isFile());
}

/** The scripts that the shader crate's Rust tests start, which they name by their path. */
const RUST_STARTED_SCRIPTS = [
	...new Set(
		filesBelow('crates/null3d-shaders/tests')
			.filter((file) => file.endsWith('.rs'))
			.flatMap((file) => [...readFileSync(join(ROOT, file), 'utf8').matchAll(/tools\/[\w-]+\.ts/g)])
			.map(([path]) => path),
	),
];

/** A script path in a command: a file of the repository that Bun runs or tests. */
const SCRIPT_PATH = /(?:^|[\s(])(?:\.\/)?((?:tools|tests|packages|bench)\/[\w./-]+\.[cm]?[jt]s)\b/g;
/** A relative import or a dynamic import of a relative path. */
const RELATIVE_IMPORT = /(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"?]+)/g;
/** The build job writes this folder, and the key names its inputs instead of its files. */
const GENERATED = 'packages/engine/src/generated/';

/** The repository file that an import names, by its path from the root, or null outside it. */
function importedFile(from: string, spec: string): string | null {
	const base = resolve(dirname(join(ROOT, from)), spec);
	for (const candidate of [
		base,
		base.replace(/\.js$/, '.ts'),
		`${base}.ts`,
		join(base, 'index.ts'),
	])
		if (existsSync(candidate) && statSync(candidate).isFile()) return relative(ROOT, candidate);
	return null;
}

/** The scripts and every repository file that they import, directly or through other files. */
function scriptsWithImports(start: readonly string[]): Set<string> {
	const found = new Set<string>();
	const next = [...start];
	for (let file = next.pop(); file !== undefined; file = next.pop()) {
		if (found.has(file)) continue;
		found.add(file);
		if (file.startsWith(GENERATED)) continue;
		for (const [, spec] of readFileSync(join(ROOT, file), 'utf8').matchAll(RELATIVE_IMPORT)) {
			const imported = spec === undefined ? null : importedFile(file, spec);
			if (imported !== null && !imported.includes('node_modules')) next.push(imported);
		}
	}
	return found;
}

/** A pattern of `hashFiles` as a regular expression over paths from the root. */
const globPattern = (glob: string) =>
	new RegExp(
		`^${glob
			.replace(/[.+^${}()|[\]\\]/g, '\\$&')
			.replace(/\*\*/g, '\0')
			.replace(/\*/g, '[^/]*')
			.replaceAll('\0', '.*')}$`,
	);

describe("CI's workflow", () => {
	it('gates main on every job through ci-passed', () => {
		const gated = needsOf(jobs['ci-passed']).sort();
		// The jobs that run after ci-passed act on its answer, so they cannot be among its needs.
		const others = Object.keys(jobs)
			.filter((name) => name !== 'ci-passed' && !needsOf(jobs[name]).includes('ci-passed'))
			.sort();
		expect(gated).toEqual(others);
	});

	it("lets a job skip only on the changes job's answer that ci-passed allows", () => {
		const step = jobNamed('ci-passed').steps?.find(({ name }) => name === 'Every job passed');
		const gate = Object.fromEntries(
			[...(step?.run ?? '').matchAll(/"([\w-]+)": "(\w+)"/g)].map(([, job, answer]) => [
				job,
				answer,
			]),
		);
		for (const name of needsOf(jobs['ci-passed'])) {
			const answer = /needs\.changes\.outputs\.(\w+) == 'true'/.exec(jobNamed(name).if ?? '')?.[1];
			expect(gate[name], name).toBe(answer);
		}
	});

	it('runs every shard of each numbered matrix once', () => {
		for (const [name, key] of [
			['browser', 'shard'],
			['browser-alone', 'shard'],
			['real-browsers', 'shard'],
			['shader-entries', 'shard'],
		] as const) {
			const shards = matrixOf(name)[key] as number[];
			expect(shards, name).toEqual(oneTo(shards.length));
		}
		expect(matrixOf('real-browsers').shards).toEqual([
			(matrixOf('real-browsers').shard as number[]).length,
		]);
	});

	it('gives each browser shard one weight', () => {
		const weights = jobNamed('browser')
			.steps?.map(({ env }) => env?.PWTEST_SHARD_WEIGHTS)
			.find(Boolean);
		expect(weights?.split(':').length).toBe((matrixOf('browser').shard as number[]).length);
	});

	it("splits the benchmark pages' parity tests into shards that each run once", () => {
		const parity = (matrixOf('bench').include ?? [])
			.map(({ tests }) => /^parity\.spec\.ts --shard=(\d+)\/(\d+)$/.exec(String(tests)))
			.filter((match) => match !== null)
			.map(([, index, count]) => [Number(index), Number(count)]);
		const count = parity[0]?.[1] ?? 0;
		expect(count).toBeGreaterThan(0);
		expect(parity.map(([index]) => index)).toEqual(oneTo(count));
		expect(parity.every(([, total]) => total === count)).toBe(true);
	});

	it("leaves out of the benchmark pages' remaining shard every test that another shard runs", () => {
		const tests = (matrixOf('bench').include ?? []).map(({ tests }) => String(tests));
		const named = tests.flatMap((t) => [...(/^--grep "\$(\w+)"$/.exec(t)?.slice(1) ?? [])]);
		const rest = tests.filter((t) => t.startsWith('--grep-invert'));
		expect(named.length).toBeGreaterThan(0);
		expect(rest).toHaveLength(1);
		for (const name of [...named, 'PARITY_TESTS']) expect(rest[0]).toContain(`$${name}`);
		for (const name of named) expect(jobNamed('bench').env?.[name], name).toBeTruthy();
	});

	it("runs the shader build's determinism check in exactly one job", () => {
		const parts = (matrixOf('rust-tests').include ?? []).filter(
			({ shard }) => shard === 'determinism',
		);
		expect(parts).toHaveLength(1);
		expect(String(parts[0]?.tests)).toContain('--test build');
	});

	it('runs every shard of the shader compiler job once', () => {
		const shards = (matrixOf('shader-compiler').include ?? []).map(({ shard }) => String(shard));
		const count = Number(shards[0]?.split('/')[1]);
		expect(shards).toEqual(Array.from({ length: count }, (_, i) => `${i}/${count}`));
	});

	it('runs each shard of each sharded Rust test part once', () => {
		const shards = new Map<string, string[]>();
		for (const part of matrixOf('rust-tests').include ?? []) {
			if (part.shard === undefined) continue;
			const list = shards.get(String(part.tests)) ?? [];
			list.push(String(part.shard));
			shards.set(String(part.tests), list);
		}
		expect(shards.size).toBeGreaterThan(0);
		for (const [tests, list] of shards) {
			const numbered = list.filter((shard) => /^\d+\/\d+$/.test(shard));
			const count = Number(numbered[0]?.split('/')[1]);
			expect(numbered.sort(), tests).toEqual(
				Array.from({ length: count }, (_, i) => `${i}/${count}`).sort(),
			);
		}
	});

	it('restores a Rust cache in every job that runs cargo or rustup', () => {
		for (const [name, job] of Object.entries(jobs)) {
			if (!commandsOf(job).some(({ text }) => /\b(?:cargo|rustup)\b/.test(text))) continue;
			const cached = (job.steps ?? []).some(({ uses }) => uses?.startsWith('Swatinem/rust-cache@'));
			expect(cached, name).toBe(true);
		}
	});

	it("keeps every job that downloads the build job's files from building them again", () => {
		const downloaders = Object.entries(jobs).filter(([, job]) => downloadsBuild(job));
		expect(downloaders.length).toBeGreaterThan(0);
		for (const [name, job] of downloaders)
			expect(job.env?.NULL3D_REQUIRE_FRESH_SHADERS, name).toBe('1');
	});

	it('runs the test that builds every shader in the shader compiler job alone', () => {
		// The determinism check builds a few entries of the same test, which is not the whole set.
		const runs = Object.entries(jobs).flatMap(([name, job]) =>
			commandsOf(job)
				.filter(({ text }) => /-p null3d-shaders --test build\b/.test(text))
				.filter(({ entry }) => entry.shard !== 'determinism')
				.map(() => name),
		);
		expect([...new Set(runs)]).toEqual(['shader-compiler']);
		// The module exports test builds a few entries, among the workspace's tests.
		for (const [name, job] of Object.entries(jobs))
			for (const { text } of commandsOf(job))
				expect(text, name).not.toMatch(/-p null3d-shaders-wasm\b|shader-module-exports/);
	});

	it('builds the production pages in one job, and every other browser job leaves them out', () => {
		const builders = Object.entries(jobs).filter(([, job]) =>
			commandsOf(job).some(
				({ text }) => text.includes('vite build') || text.includes('tools/build-test-pages.ts'),
			),
		);
		expect(builders.map(([name]) => name)).toEqual(['browser-production']);
		for (const [name, job] of Object.entries(jobs)) {
			const browserRuns = commandsOf(job).filter(({ text }) =>
				text.includes('bun run --cwd tests test'),
			);
			if (browserRuns.length === 0) continue;
			const production = browserRuns.every(({ text }) =>
				text.includes('--project "production build'),
			);
			// A job of the production build serves the pages it built; any other job builds none.
			expect(job.env?.NULL3D_PRODUCTION_PAGES, name).toBe(production ? undefined : 'skip');
			if (production)
				for (const { env } of browserRuns)
					expect(env.NULL3D_PRODUCTION_PAGES, name).toBe('prebuilt');
		}
	});

	it('runs each production build test file in one part, which builds every page that it loads', () => {
		const words = (text: unknown) => String(text).split(/\s+/).filter(Boolean);
		const parts = combinations(jobNamed('browser-production'));
		const files = parts.flatMap(({ tests }) => words(tests));
		expect(files.toSorted()).toEqual([...PRODUCTION_BUILD_TESTS].sort());
		for (const { pages, tests } of parts) {
			const built = words(pages);
			for (const page of built) expect(PRODUCTION_BUILD_PAGES as readonly string[]).toContain(page);
			for (const file of words(tests)) {
				const text = readFileSync(join(ROOT, 'tests/image', file), 'utf8');
				for (const page of PRODUCTION_BUILD_PAGES.filter((p) => text.includes(`${p}.html`)))
					expect(built, `${file} loads ${page}.html`).toContain(page);
			}
		}
	});

	it('fills the browser and sample caches in a job that no other job waits for', () => {
		const filler = jobNamed('browser-caches');
		expect(needsOf(filler)).toEqual(['changes']);
		for (const action of ['./.github/actions/playwright-chromium', './.github/actions/samples']) {
			const fill = (filler.steps ?? []).find(({ uses }) => uses === action);
			expect(fill?.with?.['cache-only'], action).toBe('true');
			// A stalled mirror must not fail the run: each job then installs for itself.
			expect(fill?.['continue-on-error'], action).toBe(true);
		}
		for (const [name, job] of Object.entries(jobs))
			if (name !== 'ci-passed') expect(needsOf(job), name).not.toContain('browser-caches');
		// The browser's key is Playwright's version: the package files change far more often.
		const browser = readFileSync(
			join(ROOT, '.github/actions/playwright-chromium/action.yml'),
			'utf8',
		);
		expect(browser).not.toContain('package.json');
	});

	it('makes the load builds in one job, which every job that serves them waits for', () => {
		const builders = Object.entries(jobs).filter(([, job]) =>
			commandsOf(job).some(({ text }) => text.includes('tests/lib/load-server.ts')),
		);
		expect(builders.map(([name]) => name)).toEqual(['load-pages']);
		// The builds travel through the archive action, which packs each content once.
		const upload = (jobNamed('load-pages').steps ?? []).find(
			({ uses, with: given }) => uses === ARCHIVE && given?.name === 'load-pages',
		);
		expect(upload?.with?.mode).toBe('upload');
		expect(upload?.with?.link).toBe('true');
		const servers = Object.entries(jobs).filter(
			([, job]) => job.env?.NULL3D_LOAD_PAGES === 'prebuilt',
		);
		expect(servers.length).toBeGreaterThan(0);
		for (const [name, job] of servers) {
			expect(needsOf(job), name).toContain('load-pages');
			expect(hands(job, 'load-pages', 'download'), name).toBe(true);
		}
	});

	it('lets every size part read the size memo, which the job that judges the parts keeps', () => {
		const cacheStep = (job: string, action: string) =>
			(jobNamed(job).steps ?? []).find(
				({ uses, with: given }) => uses === action && String(given?.path).endsWith('/size-memo'),
			);
		const restore = cacheStep('size-parts', 'actions/cache/restore@v4');
		const save = cacheStep('wasm-checks', 'actions/cache/save@v4');
		expect(restore?.with?.path).toBe(save?.with?.path);
		// Any run's memo serves, so the parts take the newest under the prefix of the key that the
		// judge saves under.
		const prefix = String(restore?.with?.['restore-keys']);
		expect(String(save?.with?.key).startsWith(prefix)).toBe(true);
		expect(needsOf(jobNamed('wasm-checks'))).toContain('size-parts');
		// The build job reads the same memo and picks the count of parts, which
		// tools/lib/size-memo.ts numbers from 1, and the matrix takes it.
		const build = jobNamed('build');
		expect(cacheStep('build', 'actions/cache/restore@v4')?.with?.['restore-keys']).toBe(prefix);
		const pick = (build.steps ?? []).find(({ id }) => id === 'size-parts');
		expect(pick?.run).toContain('bun tools/lib/size-memo.ts --parts');
		expect(build.outputs?.['size-parts']).toContain('steps.size-parts.outputs.parts');
		expect(String(matrixOf('size-parts').part)).toContain(
			'fromJSON(needs.build.outputs.size-parts)',
		);
		expect(needsOf(jobNamed('size-parts'))).toContain('build');
	});

	it("keys the city's cache on every file that its build reads", () => {
		const action = readFileSync(join(ROOT, '.github/actions/city/action.yml'), 'utf8');
		const globs = [...(/hashFiles\(([^)]*)\)/.exec(action)?.[1] ?? '').matchAll(/'([^']+)'/g)].map(
			([, glob]) => glob ?? '',
		);
		const kept = globs.filter((glob) => !glob.startsWith('!')).map(globPattern);
		const dropped = globs
			.filter((glob) => glob.startsWith('!'))
			.map((glob) => globPattern(glob.slice(1)));
		// The build script, the plugin's asset module, and the asset tool that the plugin loads from
		// @null3d/cli/assets, which the package's exports map to its optimizer's index.
		const files = scriptsWithImports([
			'bench/lib/city-files.ts',
			'packages/vite-plugin/src/assets.ts',
			'packages/cli/src/assets/index.js',
		]);
		const missing = [...files].filter(
			(file) =>
				!kept.some((pattern) => pattern.test(file)) ||
				dropped.some((pattern) => pattern.test(file)),
		);
		expect(missing).toEqual([]);
	});

	it('gives each download of the real-browser jobs a limit of its own and one more try', () => {
		for (const name of ['real-browsers', 'real-browsers-prebuilt']) downloadsRetry(name);
	});

	function downloadsRetry(name: string): void {
		const steps = jobNamed(name).steps ?? [];
		const downloads = steps.filter(
			({ uses, with: given }) =>
				(uses === './.github/actions/archive' || uses === './.github/actions/city') &&
				given?.mode === 'download',
		);
		const firsts = downloads.filter((step) => step.id !== undefined);
		expect(firsts.length, name).toBeGreaterThan(0);
		for (const first of firsts) {
			expect(first['timeout-minutes'], `${name} ${first.id}`).toBeGreaterThan(0);
			expect(first['continue-on-error'], `${name} ${first.id}`).toBe(true);
			const retry = steps[steps.indexOf(first) + 1];
			expect(retry?.if, `${name} ${first.id}`).toBe(`steps.${first.id}.outcome == 'failure'`);
			expect(retry?.uses, `${name} ${first.id}`).toBe(first.uses);
			expect(retry?.with, `${name} ${first.id}`).toEqual(first.with);
			expect(retry?.['timeout-minutes'], `${name} ${first.id}`).toBeGreaterThan(0);
		}
		// Every download is a first try or the retry of one.
		expect(downloads, name).toHaveLength(2 * firsts.length);
	}

	it('builds the city in the load pages job, which every job that downloads the city waits for', () => {
		const cityMode = (job: Job) =>
			(job.steps ?? []).find(({ uses }) => uses === './.github/actions/city')?.with?.mode;
		const builders = Object.entries(jobs).filter(([, job]) => cityMode(job) === 'build');
		// The benchmark pages bundle the city's files, so the job that builds them builds the city too.
		expect(builders.map(([name]) => name)).toEqual(['load-pages']);
		const readers = Object.entries(jobs).filter(([, job]) => cityMode(job) === 'download');
		expect(readers.length).toBeGreaterThan(0);
		for (const [name, job] of readers) expect(needsOf(job), name).toContain('load-pages');
	});

	it("keeps the build job's WebAssembly files in the cache, under the build script's own key", () => {
		const steps = jobNamed('build').steps ?? [];
		const key = steps.find(({ id }) => id === 'wasm-key');
		expect(key?.run).toContain('bun tools/build-wasm.ts --cache-key');
		const cacheOf = (action: string) =>
			steps.find(
				({ uses, with: given }) =>
					uses === action && String(given?.path).endsWith('/wasm-artifacts'),
			);
		const restore = cacheOf('actions/cache/restore@v4');
		const save = cacheOf('actions/cache/save@v4');
		expect(String(restore?.with?.key)).toContain('steps.wasm-key.outputs.key');
		expect(save?.with?.key).toBe(restore?.with?.key);
		// The restore comes before the build that copies the files from it, and the save after.
		const at = (step: Step | undefined) => steps.indexOf(step as Step);
		const build = steps.findIndex(({ name }) =>
			/WebAssembly files that the test pages need/.test(name ?? ''),
		);
		expect(at(restore)).toBeLessThan(build);
		expect(at(save)).toBeGreaterThan(build);
	});

	it("gives a draft's full run, started by marking it ready, a concurrency group of its own", () => {
		const group = String((workflow as { concurrency?: { group?: string } }).concurrency?.group);
		// The pushes after it run in the pull request's own group, so they never cancel it.
		expect(group).toContain("github.event.action == 'ready_for_review'");
		expect(group).toContain("format('pr-{0}{1}'");
		// A later full run waits for it, so it ends with a result.
		const cancel = String(
			(workflow as { concurrency?: { 'cancel-in-progress'?: string } }).concurrency?.[
				'cancel-in-progress'
			],
		);
		expect(cancel).toContain("github.event.action != 'ready_for_review'");
	});

	it("moves the build job's files and the load builds only through the archive action", () => {
		expect(hands(jobNamed('build'), 'page-wasm', 'upload')).toBe(true);
		for (const [name, job] of Object.entries(jobs))
			for (const { uses, with: given } of job.steps ?? [])
				if (
					uses?.startsWith('actions/') &&
					['page-wasm', 'load-pages'].includes(String(given?.name))
				)
					expect.unreachable(`${name} moves ${given?.name} without the archive action`);
	});

	it('names in each pass key every script that its part starts, with their imports', () => {
		const keyed = Object.entries(jobs).filter(([, job]) =>
			(job.steps ?? []).some(({ name }) => /^The key of this \w+'s inputs$/.test(name ?? '')),
		);
		expect(keyed.length).toBeGreaterThan(0);
		for (const [name, job] of keyed) {
			const key = (job.steps ?? []).find(({ name: step }) =>
				/^The key of this \w+'s inputs$/.test(step ?? ''),
			);
			const globs = [...(key?.run ?? '').matchAll(/hashFiles\(([^)]*)\)/g)].flatMap(([, args]) =>
				[...(args ?? '').matchAll(/'([^']+)'/g)].map(([, glob]) => glob ?? ''),
			);
			const patterns = globs.map(globPattern);
			const started = commandsOf(job).flatMap(({ text, env }) => {
				const named = [...text.matchAll(SCRIPT_PATH)].map(([, path]) => path ?? '');
				// The shader crate's build tests start their scripts when they build through the compiler.
				const compiles =
					/cargo .*-p null3d-shaders\b/.test(text) &&
					(text.includes('NULL3D_SHADER_COMPILER=') || env.NULL3D_SHADER_COMPILER !== undefined);
				return [...named, ...(compiles ? RUST_STARTED_SCRIPTS : [])];
			});
			const files = scriptsWithImports(started.filter((path) => existsSync(join(ROOT, path))));
			const missing = [...files].filter(
				(file) => !file.startsWith(GENERATED) && !patterns.some((pattern) => pattern.test(file)),
			);
			expect(missing, name).toEqual([]);
			// A part that reads the build job's shader modules names the files they are built from.
			if ([...files].some((file) => file.startsWith(GENERATED)))
				expect(globs, name).toEqual(
					expect.arrayContaining(['crates/null3d-shaders/**', 'tools/shaders.ts']),
				);
		}
	});
	it('leaves the image references that a job does not read out of its checkout', () => {
		// The references are most of a checkout. These jobs read every set, as the reference check
		// does, or check out history, which a sparse checkout would leave without its files.
		const whole = new Set([
			'changes',
			'commits',
			'docs-and-tools',
			'generated-branch',
			'size-base',
			'wasm-checks',
		]);
		const references = 'tests/image/references';
		for (const [name, job] of Object.entries(jobs)) {
			const checkout = (job.steps ?? []).find(({ uses }) => uses?.startsWith('actions/checkout@'));
			if (!checkout || whole.has(name)) continue;
			const sparse = String(checkout.with?.['sparse-checkout'] ?? '');
			expect(sparse, name).toContain(`!/${references}/`);
			// The browser tests read the software GPU's set, and real browsers the real GPU's.
			if (name.startsWith('browser') || name === 'showcase' || name === 'skill-sketches')
				expect(sparse, name).not.toContain(`!/${references}/chromium-swiftshader/`);
			if (name === 'real-browsers')
				expect(sparse, name).not.toContain(`!/${references}/chrome-real-gpu/`);
		}
	});
});
