// The creek's plants, grown from the vegetation add-on's species rather than loaded from files. The
// valley's plants stand where the add-on's ecological rules place them (see `valley.ts`), each
// species and variant in one instance batch of its bark and its leaves, every level of detail kept
// for the engine to switch by distance. The whole set answers the scene's one wind field: the
// trunks bend, the branches turn about their pivots and the leaves flutter, out to the distance the
// preset sways. Beyond the valley, on the mountain ring, the canopy draws as the add-on's baked
// impostor cards, and fallen lengths of dead wood lie where the rules leave them.
import {
	type InstanceBatch,
	type MeshArrays,
	type MeshGeometry,
	type QualityPreset,
	quat,
	type SketchContext,
} from '@null3d/engine';
import { createImpostors } from '@null3d/impostors';
import {
	bakeFarTree,
	bakePlantAtlases,
	type FarTree,
	generatePlant,
	leafCellFor,
	type PlantAsset,
	type PlantMaterial,
	plantMaterial,
	plantWind,
	setWindLayer,
	swayDistanceFor,
	treeValues,
} from '@null3d/vegetation';
import type { WindField } from '@null3d/wind';
import { random } from '../../lib/procedural';
import { placeValley, SEED, SPECIES, VARIANTS } from './valley';

/** One placed plant: where it stands, which variant of its species it is, and its size and turn. */
interface Copy {
	readonly x: number;
	readonly y: number;
	readonly z: number;
	readonly scale: number;
	readonly rotation: number;
}

/** The far cards on the mountain ring: how many, the heights they cover and how far out they stand. */
const CARDS = 3600;
const CARD_LOW = 2;
const CARD_HIGH = 50;
const RING_INNER = 86;
const RING_OUTER = 260;
/** The range of a card's height, in meters: the trees that the ring's scale cannot show. */
const CARD_SHORT = 9;
const CARD_TALL = 17;
/** The grid that a far card bakes from: nine views of a coarse cell dress a slope this far away. */
const CARD_VIEWS = 9;
const CARD_TEXELS = 32;
/** The fallen lengths of dead wood: their longest and shortest length, and their girth, in meters. */
const LOG_LONG = 4.5;
const LOG_SHORT = 1.8;
const LOG_GIRTH = 0.22;

/** What the plants need of the scene. */
export interface PlantOptions {
	/** True where a stone covers the ground, which nothing grows through. */
	readonly rocks?: (x: number, z: number) => boolean;
	/** The mountain ring's height at a point, which the far cards stand on. Leave it out for none. */
	readonly mountainHeight?: (x: number, z: number) => number;
}

/** The drawn plants, and what a preset and a frame change on them. */
export interface Plants {
	/** Gives the plants the preset's distance to sway within. */
	fit(preset: QualityPreset): void;
	/** Gives the plant materials the field's newest state, which a frame calls before it draws. */
	setWindLayer(field: WindField): void;
}

/** Groups the placed plants by species, then by variant, so each batch takes its own copies. */
function groupBySpecies(
	points: ReturnType<typeof placeValley>,
	records: ReadonlyMap<string, (typeof SPECIES)[number]>,
): Map<string, Copy[][]> {
	const grouped = new Map<string, Copy[][]>();
	for (let index = 0; index < points.count; index++) {
		const at = index * points.stride;
		const rule = points.rules[points.data[at + 3] as number];
		const record = rule && records.get(rule.species);
		if (!rule || !record) continue;
		const variant = Math.min(VARIANTS - 1, Math.floor(points.data[at + 4] as number));
		let byVariant = grouped.get(rule.species);
		if (!byVariant) {
			byVariant = Array.from({ length: VARIANTS }, () => []);
			grouped.set(rule.species, byVariant);
		}
		byVariant[variant]?.push({
			x: points.data[at] as number,
			y: points.data[at + 1] as number,
			z: points.data[at + 2] as number,
			scale: points.data[at + 5] as number,
			rotation: points.data[at + 6] as number,
		});
	}
	return grouped;
}

/** A part's coarser levels, with the error that each switches at, for the engine's own choice. */
function coarserLevels(
	{ geometry }: SketchContext,
	asset: PlantAsset,
	name: string,
): { mesh: MeshGeometry; error: number }[] {
	return asset.levels.slice(1).map((level) => {
		const part = level.parts.find((other) => other.name === name);
		if (!part) throw new Error(`a ${name} part of the ${asset.species.id} has no level`);
		return { mesh: geometry.fromArrays(part.arrays), error: level.error };
	});
}

/** Fills a batch's rows with its copies' places, turns, sizes and the add-on's per-copy tint. */
function place(batch: InstanceBatch, copies: readonly Copy[]): void {
	const spin = quat.create();
	copies.forEach((copy, row) => {
		batch.positions.set([copy.x, copy.y, copy.z], row * 3);
		batch.rotations.set(quat.fromEuler(spin, 0, copy.rotation * Math.PI * 2, 0), row * 4);
		batch.scales.fill(copy.scale, row * 3, row * 3 + 3);
		batch.values?.set(treeValues(copy.x, copy.z, SEED), row * 4);
	});
	batch.markDirty();
}

/** A fallen length of dead wood: a tapered log, its ends rounded, lying along x. */
function logMesh(): MeshArrays {
	const sides = 7;
	const rings = 5;
	const length = LOG_LONG + LOG_SHORT;
	const positions: number[] = [];
	const normals: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];
	for (let ring = 0; ring <= rings; ring++) {
		const t = ring / rings;
		// The log tapers toward one end and swells through its middle, as a fallen trunk does.
		const radius = LOG_GIRTH * (0.7 + 0.3 * Math.sin(Math.PI * t)) * (1 - 0.35 * t);
		for (let side = 0; side < sides; side++) {
			const angle = (side / sides) * Math.PI * 2;
			const [ny, nz] = [Math.cos(angle), Math.sin(angle)];
			positions.push((t - 0.5) * length, ny * radius, nz * radius);
			normals.push(0, ny, nz);
			uvs.push(t, side / sides);
		}
	}
	for (let ring = 0; ring < rings; ring++)
		for (let side = 0; side < sides; side++) {
			const a = ring * sides + side;
			const b = ring * sides + ((side + 1) % sides);
			indices.push(a, a + sides, b, b, a + sides, b + sides);
		}
	return { positions, normals, uvs, indices };
}

/** A card standing on the ring: where it grows, which species it shows and its own size and turn. */
interface RingCard {
	readonly x: number;
	readonly y: number;
	readonly z: number;
	readonly species: string;
	readonly scale: number;
	readonly turn: number;
}

/** Spreads far cards over the ring's wooded slopes, below the tree line and above the valley. */
function ringCards(
	canopy: readonly (typeof SPECIES)[number][],
	mountainHeight: (x: number, z: number) => number,
): RingCard[] {
	const next = random(SEED + 1);
	const cards: RingCard[] = [];
	while (cards.length < CARDS) {
		const angle = next() * Math.PI * 2;
		const reach = RING_INNER + (RING_OUTER - RING_INNER) * next();
		const x = Math.cos(angle) * reach;
		const z = Math.sin(angle) * reach;
		const y = mountainHeight(x, z);
		if (y < CARD_LOW || y > CARD_HIGH) continue;
		const record = canopy[Math.floor(next() * canopy.length)];
		if (!record) continue;
		cards.push({
			x,
			y,
			z,
			species: record.id,
			scale: CARD_SHORT + (CARD_TALL - CARD_SHORT) * next(),
			turn: next() * Math.PI * 2,
		});
	}
	return cards;
}

/**
 * Grows and draws the creek's plants: every species that the valley's rules placed, at every
 * variant, in the scene's one wind field, with the far canopy on the mountain ring as impostor
 * cards and the dead wood on the floor.
 */
export function createPlants(
	ctx: SketchContext,
	wind: WindField,
	options: PlantOptions = {},
): Plants {
	const { scene, geometry, quality } = ctx;
	const points = placeValley(options);
	const records = new Map(SPECIES.map((record) => [record.id, record]));
	const grouped = groupBySpecies(points, records);
	const atlases = bakePlantAtlases(ctx);
	const materials: PlantMaterial[] = [];
	/** The bake that each canopy species' far cards draw. */
	const far = new Map<string, FarTree>();
	const threshold = quality.settings.lodThreshold;

	for (const [id, byVariant] of grouped) {
		const record = records.get(id);
		if (!record) continue;
		const canopy = record.kind === 'tree' || record.kind === 'conifer';
		for (let variant = 0; variant < byVariant.length; variant++) {
			const copies = byVariant[variant] ?? [];
			if (copies.length === 0) continue;
			const asset = generatePlant(record, { seed: SEED, variant, levels: record.levels });
			const parts = asset.levels[0]?.parts ?? [];
			const field = plantWind(ctx, asset, wind, { swayDistance: swayDistanceFor(quality.preset) });
			// A fern, a hosta or a sedge grows no wood, so its variant needs no bark material.
			// The trunks stay out of the depth prepass, so the ambient occlusion's second draw of
			// every batch skips them: their thin cards add little to the map, and the main view is
			// unchanged.
			const bark = parts.some((part) => part.name === 'wood')
				? plantMaterial(ctx, {
						atlases,
						part: 'wood',
						color: record.color.bark,
						wind: field,
						prepass: false,
					})
				: undefined;
			const leaves = plantMaterial(ctx, {
				atlases,
				part: 'leaves',
				cell: leafCellFor(record),
				color: record.color.leaf,
				transmission: record.color.transmission,
				wind: field,
				// A tree's cards morph into its next level's places, so no crown pops as it thins.
				...(canopy && {
					morph: {
						crownRadius: Math.hypot(...asset.crown.center) + asset.crown.radius,
						threshold,
					},
				}),
			});
			// A rosette that grows flowers draws their heads in the species' flower color, so a
			// clump reads as bloom rather than as a green tuft.
			const flower = record.color.flower
				? plantMaterial(ctx, {
						atlases,
						part: 'leaves',
						cell: leafCellFor(record),
						color: record.color.flower,
						transmission: record.color.transmission,
						wind: field,
					})
				: undefined;
			if (bark) materials.push(bark);
			materials.push(leaves);
			if (flower) materials.push(flower);
			for (const part of parts) {
				const base = geometry.fromArrays(part.arrays);
				base.setLevels(coarserLevels(ctx, asset, part.name), { fade: false });
				const batch = scene.createInstances(base, copies.length, {
					material:
						part.name === 'wood'
							? (bark ?? leaves)
							: part.name === 'flower'
								? (flower ?? leaves)
								: leaves,
					values: true,
					castShadows: true,
					receiveShadows: true,
				});
				place(batch, copies);
			}
			// One variant stands for the species at a distance, where no card shows a single twig.
			if (canopy && !far.has(id))
				far.set(
					id,
					bakeFarTree(ctx, {
						asset,
						atlases,
						views: CARD_VIEWS,
						texels: CARD_TEXELS,
					}),
				);
		}
	}

	// The valley's dead wood: fallen lengths on the floor of the wood.
	const logs: Copy[] = [];
	const next = random(SEED);
	for (let index = 0; index < points.count; index++) {
		const at = index * points.stride;
		const rule = points.rules[points.data[at + 3] as number];
		if (rule?.species !== 'deadwood') continue;
		logs.push({
			x: points.data[at] as number,
			y: points.data[at + 1] as number,
			z: points.data[at + 2] as number,
			scale: 0.6 + 0.6 * next(),
			rotation: next(),
		});
	}
	if (logs.length > 0) {
		const batch = scene.createInstances(geometry.fromArrays(logMesh()), logs.length, {
			material: ctx.materials.standard({ color: '#4a3a2a', roughness: 0.95 }),
			castShadows: true,
			receiveShadows: true,
		});
		const lying = quat.fromEuler(quat.create(), 0, 0, Math.PI / 2);
		logs.forEach((log, row) => {
			batch.positions.set([log.x, log.y + LOG_GIRTH * 0.8 * log.scale, log.z], row * 3);
			batch.rotations.set(
				quat.multiply(
					quat.create(),
					quat.fromEuler(quat.create(), 0, log.rotation * Math.PI * 2, 0),
					lying,
				),
				row * 4,
			);
			batch.scales.fill(log.scale, row * 3, row * 3 + 3);
		});
		batch.markDirty();
	}

	// The ring's canopy as impostor cards: the valley's own trees stand near enough to draw as
	// meshes, so the cards dress the far slopes that no mesh reaches.
	if (options.mountainHeight) {
		const canopy = SPECIES.filter((record) => record.kind === 'tree' || record.kind === 'conifer');
		const cards = ringCards(canopy, options.mountainHeight);
		for (const record of canopy) {
			const bake = far.get(record.id);
			const mine = cards.filter((card) => card.species === record.id);
			if (!bake || mine.length === 0) continue;
			const batch = createImpostors(
				{ scene, materials: ctx.materials, geometry },
				{
					color: bake.color,
					surface: bake.surface,
					atlas: bake.atlas,
					positions: mine.flatMap((card) => [card.x, card.y + bake.base, card.z]),
					turn: mine.map((card) => card.turn),
					size: bake.size,
					depth: bake.depth,
					alphaMode: 'mask',
					receiveShadows: true,
				},
			);
			mine.forEach((card, row) => {
				const scale = card.scale / record.height;
				batch.batch.scales.fill(scale, row * 3, row * 3 + 3);
			});
			batch.markDirty();
		}
	}

	return {
		fit(preset: QualityPreset) {
			const distance = swayDistanceFor(preset);
			for (const material of materials) material.setUniform('swayDistance', distance);
		},
		setWindLayer(field) {
			setWindLayer(materials, field);
		},
	};
}
