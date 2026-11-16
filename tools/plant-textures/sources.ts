// The texture sources of a species: the files of `generated/<species>/` in the private reference
// repository at the pinned commit, or in a local folder of the same layout while the references
// change. The tool never reads `photographs/` or any other folder.
//
// A species' folder holds one file in use for each slot, under the slot's planned name. A folder
// that still holds replaced files marks them in its INDEX.md: a row whose description says
// "Superseded by" is not in use, and a remake carries a `-b` or `-c` suffix on the slot's name. So
// the file of a slot is the one file named `<slot>-*.png` that the index does not mark superseded.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cacheDir } from '../lib/build-cache.ts';

/** The pin: the reference repository and the commit the shipped textures come from. */
export interface Pin {
	readonly repository: string;
	readonly commit: string;
}

/** The file that holds the pin, the one place to change it. */
export const PIN_FILE = join(import.meta.dirname, 'pin.json');

/** Reads the pin. */
export function readPin(): Pin {
	const pin = JSON.parse(readFileSync(PIN_FILE, 'utf8')) as Pin;
	if (!/^[0-9a-f]{40}$/.test(pin.commit))
		throw new Error(`${PIN_FILE} names "${pin.commit}", which is not a full commit id`);
	return pin;
}

/** Writes the pin. */
export function writePin(pin: Pin): void {
	writeFileSync(PIN_FILE, `${JSON.stringify(pin, null, '\t')}\n`);
}

/** Where the files of one species come from. */
export interface SourceFolder {
	/** The commit, or `local` for a folder on disk. */
	readonly commit: string;
	/** The folder's file names. */
	list(): readonly string[];
	/** A file's bytes. */
	read(name: string): Uint8Array;
}

/** The SHA-256 of bytes, in hex. */
export function sha256(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

/** A species folder on disk: `<root>/<species>/`. */
export function localFolder(root: string, species: string): SourceFolder {
	const dir = join(root, species);
	if (!existsSync(dir)) throw new Error(`${dir} does not exist`);
	return {
		commit: 'local',
		list: () => readdirSync(dir).sort(),
		read: (name) => new Uint8Array(readFileSync(join(dir, name))),
	};
}

/** Runs git in the cache's repository and returns its output, or throws with git's own message. */
function git(repo: string, args: readonly string[]): Buffer {
	const result = spawnSync('git', ['--git-dir', repo, ...args], {
		maxBuffer: 1 << 30,
		env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
	});
	if (result.status !== 0)
		throw new Error(`git ${args.join(' ')} failed: ${result.stderr?.toString() || result.error}`);
	return result.stdout;
}

/**
 * The reference repository in the cache that every copy of this repository shares: a bare clone
 * that fetches only the pinned commit's tree, and each file's contents only when the tool reads it.
 * Git checks every object it fetches by its hash, so a file read from it is the file at the commit.
 */
export function pinnedRepository(pin: Pin): string {
	const repo = join(cacheDir('plant-references'), 'repository.git');
	if (!existsSync(join(repo, 'HEAD'))) {
		mkdirSync(repo, { recursive: true });
		const init = spawnSync('git', ['init', '--bare', '--quiet', repo]);
		if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`);
	}
	const url = `https://github.com/${pin.repository}.git`;
	const has = spawnSync('git', ['--git-dir', repo, 'cat-file', '-e', `${pin.commit}^{commit}`]);
	if (has.status !== 0) {
		console.log(`Fetching ${pin.repository} at ${pin.commit.slice(0, 12)}.`);
		git(repo, ['config', 'remote.origin.url', url]);
		git(repo, ['config', 'remote.origin.promisor', 'true']);
		git(repo, ['config', 'remote.origin.partialclonefilter', 'blob:none']);
		git(repo, ['fetch', '--quiet', '--depth', '1', '--filter=blob:none', 'origin', pin.commit]);
	}
	return repo;
}

/** A species folder at the pinned commit. */
export function pinnedFolder(pin: Pin, species: string): SourceFolder {
	const repo = pinnedRepository(pin);
	const path = `generated/${species}`;
	const names = git(repo, ['ls-tree', '--name-only', `${pin.commit}:${path}`])
		.toString('utf8')
		.split('\n')
		.filter(Boolean)
		.sort();
	if (names.length === 0) throw new Error(`${pin.repository} has no ${path} at ${pin.commit}`);
	return {
		commit: pin.commit,
		list: () => names,
		read: (name) =>
			new Uint8Array(git(repo, ['cat-file', 'blob', `${pin.commit}:${path}/${name}`])),
	};
}

/** The file names that a species' INDEX.md marks superseded. */
export function supersededFiles(index: string): Set<string> {
	const out = new Set<string>();
	for (const line of index.split('\n')) {
		const cells = line.split('|').map((cell) => cell.trim());
		// A table row: | `file` | what it shows | why |
		const name = /^`([^`]+)`$/.exec(cells[1] ?? '')?.[1];
		if (name && /superseded by/i.test(cells[2] ?? '')) out.add(name);
	}
	return out;
}

/**
 * The generation job of each file in the folder, from the folder's `jobs.jsonl`. A line names the
 * file it made, under the name it had when made; a file renamed when the set was published also
 * carries its `final_name`, which is the name in the folder. A line marked `in_repository: false`
 * made a file that the folder does not hold, such as a rejected attempt or a replaced version.
 */
export function jobIds(text: string | undefined): Map<string, string> {
	const out = new Map<string, string>();
	for (const line of (text ?? '').split('\n')) {
		if (!line.trim()) continue;
		const row = JSON.parse(line) as {
			file?: string;
			final_name?: string;
			job_id?: string;
			in_repository?: boolean;
		};
		if (row.in_repository === false) continue;
		const name = row.final_name ?? row.file;
		if (name && row.job_id) out.set(name, row.job_id);
	}
	return out;
}

/** A source file the tool reads, with its provenance. */
export interface SourceFile {
	readonly slot: number;
	readonly name: string;
	readonly bytes: Uint8Array;
	readonly sha256: string;
	/** The generation job that made the picture, from the folder's `jobs.jsonl`. */
	readonly job?: string;
}

/** Reads the in-use files of the folder by slot. */
export class Sources {
	private readonly names: readonly string[];
	private readonly superseded: Set<string>;
	private readonly jobs: Map<string, string>;
	readonly folder: SourceFolder;
	readonly species: string;

	constructor(folder: SourceFolder, species: string) {
		this.folder = folder;
		this.species = species;
		this.names = folder.list();
		const index = this.names.includes('INDEX.md')
			? new TextDecoder().decode(folder.read('INDEX.md'))
			: '';
		this.superseded = supersededFiles(index);
		this.jobs = jobIds(
			this.names.includes('jobs.jsonl')
				? new TextDecoder().decode(folder.read('jobs.jsonl'))
				: undefined,
		);
	}

	/** The in-use file name of a slot, or undefined when the folder has none. */
	nameOf(slot: number): string | undefined {
		const prefix = `${String(slot).padStart(2, '0')}-`;
		const candidates = this.names.filter(
			(name) => name.startsWith(prefix) && name.endsWith('.png') && !this.superseded.has(name),
		);
		if (candidates.length > 1)
			throw new Error(
				`${this.species}: slot ${slot} has ${candidates.length} files in use (${candidates.join(', ')}); its INDEX.md must mark all but one "Superseded by"`,
			);
		return candidates[0];
	}

	/** Reads the in-use file of a slot. */
	read(slot: number): SourceFile {
		const name = this.nameOf(slot);
		if (!name)
			throw new Error(`${this.species}: the reference set has no file in use for slot ${slot}`);
		const bytes = this.folder.read(name);
		const job = this.jobs.get(name);
		return { slot, name, bytes, sha256: sha256(bytes), ...(job ? { job } : {}) };
	}
}
