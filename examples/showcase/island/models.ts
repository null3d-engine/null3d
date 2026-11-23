// The island's plants: a Mediterranean cypress, stone pine, an olive, a holm oak and an oleander.
// A script builds them in Blender (tools/samples/blender/island.py), and the asset tool optimizes
// them, so they load as a developer ships models: quantized meshes and KTX2 textures. They live in
// the sample-assets repository. Each plant has a wood part and a leaves part, each with two lower
// levels of detail, for the near copies. The far copies draw as the engine's octahedral cards,
// which the island's build bakes from the same plants into two atlases apiece: the cards light from
// stored normals and blend the views nearest the eye. The wood and the leaves carry their sway in
// their second texture coordinates, which the wind material reads.
//
// The cypress joined the trees file after the other plants. A trees file that predates it leaves the
// scene on its own code-built spires, so the demo runs before the file is republished.
//
// The people and vehicles load from a second file beside the plants. It holds three rigged walkers
// with a walk clip each, a standing far proxy for each of them, a hatchback and a minibus. The
// clothing and the vehicle bodies carry a plain white material, so a scene multiplies a colour of
// its own into each copy exactly; the skin, hair, glass, wheels and trim keep their textures. A
// vehicle's wheels are parts of their own, each with its origin on its axle, so a scene turns each
// by the distance travelled over its radius.

import type { Prefab, SketchContext, Texture } from '@null3d/engine';
import type { OctahedralAtlas } from '@null3d/impostors';
import { type Part, partsOf, placed } from '../../lib/blender-models';
import { sampleUrl } from '../../lib/samples';
import type {
	PersonModel,
	TintRole,
	TrafficModels,
	TrafficPart,
	WalkerModel,
	WalkerPart,
} from './traffic';

/** The plants that the model files always carry, and that the scene cannot stand without. */
export const SPECIES = ['stone-pine', 'olive', 'holm-oak', 'oleander'] as const;
export type Species = (typeof SPECIES)[number];

/** Every plant that the scene stands, the cypress included. */
export type PlantKind = Species | 'cypress';

/** A plant's far card: the two atlases that the build baked from it, and the card's figures. */
export interface PlantCard {
	readonly color: Texture;
	readonly surface: Texture;
	readonly atlas: OctahedralAtlas;
	/** The card's width and height at scale 1, in metres. */
	readonly size: readonly [number, number];
	/** How many times taller a view's picture is than the card, which holds the plant from above. */
	readonly room: number;
	/** The plant's depth along a view, which places a card's own shadow lookup. */
	readonly depth: number;
}

/** One plant's parts: its swaying wood and leaves, and its far card. */
export interface Plant {
	readonly wood: Part;
	readonly leaves: Part;
	readonly card: PlantCard;
}

/** The plants of both files, and the cypress when the trees file carries one. */
export interface Plants {
	readonly species: Record<Species, Plant>;
	/** The cypress, or undefined while the loaded trees file has none. */
	readonly cypress: Plant | undefined;
}

/** The figures that the build wrote beside a model's cards: their grid and each plant's card. */
interface CardFigures {
	readonly atlas: OctahedralAtlas;
	readonly species: Record<
		string,
		{ readonly size: [number, number]; readonly room: number; readonly depth: number }
	>;
}

/**
 * The card figures that the build writes beside each model file, as string literals so that the
 * sample pin check can find every file that a demo names.
 */
const CARD_FIGURES: Record<'trees' | 'shrubs', string> = {
	trees: sampleUrl('sources/showcase/island/trees-cards.json'),
	shrubs: sampleUrl('sources/showcase/island/shrubs-cards.json'),
};

/**
 * Each plant's two card atlases, as string literals for the same reason. A bake that leaves a
 * species out of the figures file leaves that plant without far cards: an optional plant is left
 * out of the scene, and one that the scene requires stops the load with an error.
 */
const CARD_ATLASES: Record<PlantKind, { color: string; surface: string }> = {
	cypress: {
		color: sampleUrl('sources/showcase/island/cypress-card-color.png'),
		surface: sampleUrl('sources/showcase/island/cypress-card-surface.png'),
	},
	'holm-oak': {
		color: sampleUrl('sources/showcase/island/holm-oak-card-color.png'),
		surface: sampleUrl('sources/showcase/island/holm-oak-card-surface.png'),
	},
	olive: {
		color: sampleUrl('sources/showcase/island/olive-card-color.png'),
		surface: sampleUrl('sources/showcase/island/olive-card-surface.png'),
	},
	'stone-pine': {
		color: sampleUrl('sources/showcase/island/stone-pine-card-color.png'),
		surface: sampleUrl('sources/showcase/island/stone-pine-card-surface.png'),
	},
	oleander: {
		color: sampleUrl('sources/showcase/island/oleander-card-color.png'),
		surface: sampleUrl('sources/showcase/island/oleander-card-surface.png'),
	},
};

/** A model's card figures, or undefined when the build wrote none. */
async function cardFigures(model: 'trees' | 'shrubs'): Promise<CardFigures | undefined> {
	try {
		const response = await fetch(CARD_FIGURES[model]);
		if (!response.ok) return undefined;
		return (await response.json()) as CardFigures;
	} catch {
		return undefined;
	}
}

/** Both atlases for one plant and the figures that stand its cards, or undefined when unbaked. */
async function cardOf(
	{ assets }: SketchContext,
	figures: CardFigures,
	kind: PlantKind,
): Promise<PlantCard | undefined> {
	const at = figures.species[kind];
	const files = CARD_ATLASES[kind];
	if (!at || !files) return undefined;
	const [color, surface] = await Promise.all([
		assets.loadTexture(files.color, {
			colorSpace: 'srgb',
			wrap: 'clamp',
			mipmaps: false,
			flipY: false,
		}),
		assets.loadTexture(files.surface, {
			colorSpace: 'linear',
			wrap: 'clamp',
			mipmaps: false,
			flipY: false,
		}),
	]);
	return { color, surface, atlas: figures.atlas, size: at.size, room: at.room, depth: at.depth };
}

/** A model's card figures and both atlases for one plant, or undefined when the build wrote none. */
export async function loadPlantCard(
	ctx: SketchContext,
	model: 'trees' | 'shrubs',
	kind: PlantKind,
): Promise<PlantCard | undefined> {
	const figures = await cardFigures(model);
	return figures ? cardOf(ctx, figures, kind) : undefined;
}

/** One plant's parts, or undefined when the file or the bake does not carry every one of them. */
async function optionalPlant(
	ctx: SketchContext,
	part: (name: string) => Part,
	name: PlantKind,
	figures: CardFigures | undefined,
): Promise<Plant | undefined> {
	const find = (id: string): Part | undefined => {
		try {
			return part(id);
		} catch {
			return undefined;
		}
	};
	const wood = find(`${name}-wood`);
	const leaves = find(`${name}-leaves`);
	const card = figures ? await cardOf(ctx, figures, name) : undefined;
	return wood && leaves && card ? { wood, leaves, card } : undefined;
}

/** Loads both model files and the far cards' atlases at once. */
export async function loadPlants(ctx: SketchContext): Promise<Plants> {
	const { assets } = ctx;
	const [trees, shrubs, treeFigures, shrubFigures] = await Promise.all([
		assets.loadGltf(sampleUrl('sources/showcase/island/trees.glb')),
		assets.loadGltf(sampleUrl('sources/showcase/island/shrubs.glb')),
		cardFigures('trees'),
		cardFigures('shrubs'),
	]);
	const tree = partsOf(trees);
	const shrub = partsOf(shrubs);
	const species = Object.fromEntries(
		await Promise.all(
			SPECIES.map(async (name) => {
				const part = name === 'oleander' ? shrub : tree;
				const figures = name === 'oleander' ? shrubFigures : treeFigures;
				const plant = await optionalPlant(ctx, part, name, figures);
				if (!plant) throw new Error(`${trees.url} or ${shrubs.url} has no ${name} with its card`);
				return [name, plant];
			}),
		),
	) as Record<Species, Plant>;
	return { species, cypress: await optionalPlant(ctx, tree, 'cypress', treeFigures) };
}

/** The file that holds the island's people and vehicles. */
export const LIFE_MODEL = sampleUrl('sources/showcase/island-life/life.glb');

/** The walkers that the file holds, and the clip that each one plays. */
const WALKERS = [
	{ kind: 'villager', clip: 'walk-villager' },
	{ kind: 'woman', clip: 'walk-woman' },
	{ kind: 'youngman', clip: 'walk-youngman' },
] as const;

/** The mesh nodes of a person, and the clothing that takes a colour of its own. */
const PERSON_MESHES: readonly { readonly name: string; readonly tint?: TintRole }[] = [
	{ name: 'body' },
	{ name: 'hair' },
	{ name: 'shirt', tint: 'cloth' },
	{ name: 'trousers', tint: 'legs' },
	{ name: 'shoes', tint: 'feet' },
];

/** The wheels of a vehicle: their names, and which pair steers into a curve. */
const WHEELS = [
	{ name: 'wheel-fl', front: true },
	{ name: 'wheel-fr', front: true },
	{ name: 'wheel-bl', front: false },
	{ name: 'wheel-br', front: false },
] as const;

/** The radius of each vehicle's wheels, in meters. */
const WHEEL_RADIUS = { hatchback: 0.31, minibus: 0.36 } as const;

/** A part of the file that may be missing, such as a wheel that an older build merged into its tyres. */
function optionalModelPart(part: (name: string) => Part, name: string): Part | undefined {
	try {
		return part(name);
	} catch {
		return undefined;
	}
}

/** A loaded part as an instance part, with the place that its node gives it. */
function trafficPartOf(part: Part, tint?: TintRole): TrafficPart {
	const place = placed(part, [0, 0, 0], 0, 1);
	return {
		mesh: part.mesh,
		material: part.material,
		position: place.position,
		rotation: place.rotation,
		nodeScale: place.scale,
		...(tint !== undefined && { tint }),
	};
}

/**
 * A vehicle's parts, in the order that a livery paints them. The wheels are parts of their own
 * when the file holds them, and otherwise the one tyres part stands in their place.
 */
function vehicleParts(
	part: (name: string) => Part,
	name: 'hatchback' | 'minibus',
	hidden: string[],
): TrafficPart[] {
	const parts: TrafficPart[] = [];
	const add = (id: string, tint?: TintRole): boolean => {
		const found = optionalModelPart(part, `${name}-${id}`);
		if (!found) return false;
		parts.push(trafficPartOf(found, tint));
		hidden.push(`${name}-${id}`);
		return true;
	};
	if (!add('hull', 'paint')) throw new Error(`${LIFE_MODEL} has no ${name}-hull`);
	if (name === 'minibus') add('band', 'accent');
	add('glass');
	add('trim');
	// A file that predates the four wheels carries one tyres part, which cannot spin.
	if (!add('tyres')) {
		const radius = WHEEL_RADIUS[name];
		for (const wheel of WHEELS) {
			const found = optionalModelPart(part, `${name}-${wheel.name}`);
			if (found) {
				parts.push({ ...trafficPartOf(found), wheel: { radius, front: wheel.front } });
				hidden.push(`${name}-${wheel.name}`);
			}
		}
	}
	return parts;
}

/** One person's standing far proxy, in the order of its body parts. */
function proxyParts(part: (name: string) => Part, kind: string): TrafficPart[] {
	const parts: TrafficPart[] = [];
	for (const mesh of PERSON_MESHES) {
		const found = optionalModelPart(part, `${kind}-far-${mesh.name}`);
		if (found) parts.push(trafficPartOf(found, mesh.tint));
	}
	return parts;
}

/** One person's skinned walker, when the file holds every mesh of it and its clip. */
function walkerOf(
	part: (name: string) => Part,
	prefab: Prefab,
	kind: string,
	clip: string,
	hidden: readonly string[],
): WalkerModel | undefined {
	if (!prefab.clips.includes(clip)) return undefined;
	const meshes: WalkerPart[] = [];
	for (const mesh of PERSON_MESHES) {
		const name = `${kind}-${mesh.name}`;
		if (!optionalModelPart(part, name)) return undefined;
		meshes.push({ name, ...(mesh.tint !== undefined && { tint: mesh.tint }) });
	}
	return {
		prefab,
		parts: meshes,
		hidden: hidden.filter((name) => !PERSON_MESHES.some((mesh) => name === `${kind}-${mesh.name}`)),
		clip,
	};
}

/**
 * Loads the file that holds the island's people and vehicles. The name lists that a walker copy
 * hides are built from every model in the file, so a copy draws only the walker that it stands.
 */
export async function loadLifeModels({ assets }: SketchContext): Promise<TrafficModels> {
	const prefab = await assets.loadGltf(LIFE_MODEL);
	const part = partsOf(prefab);
	const hidden: string[] = [];
	const car = vehicleParts(part, 'hatchback', hidden);
	const bus = vehicleParts(part, 'minibus', hidden);
	// A walker copy hides the other kinds' walkers and every far proxy. A skinned mesh sits under
	// the copy's own group, with no rig object above it, so the meshes of the other walkers hide
	// one by one.
	for (const walker of WALKERS)
		for (const mesh of PERSON_MESHES) hidden.push(`${walker.kind}-${mesh.name}`);
	for (const walker of WALKERS)
		for (const mesh of PERSON_MESHES) hidden.push(`${walker.kind}-far-${mesh.name}`);
	const people: PersonModel[] = WALKERS.map((walker) => ({
		parts: proxyParts(part, walker.kind),
		walker: walkerOf(part, prefab, walker.kind, walker.clip, hidden),
	}));
	return { car, bus, people };
}
