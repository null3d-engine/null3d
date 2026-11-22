// The island's plants: a Mediterranean cypress, stone pine, an olive, a holm oak and an oleander.
// A script builds them in Blender (tools/samples/blender/island.py), and the asset tool optimizes
// them, so they load as a developer ships models: quantized meshes and KTX2 textures. They live in
// the sample-assets repository. Each plant has a wood part and a leaves part, each with two lower
// levels of detail, and a card part: crossed quads that carry the whole plant baked from the side
// and from above, for the far copies. The wood and the leaves carry their sway in their second
// texture coordinates, which the wind material reads.
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
import type { Prefab, SketchContext } from '@null3d/engine';
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

/** One plant's parts: its swaying wood and leaves, and its far card. */
export interface Plant {
	readonly wood: Part;
	readonly leaves: Part;
	readonly card: Part;
}

/** The plants of both files, and the cypress when the trees file carries one. */
export interface Plants {
	readonly species: Record<Species, Plant>;
	/** The cypress, or undefined while the loaded trees file has none. */
	readonly cypress: Plant | undefined;
}

/** One plant's parts, or undefined when the file does not carry every one of them. */
function optionalPlant(part: (name: string) => Part, name: string): Plant | undefined {
	const found = [`${name}-wood`, `${name}-leaves`, `${name}-card`].map((id) => {
		try {
			return part(id);
		} catch {
			return undefined;
		}
	});
	const [wood, leaves, card] = found;
	return wood && leaves && card ? { wood, leaves, card } : undefined;
}

/** Loads both model files at once. */
export async function loadPlants({ assets }: SketchContext): Promise<Plants> {
	const [trees, shrubs] = await Promise.all([
		assets.loadGltf(sampleUrl('sources/showcase/island/trees.glb')),
		assets.loadGltf(sampleUrl('sources/showcase/island/shrubs.glb')),
	]);
	const tree = partsOf(trees);
	const shrub = partsOf(shrubs);
	const species = Object.fromEntries(
		SPECIES.map((name) => {
			const part = name === 'oleander' ? shrub : tree;
			return [
				name,
				{ wood: part(`${name}-wood`), leaves: part(`${name}-leaves`), card: part(`${name}-card`) },
			];
		}),
	) as Record<Species, Plant>;
	return { species, cypress: optionalPlant(tree, 'cypress') };
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
