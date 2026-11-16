// Puts the measurement's large files in target/group-culling, which git ignores: the Bistro
// exterior (Amazon Lumberyard, CC BY 4.0, from Morgan McGuire's Computer Graphics Archive),
// downloaded and checked against its SHA-256, converted to glTF and optimized with levels and
// pieces by the asset tool; the desert's files, copied from the folder that MESHLETS_DESERT
// names (the meshlet study's target/meshlets, with null3d-final and raw); and three.js r187's
// package from the folder that MESHLETS_THREE names. Run from the repository's root.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '../../../..');
const data = join(root, 'target/group-culling');
const BISTRO = {
	url: 'https://casual-effects.com/g3d/data10/research/model/bistro/Exterior.zip',
	sha256: 'f612ba0d8a65811afe0d48a023d31e5b43ac40b78e9b12d15e2b7dc8923c29d4',
	licence: 'CC BY 4.0, (c) 2017 Amazon Lumberyard; NVIDIA ORCA; OBJ by Morgan McGuire',
};

const downloads = join(data, 'downloads/bistro');
mkdirSync(downloads, { recursive: true });
const zip = join(downloads, 'Exterior.zip');
if (!existsSync(zip)) {
	const response = await fetch(BISTRO.url);
	if (!response.ok) throw new Error(`${BISTRO.url}: ${response.status}`);
	writeFileSync(zip, new Uint8Array(await response.arrayBuffer()));
}
const sum = createHash('sha256').update(readFileSync(zip)).digest('hex');
if (sum !== BISTRO.sha256) throw new Error(`Exterior.zip has SHA-256 ${sum}, not ${BISTRO.sha256}`);
execFileSync('unzip', ['-o', '-q', zip, '-d', downloads], { stdio: 'inherit' });
const cli = join(root, 'packages/cli/bin/null3d.js');
const raw = join(data, 'models/bistro/raw');
mkdirSync(raw, { recursive: true });
execFileSync(
	'bun',
	[
		cli,
		'assets',
		'convert',
		join(downloads, 'exterior.obj'),
		join(raw, 'bistro.glb'),
		'--compression',
		'none',
	],
	{ stdio: 'inherit' },
);
execFileSync(
	'bun',
	[
		cli,
		'assets',
		'optimize',
		raw,
		join(data, 'models/bistro/null3d'),
		'--lod',
		'--no-blockers',
		'--bvh',
		'0',
	],
	{ stdio: 'inherit' },
);

for (const [env, from, to] of [
	['MESHLETS_DESERT', 'null3d-final', 'models/null3d-final'],
	['MESHLETS_DESERT', 'raw', 'models/raw'],
	['MESHLETS_THREE', '', 'three/package'],
] as const) {
	const source = process.env[env];
	if (source) cpSync(join(source, from), join(data, to), { recursive: true });
	else console.log(`${env} is not set: ${to} is not copied`);
}
