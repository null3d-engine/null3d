// The pass keys of the CI jobs whose parts pass again without building when an earlier run passed
// them with the same inputs: the Rust tests, the shader compiler's shards and the Vite plugin's
// compiler tests. CI's passes job runs this once, before those jobs. It works out each part's key
// from the hashes of the files that the part reads, which the job's own step gives in HASHES, and
// looks each key up in the Actions cache. A job whose every part passed then starts no runner at
// all: each part used to take a runner of its own to find its pass, 30 of them in a run that
// changed no Rust or shader file. A job that runs reads its parts' keys from this job's answer, so
// each key has one source. The key formats are the ones that the jobs wrote before, so their passes
// still count.
//   bun tools/lib/ci-passes.ts    prints keys=, passed= and modules= lines, for $GITHUB_OUTPUT
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashFiles } from './build-cache';
import { ghAsync } from './gh';
import { moduleShare, wgslModules } from './wgsl-modules';

/** One part of a job's matrix, as the workflow lists it. */
export type MatrixEntry = Readonly<Record<string, string | number | undefined>>;

/** The hashes of the files that the parts read, by the names that the passes job's step gives. */
export type InputHashes = Readonly<Record<string, string>>;

/** The packing test, whose parts each key on the hash of their own share of the WGSL modules. */
const PACK = 'test:shader-compiler:pack';

/** A part of the plugin's job: its script, and its share of the modules when it has one. */
const pluginPart = (entry: MatrixEntry) =>
	entry.share ? `${entry.script}-${entry.share}` : String(entry.script);

/** How a pass-keyed job names its parts and keys their passes. */
interface PassKeyed {
	/** The names of the hashes that its keys take, from the passes job's step. */
	readonly hashes: readonly string[];
	/** The name of a part, which the job's matrix also gives, to find its key in the answer. */
	part(entry: MatrixEntry): string;
	/** The part's key: its name and the hashes of the files that it reads. */
	key(entry: MatrixEntry, hashes: InputHashes, modules: InputHashes): string;
}

/** Every pass-keyed job of the workflow. */
export const PASS_KEYED: Readonly<Record<string, PassKeyed>> = {
	'rust-tests': {
		hashes: ['rust-shaders', 'rust-workspace'],
		part: (entry) => String(entry.id),
		key: (entry, hashes) =>
			`passed-v2-${entry.id}-${entry.shard ?? entry.partition}-${entry.shard ? hashes['rust-shaders'] : hashes['rust-workspace']}`,
	},
	'shader-compiler': {
		hashes: ['shader-compiler'],
		part: (entry) => String(entry.part),
		key: (entry, hashes) => `passed-v4-shader-compiler-${entry.shard}-${hashes['shader-compiler']}`,
	},
	'shader-compiler-plugin': {
		hashes: ['plugin', 'plugin-tests'],
		part: pluginPart,
		key: (entry, hashes, modules) =>
			`passed-v2-shader-compiler-plugin-${pluginPart(entry)}-${hashes.plugin}-${entry.script === PACK ? modules[String(entry.share)] : hashes['plugin-tests']}`,
	},
};

/** The parts of each pass-keyed job, as the workflow lists them. */
export function workflowMatrices(root: string): Record<string, MatrixEntry[]> {
	const workflow = Bun.YAML.parse(readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')) as {
		jobs: Record<string, { strategy?: { matrix?: { include?: MatrixEntry[] } } }>;
	};
	return Object.fromEntries(
		Object.keys(PASS_KEYED).map((job) => [
			job,
			workflow.jobs[job]?.strategy?.matrix?.include ?? [],
		]),
	);
}

/** The hash of each share of the WGSL modules that a part of the packing test compiles. */
export function moduleHashes(
	root: string,
	entries: readonly MatrixEntry[],
): Record<string, string> {
	const modules = wgslModules(root);
	return Object.fromEntries(
		entries
			.filter(({ script }) => script === PACK)
			.map(({ share }) => [String(share), hashFiles(root, moduleShare(modules, String(share)))]),
	);
}

/** Each pass-keyed job's parts, by name, with their keys. */
export function passKeys(
	matrices: Readonly<Record<string, readonly MatrixEntry[]>>,
	hashes: InputHashes,
	modules: InputHashes,
): Record<string, Record<string, string>> {
	return Object.fromEntries(
		Object.entries(PASS_KEYED).map(([job, keyed]) => {
			for (const name of keyed.hashes)
				if (hashes[name] === undefined) throw new Error(`no hash named ${name} for ${job}`);
			const entries = matrices[job] ?? [];
			if (entries.length === 0) throw new Error(`the workflow lists no parts of ${job}`);
			return [
				job,
				Object.fromEntries(
					entries.map((entry) => [keyed.part(entry), keyed.key(entry, hashes, modules)]),
				),
			];
		}),
	);
}

/** The refs, newest-run first, of each cache entry whose key is `key`. */
export type CacheRefs = (key: string) => Promise<string[]>;

/** Lists a key's cache entries through the REST API, which the passes job may read. */
export const cacheRefsOf =
	(repository: string, root: string): CacheRefs =>
	async (key) => {
		const out = await ghAsync(
			[
				'api',
				`repos/${repository}/actions/caches?key=${encodeURIComponent(key)}`,
				'--jq',
				'.actions_caches[] | [.key, .ref] | @tsv',
			],
			root,
		);
		// The API matches a key's prefix, so an entry of a longer key is no pass of this one.
		return out
			.split('\n')
			.map((line) => line.split('\t'))
			.filter(([found]) => found === key)
			.map(([, ref]) => ref ?? '');
	};

/**
 * The keys that a run on `refs` can restore, as the cache action would: an entry saved on one of
 * them. A lookup that fails counts as no pass, so its part runs and finds its own answer.
 */
export async function heldKeys(
	keys: readonly string[],
	refs: readonly string[],
	refsOf: CacheRefs,
): Promise<Set<string>> {
	const held = await Promise.all(
		keys.map(async (key) => {
			try {
				return (await refsOf(key)).some((ref) => refs.includes(ref)) ? key : undefined;
			} catch (e) {
				console.error(`could not look up ${key}, so its part runs: ${(e as Error).message}`);
				return undefined;
			}
		}),
	);
	return new Set(held.filter((key) => key !== undefined));
}

/** The jobs whose every part's key is held. */
export function passedJobs(
	keys: Readonly<Record<string, Readonly<Record<string, string>>>>,
	held: ReadonlySet<string>,
): string[] {
	return Object.entries(keys)
		.filter(([, parts]) => Object.values(parts).every((key) => held.has(key)))
		.map(([job]) => job);
}

if (import.meta.main) {
	const root = join(import.meta.dirname, '../..');
	const { GITHUB_REPOSITORY, GITHUB_REF, DEFAULT_BRANCH, HASHES } = process.env;
	if (!GITHUB_REPOSITORY || !GITHUB_REF || !DEFAULT_BRANCH || !HASHES)
		throw new Error('set GITHUB_REPOSITORY, GITHUB_REF, DEFAULT_BRANCH and HASHES, as CI does');
	const matrices = workflowMatrices(root);
	const modules = moduleHashes(root, matrices['shader-compiler-plugin'] ?? []);
	const keys = passKeys(matrices, JSON.parse(HASHES), modules);
	// A run restores the entries of its own ref and of the default branch.
	const refs = [GITHUB_REF, `refs/heads/${DEFAULT_BRANCH}`];
	const all = Object.values(keys).flatMap((parts) => Object.values(parts));
	const held = await heldKeys(all, refs, cacheRefsOf(GITHUB_REPOSITORY, root));
	const passed = passedJobs(keys, held);
	console.error(
		`${held.size} of ${all.length} parts passed before; whole jobs: ${passed.join(', ') || 'none'}`,
	);
	console.log(`keys=${JSON.stringify(keys)}`);
	console.log(`passed=${JSON.stringify(passed)}`);
	console.log(`modules=${JSON.stringify(modules)}`);
}
