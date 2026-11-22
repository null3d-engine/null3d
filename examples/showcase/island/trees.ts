// The island's trees: tall cypresses on the upper slopes and along the lanes, wide umbrella pines by
// the coast, low olives in groves and holm oaks in the forest, each where the town plan puts it, with
// oleanders along the lanes. The pines, olives, oaks, oleanders and cypresses are models built by
// script in Blender (`models.ts`): near copies draw as meshes whose levels thin with distance and
// sway in the wind, and far ones hand over to the models' own cards, baked from the plant, so the
// whole forest fits one view. A page that draws the island before the cypress model arrives keeps
// its code-built spires in their place, and those spires return if the model cannot load.
import {
	type Camera,
	type InstanceBatch,
	type QualityPreset,
	quat,
	type SketchContext,
} from '@null3d/engine';
import { createGrass } from '@null3d/grass';
import { handOverToCards } from '@null3d/impostors';
import { createWind } from '@null3d/wind';
import { type Stand, type SwayLook, standPart, swayingPart } from '../../lib/blender-models';
import { Noise, random } from '../../lib/procedural';
import { createSway } from '../../lib/sway';
import { edgeGrid, inCore, read } from './ground';
import { beachShare, golfShare, inland, townShare } from './island';
import { type Build, build, type Color, cypress, finish, quad, shrub } from './kit';
import { loadPlants, type Plant, type PlantKind, type Species } from './models';
import {
	CYPRESS,
	canopyAt,
	FILL_SPOTS,
	groundHeight,
	LOTS,
	type Lot,
	OAK,
	OLIVE,
	ROADS,
	SHRUBS,
	slopeAt,
	standing,
	TREE_SPOTS,
	type TreeSpot,
	UMBRELLA,
} from './plan';
import { onRetainingWall, parkLawns } from './town';

/** The share of the plan's trees that each preset stands on the island. */
export const TREE_SHARE: Record<QualityPreset, number> = {
	low: 0.3,
	medium: 0.55,
	high: 0.8,
	ultra: 1,
};

/** The distance past which the fallback spires' far cypresses draw, as their plainest form, in meters. */
const FAR_SPIRES: Record<QualityPreset, number> = { low: 90, medium: 130, high: 130, ultra: 300 };

/** The wind field's box around the camera, in meters, and the cells across it. */
const WIND_BOX = 160;
const WIND_GRID = 64;

/** The tufts of grass on each park's lawn at High. */
const GRASS_TUFTS = 9000;
/** The blades' color: a summer lawn, drier than the turf of the golf course. */
const GRASS_COLOR = '#55752c';
/** How far a tuft draws, in meters. */
const GRASS_REACH = 170;

/** The layer that the sun sees and no camera does, for shadow casters that the views leave out. */
export const CASTER_LAYER = 1 << 2;

/** How far the far canopy draws, in meters: past the whole island from any view. */
const FILL_REACH = 6000;

/** Each planted kind's number in the plan, and the model that stands it. */
const KINDS: readonly { readonly kind: number; readonly species: Species }[] = [
	// A tall bare red trunk under a wide flat dark crown of needles.
	{ kind: UMBRELLA, species: 'stone-pine' },
	// A short gnarled trunk under fine silver-green leaves.
	{ kind: OLIVE, species: 'olive' },
	// A round dark crown, full to the ground, for the forest and the square's shade.
	{ kind: OAK, species: 'holm-oak' },
];

/** The margin that keeps a rim shrub's roots off a road's edge, in meters. */
const SCRUB_ROAD_CLEAR = 3;

/**
 * The scrub that grows along the rim of each bare patch on the hills, so a strip of bare ground
 * never meets the wood in a straight edge. The plan's own shrubs keep clear of the town's ground,
 * the fairways and the beach, which leaves the strips between them bare. A spot takes scrub where
 * the ground is steep and a wood stands a few meters off, clear of roads, the beach, the fairways
 * and the town's core. The spots are fixed, so every preset stands the same ones.
 */
export const EDGE_SCRUB: readonly TreeSpot[] = (() => {
	let seed = 1729;
	const next = () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 4294967296;
	};
	/** The nearest tree stands between these distances, in meters, for a rim. */
	const [RIM_NEAR, RIM_FAR] = [5, 18];
	const step = 4;
	// The trees, in buckets ten meters across, so a rim finds its nearest without a scan.
	const bucket = 10;
	const bcell = (value: number) => Math.floor(value / bucket);
	const trees = new Map<string, readonly TreeSpot[]>();
	for (const spot of [...TREE_SPOTS, ...FILL_SPOTS]) {
		const key = `${bcell(spot.x)},${bcell(spot.z)}`;
		const list = trees.get(key);
		trees.set(key, list ? [...list, spot] : [spot]);
	}
	const nearestTree = (x: number, z: number): number => {
		let near = Number.POSITIVE_INFINITY;
		for (let a = -2; a <= 2; a++)
			for (let b = -2; b <= 2; b++)
				for (const spot of trees.get(`${bcell(x) + a},${bcell(z) + b}`) ?? [])
					near = Math.min(near, Math.hypot(spot.x - x, spot.z - z));
		return near;
	};
	// The cells that a road's own width and its verge take, at the grid's step.
	const cell = (value: number) => Math.floor(value / step);
	const held = new Set<string>();
	for (const road of ROADS)
		for (const point of road.points) {
			const reach = Math.ceil((road.half + SCRUB_ROAD_CLEAR) / step);
			for (let a = -reach; a <= reach; a++)
				for (let b = -reach; b <= reach; b++) held.add(`${cell(point.x) + a},${cell(point.z) + b}`);
		}
	const spots: TreeSpot[] = [];
	for (let x = -440; x <= 440; x += step)
		for (let z = -400; z <= 400; z += step) {
			const px = x + (next() - 0.5) * step * 0.75;
			const pz = z + (next() - 0.5) * step * 0.75;
			if (inland(px, pz) < 10 || beachShare(px, pz) > 0.15 || golfShare(px, pz) > 0.02) continue;
			if (townShare(px, pz) > 0.6 || held.has(`${cell(px)},${cell(pz)}`)) continue;
			if (slopeAt(px, pz) < 0.25) continue;
			const near = nearestTree(px, pz);
			if (near < RIM_NEAR || near > RIM_FAR) continue;
			if (next() > 0.65) continue;
			// Scrub grows in clumps, so a rim reads from across the bay.
			for (let k = 0; k < 3; k++) {
				const ox = px + (next() - 0.5) * 4;
				const oz = pz + (next() - 0.5) * 4;
				spots.push({
					kind: 0,
					x: ox,
					y: groundHeight(ox, oz),
					z: oz,
					turn: 0,
					scale: 1.2 + next() * 1.2,
				});
			}
		}
	return spots;
})();

/**
 * The distance at which a tree and a shrub hand over from their meshes to their cards, in meters
 * at each preset. A tree's coarsest level switches in at about 90 m, so the cards take over once a
 * crown is a few dozen pixels across.
 */
const TREE_CARDS: Record<QualityPreset, number> = { low: 150, medium: 200, high: 260, ultra: 340 };
/**
 * How much farther each tree level reaches than its measured error allows, by preset. A tree's middle
 * levels are simple forms, and the hills read as flat slabs where they stand past a hundred metres.
 * Standing them farther keeps the hills whole as the camera moves; the cost is triangles between the
 * switch distances. Ultra keeps the measured reach, since its card hand-over is already far out.
 */
const LEVEL_REACH: Record<QualityPreset, number> = { low: 1, medium: 1.6, high: 2.2, ultra: 2 };
const SHRUB_CARDS: Record<QualityPreset, number> = { low: 40, medium: 55, high: 70, ultra: 90 };

/** The side of the grid that stands the forest floor's plants, in meters. */
const FLOOR_CELL = 3.6;
/** The share of that grid's spots that each preset stands. */
const FLOOR_SHARE: Record<QualityPreset, number> = {
	low: 0.22,
	medium: 0.45,
	high: 0.75,
	ultra: 1,
};
/**
 * How far the floor's plants draw, in meters, at each preset: a bush a few dozen pixels wide still
 * reads at the far edge, and the band keeps a closed wood's floor to a bounded number of instances.
 */
const FLOOR_REACH: Record<QualityPreset, number> = { low: 24, medium: 34, high: 48, ultra: 66 };
/** Under this share of canopy the floor takes only fallen leaves, with no undergrowth. */
const FLOOR_SHADE = 0.35;

/** The tints of the floor's undergrowth: olive, lentisk and heath greens with dry straw among them. */
const FLOOR_TINTS = [
	[0.19, 0.28, 0.11],
	[0.24, 0.33, 0.14],
	[0.16, 0.24, 0.1],
	[0.3, 0.34, 0.17],
	[0.28, 0.29, 0.13],
] as const;
/** The tints of the fallen leaves: chestnut, oak and olive browns, and grey litter. */
const LITTER_TINTS = [
	[0.34, 0.24, 0.12],
	[0.3, 0.26, 0.14],
	[0.26, 0.24, 0.17],
	[0.38, 0.3, 0.17],
	[0.22, 0.2, 0.14],
] as const;

/** A place on the floor that takes a plant, with its own turn, size and tint. */
interface FloorSpot {
	x: number;
	y: number;
	z: number;
	turn: number;
	scale: number;
	tint: readonly [number, number, number];
}

/**
 * Whether a point lies inside a house's footprint. Each plot's reach is a short radius, so a place
 * looks for its own and its neighbours' plots, which are listed under a coarse grid.
 */
function onHouse(): (x: number, z: number) => boolean {
	const side = 10;
	const listed = new Map<string, Lot[]>();
	for (const lot of LOTS) {
		const reach = lot.reach + 2;
		for (let i = Math.floor((lot.x - reach) / side); i <= Math.floor((lot.x + reach) / side); i++)
			for (
				let j = Math.floor((lot.z - reach) / side);
				j <= Math.floor((lot.z + reach) / side);
				j++
			) {
				const key = `${i},${j}`;
				const list = listed.get(key);
				if (list) list.push(lot);
				else listed.set(key, [lot]);
			}
	}
	return (x, z) => {
		const key = `${Math.floor(x / side)},${Math.floor(z / side)}`;
		for (const lot of listed.get(key) ?? [])
			if (Math.hypot(x - lot.x, z - lot.z) < lot.reach + 2) return true;
		return false;
	};
}

/**
 * The forest floor's plants: low scrub and fallen litter. The scrub holds the shade of a closed
 * wood and thins out into the open, and the litter lies everywhere that is not worked ground,
 * thicker under a crown. The spots come from one fixed seed, so every load stands the same ones,
 * and the plan's own spots are not moved.
 */
const FLOOR: { undergrowth: readonly FloorSpot[]; litter: readonly FloorSpot[] } = (() => {
	const next = random(4801);
	const held = onHouse();
	const undergrowth: FloorSpot[] = [];
	const litter: FloorSpot[] = [];
	const lawns = parkLawns();
	for (let x = -430; x <= 430; x += FLOOR_CELL)
		for (let z = -400; z <= 400; z += FLOOR_CELL) {
			const px = x + (next() - 0.5) * FLOOR_CELL * 0.8;
			const pz = z + (next() - 0.5) * FLOOR_CELL * 0.8;
			const [bush, leaf, size, turn] = [next(), next(), next(), next()];
			if (inland(px, pz) < 7 || beachShare(px, pz) > 0.12) continue;
			if (read(edgeGrid, px, pz) < 1.6 || slopeAt(px, pz) > 1.6) continue;
			if (inCore(px, pz) || held(px, pz) || lawns.some((lawn) => lawn.where(px, pz))) continue;
			const shade = canopyAt(px, pz);
			// The golf course's mown turf keeps clear, and its rough and its woods take the floor.
			if (golfShare(px, pz) > 0.02 && shade < 0.25) continue;
			const y = groundHeight(px, pz);
			// Fallen leaves and twigs lie under every crown and across the open ground between them.
			if (leaf < 0.24 + 0.66 * shade)
				litter.push({
					x: px,
					y: y - 0.03,
					z: pz,
					turn: turn * 6.3,
					scale: 0.7 + size * 0.7,
					tint: LITTER_TINTS[Math.floor(turn * LITTER_TINTS.length)] as readonly [
						number,
						number,
						number,
					],
				});
			// Low scrub grows in the shade of a closed wood, and only a stray clump shows in the open.
			if (shade > FLOOR_SHADE && bush < 0.12 + 0.85 * Math.min(1, (shade - FLOOR_SHADE) / 0.5))
				undergrowth.push({
					x: px,
					y: y - 0.06,
					z: pz,
					turn: turn * 6.3,
					scale: 0.45 + size * 0.5,
					tint: FLOOR_TINTS[Math.floor(bush * FLOOR_TINTS.length)] as readonly [
						number,
						number,
						number,
					],
				});
		}
	return { undergrowth, litter };
})();

/**
 * A patch of fallen leaves and twigs, a few tens of centimeters across, lying a hair above the
 * ground. Its color comes from its instance.
 */
function leafLitter(): Build {
	const b = build();
	const next = random(571);
	for (let k = 0; k < 9; k++) {
		const a = next() * Math.PI * 2;
		const r = Math.sqrt(next()) * 0.34;
		const [x, z] = [Math.cos(a) * r, Math.sin(a) * r];
		const s = 0.05 + next() * 0.09;
		const turn = next() * Math.PI * 2;
		const [ux, uz] = [Math.cos(turn) * s, Math.sin(turn) * s];
		const [vx, vz] = [-Math.sin(turn) * s * 0.55, Math.cos(turn) * s * 0.55];
		const y = 0.012 + next() * 0.02;
		const tone = 0.62 + next() * 0.55;
		const color: Color = [tone, tone, tone];
		quad(
			b,
			[x - ux, y, z - uz],
			[x + vx, y + 0.012, z + vz],
			[x + ux, y, z + uz],
			[x - vx, y + 0.012, z - vz],
			color,
		);
	}
	// A twig lies among the leaves, paler than they are.
	for (let k = 0; k < 2; k++) {
		const [x, z] = [(next() - 0.5) * 0.5, (next() - 0.5) * 0.5];
		const turn = next() * Math.PI * 2;
		const length = 0.16 + next() * 0.2;
		const [ux, uz] = [Math.cos(turn) * length, Math.sin(turn) * length];
		const [vx, vz] = [-Math.sin(turn) * 0.015, Math.cos(turn) * 0.015];
		quad(
			b,
			[x - ux - vx, 0.03, z - uz - vz],
			[x + ux - vx, 0.03, z + uz - vz],
			[x + ux + vx, 0.034, z + uz + vz],
			[x - ux + vx, 0.034, z - uz + vz],
			[0.9, 0.85, 0.75],
		);
	}
	return b;
}

/** Stands a batch of the floor's spots, at the preset's share and draw reach. */
function standFloor(
	ctx: SketchContext,
	mesh: Build,
	spots: readonly FloorSpot[],
	share: number,
	reach: number,
	castShadows: boolean,
): void {
	const kept = standing(spots, share);
	if (kept.length === 0) return;
	const batch = ctx.scene.createInstances(ctx.geometry.fromArrays(finish(mesh)), kept.length, {
		material: ctx.materials.standard({ vertexColors: true, roughness: 1, doubleSided: true }),
		colors: true,
		castShadows,
		receiveShadows: true,
	});
	kept.forEach((spot, k) => {
		batch.positions.set([spot.x, spot.y, spot.z], k * 3);
		batch.rotations.set(quat.fromEuler(quat.create(), 0, spot.turn, 0), k * 4);
		// Scrub and litter spread wider than they rise, as low growth on a floor does.
		batch.scales.set([spot.scale * 1.15, spot.scale, spot.scale * 1.15], k * 3);
		batch.colors?.set([...spot.tint, 1], k * 4);
	});
	batch.markDirty();
	batch.setDrawRange(0, reach);
}

/**
 * How far each part's freest tips move in a wind of one meter a second, in meters, how stiff it is
 * near its root, and how far its leaves flutter. The wood and the leaves share the bend, so the
 * leaves stay on their twigs, and the leaves flutter on top.
 */
const SWAY: Record<PlantKind, SwayLook> = {
	cypress: { sway: 0.014, stiffness: 2, rustle: 0.018 },
	'stone-pine': { sway: 0.025, stiffness: 2, rustle: 0.03 },
	olive: { sway: 0.02, stiffness: 2, rustle: 0.03 },
	'holm-oak': { sway: 0.016, stiffness: 2, rustle: 0.02 },
	oleander: { sway: 0.015, stiffness: 1.5, rustle: 0.02 },
};

/** A cypress's foliage: upward sprays of darker and paler green, near white, which its colors tint. */
function spireMap({ textures }: SketchContext) {
	const size = 512;
	const noise = new Noise(211);
	const data = new Uint8Array(size * size * 4);
	for (let j = 0; j < size; j++)
		for (let i = 0; i < size; i++) {
			const [u, v] = [i / size, j / size];
			const sprays = noise.fbm2(u * 32, v * 24, 3, 32) + 0.5 * noise.fbm2(u * 90, v * 80, 2, 90);
			const tone = 150 + Math.min(105, Math.max(-110, sprays * 170));
			const at = (j * size + i) * 4;
			data[at] = data[at + 1] = data[at + 2] = tone;
			data[at + 3] = 255;
		}
	return textures.fromData({
		width: size,
		height: size,
		data,
		colorSpace: 'srgb',
		wrap: 'repeat',
		mipmaps: true,
	});
}

/** Writes each row's place, turn and size into a batch of meshes. */
function fill(batch: InstanceBatch, spots: readonly TreeSpot[]): void {
	const turn = quat.create();
	spots.forEach((spot, k) => {
		batch.positions.set([spot.x, spot.y, spot.z], k * 3);
		quat.fromEuler(turn, 0, spot.turn, 0);
		batch.rotations.set(turn, k * 4);
		batch.scales.set([spot.scale, spot.scale, spot.scale], k * 3);
	});
	batch.markDirty();
}

/** The trees that stand at the preset's share, and the far canopy, with the wall's share left out. */
function treeStands(ctx: SketchContext): { kept: readonly TreeSpot[]; fills: readonly TreeSpot[] } {
	const preset = ctx.quality.preset;
	const onWall = onRetainingWall();
	const kept = standing(TREE_SPOTS, TREE_SHARE[preset]).filter((spot) => !onWall(spot.x, spot.z));
	return { kept, fills: standing(FILL_SPOTS, TREE_SHARE[preset]) };
}

/** The code-built spires that stand in the cypress model's place until it loads, or when it cannot. */
let fallbackSpires: { destroy(): void } | undefined;

/** Removes the fallback spires, once the cypress model stands in their place. */
function clearFallbackSpires(): void {
	fallbackSpires?.destroy();
	fallbackSpires = undefined;
}

/**
 * Places the code-built cypresses, for a page that draws the island before the cypress model lands.
 * It has no assets to wait for, so it runs in the same turn as the sketch. A page that grows the
 * island first places them from `createTrees` instead, only when the model is missing.
 */
export function createCypressSpires(ctx: SketchContext): void {
	if (fallbackSpires) return;
	const { kept, fills } = treeStands(ctx);
	fallbackSpires = placeCypresses(ctx, kept, fills);
}

/** Places the code spires of a list of spots, and answers with the call that frees them. */
function placeCypresses(
	ctx: SketchContext,
	kept: readonly TreeSpot[],
	fills: readonly TreeSpot[],
): { destroy(): void } {
	const preset = ctx.quality.preset;
	const spires = kept.filter((spot) => spot.kind === CYPRESS);
	// The far canopy's cypresses stand only as the plainest spires, past the near trees.
	const farSpires = fills.filter((spot) => spot.kind === CYPRESS);
	if (spires.length === 0 && farSpires.length === 0) return { destroy() {} };
	const mesh = ctx.geometry.fromArrays(finish(cypress(14, 18)));
	mesh.setLevels([
		{ mesh: ctx.geometry.fromArrays(finish(cypress(8, 8))), error: 0.03 },
		{ mesh: ctx.geometry.fromArrays(finish(cypress(5, 4))), error: 0.14 },
	]);
	const foliage = spireMap(ctx);
	const material = ctx.materials.standard({ map: foliage, vertexColors: true, roughness: 0.95 });
	const meshes = [mesh];
	const batches: InstanceBatch[] = [];
	if (spires.length > 0) {
		const batch = ctx.scene.createInstances(mesh, spires.length, {
			material,
			castShadows: true,
			receiveShadows: true,
		});
		fill(batch, spires);
		batches.push(batch);
	}
	if (farSpires.length > 0) {
		const plain = ctx.geometry.fromArrays(finish(cypress(5, 4)));
		meshes.push(plain);
		const far = ctx.scene.createInstances(plain, farSpires.length, {
			material,
			castShadows: false,
			receiveShadows: true,
		});
		fill(far, farSpires);
		far.setDrawRange(FAR_SPIRES[preset], FILL_REACH);
		batches.push(far);
	}
	return {
		destroy() {
			for (const batch of batches) batch.destroy();
			for (const part of meshes) part.destroy();
			material.destroy();
			foliage.destroy();
		},
	};
}

/**
 * Grows the island's trees for the preset, and returns the call that moves them in the wind. A
 * scene that placed the code spires before its first frame passes `spires: false`, so they are not
 * placed twice; the cypress model replaces them as soon as it loads.
 */
export async function createTrees(
	ctx: SketchContext,
	camera: Camera,
	{ spires = true }: { spires?: boolean } = {},
): Promise<{ update(): void }> {
	const preset = ctx.quality.preset;
	const { kept, fills } = treeStands(ctx);
	const wind = createWind(ctx, { camera, box: WIND_BOX, grid: WIND_GRID });
	const sway = createSway(ctx, { wind });
	// A distance band that fades discards pixels in a screen-door pattern, and past a thinning
	// crown those holes show the card, which is flat where the mesh's leaves are not, so the holes
	// read as dots. The hand-over already stands each card at full coverage before its mesh goes,
	// so a cut at once hides the swap. The island's draw ranges are the trees', their cards and the
	// lawns, and a lawn is smaller than the reach, so no other view pays for the cut.
	const noBandFade = () => {
		if (ctx.quality.settings.lodFade) void ctx.quality.set({ lodFade: false });
	};
	noBandFade();
	ctx.quality.onChange(noBandFade);
	const { species, cypress: cypressModel } = await loadPlants(ctx);
	/**
	 * Stands one plant: its wood and leaves as near meshes that sway, and its card for every copy
	 * past the hand-over distance.
	 */
	const plant = (kind: PlantKind, model: Plant, stands: readonly Stand[], handOver: number) => {
		if (stands.length === 0) return;
		const { wood, leaves, card } = model;
		// A level hands over through a dithered band unless its own `fade` says otherwise. The
		// plants' file carries errors written by hand, so every level dithers, and the pattern
		// spreads across a whole crown at the switch. The levels differ by less than a pixel at the
		// distances they switch, so a cut at once keeps the crown whole.
		const { levels } = leaves.mesh;
		if (levels.length > 0) {
			const reach = LEVEL_REACH[ctx.quality.preset];
			leaves.mesh.setLevels(
				levels.map((level) => ({
					...level,
					fade: false,
					...(level.error !== undefined && { error: level.error * reach }),
					...(level.coverage !== undefined && { coverage: level.coverage * reach }),
				})),
				{ fade: false },
			);
		}
		// The wood cuts between its levels at once too: a dithered band on a trunk shows as a stipple.
		if (wood.mesh.levels.length > 0)
			wood.mesh.setLevels(
				wood.mesh.levels.map((level) => ({ ...level, fade: false })),
				{ fade: false },
			);
		// The wood bends with its leaves but has none to flutter, and its bark's own map gives its
		// roughness.
		const bark = { ...SWAY[kind], rustle: 0, roughness: 1 };
		const cards = standPart(ctx, card, stands, card.material);
		// A card stands in its plant's own bound, so the hand-over's reach for the card's corners,
		// which the batch's small file scale makes nearly zero, adds nothing.
		handOverToCards(
			standPart(ctx, wood, stands, swayingPart(sway, wood, bark, false)),
			cards,
			handOver,
		);
		handOverToCards(
			standPart(ctx, leaves, stands, swayingPart(sway, leaves, SWAY[kind], true)),
			cards,
			handOver,
		);
	};
	/** The plan's spots of one kind, as the stands of one model. */
	const standsOf = (kind: number): Stand[] =>
		[...kept, ...fills]
			.filter((spot) => spot.kind === kind)
			.map((spot) => ({ ...spot, yaw: spot.turn, size: spot.scale }));
	// Each kind's kept trees and its far canopy are copies of one model, which hands every copy over
	// to its card with distance.
	for (const { kind, species: name } of KINDS)
		plant(name, species[name], standsOf(kind), TREE_CARDS[preset]);
	// The cypresses stand as their model at every distance, and as the code spires only while that
	// model is missing.
	if (cypressModel) {
		clearFallbackSpires();
		plant('cypress', cypressModel, standsOf(CYPRESS), TREE_CARDS[preset]);
	} else if (spires) {
		fallbackSpires = placeCypresses(ctx, kept, fills);
	}
	// A shrub's turn comes from its place in the plan, since the plan gives it none. The rim scrub
	// breaks the edges of the bare strips that the plan's shrubs keep clear of.
	plant(
		'oleander',
		species.oleander,
		[...standing(SHRUBS, TREE_SHARE[preset]), ...standing(EDGE_SCRUB, TREE_SHARE[preset])].map(
			(spot, k) => ({
				x: spot.x,
				y: spot.y,
				z: spot.z,
				yaw: Math.imul(k + 1, 2654435761) / 683565275,
				size: spot.scale,
			}),
		),
		SHRUB_CARDS[preset],
	);
	// The floor under the near woods: low scrub that holds the shade, and fallen litter beneath it.
	standFloor(ctx, shrub(180), FLOOR.undergrowth, FLOOR_SHARE[preset], FLOOR_REACH[preset], false);
	standFloor(ctx, leafLitter(), FLOOR.litter, FLOOR_SHARE[preset], FLOOR_REACH[preset], false);
	const lawns = await Promise.all(
		parkLawns().map((lawn, k) =>
			createGrass(ctx, {
				height: lawn.height,
				area: { x: lawn.x, z: lawn.z, size: lawn.size },
				count: GRASS_TUFTS,
				seed: 41 + k,
				blades: 9,
				segments: 2,
				shapes: 2,
				where: lawn.where,
				color: GRASS_COLOR,
				wind: wind.field,
				// The lawns set their own draw range, so their rows stay a batch on both paths.
				compute: false,
			}),
		),
	);
	for (const lawn of lawns) for (const batch of lawn.batches) batch.setDrawRange(0, GRASS_REACH);
	ctx.quality.onChange(() => {
		for (const lawn of lawns) lawn.fit(ctx.quality.preset);
	});
	return {
		update() {
			// The field's box follows the camera, and a gust fades, so it steps every frame.
			wind.update();
			sway.update();
			for (const lawn of lawns) lawn.setWindLayer(wind.field);
		},
	};
}
