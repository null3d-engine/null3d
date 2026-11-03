// Writes the shipped leaf and bark textures of the vegetation add-on's species from the private
// reference set at the pinned commit (D-309):
//   bun run plants:textures <species...>             write each species' folder
//   bun run plants:textures --verify <species...>    build again and compare every file's hash
//   bun run plants:textures --from <dir> <species>   read <dir>/<species>/ instead of the pinned commit
//   bun run plants:textures --pin <commit or ref>    pin another commit of the reference repository
//   bun run plants:textures --sheet <dir> <species>  also write review sheets of what the files hold
// With no species named, it takes every folder of the textures package that holds a source.json.
// The pinned repository is fetched once into the cache that every copy of the repository shares.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODEL_CAPS, TWO_ZONE_DOWNLOADS } from '../../packages/vegetation/src/core/caps.ts';
import { buildSpecies, TEXTURES_ROOT } from './build.ts';
import { writeSheets } from './review.ts';
import { localFolder, pinnedFolder, readPin, sha256, writePin } from './sources.ts';

const args = process.argv.slice(2);
const option = (name: string) => {
	const at = args.indexOf(name);
	if (at < 0) return undefined;
	const value = args[at + 1];
	if (!value || value.startsWith('--')) throw new Error(`${name} needs a value`);
	args.splice(at, 2);
	return value;
};
const flag = (name: string) => {
	const at = args.indexOf(name);
	if (at >= 0) args.splice(at, 1);
	return at >= 0;
};

const pinTo = option('--pin');
const from = option('--from');
const sheets = option('--sheet');
const verify = flag('--verify');

if (pinTo) {
	const pin = readPin();
	let commit = pinTo;
	if (!/^[0-9a-f]{40}$/.test(commit)) {
		const remote = spawnSync(
			'git',
			['ls-remote', `https://github.com/${pin.repository}.git`, pinTo],
			{ encoding: 'utf8' },
		);
		commit = remote.stdout.split(/\s/)[0] ?? '';
		if (remote.status !== 0 || !/^[0-9a-f]{40}$/.test(commit))
			throw new Error(`${pinTo} names no branch or tag of ${pin.repository}: ${remote.stderr}`);
	}
	writePin({ ...pin, commit });
	console.log(`Pinned ${pin.repository} at ${commit}.`);
}

const species = args.length
	? args
	: readdirSync(TEXTURES_ROOT).filter((name) =>
			existsSync(join(TEXTURES_ROOT, name, 'source.json')),
		);
if (species.length === 0 && !pinTo)
	throw new Error('name a species, or add a source.json to a folder of the textures package');

let failed = false;
for (const id of species) {
	console.log(`${id}:`);
	const folder = from ? localFolder(from, id) : pinnedFolder(readPin(), id);
	if (from)
		console.log(
			`  reading ${join(from, id)}, not the pinned commit: the manifest records the commit as "local"`,
		);
	const built = await buildSpecies(id, folder);
	const dir = join(TEXTURES_ROOT, id);
	const kb = (bytes: number) => `${(bytes / 1000).toFixed(1)} KB`;
	const ktx = [...built.files].filter(([name]) => name.endsWith('.ktx2'));
	const full = ktx
		.filter(([name]) => !name.includes('-half'))
		.reduce((sum, [, b]) => sum + b.length, 0);
	const half = ktx
		.filter(([name]) => name.includes('-half'))
		.reduce((sum, [, b]) => sum + b.length, 0);
	const caps = { ...MODEL_CAPS[built.report.config.caps], ...TWO_ZONE_DOWNLOADS[id] };
	console.log(
		`  full set ${kb(full)} of ${kb(caps.downloadBytes)}, half set ${kb(half)} of ${kb(caps.downloadHalfBytes)}`,
	);
	if (built.report.leaf) {
		const { lowerOverlap, lowerMirrored, coverageByLevel } = built.report.leaf;
		console.log(
			`  lower face, ${lowerMirrored ? 'mirrored' : 'as drawn'}, fits the upper's outline with an overlap of ${lowerOverlap}`,
		);
		console.log(`  leaf coverage by mip level, 1024 down to 16: ${coverageByLevel.join(', ')}`);
	}
	for (const layer of built.report.bark ?? [])
		console.log(
			`  ${layer.name} bark seams, across and down, against the steps inside: ${layer.seams.across}, ${layer.seams.down}`,
		);
	if (full > caps.downloadBytes || half > caps.downloadHalfBytes) {
		console.error(
			`  over the owner's cap: lower the ETC1S quality of the least-seen file in source.json`,
		);
		failed = true;
	}
	if (sheets) {
		mkdirSync(sheets, { recursive: true });
		for (const file of await writeSheets(built, sheets)) console.log(`  review sheet ${file}`);
	}
	if (verify) {
		const differ = [...built.files].filter(([name, bytes]) => {
			const path = join(dir, name);
			return !existsSync(path) || sha256(new Uint8Array(readFileSync(path))) !== sha256(bytes);
		});
		if (differ.length) {
			console.error(
				`  differs from the committed folder: ${differ.map(([name]) => name).join(', ')}`,
			);
			failed = true;
		} else console.log(`  every file matches the committed folder, byte for byte`);
	} else {
		for (const [name, bytes] of built.files) writeFileSync(join(dir, name), bytes);
		console.log(`  wrote ${built.files.size} files to ${dir}`);
	}
}
if (failed) process.exit(1);
