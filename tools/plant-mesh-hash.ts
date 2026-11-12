// A stable hash of one species' built meshes, so a change to a shared builder or to a record field
// can be proved inert for the species that do not use it. It builds on this thread with no browser:
// the same kit and grow functions a page uses, reached through their Bun-side entry points, since the
// package's index also loads the engine for a page.
//
// Usage: bun tools/plant-mesh-hash.ts <species> [season]
//        bun tools/plant-mesh-hash.ts --standins
//
// The species must be one of the registry's, and the season one of summer, autumn, winter or
// blossom; the record's default when it is not given. `--standins` builds every demo page's stand-ins
// with the page's own size, colours, seed and sparseness, so a change to the plant core can be proved
// inert for the pages that draw stand-ins. Each build prints its hash with the commit and the dirty
// flag, as every figure in the repository does, and the two builds' hashes must match.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { DEMO_SPARSENESS, PAGE_STAND_INS } from '../examples/lib/stand-ins.ts';
import type { PlantAsset, ShootRows, SpeciesKitData } from '../packages/vegetation/src/asset.ts';
import { isSpeciesId, loadSpecies, speciesIds } from '../packages/vegetation/src/core/registry.ts';
import { standInSpecies } from '../packages/vegetation/src/core/stand-in.ts';
import type { Season } from '../packages/vegetation/src/core/types.ts';
import { buildKitNow, growPlantNow, loadPlantCode } from '../packages/vegetation/src/generate.ts';

/** The repository's root, which the tool reads its provenance from. */
const ROOT = join(import.meta.dirname, '..');
/** The mesh tier a page draws near the camera. */
const DETAIL = 'high';
/** The seasons a record may grow for. */
const SEASONS: readonly Season[] = ['summer', 'autumn', 'winter', 'blossom'];

/** The commit the meshes were built at, and whether the tree had changes. */
function provenance(): { readonly commit: string; readonly dirty: boolean } {
	const run = (args: readonly string[]): string => {
		const done = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
		if (done.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${done.stderr.trim()}`);
		return done.stdout.trim();
	};
	return { commit: run(['rev-parse', 'HEAD']), dirty: run(['status', '--porcelain']) !== '' };
}

/** One mesh set's hash, with the vertices and indices it holds. */
interface MeshHash {
	readonly hash: string;
	readonly vertices: number;
	readonly indices: number;
}

/** Feeds one typed array to the hash with its length, so two arrays never collide on layout. */
function eat(hash: ReturnType<typeof createHash>, array: ArrayBufferView): void {
	hash.update(String(array.byteLength));
	hash.update(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
}

/** Feeds a skeleton or row field: its bytes for a view, its value for a count, a marker for none. */
function eatField(
	hash: ReturnType<typeof createHash>,
	value: ArrayBufferView | number | undefined,
): void {
	if (value === undefined) hash.update('u');
	else if (typeof value === 'number') hash.update(`n:${value}`);
	else eat(hash, value);
}

/** A prototype's or a part's arrays, in a fixed order. */
const ARRAYS = ['positions', 'normals', 'uvs', 'uvs1', 'colors', 'indices'] as const;

/**
 * The hash of everything one build draws: the kit's shoot prototypes at every tier and its card
 * atlas, the grown plant's skeleton, shoot rows and every level's parts.
 */
function meshHash(kit: SpeciesKitData, asset: PlantAsset): MeshHash {
	const hash = createHash('sha256');
	let vertices = 0;
	let indices = 0;
	hash.update(String(kit.prototypes.length));
	for (const prototype of kit.prototypes) {
		hash.update(
			[
				'',
				prototype.class,
				String(prototype.index),
				String(prototype.leaves),
				String(prototype.length),
				String(prototype.radius),
			].join('|'),
		);
		for (const tier of prototype.tiers) {
			for (const key of ARRAYS) {
				const array = tier[key];
				eat(hash, array);
				if (key === 'positions') vertices += array.length / 3;
				if (key === 'indices') indices += array.length;
			}
		}
	}
	hash.update(`cards:${kit.cards.size}`);
	eat(hash, kit.cards.color);
	eat(hash, kit.cards.surface);
	const skeleton = asset.skeleton;
	for (const array of [
		skeleton.position,
		skeleton.radius,
		skeleton.parent,
		skeleton.axisOf,
		skeleton.light,
		skeleton.age,
		skeleton.flags,
		...Object.values(skeleton.axes),
		...Object.values(skeleton.buds),
	])
		eatField(hash, array);
	const rows = asset.shoots;
	for (const key of Object.keys(rows) as (keyof ShootRows)[]) eatField(hash, rows[key]);
	for (const level of asset.levels)
		for (const part of level.parts)
			for (const key of ARRAYS) {
				const array = part.arrays[key];
				eat(hash, array);
				if (key === 'positions') vertices += array.length / 3;
				if (key === 'indices') indices += array.length;
			}
	return { hash: hash.digest('hex'), vertices, indices };
}

const [named, seasonName] = process.argv.slice(2);
if (named === '--standins') {
	if (seasonName !== undefined) {
		console.error('usage: bun tools/plant-mesh-hash.ts --standins');
		process.exit(2);
	}
	const { commit, dirty } = provenance();
	let deterministic = true;
	for (const page of PAGE_STAND_INS) {
		for (const plant of page.plants) {
			const module = standInSpecies(plant.id, {
				variants: Math.max(1, page.variants ?? 1),
				...plant.standIn,
			});
			await loadPlantCode(module.record);
			const build = (): MeshHash => {
				const kit = buildKitNow(module, { detail: DETAIL, placeholders: true });
				const asset = growPlantNow(kit, {
					seed: page.seed,
					variant: 0,
					near: true,
					sparse: DEMO_SPARSENESS,
					season: module.record.seasons.default,
				});
				return meshHash(kit, asset);
			};
			const first = build();
			const second = build();
			console.log(
				`${page.page} ${plant.id} seed ${page.seed} commit ${commit} dirty ${dirty} sha256 ${first.hash} vertices ${first.vertices} indices ${first.indices}`,
			);
			if (first.hash !== second.hash) {
				console.error(`${page.page} ${plant.id}: the two builds hashed differently`);
				deterministic = false;
			}
		}
	}
	process.exit(deterministic ? 0 : 1);
}
if (!named) {
	console.error(
		`usage: bun tools/plant-mesh-hash.ts <species> [season]\n       bun tools/plant-mesh-hash.ts --standins\n\nspecies: ${speciesIds().join(', ')}`,
	);
	process.exit(2);
}
if (!isSpeciesId(named)) {
	console.error(`no species is named '${named}'. The species are: ${speciesIds().join(', ')}`);
	process.exit(2);
}
if (seasonName !== undefined && !SEASONS.includes(seasonName as Season)) {
	console.error(`no season is named '${seasonName}'. The seasons are: ${SEASONS.join(', ')}`);
	process.exit(2);
}
const { commit, dirty } = provenance();
const module = await loadSpecies(named);
await loadPlantCode(module.record);
const season = (seasonName as Season | undefined) ?? module.record.seasons.default;
const build = (): MeshHash => {
	const kit = buildKitNow(module, { detail: DETAIL, placeholders: 'missing' });
	const asset = growPlantNow(kit, { seed: 11, variant: 0, near: true, season });
	return meshHash(kit, asset);
};
const first = build();
const second = build();
const line = (result: MeshHash): string =>
	`${named} ${season} commit ${commit} dirty ${dirty} sha256 ${result.hash} vertices ${result.vertices} indices ${result.indices}`;
console.log(line(first));
console.log(line(second));
if (first.hash !== second.hash) {
	console.error('the two builds hashed differently: the build is not deterministic');
	process.exit(1);
}
